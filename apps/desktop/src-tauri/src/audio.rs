use std::cell::RefCell;
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc, Arc, Mutex, OnceLock,
};
use std::time::{SystemTime, UNIX_EPOCH};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::hotkey::{resolve_action, ChordAction, HookEvent};
use crate::pipeline::{current_phase, get_pipeline_state_inner, set_phase, Phase, PipelineStatus};
use crate::settings::Microphone;

/// Speech-grade capture shape: mono takes, short-take and silence floors.
/// Gain normalization toward a healthy level happens at the S4 handoff;
/// S3 stores the take as captured plus honest measurements.
pub const PREFERRED_SAMPLE_RATE: u32 = 16_000;
pub const MIN_TAKE_MS: u64 = 250;
pub const SILENCE_PEAK: f32 = 0.01;

/// How often the live loudness reading is published, in milliseconds.
///
/// Hard-throttled on purpose: this drives a visual hint, and one value
/// per audio buffer would flood the event channel for no visible gain.
pub const LEVEL_TICK_MS: u64 = 40;

/// A reading per audio buffer would be hundreds of events a second for a
/// visual hint nobody can read that fast. Checked where the constant
/// lives rather than only when the tests run.
const _: () = assert!(LEVEL_TICK_MS >= 30, "the meter would flood the channel");

/// Loudness that counts as a full meter for ordinary speech.
///
/// Chosen so a normal voice sits around the middle of the range and only
/// a raised voice reaches the top, which is what makes the meter
/// readable rather than pinned at one end.
pub const LEVEL_LOUD: f32 = 0.25;

/// Loudness of a slice of samples, normalised to `0.0..=1.0`.
///
/// Root mean square rather than peak, because peak jumps on a single
/// click and collapses just as fast — which reads as noise rather than
/// as a voice. Silent input reads as silence rather than as an error.
pub fn rms_level(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let mean = samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32;
    (mean.sqrt() / LEVEL_LOUD).clamp(0.0, 1.0)
}

#[derive(Debug)]
pub struct TakeStats {
    pub duration_ms: u64,
    pub peak: f32,
}

/// One usable input device, as the settings surface needs it.
///
/// Identity is the device's own name, which is what the host gives us
/// without extra dependencies. Two identically named devices are a
/// limitation, stated here rather than hidden.
#[derive(Debug, Clone, serde::Serialize)]
pub struct InputDevice {
    pub id: String,
    pub label: String,
}

fn device_name(device: &cpal::Device) -> Option<String> {
    device.name().ok()
}

/// Every input device the host offers, for the settings surface.
/// A host that cannot enumerate its inputs reports none rather than
/// failing: the take path still reaches its own plain failure.
pub fn input_devices(host: &cpal::Host) -> Vec<InputDevice> {
    let Ok(devices) = host.input_devices() else {
        return Vec::new();
    };
    devices
        .filter_map(|device| {
            let name = device_name(&device)?;
            Some(InputDevice {
                id: name.clone(),
                label: name,
            })
        })
        .collect()
}

#[tauri::command]
pub fn list_input_devices() -> Vec<InputDevice> {
    input_devices(&cpal::default_host())
}

/// Ask-on-first-press rule (ADR-001): ask only when the user has not
/// chosen and there is actually something to choose between. With one
/// microphone or an explicit choice, nothing is asked.
pub fn should_ask_microphone(chosen: &Microphone, device_count: usize) -> bool {
    matches!(chosen, Microphone::SystemDefault) && device_count > 1
}

/// Whether the settings surface should be asking which microphone to
/// use. The rule lives in the core so the interface only renders it.
#[tauri::command]
pub fn needs_microphone_choice(app: AppHandle) -> bool {
    should_ask_microphone(
        &crate::settings::microphone_of(&app),
        list_input_devices().len(),
    )
}

/// Opens the chosen microphone, or fails with the reason in plain words.
/// A device that has been unplugged since it was chosen fails by name
/// rather than silently falling back to something else.
fn select_input_device(host: &cpal::Host, chosen: &Microphone) -> Result<cpal::Device, String> {
    match chosen.device_id() {
        None => host
            .default_input_device()
            .ok_or_else(|| "no microphone found — check the system input device".to_string()),
        Some(id) => device_by_name(host, id)
            .ok_or_else(|| format!("microphone '{id}' is gone — pick another one")),
    }
}

