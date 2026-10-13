use std::cell::RefCell;
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{SystemTime, UNIX_EPOCH};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use tauri::{AppHandle, Manager};

use crate::hotkey::{resolve_edge, ChordEdge};
use crate::pipeline::{current_phase, set_phase, Phase, PipelineStatus};
use crate::settings::Microphone;

/// Speech-grade capture shape: mono takes, short-take and silence floors.
/// Gain normalization toward a healthy level happens at the S4 handoff;
/// S3 stores the take as captured plus honest measurements.
pub const PREFERRED_SAMPLE_RATE: u32 = 16_000;
pub const MIN_TAKE_MS: u64 = 250;
pub const SILENCE_PEAK: f32 = 0.01;

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

/// Hotkey pressed: open the microphone and start the take.
/// A missing or unusable microphone fails loudly, never silently deaf.
pub fn begin_take(app: &AppHandle) {
    let phase = match current_phase(app) {
        Some(p) => p,
        None => return,
    };
    if resolve_edge(ChordEdge::Activated, phase) != Some(Phase::Listening) {
        return;
    }
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
            ACTIVE_TAKE.with(|slot| *slot.borrow_mut() = Some(active));
            crate::hotkey::debug_log("begin_take: stream live\n".to_string());
            set_phase(app, Phase::Listening, None);
        }
        Err(detail) => {
            crate::hotkey::debug_log(format!("begin_take failed: {detail}\n"));
            set_phase(app, Phase::Failed, Some(detail));
        }
    }
}

/// Hotkey released: stop capture, store the take, validate it.
/// Silence and very short takes fail here with a plain message.
pub fn end_take(app: &AppHandle) {
    let phase = match current_phase(app) {
        Some(p) => p,
        None => return,
    };
    crate::hotkey::debug_log(format!("end_take entry phase={phase:?}\n"));
    if resolve_edge(ChordEdge::Released, phase) != Some(Phase::Thinking) {
        crate::hotkey::debug_log("end_take: ignored, not a live take\n".to_string());
        return;
    }
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

/// Terminal phases (done, failed, cancelled) return to idle in one action.
#[tauri::command]
pub fn reset_pipeline(app: AppHandle) -> PipelineStatus {
    let phase = current_phase(&app);
    match phase {
        Some(Phase::Done) | Some(Phase::Failed) | Some(Phase::Cancelled) => {
            set_phase(&app, Phase::Idle, None);
        }
        _ => {}
    }
    crate::pipeline::get_pipeline_state_inner(&app)
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
