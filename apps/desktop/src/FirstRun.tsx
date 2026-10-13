// First run is one screen (docs/04-experience.md): one instruction, the
// chord it means, and honest model progress behind it. No account step,
// no wizard, and nothing else to read before the first take.

import type { Download, ModelOption, PipelineStatus, Settings } from "./types";

interface FirstRunProps {
  hotkey: string;
  settings: Settings;
  status: PipelineStatus | null;
  download: Download | null;
  model: ModelOption | null;
  onDownload: () => void;
  onDone: () => void;
}

function modelLine(
  model: ModelOption | null,
  download: Download | null,
): string {
  if (download?.running) {
    const size = `${download.received_mb} / ${download.total_mb} MB`;
    const percent =
      download.percent !== null ? ` (${download.percent}%)` : "";
    return `Downloading the speech model: ${size}${percent}. Dictation stays available.`;
  }
  if (download?.error) return `The model download failed: ${download.error}`;
  if (!model) return "Preparing the speech model.";
  if (model.present) return "The speech model is ready.";
  return `The speech model (${model.size_mb} MB) is not downloaded yet.`;
}

export function FirstRun({
  hotkey,
  settings,
  status,
  download,
  model,
  onDownload,
  onDone,
}: FirstRunProps) {
  const phase = status?.phase ?? "idle";
  const dictating = phase === "listening" || phase === "thinking";
  // The name comes from the core, so this screen cannot describe a
  // state differently from every other one.
  const phaseName = status?.label ?? "Ready when you are.";
  const modelMissing = model !== null && !model.present;

  return (
    <section aria-label="first run" className="first-run">
      <h1>whisperlane</h1>
      <p className="first-run-instruction">
        Hold <kbd>{hotkey}</kbd>, speak, and release.
      </p>
      <p className="first-run-hint">
        Tap it instead to keep dictating. Escape throws the take away.
      </p>

      <p className="first-run-model">{modelLine(model, download)}</p>
      {modelMissing && !download?.running && (
        <button type="button" onClick={onDownload}>
          Download the speech model
        </button>
      )}

      <p className="first-run-state" role="status" aria-live="polite">
        {phaseName}
        {status?.detail ? ` ${status.detail}` : ""}
      </p>

      {status?.last_text && (
        <p className="first-run-transcript">
          <strong>{status.last_text}</strong>
        </p>
      )}

      <button type="button" className="first-run-done" onClick={onDone}>
        I&apos;m ready
      </button>

      <p className="first-run-footnote">
        Your text goes wherever the cursor is. Language: {settings.language}.
      </p>
      {dictating && (
        <p className="first-run-footnote">Stop when you are finished talking.</p>
      )}
    </section>
  );
}