/// Looks the chosen device back up on the host by name.
fn device_by_name(host: &cpal::Host, name: &str) -> Option<cpal::Device> {
    host.input_devices()
        .ok()?
        .find(|device| device_name(device).as_deref() == Some(name))
}

/// Pure validation: silence and very short takes end in a clear,
/// recoverable Failed state instead of flowing downstream.
pub fn validate_take(sample_count: usize, sample_rate: u32, peak: f32) -> Result<TakeStats, &'static str> {
    let duration_ms = sample_count as u64 * 1000 / sample_rate.max(1) as u64;
    if duration_ms < MIN_TAKE_MS {
        return Err("take too short — hold the hotkey while speaking");
    }
    if peak < SILENCE_PEAK {
        return Err("no speech detected — try again");
    }
    Ok(TakeStats { duration_ms, peak })
}

/// Averages one interleaved frame down to mono.
pub fn push_frame_mono(samples: &mut Vec<f32>, frame: &[f32]) {
    if frame.is_empty() {
        return;
    }
    samples.push(frame.iter().sum::<f32>() / frame.len() as f32);
}

fn push_interleaved(samples: &Arc<Mutex<Vec<f32>>>, channels: usize, data: &[f32]) {
    if let Ok(mut guard) = samples.try_lock() {
        for frame in data.chunks(channels.max(1)) {
            push_frame_mono(&mut guard, frame);
        }
    }
}

pub fn take_path(dir: &std::path::Path, stem_ms: u128) -> PathBuf {
    dir.join(format!("take-{stem_ms}.wav"))
}

fn takes_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("could not resolve data dir: {e:?}"))?
        .join("takes");
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not create takes dir: {e}"))?;
    Ok(dir)
}

pub fn write_wav_mono16(
    path: &std::path::Path,
    samples: &[f32],
    sample_rate: u32,
) -> Result<(), hound::Error> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(path, spec)?;
    for &s in samples {
        let v = (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
        writer.write_sample(v)?;
    }
    writer.finalize()?;
    Ok(())
}

struct ActiveTake {
    // Held alive while recording; dropping the stream stops capture.
    _stream: cpal::Stream,
    samples: Arc<Mutex<Vec<f32>>>,
    sample_rate: u32,
    stream_failed: Arc<AtomicBool>,
}

// cpal::Stream is !Send, so the live stream lives and dies on the audio
// worker thread (spawned by run_listener), which is the only caller of
// begin_take/end_take. The hook thread only queues edges.
thread_local! {
    static ACTIVE_TAKE: RefCell<Option<ActiveTake>> = const { RefCell::new(None) };
}

fn pick_config(
    device: &cpal::Device,
) -> Result<(cpal::StreamConfig, cpal::SampleFormat), String> {
    let supported = device
        .supported_input_configs()
        .map_err(|e| format!("microphone unavailable: {e}"))?;
    let mut fallback = None;
    for range in supported {
        if range.min_sample_rate().0 <= PREFERRED_SAMPLE_RATE
            && range.max_sample_rate().0 >= PREFERRED_SAMPLE_RATE
        {
            let cfg = range.with_sample_rate(cpal::SampleRate(PREFERRED_SAMPLE_RATE));
            if cfg.channels() == 1 {
                return Ok((cfg.config(), cfg.sample_format()));
            }
            if fallback.is_none() {
                fallback = Some((cfg.config(), cfg.sample_format()));
            }
        }
    }
    if let Some(cfg) = fallback {
        return Ok(cfg);
    }
    let def = device
        .default_input_config()
        .map_err(|e| format!("microphone unavailable: {e}"))?;
    Ok((def.config(), def.sample_format()))
}

