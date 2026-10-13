# External input — ChatGPT UI/UX brief (NOT source of truth)

Provenance: produced with partial project context by an external model at
the maintainer's request. It contains valuable elaboration and genuine
guesses in areas the project had already decided. Nothing in this file
overrides docs/plan/pre-start-intro-plan.md or the numbered documents.

How it was merged: see ui-brief-triage.md next to this file. Adopted
parts live in docs/04-experience.md, rejected alternatives live in
docs/08-decisions.md, parked ideas live in IDEAS.md at the repo root.
The reference mockup image is stored alongside this file as
Whisper_Dynamic_Pill_UI_Mockup.png.

The original text follows verbatim, including its own mockup reference
(the image file itself is not stored here).

---

# Whisper STT — UI/UX Brief for AI Coding Agent

**Document type:** Product UI/UX and implementation brief  
**Product:** Whisper STT  
**Primary platform:** Windows desktop  
**Design direction:** Liquid Glass + Dynamic Pill  
**Tagline:** *Voice in. Text out.*

> **Agent instruction:** Treat this document as the product design source of truth for the first UI implementation. Inspect the existing repository and architecture before changing code. Preserve working transcription/backend behavior; implement the UI in small, verifiable steps. Do not assume a framework, runtime, or audio pipeline that is not already present in the repository.

## 1. Product vision

Whisper is a lightweight, keyboard-first speech-to-text utility that lives above the user's workflow. It should feel like a polished system utility—not a conventional, permanently open recording application.

The primary interaction is a compact, borderless floating pill that expands only when the user needs feedback or controls. The app should make recording state unmistakable, transcribe speech, and make the resulting text easy to copy or insert into the active workflow.

### Product principles

- **Quiet by default:** keep the interface small and unobtrusive.
- **One clear action:** starting and stopping a recording must be obvious.
- **State clarity:** users must always know whether the app is idle, recording, processing, completed, or in an error state.
- **Keyboard-first:** essential actions must work without relying on the mouse.
- **Premium restraint:** glass, blur, reflections, and glow are accents—not decoration everywhere.
- **Trust and privacy:** make microphone activity visible and explain where audio is processed and whether history is stored.
- **Cross-platform identity:** preserve the same visual language while adapting windowing and system integration to each OS.

## 2. Visual direction

### Liquid Glass

Use translucent dark surfaces, restrained backdrop blur, subtle edge highlights, soft shadows, and carefully controlled reflections. Prioritize readable text over transparency.

- Base background: `#0B0D12`
- Glass surface: `#20212B`
- Primary text: `#F5F5F7`
- Secondary text: `#A8A8B7`
- Primary accent: `#B7A5FF`
- Success: `#79E2BB`
- Error: `#FF7D86`
- Glass border: `#FFFFFF24` (approximate token; adapt to rendering technology)

Use the accent glow mainly during active recording, processing, focus, or success feedback. Do not put a strong glow around every control. Provide an opaque fallback when transparency is disabled, unsupported, or too expensive to render.

### Shape and typography

- Pill controls use a fully rounded capsule silhouette.
- Transcript and settings panels use restrained rounded corners.
- Use a clean system sans-serif appropriate to the host OS.
- Keep typography hierarchy simple: title/status, supporting detail, then controls.
- Icons should be consistent outline icons with clear labels/tooltips for unfamiliar actions.
- Avoid unnecessary gradients, decorative charts, large branding, and persistent navigation.

## 3. Main UI surfaces

### A. Floating Pill

The core interface. It is borderless, floating, keyboard-accessible, and shown above normal desktop content when appropriate.

- Default position: top-center.
- Allow the user to move it and remember the position.
- Avoid covering critical content; support a configurable position.
- Support compact and expanded states.
- Handle multiple monitors, DPI scaling, and screen edges.
- Define behavior for full-screen apps and focus changes.
- Keep the pill non-activating where possible when merely displaying status, but ensure controls remain accessible and keyboard-operable. Validate platform-specific window behavior in the existing stack.

Suggested initial logical dimensions (not physical pixels; account for DPI scaling):
- Idle: `64 × 64`
- Recording: `380 × 76`
- Processing: `300 × 68`
- Completed: `320 × 68`

These are starting targets, not immutable requirements. Refine after running the UI on real Windows display scaling.

### B. Transcript Panel

An optional expanded surface for reviewing the latest transcription.

Include:
- Header: Whisper mark/name and close action.
- Status and detected/selected language.
- Readable transcript text.
- Copy action.
- Optional “copy and paste” / insert action, clearly distinguished from copy.
- Optional edit/retry actions if supported by the product's actual transcription pipeline.
- Duration and word count only when actual values are available.
- Error/retry feedback without discarding captured content.

