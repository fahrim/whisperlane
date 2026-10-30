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
    publish_runtime_pin();
    tauri_build::build();
}

/// Fetches the runtime through the one script that owns the pin.
///
/// This deliberately does not decide for itself whether the staged
/// runtime is current. The tag lives in `fetch-runtime.ps1`; the marker
/// is only a record of what that script last staged. A build script that
/// short-circuits on "a marker exists and some server exists" can publish
/// the old pin after the tag has moved, which is exactly the failure this
/// arrangement removes. The script's own fast path checks the tag, the
/// pinned digest, and every required file before it skips the download.
fn ensure_runtime() {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    // Windows PowerShell, not pwsh: the script is run from cmd or
    // PowerShell alike and must not depend on which one is first on PATH.
    let script = manifest
        .join("..")
        .join("..")
        .join("..")
        .join("scripts")
        .join("fetch-runtime.ps1");
    if !script.is_file() {
        panic!(
            "could not find the runtime fetch script at {}",
            script.display()
        );
    }
    // Windows PowerShell 5.1 reads a BOM-less file as the system code
    // page, so a UTF-8 dash inside a string can be read as a quote and
    // break the parse. Keep the script ASCII and fail here with a clear
    // reason instead of letting the parser point at the wrong brace.
    let script_bytes = std::fs::read(&script)
        .unwrap_or_else(|e| panic!("could not read {}: {e}", script.display()));
    if let Some(offset) = script_bytes.iter().position(|byte| !byte.is_ascii()) {
        let line = script_bytes[..offset]
            .iter()
            .filter(|&&byte| byte == b'\n')
            .count()
            + 1;
        panic!(
            "{} has a non-ASCII byte on line {line}; the fetch script must \
             stay ASCII because Windows PowerShell 5.1 misreads UTF-8 \
             without a BOM",
            script.display()
        );
    }
    // The pin and the digest live in this script. Cargo has to rerun the
    // build script when either moves, or an existing target directory
    // keeps the runtime and the compiled-in pin from the old tag. The
    // staged directory is tracked too, so a deleted engine is restored
    // rather than silently shipped.
    println!("cargo:rerun-if-changed={}", script.display());
    println!(
        "cargo:rerun-if-changed={}",
        manifest.join("runtime").display()
    );
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

    // The script is the gate, but the bundle cannot work without both
    // backends. Checking here turns a packaging mistake into a build
    // failure rather than a first-run failure on a user's machine.
    let runtime = manifest.join("runtime");
    for engine in ["whisper-server.exe", "whisper-server-cpu.exe"] {
        if !runtime.join(engine).is_file() {
            panic!(
                "the staged transcription runtime has no {engine}. \
                 Run scripts\\fetch-runtime.ps1 -Force to refetch it."
            );
        }
    }
}

/// Hands the staged pin to the application.
///
/// The data directory keeps several runtime versions side by side; this
/// is how the running build knows which one it shipped and therefore
/// which one it must install or switch to. Without it the app would
/// have to guess from file names, which is exactly the kind of claim
/// ADR-010 removes.
fn publish_runtime_pin() {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let pin_file = manifest.join(RUNTIME_PIN);
    println!("cargo:rerun-if-changed={}", pin_file.display());
    let pin = std::fs::read_to_string(&pin_file)
        .unwrap_or_else(|e| panic!("could not read {}: {e}", pin_file.display()));
    // The marker records the pin first, then the staged archive digest.
    // The pin is the directory name; the digest is the script's business.
    let pin = pin.split_whitespace().next().unwrap_or_default();
    if pin.is_empty() {
        panic!("{} is empty", pin_file.display());
    }
    println!("cargo:rustc-env=WHISPERLANE_RUNTIME_PIN={pin}");
}
