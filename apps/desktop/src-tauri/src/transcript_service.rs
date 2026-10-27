//! The local transcript service.
//!
//! A finished dictation is published once, as one JSON object per line,
//! on loopback. It exists so another local program — an agent, a script, an
//! editor — can be fed the words the user just spoke without reading the
//! screen, the clipboard, or the focused window.
//!
//! The contract is deliberately small and versioned. Everything else in
//! whisperlane may change shape; this line may not:
//!
//! ```text
//! {"version":"1.0","event":"transcript","text":"…","timestamp":1710000000000}
//! ```
//!
//! Off unless the user turns it on. It is the one part of the
//! application that hands a transcript to another process, so it is the
//! one part that has to be asked for.

use std::io::Write;
use std::net::{TcpListener, TcpStream};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// The port the service listens on.
///
/// Fixed rather than discovered, because a consumer that has to find the
/// port has to find a discovery mechanism too, and the contract is meant
/// to be one line of documentation.
pub const PORT: u16 = 47830;

/// The shape of a published line. Bumped only when a consumer would have
/// to change to keep working.
pub const CONTRACT_VERSION: &str = "1.0";

/// Enough for one consumer and a couple of experiments. More than this is
/// a sign the service is being used for something it is not.
const MAX_SUBSCRIBERS: usize = 8;

/// How long the accept loop waits between polls. The listener is
/// non-blocking so that turning the service off actually stops it,
/// rather than leaving a thread asleep in `accept` forever.
const POLL: Duration = Duration::from_millis(40);

struct State {
    running: bool,
    subscribers: Vec<TcpStream>,
    error: Option<String>,
}

static SERVICE: Mutex<State> = Mutex::new(State {
    running: false,
    subscribers: Vec::new(),
    error: None,
});

/// A poisoned lock must not take dictation down with it: the worst this
/// module can do is fail to publish, which is already a supported state.
fn lock() -> MutexGuard<'static, State> {
    SERVICE.lock().unwrap_or_else(|e| e.into_inner())
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct TranscriptServiceStatus {
    pub running: bool,
    pub port: u16,
    pub subscribers: usize,
    pub error: Option<String>,
}

pub fn status() -> TranscriptServiceStatus {
    let guard = lock();
    TranscriptServiceStatus {
        running: guard.running,
        port: PORT,
        subscribers: guard.subscribers.len(),
        error: guard.error.clone(),
    }
}

#[tauri::command]
pub fn transcript_service_status() -> TranscriptServiceStatus {
    status()
}

/// Starts listening, once. A second call while running is a no-op rather
/// than a second thread on the same port.
pub fn start() {
    {
        let mut guard = lock();
        if guard.running {
            return;
        }
        guard.running = true;
        guard.error = None;
    }
    std::thread::spawn(run);
}

/// Stops listening and drops every subscriber.
///
/// The accept loop sees the flag within one poll and the subscribers are
/// closed by being dropped, so a consumer sees the connection end rather
/// than a service that silently went quiet.
pub fn stop() {
    let mut guard = lock();
    guard.running = false;
    guard.subscribers.clear();
}

fn run() {
    let listener = match TcpListener::bind(("127.0.0.1", PORT)) {
        Ok(listener) => listener,
        Err(e) => {
            let mut guard = lock();
            guard.running = false;
            guard.error = Some(format!("could not listen on 127.0.0.1:{PORT}: {e}"));
            return;
        }
    };
    let _ = listener.set_nonblocking(true);

    while lock().running {
        match listener.accept() {
            Ok((stream, _)) => {
                let _ = stream.set_nodelay(true);
                let mut guard = lock();
                if guard.subscribers.len() < MAX_SUBSCRIBERS {
                    guard.subscribers.push(stream);
                }
                // Beyond the cap the connection is simply dropped: a
                // dictation tool is not a message bus, and refusing a
                // subscriber is clearer than queueing for one.
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(POLL);
            }
            Err(e) => {
                let mut guard = lock();
                guard.error = Some(format!("the listener stopped: {e}"));
                guard.running = false;
                break;
            }
        }
    }

    lock().running = false;
}

/// Publishes one finished transcript to every live subscriber.
///
/// A subscriber that has gone away is dropped here rather than being
/// remembered: the list is the set of streams that last worked, not the
/// set that ever connected.
pub fn publish(text: &str) {
    let line = payload(text);
    let mut guard = lock();
    if !guard.running {
        return;
    }
    guard
        .subscribers
        .retain_mut(|stream| stream.write_all(line.as_bytes()).is_ok());
}

/// One line of the contract, newline included.
fn payload(text: &str) -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0);
    let body = serde_json::json!({
        "version": CONTRACT_VERSION,
        "event": "transcript",
        "text": text,
        "timestamp": timestamp,
    });
    format!("{body}\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_published_line_is_one_json_object_with_the_contract_fields() {
        let line = payload("hello \"world\"\nsecond line");
        assert!(line.ends_with('\n'), "a line must be a line");
        assert_eq!(
            line.matches('\n').count(),
            1,
            "an embedded newline would split the contract in two"
        );
        let value: serde_json::Value = serde_json::from_str(line.trim()).expect("valid JSON");
        assert_eq!(value["version"], CONTRACT_VERSION);
        assert_eq!(value["event"], "transcript");
        assert_eq!(value["text"], "hello \"world\"\nsecond line");
        assert!(value["timestamp"].is_u64());
    }

    #[test]
    fn publishing_without_the_service_running_is_silent() {
        stop();
        // Nothing to assert beyond "it returns": the point is that a
        // disabled service cannot interfere with a take.
        publish("nobody is listening");
        assert!(!status().running);
    }
}