fn spawn_stream(
    device: &cpal::Device,
    config: cpal::StreamConfig,
    format: cpal::SampleFormat,
    samples: Arc<Mutex<Vec<f32>>>,
    channels: usize,
    stream_failed: Arc<AtomicBool>,
) -> Result<cpal::Stream, String> {
    let err_fn = move |_| {
        stream_failed.store(true, Ordering::SeqCst);
    };
    match format {
        cpal::SampleFormat::F32 => {
            let s = Arc::clone(&samples);
            device
                .build_input_stream(
                    &config,
                    move |data: &[f32], _: &_| push_interleaved(&s, channels, data),
                    err_fn,
                    None,
                )
                .map_err(|e| format!("microphone unavailable: {e}"))
        }
        cpal::SampleFormat::I16 => {
            let s = Arc::clone(&samples);
            device
                .build_input_stream(
                    &config,
                    move |data: &[i16], _: &_| {
                        let conv: Vec<f32> =
                            data.iter().map(|&v| v as f32 / i16::MAX as f32).collect();
                        push_interleaved(&s, channels, &conv);
                    },
                    err_fn,
                    None,
                )
                .map_err(|e| format!("microphone unavailable: {e}"))
        }
        cpal::SampleFormat::U16 => {
            let s = Arc::clone(&samples);
            device
                .build_input_stream(
                    &config,
                    move |data: &[u16], _: &_| {
                        let conv: Vec<f32> = data
                            .iter()
                            .map(|&v| v as f32 / u16::MAX as f32 * 2.0 - 1.0)
                            .collect();
                        push_interleaved(&s, channels, &conv);
                    },
                    err_fn,
                    None,
                )
                .map_err(|e| format!("microphone unavailable: {e}"))
        }
        other => Err(format!("unsupported microphone format: {other:?}")),
    }
}

/// What the pill's own controls ask for (ADR-008).
///
/// The main control is one control, not two: it starts a take from a
/// resting state and stops a live one. Which of the two it means is the
/// decision table's call and never the surface's, so a pill showing a
/// stale phase cannot ask to stop a take that never began.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TakeCommand {
    /// The main control was pressed: start at rest, stop while live.
    Control,
    /// The cancel action: throw the take away, exactly as Escape does.
    Discard,
}

impl From<TakeCommand> for HookEvent {
    /// A control press stands for the chord press that would have meant
    /// the same thing, so both reach the one decision table instead of
    /// restating its rules.
    fn from(command: TakeCommand) -> Self {
        match command {
            TakeCommand::Control => HookEvent::Pressed,
            TakeCommand::Discard => HookEvent::Cancelled,
        }
    }
}

/// One turn of the take worker.
#[derive(Debug)]
pub enum Intent {
    /// A chord edge observed by the hook.
    Chord(HookEvent),
    /// A press of the pill's own control.
    Control(TakeCommand),
}

static INBOX: OnceLock<mpsc::Sender<Intent>> = OnceLock::new();

/// Starts the take worker.
///
/// The live capture stream is `!Send` and lives on this one thread, so
/// every intent is handed to the worker instead of being acted on by
/// whichever surface pressed it.
pub fn spawn_worker(app: AppHandle) {
    let (tx, rx) = mpsc::channel::<Intent>();
    let _ = INBOX.set(tx);
    std::thread::spawn(move || {
        for intent in rx {
            crate::hotkey::debug_log(format!("worker {intent:?}\n"));
            dispatch(&app, intent);
        }
    });
}

/// Queues an intent for the take worker. Reports whether it was
/// accepted, because a dropped stop would leave a take open until the
/// next press.
pub fn send(intent: Intent) -> bool {
    INBOX.get().is_some_and(|tx| tx.send(intent).is_ok())
}

/// Queues a chord edge from the hook.
pub fn send_edge(event: HookEvent) -> bool {
    send(Intent::Chord(event))
}

/// Queues a press of the pill's control.
pub fn request(command: TakeCommand) -> bool {
    send(Intent::Control(command))
}

/// Turns one intent into take work. The single entry point for the take
/// worker, so every dictation flow — chord or mouse — passes the same
/// decision table.
pub fn dispatch(app: &AppHandle, intent: Intent) {
    let event = match intent {
        Intent::Chord(event) => event,
        Intent::Control(command) => command.into(),
    };
    match resolve_action(event, current_phase(app)) {
        ChordAction::Start => begin_take(app),
        ChordAction::Stop => end_take(app),
        ChordAction::Cancel => cancel_take(app),
        ChordAction::Ignore => {}
    }
}

/// The pill's control, and the settings surface's cancel button.
///
/// The intent is queued rather than acted on here: the live stream
/// belongs to the take worker, so a take started or ended anywhere else
/// would never find it. The returned state is the honest snapshot at
/// this instant; the worker publishes the real one as it happens.
#[tauri::command]
pub fn take_control(app: AppHandle, command: TakeCommand) -> PipelineStatus {
    request(command);
    get_pipeline_state_inner(&app)
}

