<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand-kit/01_Logos/PNG/whisperlane-lockup-horizontal-on-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="brand-kit/01_Logos/PNG/whisperlane-lockup-horizontal-on-light.png">
    <img alt="whisperlane" src="brand-kit/01_Logos/PNG/whisperlane-lockup-horizontal-on-light.png" width="400">
  </picture>
</p>

<p align="center">
  <b>Hold a key, talk, and it is typed.</b><br>
  <sub>Free · Private · Local-first dictation for Windows</sub>
</p>

<p align="center">
  <a href="https://learn.microsoft.com/en-us/windows/"><img src="https://img.shields.io/badge/platform-Windows-0078D4?logo=windows&logoColor=white" alt="Windows" height="20"></a>
  <a href="https://tauri.app"><img src="https://img.shields.io/badge/tauri-v2-24C8DB?logo=tauri&logoColor=black" alt="Tauri v2" height="20"></a>
  <a href="https://www.rust-lang.org"><img src="https://img.shields.io/badge/rust-2024-orange?logo=rust&logoColor=white" alt="Rust" height="20"></a>
  <a href="LICENSE-MIT"><img src="https://img.shields.io/badge/license-MIT%20%7C%20Apache--2.0-blue.svg" alt="MIT or Apache-2.0" height="20"></a>
  <a href="docs/07-roadmap.md"><img src="https://img.shields.io/badge/status-in%20progress-yellow.svg" alt="Status: in progress" height="20"></a>
</p>

<p align="center">
  <img src="brand-kit/04_Social_Media/hero-main-generated.webp" alt="The whisperlane settings window, a finished take and the listening pill, floating over a blue wave" width="900">
</p>

whisperlane is a free, private, local-first desktop dictation tool. Press a
hotkey, speak, and the transcribed words appear where the caret is — in the
focused application today, and in an AI coding agent in phase two. No
account, no cloud round-trip, no settings wall. A quiet tool that is mostly
invisible, feels finished, and respects the machine it runs on.

**Positioning.** Not another general dictation app: a premium-feeling,
local-first dictation tool whose technical wedge is strong Windows graphics
support beyond a single vendor (AMD and Intel alongside NVIDIA and CPU
fallback), with an AI-agent-native direction held for phase two.

## What it does

- **Hold-to-talk** and **toggle-to-talk** dictation.
- **Insertion into the focused application** — the only destination in v1.
- **Cancellation** that discards a take so nothing is inserted.
- **Minimal optional refinement** — light local cleanup of punctuation and
  obvious filler, off unless requested, never rewriting meaning.
- **Model management that stays out of the way** — the required speech model
  is fetched when you ask for it, with honest progress.
- **Application settings kept to the minimum** that v1 flows require.

Everything runs on the machine after setup: offline, with no account and no
required network dependency for everyday dictation.

## How a take works

| Step | What happens |
| --- | --- |
| **Hold** | Press and hold the chord — `Ctrl` + `Shift` + `Space` by default, configurable in settings. |
| **Speak** | The microphone is captured locally and the pill shows the live input level. |
| **Release** | The take is transcribed on the GPU (Vulkan, CUDA, or CPU fallback) and the text lands at the caret. |
| **Discard** | `Escape` throws the take away at any point before insertion — nothing is typed. |

## Status

Windows-only MVP, in progress. Agents (including OpenCode) are deliberately
phase two.

| Milestone | Scope | Status |
| --- | --- | --- |
| M0 — skeleton that talks | Shell, tray, hotkey, capture, GPU transcription, clipboard delivery | ✅ Done |
| M1 — useful on Windows | Settings, chord, microphone, hold/toggle/cancel, insertion, model download, AMD/Intel acceleration | ✅ Done |
| M2 — polish and packaging | First run, pill states, premium pass, packaging | 🟡 In progress |
| Phase 2 — agent integration | Dictation into an AI coding agent (OpenCode first) | ⏳ Planned |
| M3 — wider platforms | macOS, then Linux, signing and notarization | ⏳ Planned |

## The pill

Every state is legible from a single small indicator.