Do not invent metadata or display fake live text. Bind UI to real app state.

### C. Settings Window

A conventional settings window may be used here; it does not need to mimic the pill.

Sections:
1. **Audio:** microphone selection, input level, test microphone.
2. **Transcription:** model, language, auto-detection, only options supported by the current backend.
3. **Shortcuts:** global shortcut configuration and conflict detection.
4. **Appearance:** pill position, size, glass intensity, theme, animation preferences.
5. **Result behavior:** copy, optional auto-paste, panel dismissal behavior.
6. **Privacy:** local/cloud processing disclosure, history retention, deletion controls, based on actual implementation.
7. **About:** version, updates, support/licensing if applicable.

Do not claim that processing is local or private unless the current implementation confirms it.

## 4. Dynamic Pill states

Implement an explicit state model. The UI should render from state, not from loosely coupled booleans.

### State 1 — Idle / Ready
- Compact microphone/Whisper icon.
- Subtle glass surface and border.
- Optional short “Ready” tooltip or accessible label.
- No animated waveform when not recording.
- Activating the configured shortcut starts recording, after permission/device checks.

### State 2 — Recording
- Pill expands smoothly.
- Show elapsed time.
- Show a live waveform or audio-level visualization based on real input levels.
- Show an unmistakable stop control.
- Show language only if known; otherwise use a neutral label such as “Listening”.
- A pause control is optional only if pause/resume is supported end-to-end.
- Clearly indicate microphone activity.

### State 3 — Processing
- Replace the stop control with a processing indicator.
- Use restrained progress animation; do not imply a precise percentage if no progress data exists.
- Keep the interface responsive.
- Prevent duplicate stop/transcription requests.
- If transcription is asynchronous, handle cancellation and completion safely.

### State 4 — Completed
- Show a brief success check.
- Indicate that text is ready.
- Offer copy and/or insert actions.
- If configured, copy or paste automatically only after the relevant action is explicit and reliable.
- Return to compact state after a short configurable interval, unless the transcript panel is open or the user is interacting.

### State 5 — Error / Permission / Device unavailable
- Show a clear, concise explanation.
- Offer a relevant next action: retry, choose microphone, grant permission, or open settings.
- Do not use color alone to communicate the error.
- Preserve recoverable audio/transcript data.
- Never leave the UI stuck in a permanent processing state.

### State transitions

`Idle → Recording → Processing → Completed → Idle`

Error paths may branch from device checks, recording, or processing:
`Idle/Recording/Processing → Error → Retry or Idle`

The implementation must prevent impossible transitions, duplicate event handling, and stale async results from overwriting a newer session.

## 5. Interaction and animation

Suggested initial timings:
- Pill appearance: ~180 ms opacity/scale transition.
- Expand into recording: ~240 ms.
- Waveform updates: ~60–100 ms, throttled to avoid unnecessary rendering.
- Recording-to-processing transition: ~160 ms.
- Success feedback: ~220 ms.
- Copy feedback: ~140 ms.
- Panel dismissal: ~180 ms.

Use these as targets, not hard rules. Prefer fluid, interruptible transitions and avoid overshoot/bouncy motion. Respect OS reduced-motion preferences and provide a setting to reduce animations.

### Haptic-like feedback

Desktop hardware does not guarantee a universal haptic API. Use a combination of:
- visual micro-motion,
- brief icon/state transition,
- optional subtle sound cues (off by default or user-configurable),
- real haptic output only on platforms/devices where it is supported and appropriate.

Never make essential state feedback depend on sound or color alone.

## 6. Keyboard-first behavior

Suggested defaults to validate against OS and app conflicts:
- `Alt + Space`: toggle recording.
- `Esc`: close a non-recording panel or cancel a cancellable operation; do not silently discard a recording.
- `Ctrl + Enter`: confirm/insert result, only if this action is supported and clearly communicated.
- `Ctrl + C`: normal copy behavior when transcript text is focused/selected.
- `Alt + Up`: optional move/reposition mode.

All global shortcuts must be configurable and conflict-checked. Do not intercept OS shortcuts unexpectedly. Document platform-specific differences. Keyboard focus, focus restoration, and accessibility labels are part of the feature—not polish to add later.

## 7. Copy/paste semantics

Copy and paste are different actions and must be presented distinctly.

- **Copy:** puts the transcript on the clipboard and gives a brief confirmation.
- **Paste/Insert:** sends text to the previously active application only if the implementation can do this reliably and safely.
- Preserve the user's previous focus when opening/closing the overlay where possible.
- Do not steal focus during passive state changes.
- If the target app is no longer available or insertion fails, leave the text accessible in the Transcript Panel.
- Do not auto-paste without a clear user setting or explicit action.

