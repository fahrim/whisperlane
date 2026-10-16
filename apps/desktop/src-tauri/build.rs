//! Build steps that have to happen before the crate compiles.
//!
//! The transcription runtime is not ours and is not committed: it is
//! whisper.cpp built with Vulkan, fetched by tag and checksum from the
//! repository that builds it. It is a build prerequisite rather than a
//! convenience — the bundle declares it as a resource, so a build with
//! nothing there does not compile at all.
//!
//! Fetching here rather than from a npm-style install step means every
//! entry point works the same way: `cargo test` on a fresh clone fetches
//! it exactly as `tauri build` does, and neither can be run against a
//! runtime somebody placed by hand.

use std::path::Path;
use std::process::Command;

/// The marker `fetch-runtime.ps1` writes beside the staged engine,
/// naming the pin it staged. Beside the directory rather than inside it,
/// so the bundle's resource glob does not ship it to every install.
const RUNTIME_PIN: &str = "runtime.pin";

fn main() {
    ensure_runtime();
    tauri_build::build();
}

/// Fetches the runtime unless it is already staged at the current pin.
fn ensure_runtime() {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    if manifest.join(RUNTIME_PIN).is_file() {
        return;
    }
    // Windows PowerShell, not pwsh: the script is run from cmd or
    // PowerShell alike and must not depend on which one is first on PATH.
    let script = manifest
        .join("..")
        .join("..")
        .join("scripts")
        .join("fetch-runtime.ps1");
    let status = Command::new("powershell.exe")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(&script)
        .status();
    match status {
        Ok(s) if s.success() => {}
        Ok(s) => panic!(
            "could not fetch the transcription runtime (exit {s}). \
             Run scripts\\fetch-runtime.ps1 to see why."
        ),
        Err(e) => panic!(
            "could not run scripts\\fetch-runtime.ps1: {e}. \
             The build needs the engine; see docs for the offline route."
        ),
    }
}