/// Publishes a live loudness reading while the take is capturing.
///
/// Derived from the samples already being captured, so it costs one
/// pass over the new audio and nothing else. The reading stops by itself
/// when the take ends, and ends at zero rather than freezing mid-wave,
/// so the meter never shows a level for audio no longer being heard.
pub fn spawn_level_ticker(app: &AppHandle, samples: Arc<Mutex<Vec<f32>>>) {
    let app = app.clone();
    std::thread::spawn(move || {
        let mut read_up_to = 0usize;
        while current_phase(&app) == Some(Phase::Listening) {
            std::thread::sleep(std::time::Duration::from_millis(LEVEL_TICK_MS));
            // try_lock, not lock: the capture thread appends to the same
            // buffer, and a visual hint is never worth waiting for.
            let Ok(guard) = samples.try_lock() else {
                continue;
            };
            if guard.len() <= read_up_to {
                continue;
            }
            let level = rms_level(&guard[read_up_to..]);
            read_up_to = guard.len();
            drop(guard);
            let _ = app.emit("audio-level", level);
        }
        let _ = app.emit("audio-level", 0.0f32);
    });
}

/// Hotkey pressed: open the microphone and start the take.
/// A missing or unusable microphone fails loudly, never silently deaf.
pub fn begin_take(app: &AppHandle) {
    // A new take clears the previous one, so the surface never shows or
    // copies a transcript and delivery note that belong to a finished take.
    crate::pipeline::clear_last_text(app);
    crate::pipeline::set_delivery(app, crate::pipeline::DeliveryKind::None, None);
    let take = (|| -> Result<ActiveTake, String> {
        let host = cpal::default_host();
        let device = select_input_device(&host, &crate::settings::microphone_of(app))?;
        let (config, format) = pick_config(&device)?;
        let channels = config.channels as usize;
        let sample_rate = config.sample_rate.0;
        let samples = Arc::new(Mutex::new(Vec::new()));
        let stream_failed = Arc::new(AtomicBool::new(false));
        let stream = spawn_stream(
            &device,
            config,
            format,
            Arc::clone(&samples),
            channels,
            Arc::clone(&stream_failed),
        )?;
        stream
            .play()
            .map_err(|e| format!("microphone unavailable: {e}"))?;
        Ok(ActiveTake {
            _stream: stream,
            samples,
            sample_rate,
            stream_failed,
        })
    })();
    match take {
        Ok(active) => {
            let samples = Arc::clone(&active.samples);
            ACTIVE_TAKE.with(|slot| *slot.borrow_mut() = Some(active));
            // The meter reads the very buffer the take will transcribe,
            // so it cannot drift from what is actually being heard.
            spawn_level_ticker(app, samples);
            crate::hotkey::debug_log("begin_take: stream live\n".to_string());
            set_phase(app, Phase::Listening, None);
        }
        Err(detail) => {
            crate::hotkey::debug_log(format!("begin_take failed: {detail}\n"));
            set_phase(app, Phase::Failed, Some(detail));
        }
    }
}

/// Hotkey released, or pressed again: stop capture, store the take,
/// validate it. Silence and very short takes fail here with a plain
/// message.
pub fn end_take(app: &AppHandle) {
    crate::hotkey::debug_log("end_take entry\n".to_string());
    let active = ACTIVE_TAKE.with(|slot| slot.borrow_mut().take());
    let Some(active) = active else {
        crate::hotkey::debug_log("end_take: no active stream\n".to_string());
        set_phase(app, Phase::Failed, Some("capture never started".to_string()));
        return;
    };
    // Dropping the stream stops the device; read what we got.
    drop(active._stream);
    let samples = active.samples.lock().expect("samples poisoned");
    if active.stream_failed.load(Ordering::SeqCst) {
        set_phase(
            app,
            Phase::Failed,
            Some("capture interrupted — try again".to_string()),
        );
        return;
    }
    let peak = samples.iter().fold(0.0f32, |m, &v| m.max(v.abs()));
    // Samples arrive mono already (downmixed per frame at capture).
    let stats = match validate_take(samples.len(), active.sample_rate, peak) {
        Ok(s) => s,
        Err(msg) => {
            set_phase(app, Phase::Failed, Some(msg.to_string()));
            return;
        }
    };
    let mono = samples.clone();
    drop(samples);
    let stored = (|| -> Result<(String, String), String> {
        let dir = takes_dir(app)?;
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| format!("could not timestamp take: {e}"))?
            .as_millis();
        let path = take_path(&dir, stamp);
        write_wav_mono16(&path, &mono, active.sample_rate)
            .map_err(|e| format!("could not store take: {e}"))?;
        let detail = format!(
            "take stored ({} ms, peak {:.2}); transcribing",
            stats.duration_ms, stats.peak
        );
        Ok((detail, path.to_string_lossy().into_owned()))
    })();
    match stored {
        Ok((detail, wav_path)) => {
            set_phase(app, Phase::Thinking, Some(detail));
            let handle = app.clone();
            crate::stt::transcribe_take(handle, wav_path);
        }
        Err(detail) => set_phase(app, Phase::Failed, Some(detail)),
    }
}

