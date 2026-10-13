# whisperlane — pre-start intro plan

> **Dictate into your AI agent.** A free, local-first voice-to-text desktop app.

Status: **pre-start**. This is the document the project begins from — a shared
picture of what we are building and why, not a frozen spec. Expect it to change
once real code and real use push back.

---

## 1. What it is

whisperlane is a standalone desktop dictation app: press a hotkey, speak, and the
words appear where you need them. It is the independent build of the
`opencode-listen-stt` plugin, in the shape of SuperWhisper / Wispr Flow — but
free, open source, private by default (runs locally), and **native to AI
agents**: the words can land in any app, and — the reason this project exists —
straight into a coding agent like OpenCode.

One sentence: *hold a key, talk, and it is typed — into your editor, your chat,
or your agent.*

## 2. Why another one (an honest read of the field)

The space is crowded and mature. A sample of the open-source leaders:

| Project | Stars | Stack | Notes |
| --- | --- | --- | --- |
| `cjpais/Handy` | ~34k | Rust (Tauri) | Free, offline, cross-platform, extensible — the benchmark |
| `OpenWhispr/openwhispr` | ~9k | JS | Local + cloud (BYOK), cross-platform |
| `thewh1teagle/vibe` | ~8k | Tauri/TS | Focused on file transcription, not typing into apps |
| `Beingpax/VoiceInk` | ~7k | Swift | Excellent, but macOS-only |
| `crosswk/SayIt`, `infiniV/VoiceFlow`, … | 400–900 | TS / Python | Windows- and Linux-leaning dictation |

So we do **not** win by being "another dictation app". We win on a sharper idea.
Three axes, in priority order:

1. **AI-agent native.** Most tools type into *apps*. We make "type into your
   agent" a first-class, obvious path — starting with OpenCode, then generalising.
   This is a real, largely unclaimed niche, and it builds directly on what we
   already have working.
2. **Premium, uncluttered UX.** The standout should be how it *feels*: quiet,
   obvious, and beautiful — the sense of an Apple product. Not a settings wall.
3. **Any GPU on Windows (technical wedge).** NVIDIA/CUDA and Apple/Metal are
   covered by others; **AMD and Intel GPUs on Windows** are still painful. We have
   a whisper.cpp **Vulkan** build (`whisper-vulkan-win`) that closes exactly this
   gap. Fast local transcription with zero setup on hardware the others leave to
   the CPU.

## 3. Goals and non-goals

**Goals for v1**
- Hold-to-talk and toggle-to-talk dictation that inserts text into the focused
  app, reliably, on Windows.
- A first-class "dictate into OpenCode" flow.
- Fast local transcription on AMD/Intel/NVIDIA/CPU via whisper.cpp.
- A dead-simple first run: one screen, one key, model downloads quietly.
- A UX that feels finished — calm, sparse, confident.