<p align="center">
  <img src="brand-kit/03_Status_States/whisperlane-status-idle-tile.png" alt="Idle" width="96" loading="lazy">
  <img src="brand-kit/03_Status_States/whisperlane-status-listening-active-tile.png" alt="Listening" width="96" loading="lazy">
  <img src="brand-kit/03_Status_States/whisperlane-status-processing-tile.png" alt="Processing" width="96" loading="lazy">
  <img src="brand-kit/03_Status_States/whisperlane-status-muted-tile.png" alt="Muted" width="96" loading="lazy">
  <img src="brand-kit/03_Status_States/whisperlane-status-error-tile.png" alt="Error" width="96" loading="lazy">
</p>

<p align="center">
  <sub>Idle · Listening · Processing · Muted · Error</sub>
</p>

## Documentation

The project is documented first; the plan folder is the origin. Start with
the source plan, then read the numbered documents in order.

| Document | Purpose |
| --- | --- |
| [`docs/plan/pre-start-intro-plan.md`](docs/plan/pre-start-intro-plan.md) | Single source of truth for what we are building and why |
| [`docs/01-vision.md`](docs/01-vision.md) | Mission, vision, v1 goals, success measures, non-goals |
| [`docs/02-audience.md`](docs/02-audience.md) | Target users, personas, usage scenarios |
| [`docs/03-product.md`](docs/03-product.md) | Scope, features, boundaries, positioning |
| [`docs/04-experience.md`](docs/04-experience.md) | UX principles, flows, states, premium feel |
| [`docs/05-architecture.md`](docs/05-architecture.md) | Components, data flow, technology choices |
| [`docs/06-agent-integration.md`](docs/06-agent-integration.md) | Phase-two agent path and target abstraction |
| [`docs/07-roadmap.md`](docs/07-roadmap.md) | Milestones M0 through M3 with acceptance criteria |
| [`docs/08-decisions.md`](docs/08-decisions.md) | Open questions with options, trade-offs, recommendations |
| [`docs/09-repository.md`](docs/09-repository.md) | Layout, licensing, contribution, test and release strategy |

Full index: [`docs/README.md`](docs/README.md).

## Repository

- Layout, licensing, contribution rules and release strategy:
  [`docs/09-repository.md`](docs/09-repository.md).
- Documentation is written in English; discussion with the maintainer is in
  Turkish.
- No document contains source code, configuration, or snippets; architecture
  is narrated.

## Brand

The brand kit lives in [`brand-kit/`](brand-kit/). Assets include the logo
lockups, app icons, status states, social media sizes, and the guidelines
below.

<p align="center">
  <img src="brand-kit/05_Guidelines/brand-overview.png" alt="Brand overview: primary lockup, app icon, brandmark variants, voice and agent states, core palette" width="640" loading="lazy">
</p>

<p align="center">
  <img src="brand-kit/05_Guidelines/color-palette.png" alt="Color palette: Midnight Navy, Deep Indigo, Signal Cyan, Electric Blue, Wave Purple, Glow Magenta, Warm Coral, Silver, Near White" width="640" loading="lazy">
</p>

<p align="center">
  <img src="brand-kit/02_App_Icons/PNG/whisperlane-app-icon-flat-1024.png" alt="App icon, flat" width="112" loading="lazy">
  <img src="brand-kit/02_App_Icons/PNG/whisperlane-app-icon-1024.png" alt="App icon, glass" width="112" loading="lazy">
  <img src="brand-kit/02_App_Icons/PNG/whisperlane-maskable-512.png" alt="App icon, maskable" width="112" loading="lazy">
  <img src="brand-kit/02_App_Icons/PNG/favicon-48.png" alt="Favicon" width="48" loading="lazy">
</p>

<p align="center">
  <sub>Flat · Glass · Maskable · Favicon</sub>
</p>

See [`brand-kit/README.md`](brand-kit/README.md) and
[`brand-kit/ASSET_INDEX.md`](brand-kit/ASSET_INDEX.md) for the full asset
list and usage notes.

## Social preview

<p align="center">
  <img src="brand-kit/04_Social_Media/open-graph-1200x630.jpg" alt="Open Graph preview" width="640" loading="lazy">
</p>

## License

Dual-licensed under [MIT](LICENSE-MIT) or [Apache License 2.0](LICENSE-APACHE),
following the common Rust-ecosystem convention. Licensing texts travel with
every distribution.

---

<sub>whisperlane — a quiet tool that is mostly invisible, feels finished, and
respects the machine it runs on.</sub>