## 8. Accessibility, resilience, and quality

- Test text contrast against both dark and bright content behind the glass.
- Support system transparency and reduced-motion preferences.
- Provide an opaque high-readability fallback.
- Support keyboard navigation and screen-reader labels.
- Do not rely on color alone for state.
- Test Windows display scaling, multiple monitors, screen edges, sleep/resume, microphone removal, permission denial, and repeated hotkey presses.
- Keep blur and animation rendering lightweight.
- Ensure a visible and accessible stop control while recording.
- Ensure errors are actionable and do not destroy captured content.

## 9. Cross-platform strategy

Windows is the first target. Keep the product identity and semantic state model shared, but isolate platform-specific integration.

Shared:
- design tokens,
- pill state model,
- transcript/result model,
- interaction semantics,
- accessibility rules,
- animation intent and timing targets.

Platform adapters:
- global shortcuts,
- borderless/always-on-top window behavior,
- blur/material implementation,
- microphone permissions and device selection,
- clipboard and insertion behavior,
- system tray/menu bar,
- lifecycle and notification behavior.

Future targets: macOS, iOS, Android, and Linux. Do not assume a desktop-style floating pill can behave identically on mobile; adapt to OS permissions, background execution limits, and available system surfaces.

## 10. Implementation priorities

### P0 — Functional core
1. Inspect the repository and document the current UI framework, audio path, transcription service, and existing state model.
2. Implement the pill and explicit state transitions.
3. Implement start/stop via global shortcut.
4. Connect the UI to real microphone and transcription state.
5. Show results and support copy reliably.
6. Add meaningful permission/device/error handling.

### P1 — Premium visual polish
1. Liquid Glass surface and opaque fallback.
2. Refined typography, spacing, borders, and shadows.
3. Smooth state transitions and waveform.
4. Transcript Panel.
5. Settings sections for microphone, language/model, shortcuts, appearance, and privacy.
6. Reduced-motion and transparency settings.

### P2 — Extended experience
1. Configurable placement and size.
2. Recording history, if desired and privacy requirements are defined.
3. Live transcription, if supported by the current backend.
4. Platform adapters for additional operating systems.

## 11. Acceptance criteria

The first implementation is ready for review when:
- The pill starts in a clean, compact idle state.
- The configured global shortcut starts and stops recording reliably.
- Recording is visually unmistakable and has a working stop control.
- The waveform reflects real audio levels or is clearly represented as a non-live placeholder only during early prototyping.
- Processing and success states are distinct.
- A successful transcript can be copied.
- Errors and permission problems have actionable recovery paths.
- The overlay does not permanently steal focus from the user's active app.
- Transparency-off/reduced-motion alternatives work.
- DPI scaling, multi-monitor placement, and repeated shortcut presses have been tested.
- Existing transcription/backend behavior has not regressed.
- No fake settings, fake progress, or unimplemented controls are presented as functional.

## 12. Instructions to the AI coding agent

1. **Inspect before editing.** Identify the framework, entry points, window lifecycle, hotkey implementation, audio capture pipeline, Whisper integration, and test/build commands.
2. **Reuse existing architecture.** Do not replace a working audio or transcription stack just to match this visual brief.
3. **Propose a short implementation plan** based on the repository's actual structure before broad refactoring.
4. **Implement incrementally.** Start with the state model and functional pill; then visual polish; then settings.
5. **Use real state.** Connect every visible control to a real action or mark it clearly as not yet implemented. Never fabricate live transcription, progress, audio levels, or privacy claims.
6. **Keep components maintainable.** Separate design tokens, pill states, transcript panel, settings, and platform-specific adapters where appropriate.
7. **Verify.** Run available lint, type checks, tests, and build; manually check focus, shortcuts, DPI, and failure states where possible.
8. **Report clearly.** Summarize changed files, implemented behavior, tests run, known limitations, and the next recommended step.

## 13. Reference mockup

Use the supplied mockup (docs/reference/Whisper_Dynamic_Pill_UI_Mockup.png)
as a **visual direction reference**, not as a pixel-perfect specification. It demonstrates a dark, premium floating capsule, waveform, prominent recording control, translucent transcript panel, and compact state examples.

The reference contains illustrative UI and may include elements that are not part of the final product. Prioritize the written state model and acceptance criteria over any accidental text, decorative effect, or unsupported control visible in the mockup.

---

**Design north star:** Whisper should feel like a small, precise, trustworthy system utility. Its premium quality comes from restraint, responsive behavior, excellent state clarity, and frictionless text insertion—not from visual effects alone.