**Non-goals for v1**
- Accounts, cloud sync, teams.
- Meeting recording / transcription library.
- Mobile.
- Model training or fine-tuning.
- Being a general "transcribe this file" tool (that is `vibe`'s job).

## 4. Experience — the part we win on

Principles, not screens:

- **The app is mostly invisible.** Its home is a tray/menu-bar icon and a hotkey.
  The main window is for onboarding and the occasional setting.
- **One window, one job.** No dashboard, no feature grid. Sensible defaults;
  everything advanced is folded away.
- **A quiet signal for every state.** Idle / listening / thinking / done — shown
  with one small, tasteful indicator (a waveform, a dot), never a wall of chrome.
- **Native feel.** Real platform behaviour, restrained motion, generous space,
  a single accent colour. Nothing that looks like a web app in a box.
- **First run is one screen.** Big, clear instruction: *hold the key and speak.*
  The model download runs in the background with honest progress. No account, no
  wizard.

## 5. Core flows

1. **Hold-to-talk** — hold the hotkey, speak, release. Transcribe and insert.
2. **Toggle-to-talk** — tap to start, tap to stop (for longer thoughts).
3. **Insert target** — the focused application by default; the agent as an
   explicit choice.
4. **Refine (optional, minimal by default)** — light local cleanup: punctuation
   and obvious filler. Off unless asked for; never rewrites meaning.
5. **Cancel** — discard the take without inserting anything.

## 6. AI-agent integration (the wedge)

Start with **OpenCode**, keep it thin and pluggable:

- **Mode A — dictate into the agent's prompt.** The transcribed text is placed in
  the agent's input, exactly like the plugin does today. Low risk, immediately
  useful.
- **Mode B — voice-first.** Transcribe, then hand the text to the agent as a
  prompt in one step.

Design rule: a single, documented **"target"** abstraction (focused app vs agent),
so later agents (Claude Code, Cursor, plain terminals …) are configuration, not a
rewrite. The agent integration is what the name's **tagline** carries; the product
stays simple.

## 7. Tech stack

- **Tauri v2** — Rust core, system webview, small binaries, native integration.
- **Bun** — package manager, scripts, and (where it fits) bundling/testing for the
  JS side.
- **React + TypeScript** — the UI.
- **whisper.cpp (ggml)** — ASR. Vulkan on Windows (AMD/Intel), CUDA/Metal where
  present, CPU as the floor.
- **Rust** for the parts that must be native: audio capture (`cpal`), global
  hotkey (`global-hotkey`), text injection (`enigo` / `SendInput` on Windows),
  tray, model manager, and the whisper binding.

## 8. Architecture (sketch)

```
┌──────────────────────────── whisperlane ────────────────────────────┐
│  React UI (Tauri webview)                                            │
│   onboarding · settings · tray popover · model manager              │
└───────────────▲───────────────────────────────┬─────────────────────┘
                │ Tauri commands / events        │
┌───────────────┴───────────────────────────────▼─────────────────────┐
│  Rust core                                                           │
│   hotkey ─▶ capture+VAD ─▶ ASR(whisper.cpp) ─▶ text ─▶ insert/target │
│   tray · model manager · preferences · logs                          │
└──────────────────────────────────────────────────────────────────────┘
```

Open decision: **in-process** (`whisper-rs`) vs a **sidecar whisper.cpp server**
(what the plugin does today). The sidecar is proven and lets us ship our Vulkan
build as-is; in-process is simpler to package. Decide with a spike (see §12).

## 9. Licensing

**Dual-licensed: MIT OR Apache-2.0** (the Rust-ecosystem convention; GitHub will
report it as *"MIT, Apache-2.0"*).

- `LICENSE-MIT` and `LICENSE-APACHE` at the repo root.
- `package.json` and `Cargo.toml`: `"license": "MIT OR Apache-2.0"`.
- Keep each license file as the unmodified canonical text (a stray appended note
  makes GitHub report the licence as `NOASSERTION` — a mistake we already made
  once).

## 10. Proposed repo layout

```
whisperlane/
  docs/
    plan/
      pre-start-intro-plan.md      ← this file
  apps/
    desktop/
      src/                         # React + TS
      src-tauri/                   # Rust core (Tauri)
  crates/                          # optional: audio, asr, injection as libs
  README.md
  LICENSE-MIT
  LICENSE-APACHE
```

## 11. Milestones

- **M0 — skeleton that talks.** Tauri + React shell, tray, global hotkey,
  capture → WAV, whisper.cpp transcribe (CPU), copy to clipboard. End-to-end, ugly.
- **M1 — useful on Windows.** Insert into the focused app; settings; model
  manager; **Vulkan** path for AMD/Intel; hold/toggle/cancel flows.
- **M2 — the wedge + the polish.** OpenCode "dictate into the agent"; first-run
  onboarding; the premium UX pass; packaging.
- **M3 — wider.** macOS, then Linux; signing/notarisation; publish.

## 12. Open questions (decide with small spikes)

- In-process `whisper-rs` vs sidecar server — packaging, memory, model hot-swap.
- Streaming (chunked) vs record-then-transcribe — latency vs accuracy/complexity.
- Text injection per OS: `SendInput` (Windows), `CGEvent` (macOS), `ydotool`/
  `wtype` (Linux) — reliability and permission stories.
- Which models ship, which download; the default (size vs speed vs accuracy).
- Optional cleanup: local small model, rules only, or none.
- **Name check:** domain (e.g. `whisperlane.com`/`.app`), package names, any
  trademark collisions.

## 13. Reuse from what we already have

- **`opencode-listen-stt`** — capture, the whisper server, hotkey handling, model
  management, and the "insert into OpenCode" idea. Much of M0/M2 is a port.
- **`whisper-vulkan-win`** — a whisper.cpp Vulkan build for AMD/Intel on Windows.
  This is the technical wedge; it ships inside M1.

## 14. Prior art and references

- Apps: Handy, OpenWhispr, VoiceInk, Vibe, whisper-writer, SayIt, VoiceFlow,
  and the curated `awesome-voice-typing`.
- Core: whisper.cpp, whisper-rs, cpal, global-hotkey, enigo, Tauri, Bun, React.

---

*Next step: pick the M0 scope, scaffold `apps/desktop`, and get "speak → text on
screen" working before any polish. The still has to stand on its own before it
moves — same rule as the other projects.*