/// Discards the take. Capture stops and nothing is stored; a take
/// already being transcribed is abandoned when its result arrives, so
/// cancelled text is never delivered or copied.
/// Only a live take can be discarded. The decision table settles that
/// before this is reached; re-checking here keeps a late intent from
/// resurrecting a take that has already delivered.
pub fn cancel_take(app: &AppHandle) {
    if !matches!(
        current_phase(app),
        Some(Phase::Listening) | Some(Phase::Thinking)
    ) {
        return;
    }
    // Dropping the stream stops the device; the samples go with it.
    ACTIVE_TAKE.with(|slot| slot.borrow_mut().take());
    set_phase(
        app,
        Phase::Cancelled,
        Some("discarded — nothing was inserted".to_string()),
    );
}

/// Terminal phases (done, failed, cancelled) return to idle in one action.
/// This is also the pill's dismiss (ADR-007), so the path back to a
/// quiet idle never has to go through the settings window. It touches
/// no capture stream, so it does not queue for the take worker.
#[tauri::command]
pub fn reset_pipeline(app: AppHandle) -> PipelineStatus {
    let phase = current_phase(&app);
    match phase {
        Some(Phase::Done) | Some(Phase::Failed) | Some(Phase::Cancelled) => {
            set_phase(&app, Phase::Idle, None);
            // Delivery state belongs to the take that just ended.
            crate::pipeline::set_delivery(&app, crate::pipeline::DeliveryKind::None, None);
        }
        _ => {}
    }
    get_pipeline_state_inner(&app)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn silence_reads_as_silence_and_never_above_full() {
        assert_eq!(rms_level(&[]), 0.0, "no audio is no level");
        assert_eq!(rms_level(&[0.0; 640]), 0.0);
        // A level the meter cannot show is reported as full rather than
        // clipped into nonsense downstream.
        let loud: Vec<f32> = vec![1.0; 640];
        assert_eq!(rms_level(&loud), 1.0);
        assert!(rms_level(&[LEVEL_LOUD; 640]) <= 1.0);
    }

    #[test]
    fn ordinary_speech_sits_midway_rather_than_pinned() {
        // Half of the loud level reads as roughly half the meter, so a
        // normal voice moves the needle across the middle instead of
        // slamming to either end.
        let level = rms_level(&[LEVEL_LOUD / 2.0; 640]);
        assert!(
            (0.4..0.6).contains(&level),
            "half-loud speech read as {level}"
        );
    }

    #[test]
    fn one_loud_click_does_not_read_as_a_loud_voice() {
        // Why this is root mean square and not peak: a single click in a
        // quiet stretch would peg the meter, which reads as noise. Peak
        // reports a full meter there; spreading the same energy across
        // the window keeps it well under ordinary speech.
        let mut samples = vec![0.0f32; 639];
        samples.push(1.0);
        let with_click = rms_level(&samples);
        let speech = rms_level(&[LEVEL_LOUD / 2.0; 640]);
        assert!(
            with_click < speech / 2.0,
            "a lone click read as {with_click}, against speech at {speech}"
        );
    }

    #[test]
    fn silence_fails_with_plain_message() {
        let samples = vec![0.0f32; 16_000];
        let err = validate_take(samples.len(), 16_000, 0.0).unwrap_err();
        assert!(err.contains("no speech"));
    }

    #[test]
    fn very_short_take_fails_even_if_loud() {
        let err = validate_take(100, 16_000, 0.9).unwrap_err();
        assert!(err.contains("too short"));
    }

    #[test]
    fn healthy_take_passes_with_stats() {
        let stats = validate_take(16_000, 16_000, 0.42).unwrap();
        assert_eq!(stats.duration_ms, 1000);
        assert!((stats.peak - 0.42).abs() < f32::EPSILON);
    }

    #[test]
    fn frames_downmix_to_mono_average() {
        let mut out = Vec::new();
        push_frame_mono(&mut out, &[0.5, -0.5]);
        assert_eq!(out, vec![0.0]);
        push_frame_mono(&mut out, &[]);
        assert_eq!(out.len(), 1);
    }

    #[test]
    fn take_path_names_wav_in_dir() {
        let dir = std::path::Path::new("/tmp/takes");
        let p = take_path(dir, 123);
        assert_eq!(p.extension().and_then(|e| e.to_str()), Some("wav"));
        assert!(p.starts_with(dir));
    }

    #[test]
    fn wav_roundtrip_preserves_shape() {
        let dir = std::env::temp_dir();
        let path = dir.join("whisperlane-s3-roundtrip.wav");
        let samples: Vec<f32> = (0..1600).map(|i| (i as f32 / 1600.0) * 0.8).collect();
        write_wav_mono16(&path, &samples, 16_000).unwrap();
        let reader = hound::WavReader::open(&path).unwrap();
        let spec = reader.spec();
        assert_eq!(spec.channels, 1);
        assert_eq!(spec.sample_rate, 16_000);
        assert_eq!(reader.len(), 1600);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn asks_which_microphone_only_when_there_is_a_choice() {
        // Unchosen with several devices: ask, after the first take worked.
        assert!(should_ask_microphone(&Microphone::SystemDefault, 3));
        // Unchosen with one device: nothing to ask.
        assert!(!should_ask_microphone(&Microphone::SystemDefault, 1));
        assert!(!should_ask_microphone(&Microphone::SystemDefault, 0));
        // Already chosen: never ask again.
        assert!(!should_ask_microphone(
            &Microphone::Device("Headset".to_string()),
            3
        ));
    }

    #[test]
    fn microphone_exposes_only_a_named_device_id() {
        assert_eq!(Microphone::SystemDefault.device_id(), None);
        assert_eq!(
            Microphone::Device("Headset".to_string()).device_id(),
            Some("Headset")
        );
    }

    #[test]
    fn an_unusable_chosen_microphone_fails_by_name() {
        let host = cpal::default_host();
        let missing = Microphone::Device("no such microphone".to_string());
        let Err(detail) = select_input_device(&host, &missing) else {
            panic!("a microphone that does not exist must not open");
        };
        assert!(detail.contains("no such microphone"));
        assert!(detail.contains("pick another"));
    }

    #[test]
    fn every_control_command_stands_for_a_chord_edge() {
        // The pill and the chord must not drift apart: a control press
        // resolves through the same table, so each one maps to the edge
        // that would have meant the same thing.
        assert_eq!(HookEvent::from(TakeCommand::Control), HookEvent::Pressed);
        assert_eq!(HookEvent::from(TakeCommand::Discard), HookEvent::Cancelled);
    }

    #[test]
    fn the_mouse_reaches_exactly_what_the_keyboard_reaches() {
        // One control, two meanings: it starts at rest and stops a live
        // take, which is what a press of the chord already does.
        for resting in [
            Some(Phase::Idle),
            Some(Phase::Done),
            Some(Phase::Failed),
            Some(Phase::Cancelled),
        ] {
            assert_eq!(
                resolve_action(TakeCommand::Control.into(), resting),
                ChordAction::Start,
                "the control starts from {resting:?}"
            );
        }
        assert_eq!(
            resolve_action(TakeCommand::Control.into(), Some(Phase::Listening)),
            ChordAction::Stop
        );
        // Nothing to stop while transcribing: the take is already gone.
        assert_eq!(
            resolve_action(TakeCommand::Control.into(), Some(Phase::Thinking)),
            ChordAction::Ignore
        );

        for live in [Some(Phase::Listening), Some(Phase::Thinking)] {
            assert_eq!(
                resolve_action(TakeCommand::Discard.into(), live),
                ChordAction::Cancel,
                "discard while {live:?}"
            );
        }
        assert_eq!(
            resolve_action(TakeCommand::Discard.into(), Some(Phase::Done)),
            ChordAction::Ignore,
            "a delivered take cannot be discarded afterwards"
        );
    }
}
