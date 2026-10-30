//! Shared transcription helpers: the engine input shape, quiet-input
//! gain, the backend vocabulary, and the `whisper-server` multipart
//! protocol. Proven shapes ported from the `opencode-listen-stt` plugin:
//! 16 kHz mono takes, peak-target gain, multipart `/inference` with an
//! OpenAI-compatible fallback. Backend selection itself lives in the
//! supervisor, because only a real launch can answer it.

use std::path::Path;

/// Engine input shape.
pub const ENGINE_SAMPLE_RATE: u32 = 16_000;

/// Plugin's gain shape: lift quiet takes toward this peak without
/// amplifying silence into noise. Factor is capped.
pub const GAIN_TARGET_PEAK: f32 = 8000.0 / 32768.0;
pub const GAIN_MAX_FACTOR: f32 = 40.0;
pub const GAIN_MIN_FACTOR: f32 = 1.05;

pub const INFERENCE_PATH: &str = "/inference";
pub const OPENAI_FALLBACK_PATH: &str = "/v1/audio/transcriptions";

/// GPU-first backend walk: CUDA, then Vulkan, then CPU. Same binary
/// serves all three; the walk only reports what is available.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Backend {
    Cuda,
    Vulkan,
    Cpu,
}

impl Backend {
    pub fn as_str(self) -> &'static str {
        match self {
            Backend::Cuda => "cuda",
            Backend::Vulkan => "vulkan",
            Backend::Cpu => "cpu",
        }
    }
}

/// Linear resampler for mono f32 takes. Takes are short; clarity beats speed.
pub fn resample_linear(samples: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if samples.is_empty() || from_rate == 0 || to_rate == 0 {
        return Vec::new();
    }
    if from_rate == to_rate {
        return samples.to_vec();
    }
    let ratio = from_rate as f64 / to_rate as f64;
    let out_len = (samples.len() as f64 / ratio).ceil() as usize;
    (0..out_len)
        .map(|i| {
            let pos = i as f64 * ratio;
            let lo = pos.floor() as usize;
            let hi = (lo + 1).min(samples.len() - 1);
            let frac = (pos - lo as f64) as f32;
            samples[lo] * (1.0 - frac) + samples[hi] * frac
        })
        .collect()
}

/// Loads a take file as mono f32 plus its sample rate.
pub fn load_wav_mono_f32(path: &Path) -> Result<(Vec<f32>, u32), String> {
    let mut reader = hound::WavReader::open(path).map_err(|e| format!("cannot read take: {e}"))?;
    let spec = reader.spec();
    let channels = spec.channels.max(1) as usize;
    let samples: Result<Vec<f32>, _> = match (spec.bits_per_sample, spec.sample_format) {
        (16, hound::SampleFormat::Int) => reader
            .samples::<i16>()
            .map(|s| s.map(|v| v as f32 / i16::MAX as f32).map_err(|e| e.to_string()))
            .collect(),
        (32, hound::SampleFormat::Float) => {
            reader.samples::<f32>().map(|s| s.map_err(|e| e.to_string())).collect()
        }
        (b, f) => return Err(format!("unsupported take format: {b}-bit {f:?}")),
    };
    let samples = samples.map_err(|e| format!("cannot read take: {e}"))?;
    let mono: Vec<f32> = samples
        .chunks(channels)
        .map(|frame| frame.iter().sum::<f32>() / frame.len() as f32)
        .collect();
    Ok((mono, spec.sample_rate))
}

/// Software gain toward a healthy level. Returns the applied factor;
/// 1.0 means untouched (already loud enough, or pure silence).
pub fn normalize_gain(samples: &mut [f32]) -> f32 {
    let peak = samples.iter().fold(0.0f32, |m, &v| m.max(v.abs()));
    if peak <= f32::EPSILON || peak >= GAIN_TARGET_PEAK {
        return 1.0;
    }
    let factor = (GAIN_TARGET_PEAK / peak).min(GAIN_MAX_FACTOR);
    if factor <= GAIN_MIN_FACTOR {
        return 1.0;
    }
    for s in samples.iter_mut() {
        *s = (*s * factor).clamp(-1.0, 1.0);
    }
    factor
}

/// Builds a multipart/form-data body for the transcription endpoints.
/// Pure constructor so the exact bytes are unit-tested.
pub fn multipart_body(boundary: &str, wav: &[u8], language: &str) -> Vec<u8> {
    let mut body = Vec::new();
    let part = |b: &mut Vec<u8>, s: &str| b.extend_from_slice(s.as_bytes());
    part(&mut body, &format!("--{boundary}\r\n"));
    part(
        &mut body,
        "Content-Disposition: form-data; name=\"file\"; filename=\"voice.wav\"\r\n",
    );
    part(&mut body, "Content-Type: audio/wav\r\n\r\n");
    body.extend_from_slice(wav);
    part(&mut body, "\r\n");
    part(&mut body, &format!("--{boundary}\r\n"));
    part(
        &mut body,
        "Content-Disposition: form-data; name=\"response_format\"\r\n\r\n",
    );
    part(&mut body, "json\r\n");
    part(&mut body, &format!("--{boundary}\r\n"));
    part(
        &mut body,
        "Content-Disposition: form-data; name=\"language\"\r\n\r\n",
    );
    part(&mut body, language);
    part(&mut body, "\r\n");
    part(&mut body, &format!("--{boundary}--\r\n"));
    body
}

/// Pulls `text` out of either endpoint's JSON reply.
pub fn parse_transcript(json: &str) -> Result<String, String> {
    let v: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("bad transcription response: {e}"))?;
    v.get("text")
        .and_then(|t| t.as_str())
        .map(|t| t.trim().to_string())
        .ok_or_else(|| "transcription response has no text".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_rate_returns_identical_samples() {
        let s = vec![0.1, -0.2, 0.3];
        assert_eq!(resample_linear(&s, 16_000, 16_000), s);
    }

    #[test]
    fn downsample_halves_length() {
        let s: Vec<f32> = (0..100).map(|i| i as f32).collect();
        let out = resample_linear(&s, 48_000, 16_000);
        assert!((out.len() as i32 - 34).abs() <= 1);
    }

    #[test]
    fn quiet_take_is_lifted_silence_is_not() {
        let mut loud = vec![0.5; 100];
        assert_eq!(normalize_gain(&mut loud), 1.0);
        let mut quiet = vec![0.01; 100];
        let factor = normalize_gain(&mut quiet);
        assert!(factor > GAIN_MIN_FACTOR);
        assert!((quiet[0] - 0.01 * factor).abs() < 1e-6);
        let mut silence = vec![0.0; 100];
        assert_eq!(normalize_gain(&mut silence), 1.0);
    }

    #[test]
    fn multipart_body_carries_file_and_language() {
        let body = multipart_body("BOUND", b"WAVBYTES", "tr");
        let text = String::from_utf8_lossy(&body);
        assert!(text.contains("name=\"file\"; filename=\"voice.wav\""));
        assert!(text.contains("WAVBYTES"));
        assert!(text.contains("name=\"language\"\r\n\r\ntr"));
        assert!(text.starts_with("--BOUND\r\n"));
        assert!(text.ends_with("--BOUND--\r\n"));
    }

    #[test]
    fn transcript_parses_and_trims() {
        assert_eq!(parse_transcript(r#"{"text":"  merhaba  "}"#).unwrap(), "merhaba");
        assert!(parse_transcript(r#"{"nope":1}"#).is_err());
    }
}
