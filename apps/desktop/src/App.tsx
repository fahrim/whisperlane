import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FirstRun } from "./FirstRun";
import { Picker, Switch } from "./controls";
import { SignalBackdrop } from "./SignalBackdrop";
import { deliveryNote, transcriptMatters } from "./delivery";
import type {
  Download,
  HotkeyChoice,
  InputDevice,
  LanguageChoice,
  Microphone,
  ModelOption,
  PipelineStatus,
  Settings,
  ThemeChoice,
} from "./types";
import "./App.css";

interface SttStatus {
  model_file: string;
  model_present: boolean;
  backend: string;
  backend_verified: boolean;
  service: "unloaded" | "starting" | "ready" | "failed";
  detail: string | null;
}

type NavTab = "general" | "speech" | "appearance" | "shortcuts" | "about";

const LEVEL_BAR_COUNT = 16;
const RESTING_BARS = 10;

function hotkeyKeycaps(code: string, fallbackLabel: string): string[] {
  if (code === "ctrl_shift_space") return ["Control", "Shift", "Space"];
  if (code === "ctrl_space") return ["Control", "Space"];
  if (code === "ctrl_y") return ["Control", "Y"];
  const cleaned = fallbackLabel.replace(/\s*\(.*\)$/, "").trim();
  if (!cleaned || cleaned === "…") return ["Control", "Shift", "Space"];
  return cleaned.split(/\s*\+\s*/).filter(Boolean);
}

function BrandWaveIcon() {
  return (
    <svg
      className="brand-wave-icon"
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="wlBrandGrad" x1="0" y1="2" x2="28" y2="26" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#60A5FA" />
          <stop offset="45%" stopColor="#818CF8" />
          <stop offset="100%" stopColor="#C084FC" />
        </linearGradient>
      </defs>
      <rect x="2.5" y="10" width="2.8" height="8" rx="1.4" fill="url(#wlBrandGrad)" opacity="0.75" />
      <rect x="7.5" y="5.5" width="2.8" height="17" rx="1.4" fill="url(#wlBrandGrad)" opacity="0.92" />
      <rect x="12.6" y="2.5" width="2.8" height="23" rx="1.4" fill="url(#wlBrandGrad)" />
      <rect x="17.7" y="7" width="2.8" height="14" rx="1.4" fill="url(#wlBrandGrad)" opacity="0.9" />
      <rect x="22.7" y="10.5" width="2.8" height="7" rx="1.4" fill="url(#wlBrandGrad)" opacity="0.7" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MicIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect
        x="9"
        y="3"
        width="6"
        height="11"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SunIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4" fill="currentColor" />
      <path
        d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.64 5.64l1.55 1.55M16.81 16.81l1.55 1.55M18.36 5.64l-1.55 1.55M7.19 16.81l-1.55 1.55"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
      />
    </svg>
  );
}

function KeyboardIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect
        x="2.5"
        y="5"
        width="19"
        height="14"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <circle cx="6.5" cy="9.5" r="1" fill="currentColor" />
      <circle cx="10.2" cy="9.5" r="1" fill="currentColor" />
      <circle cx="13.8" cy="9.5" r="1" fill="currentColor" />
      <circle cx="17.5" cy="9.5" r="1" fill="currentColor" />
      <circle cx="6.5" cy="13" r="1" fill="currentColor" />
      <circle cx="17.5" cy="13" r="1" fill="currentColor" />
      <path
        d="M8.5 15h7"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function InfoIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.75" />
      <path
        d="M12 11v5M12 8h.01"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M16.862 3.487a2.1 2.1 0 1 1 2.97 2.97L7.5 18.79 3 20l1.21-4.5L16.862 3.487Z"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MiniWaveIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="5.5" width="1.8" height="5" rx="0.9" fill="#818CF8" />
      <rect x="4.5" y="3" width="1.8" height="10" rx="0.9" fill="#A855F7" />
      <rect x="7.5" y="1.5" width="1.8" height="13" rx="0.9" fill="#C084FC" />
      <rect x="10.5" y="3.5" width="1.8" height="9" rx="0.9" fill="#818CF8" />
      <rect x="13.5" y="5.5" width="1.8" height="5" rx="0.9" fill="#60A5FA" />
    </svg>
  );
}

function GlobeIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.75" />
      <ellipse cx="12" cy="12" rx="4.2" ry="9" stroke="currentColor" strokeWidth="1.65" />
      <path
        d="M3.5 9.5h17M3.5 14.5h17"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SparklesIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M11 3.5 12.9 9.1 18.5 11 12.9 12.9 11 18.5 9.1 12.9 3.5 11 9.1 9.1 11 3.5Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M18.5 3.5 19.2 5.8 21.5 6.5 19.2 7.2 18.5 9.5 17.8 7.2 15.5 6.5 17.8 5.8 18.5 3.5Z"
        fill="currentColor"
      />
      <path
        d="M18 15.5 18.5 17 20 17.5 18.5 18 18 19.5 17.5 18 16 17.5 17.5 17 18 15.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

function BrainIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9.5 3.5a3 3 0 0 0-2.9 2.2A3.2 3.2 0 0 0 4.5 9c0 1.1.55 2.08 1.4 2.66a3.3 3.3 0 0 0-.4 1.6c0 1.54 1.04 2.84 2.46 3.22A2.9 2.9 0 0 0 12 18.5V6a2.5 2.5 0 0 0-2.5-2.5Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14.5 3.5a3 3 0 0 1 2.9 2.2A3.2 3.2 0 0 1 19.5 9c0 1.1-.55 2.08-1.4 2.66.26.48.4 1.02.4 1.6 0 1.54-1.04 2.84-2.46 3.22A2.9 2.9 0 0 1 12 18.5V6a2.5 2.5 0 0 1 2.5-2.5Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M20.4 14.6A8.5 8.5 0 0 1 9.4 3.6a8.5 8.5 0 1 0 11 11Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PowerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3v9M17.66 6.34a8 8 0 1 1-11.32 0"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
      />
    </svg>
  );
}

function App() {
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [stt, setStt] = useState<SttStatus | null>(null);
  const [hotkey, setHotkey] = useState<string>("…");
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [languages, setLanguages] = useState<LanguageChoice[]>([]);
  const [hotkeys, setHotkeys] = useState<HotkeyChoice[]>([]);
  const [devices, setDevices] = useState<InputDevice[]>([]);
  const [themes, setThemes] = useState<ThemeChoice[]>([]);
  const [startWithWindows, setStartWithWindows] = useState(false);
  const [startBusy, setStartBusy] = useState(false);
  const [_askMic, setAskMic] = useState(false);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [download, setDownload] = useState<Download | null>(null);
  const [activeTab, setActiveTab] = useState<NavTab>("general");
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [micTesting, setMicTesting] = useState<boolean>(false);
  const [windowSize, setWindowSize] = useState<{
    width: number;
    height: number | null;
  }>({
    width: 790,
    height: null,
  });

  const hotkeyButtonRef = useRef<HTMLButtonElement | null>(null);
  const micTestStreamRef = useRef<MediaStream | null>(null);
  const micTestAudioCtxRef = useRef<AudioContext | null>(null);
  const micTestRafRef = useRef<number>(0);
  const resizeSessionRef = useRef<{
    edge: "e" | "w" | "s" | "n" | "se" | "sw" | "ne" | "nw";
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
  } | null>(null);

  // Held while the introduction is being closed, for the reason given
  // below it.
  const [leaving, setLeaving] = useState(false);

  const showIntroduction =
    settings !== null && (!settings.onboarded || leaving);
  const showSettings = settings !== null && settings.onboarded && !leaving;

  function onResizePointerDown(
    edge: "e" | "w" | "s" | "n" | "se" | "sw" | "ne" | "nw",
    event: React.PointerEvent<HTMLDivElement>,
  ) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const frame = frameRef.current;
    resizeSessionRef.current = {
      edge,
      startX: event.screenX,
      startY: event.screenY,
      startWidth: frame?.offsetWidth ?? windowSize.width,
      startHeight: frame?.offsetHeight ?? 740,
    };
  }

  function onResizePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const session = resizeSessionRef.current;
    if (!session) return;
    const dx = event.screenX - session.startX;
    const dy = event.screenY - session.startY;
    const maxW = Math.max(680, window.screen.availWidth - 80);
    const maxH = Math.max(540, window.screen.availHeight - 80);

    setWindowSize((prev) => {
      let nextWidth = prev.width;
      let nextHeight = prev.height;

      if (session.edge.includes("e")) {
        nextWidth = Math.round(
          Math.min(maxW, Math.max(540, session.startWidth + dx * 2)),
        );
      } else if (session.edge.includes("w")) {
        nextWidth = Math.round(
          Math.min(maxW, Math.max(540, session.startWidth - dx * 2)),
        );
      }

      if (session.edge.includes("s")) {
        nextHeight = Math.round(
          Math.min(maxH, Math.max(460, session.startHeight + dy * 2)),
        );
      } else if (session.edge.includes("n")) {
        nextHeight = Math.round(
          Math.min(maxH, Math.max(460, session.startHeight - dy * 2)),
        );
      }

      return { width: nextWidth, height: nextHeight };
    });
  }

  function onResizePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (!resizeSessionRef.current) return;
    resizeSessionRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function resetWindowSize() {
    setWindowSize({ width: 790, height: null });
  }

  async function finishOnboarding() {
    setLeaving(true);
    try {
      setSettings(await invoke<Settings>("complete_onboarding"));
      await invoke("toggle_settings");
    } catch (e) {
      setLeaving(false);
      setError(String(e));
    }
  }

  useEffect(() => {
    const value = settings?.theme ?? "system";
    if (value === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = value;
  }, [settings?.theme]);

  async function hideWindow() {
    stopMicTest();
    try {
      await invoke("toggle_settings");
    } catch (e) {
      setError(String(e));
    }
  }

  const frameRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (settings === null) return;
    const frame = frameRef.current;
    if (!frame) return;
    const fit = () => {
      const bleed =
        parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue(
            "--window-bleed",
          ),
        ) || 0;
      const rect = frame.getBoundingClientRect();
      const width = Math.max(frame.offsetWidth, Math.round(rect.width));
      const height = Math.max(frame.offsetHeight, Math.round(rect.height));
      if (width <= 0 || height <= 0) return;
      void invoke("fit_window", {
        contentWidth: width,
        contentHeight: height,
        bleed,
      }).catch(() => {});
    };
    fit();
    const raf = requestAnimationFrame(fit);
    const observer = new ResizeObserver(fit);
    observer.observe(frame);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [
    settings !== null,
    showSettings,
    showIntroduction,
    activeTab,
    windowSize.width,
    windowSize.height,
  ]);

  async function refreshModels() {
    try {
      setModelOptions(await invoke<ModelOption[]>("list_models"));
      setDownload(await invoke<Download>("get_download"));
    } catch (e) {
      setError(String(e));
    }
  }

  async function chooseModel(id: string) {
    try {
      setSettings(await invoke<Settings>("set_model", { model: id }));
      await refreshModels();
    } catch (e) {
      setError(String(e));
    }
  }

  async function downloadModel(id: string) {
    try {
      setDownload(await invoke<Download>("download_model", { id }));
    } catch (e) {
      setError(String(e));
    }
  }

  async function refreshStt() {
    try {
      setStt(await invoke<SttStatus>("get_stt_status"));
    } catch (e) {
      setError(String(e));
    }
  }

  async function chooseMicrophone(microphone: Microphone) {
    try {
      setSettings(await invoke<Settings>("set_microphone", { microphone }));
      setAskMic(await invoke<boolean>("needs_microphone_choice"));
    } catch (e) {
      setError(String(e));
    }
  }

  async function chooseLanguage(code: string) {
    try {
      setSettings(await invoke<Settings>("set_language", { language: code }));
    } catch (e) {
      setError(String(e));
    }
  }

  async function chooseHotkey(code: string) {
    try {
      setSettings(await invoke<Settings>("set_hotkey", { hotkey: code }));
      setHotkey(await invoke<string>("get_hotkey_label"));
    } catch (e) {
      setError(String(e));
    }
  }

  async function chooseTheme(code: string) {
    try {
      setSettings(await invoke<Settings>("set_theme", { theme: code }));
    } catch (e) {
      setError(String(e));
    }
  }

  async function chooseStartWithWindows(start: boolean): Promise<boolean> {
    setStartBusy(true);
    try {
      await invoke<Settings>("set_start_with_windows", { start });
      setStartWithWindows(await invoke<boolean>("is_start_with_windows"));
      return true;
    } catch (e) {
      setStartWithWindows(
        await invoke<boolean>("is_start_with_windows").catch(() => start),
      );
      setError(String(e));
      return false;
    } finally {
      setStartBusy(false);
    }
  }

  function stopMicTest() {
    if (micTestRafRef.current) {
      cancelAnimationFrame(micTestRafRef.current);
      micTestRafRef.current = 0;
    }
    if (micTestStreamRef.current) {
      micTestStreamRef.current.getTracks().forEach((t) => t.stop());
      micTestStreamRef.current = null;
    }
    if (micTestAudioCtxRef.current) {
      void micTestAudioCtxRef.current.close().catch(() => {});
      micTestAudioCtxRef.current = null;
    }
    setMicTesting(false);
    setAudioLevel(0);
  }

  async function toggleMicTest() {
    if (micTesting) {
      stopMicTest();
      return;
    }
    try {
      setMicTesting(true);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micTestStreamRef.current = stream;
      const ctx = new AudioContext();
      micTestAudioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const buffer = new Float32Array(analyser.fftSize);
      const tick = () => {
        analyser.getFloatTimeDomainData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) {
          sum += buffer[i] * buffer[i];
        }
        const rms = Math.sqrt(sum / buffer.length);
        const normalized = Math.min(1, rms / 0.07);
        setAudioLevel(normalized);
        micTestRafRef.current = requestAnimationFrame(tick);
      };
      micTestRafRef.current = requestAnimationFrame(tick);
    } catch {
      // Fallback: trigger a take or stop testing cleanly if WebAudio mic access is denied
      setMicTesting(false);
      void invoke<PipelineStatus>("take_control", { command: "control" })
        .then(setStatus)
        .catch(() => {});
    }
  }

  useEffect(() => {
    const offLevel = listen<number>("audio-level", (event) => {
      setAudioLevel(event.payload);
    });
    return () => {
      stopMicTest();
      void offLevel.then((unlisten) => unlisten());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const live =
    status !== null &&
    (status.phase === "listening" || status.phase === "thinking");

  const chosenModel =
    modelOptions.find((option) => option.id === settings?.model) ??
    modelOptions.find((option) => option.is_default) ??
    null;

  const modelLine = (() => {
    if (download?.running) {
      const progress =
        download.percent !== null ? ` · ${download.percent}%` : "";
      return `Downloading${progress} · ${download.received_mb} of ${download.total_mb} MB`;
    }
    if (!chosenModel) return null;
    if (!chosenModel.present)
      return `${chosenModel.size_mb} MB · Not downloaded`;
    if (!stt) return `${chosenModel.size_mb} MB · Ready`;
    if (stt.service === "failed")
      return stt.detail ?? "The engine could not start";
    if (stt.service === "starting") return "Getting ready…";
    return `${chosenModel.size_mb} MB  ·  Ready`;
  })();

  const canDownload =
    chosenModel !== null && !chosenModel.present && !download?.running;

  const wasDownloading = useRef(false);

  useEffect(() => {
    let stop = false;
    async function poll() {
      try {
        setStatus(await invoke<PipelineStatus>("get_pipeline_state"));
        await refreshStt();
        const state = await invoke<Download>("get_download");
        setDownload(state);
        if (wasDownloading.current && !state.running) await refreshModels();
        wasDownloading.current = state.running;
      } catch (e) {
        if (!stop) setError(String(e));
      }
    }
    invoke<string>("get_hotkey_label")
      .then(setHotkey)
      .catch((e) => setError(String(e)));
    invoke<Settings>("get_settings")
      .then((loaded) => {
        setSettings(loaded);
        return invoke<Download>("ensure_model_ready", {
          firstRun: !loaded.onboarded,
        });
      })
      .then(setDownload)
      .catch((e) => setError(String(e)));
    invoke<LanguageChoice[]>("list_languages")
      .then(setLanguages)
      .catch((e) => setError(String(e)));
    invoke<HotkeyChoice[]>("list_hotkeys")
      .then(setHotkeys)
      .catch((e) => setError(String(e)));
    invoke<InputDevice[]>("list_input_devices")
      .then(setDevices)
      .catch((e) => setError(String(e)));
    invoke<boolean>("needs_microphone_choice")
      .then(setAskMic)
      .catch((e) => setError(String(e)));
    invoke<ThemeChoice[]>("list_themes")
      .then(setThemes)
      .catch((e) => setError(String(e)));
    invoke<boolean>("is_start_with_windows")
      .then(setStartWithWindows)
      .catch(() => {});
    refreshModels();
    poll();
    const timer = setInterval(poll, 1000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, []);

  const activeBars =
    micTesting || live
      ? Math.max(1, Math.min(LEVEL_BAR_COUNT, Math.round(audioLevel * LEVEL_BAR_COUNT)))
      : RESTING_BARS;

  const showHoldToTalk = activeTab === "general" || activeTab === "shortcuts";
  const showSpeechCards = activeTab === "general" || activeTab === "speech";
  const showAppearanceCard = activeTab === "general" || activeTab === "appearance";
  const showStartupCard = activeTab === "general";
  const showAboutCard = activeTab === "about";

  const keycaps = settings
    ? hotkeyKeycaps(settings.hotkey, hotkey)
    : ["Control", "Shift", "Space"];

  return (
    <div className="window">
      <div
        className={`window-frame${showSettings ? " window-frame-settings" : ""}${
          showSettings && windowSize.height !== null ? " has-custom-height" : ""
        }`}
        ref={frameRef}
        style={
          showSettings
            ? {
                width: `${windowSize.width}px`,
                minWidth: `${windowSize.width}px`,
                maxWidth: `${windowSize.width}px`,
                ...(windowSize.height !== null
                  ? { height: `${windowSize.height}px` }
                  : {}),
              }
            : undefined
        }
      >
        {showSettings && (
          <>
            {(["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const).map(
              (edge) => (
                <div
                  key={edge}
                  className={`window-resize-handle window-resize-${edge}`}
                  onPointerDown={(e) => onResizePointerDown(edge, e)}
                  onPointerMove={onResizePointerMove}
                  onPointerUp={onResizePointerUp}
                  onPointerCancel={onResizePointerUp}
                  onDoubleClick={resetWindowSize}
                  aria-hidden="true"
                />
              ),
            )}
          </>
        )}
        <div className="window-ambient" aria-hidden="true" />
        <SignalBackdrop />

        {!showSettings && (
          <>
            <header className="title-bar" data-tauri-drag-region="deep">
              <span className="title-bar-name">whisperlane</span>
              <span className="title-bar-drag" />
              <button
                type="button"
                className="title-bar-close"
                aria-label="Close"
                onClick={hideWindow}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                  <path
                    d="M1 1 L9 9 M9 1 L1 9"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </header>
            <main className="content">
              {settings === null && <p role="status">loading…</p>}
              {error && (
                <p role="alert" className="banner">
                  {error}
                </p>
              )}
              {showIntroduction && (
                <FirstRun
                  settings={settings}
                  hotkey={hotkey}
                  status={status}
                  download={download}
                  model={chosenModel}
                  choices={{
                    hotkeys,
                    languages,
                    devices,
                    startWithWindows,
                  }}
                  change={{
                    hotkey: chooseHotkey,
                    language: chooseLanguage,
                    microphone: (value) =>
                      void chooseMicrophone(
                        value === "system_default"
                          ? { kind: "system_default" }
                          : { kind: "device", id: value },
                      ),
                    startWithWindows: (next) => chooseStartWithWindows(next),
                  }}
                  onDownload={() =>
                    chosenModel && downloadModel(chosenModel.id)
                  }
                  onDone={finishOnboarding}
                />
              )}
            </main>
          </>
        )}

        {showSettings && settings && (
          <div className="settings-shell">
            <aside className="settings-sidebar">
              <div className="sidebar-brand" data-tauri-drag-region="deep">
                <BrandWaveIcon />
                <span className="sidebar-brand-name">whisperlane</span>
              </div>

              <nav className="sidebar-nav" aria-label="Settings categories">
                <button
                  type="button"
                  className={`sidebar-nav-item${activeTab === "general" ? " is-active" : ""}`}
                  onClick={() => setActiveTab("general")}
                >
                  <span className="sidebar-nav-icon">
                    <GearIcon />
                  </span>
                  <span className="sidebar-nav-text">
                    <span className="sidebar-nav-title">General</span>
                    <span className="sidebar-nav-subtitle">App behavior &amp; startup</span>
                  </span>
                </button>

                <button
                  type="button"
                  className={`sidebar-nav-item${activeTab === "speech" ? " is-active" : ""}`}
                  onClick={() => setActiveTab("speech")}
                >
                  <span className="sidebar-nav-icon">
                    <MicIcon />
                  </span>
                  <span className="sidebar-nav-text">
                    <span className="sidebar-nav-title">Speech</span>
                    <span className="sidebar-nav-subtitle">Mic, language, model</span>
                  </span>
                </button>

                <button
                  type="button"
                  className={`sidebar-nav-item${activeTab === "appearance" ? " is-active" : ""}`}
                  onClick={() => setActiveTab("appearance")}
                >
                  <span className="sidebar-nav-icon">
                    <SunIcon />
                  </span>
                  <span className="sidebar-nav-text">
                    <span className="sidebar-nav-title">Appearance</span>
                    <span className="sidebar-nav-subtitle">Theme &amp; visuals</span>
                  </span>
                </button>

                <button
                  type="button"
                  className={`sidebar-nav-item${activeTab === "shortcuts" ? " is-active" : ""}`}
                  onClick={() => setActiveTab("shortcuts")}
                >
                  <span className="sidebar-nav-icon">
                    <KeyboardIcon />
                  </span>
                  <span className="sidebar-nav-text">
                    <span className="sidebar-nav-title">Shortcuts</span>
                    <span className="sidebar-nav-subtitle">Hotkeys &amp; controls</span>
                  </span>
                </button>

                <button
                  type="button"
                  className={`sidebar-nav-item${activeTab === "about" ? " is-active" : ""}`}
                  onClick={() => setActiveTab("about")}
                >
                  <span className="sidebar-nav-icon">
                    <InfoIcon />
                  </span>
                  <span className="sidebar-nav-text">
                    <span className="sidebar-nav-title">About</span>
                    <span className="sidebar-nav-subtitle">Version &amp; links</span>
                  </span>
                </button>
              </nav>
            </aside>

            <main className="settings-main">
              <header className="settings-header" data-tauri-drag-region="deep">
                <div className="settings-header-titles">
                  <h1 className="settings-title">Settings</h1>
                  <p className="settings-subtitle">
                    Customize how whisperlane listens and works for you.
                  </p>
                </div>
                <button
                  type="button"
                  className="title-bar-close settings-close-btn"
                  aria-label="Close"
                  onClick={hideWindow}
                >
                  <svg width="11" height="11" viewBox="0 0 10 10" aria-hidden="true">
                    <path
                      d="M1 1 L9 9 M9 1 L1 9"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </header>

              {error && (
                <p role="alert" className="banner">
                  {error}
                </p>
              )}

              {live && (
                <p role="status" className="banner">
                  Listening — press {hotkey} again to insert, Escape to discard.
                </p>
              )}

              <div className="settings-cards">
                {showHoldToTalk && (
                  <section className="settings-card" aria-label="Hold to Talk">
                    <div className="settings-card-icon">
                      <KeyboardIcon />
                    </div>
                    <div className="settings-card-body">
                      <h2 className="settings-card-title">Hold to Talk</h2>
                      <p className="settings-card-desc">
                        Press and hold this shortcut to talk, or tap to toggle.
                      </p>
                      <div className="settings-card-controls">
                        <Picker
                          label="Hold to talk"
                          value={settings.hotkey}
                          options={hotkeys}
                          onChange={chooseHotkey}
                          buttonRef={hotkeyButtonRef}
                          renderValue={() => (
                            <span className="hotkey-caps">
                              {keycaps.map((cap, idx) => (
                                <span key={cap} className="hotkey-cap-group">
                                  {idx > 0 && (
                                    <span className="hotkey-plus">+</span>
                                  )}
                                  <kbd className="hotkey-cap">{cap}</kbd>
                                </span>
                              ))}
                            </span>
                          )}
                        />
                        <button
                          type="button"
                          className="card-action-btn"
                          onClick={() => hotkeyButtonRef.current?.click()}
                        >
                          <PencilIcon />
                          <span>Change</span>
                        </button>
                      </div>
                      <p className="settings-card-note">
                        <InfoIcon size={14} />
                        <span>Your words go wherever the cursor is.</span>
                      </p>
                    </div>
                  </section>
                )}

                {showSpeechCards && (
                  <>
                    <section className="settings-card" aria-label="Microphone">
                      <div className="settings-card-icon">
                        <MicIcon />
                      </div>
                      <div className="settings-card-body">
                        <h2 className="settings-card-title">Microphone</h2>
                        <p className="settings-card-desc">
                          Choose the microphone you want to use.
                        </p>
                        <div className="settings-card-controls">
                          <Picker
                            label="Microphone"
                            leadingIcon={<MicIcon size={16} />}
                            value={
                              settings.microphone.kind === "device"
                                ? (settings.microphone.id ?? "")
                                : "system_default"
                            }
                            options={[
                              { code: "system_default", label: "System default" },
                              ...devices.map((device) => ({
                                code: device.id,
                                label: device.label,
                              })),
                            ]}
                            onChange={(value) =>
                              void chooseMicrophone(
                                value === "system_default"
                                  ? { kind: "system_default" }
                                  : { kind: "device", id: value },
                              )
                            }
                          />
                          <button
                            type="button"
                            className={`card-action-btn test-mic-btn${micTesting ? " is-testing" : ""}`}
                            onClick={() => void toggleMicTest()}
                          >
                            <MiniWaveIcon />
                            <span>{micTesting ? "Stop Test" : "Test Mic"}</span>
                          </button>
                        </div>
                        <div className="mic-meter-row">
                          <div className="mic-level-bars" aria-hidden="true">
                            {Array.from({ length: LEVEL_BAR_COUNT }, (_, idx) => (
                              <span
                                key={idx}
                                className={`mic-level-bar${idx < activeBars ? " is-lit" : ""}`}
                              />
                            ))}
                          </div>
                          <span className="mic-meter-hint">
                            Speak to see the input level.
                          </span>
                        </div>
                      </div>
                    </section>

                    <section className="settings-card" aria-label="Language">
                      <div className="settings-card-icon">
                        <GlobeIcon />
                      </div>
                      <div className="settings-card-body">
                        <h2 className="settings-card-title">Language</h2>
                        <p className="settings-card-desc">
                          The language to transcribe.
                        </p>
                        <div className="settings-card-controls">
                          <Picker
                            label="Language"
                            leadingIcon={<GlobeIcon size={16} />}
                            value={settings.language}
                            options={languages}
                            onChange={chooseLanguage}
                          />
                        </div>
                      </div>
                    </section>

                    <section className="settings-card" aria-label="Speech Model">
                      <div className="settings-card-icon">
                        <SparklesIcon />
                      </div>
                      <div className="settings-card-body">
                        <h2 className="settings-card-title">Speech Model</h2>
                        <p className="settings-card-desc">
                          Bigger models are more accurate, but slower.
                        </p>
                        <div className="settings-card-controls">
                          <Picker
                            label="Speech Model"
                            leadingIcon={<BrainIcon />}
                            value={settings.model}
                            options={modelOptions.map((option) => ({
                              code: option.id,
                              label: option.label,
                            }))}
                            onChange={chooseModel}
                          />
                          {canDownload && chosenModel && (
                            <button
                              type="button"
                              className="download-button"
                              aria-label={`Download the speech model, ${chosenModel.size_mb} MB`}
                              onClick={() => downloadModel(chosenModel.id)}
                            >
                              <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
                                <path
                                  d="M8 2.5 V10 M4.6 7.2 L8 10.6 L11.4 7.2 M2.8 13 H13.2"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            </button>
                          )}
                        </div>
                        {modelLine && (
                          <p className="settings-card-status">{modelLine}</p>
                        )}
                        {download?.error && (
                          <p role="alert" className="settings-card-status">
                            {download.error}
                          </p>
                        )}
                      </div>
                    </section>
                  </>
                )}

                {showAppearanceCard && (
                  <section
                    className="settings-card settings-card-inline"
                    aria-label="Appearance"
                  >
                    <div className="settings-card-icon">
                      <SunIcon />
                    </div>
                    <div className="settings-card-body">
                      <h2 className="settings-card-title">Appearance</h2>
                      <p className="settings-card-desc">
                        Choose how the app looks.
                      </p>
                    </div>
                    <div className="settings-card-inline-control">
                      <Picker
                        label="Appearance"
                        leadingIcon={
                          settings.theme === "light" ? (
                            <SunIcon size={15} />
                          ) : (
                            <MoonIcon />
                          )
                        }
                        value={settings.theme}
                        options={themes}
                        onChange={chooseTheme}
                        renderValue={(selected) =>
                          settings.theme === "system"
                            ? "Dark"
                            : (selected?.label ?? "Dark")
                        }
                      />
                    </div>
                  </section>
                )}

                {showStartupCard && (
                  <section
                    className="settings-card settings-card-inline"
                    aria-label="Start with Windows"
                  >
                    <div className="settings-card-icon">
                      <PowerIcon />
                    </div>
                    <div className="settings-card-body">
                      <h2 className="settings-card-title">Start with Windows</h2>
                      <p className="settings-card-desc">
                        Automatically launch whisperlane when you sign in.
                      </p>
                    </div>
                    <div className="settings-card-inline-control">
                      <Switch
                        checked={startWithWindows}
                        disabled={startBusy}
                        label="Start with Windows"
                        onChange={(next) => void chooseStartWithWindows(next)}
                      />
                    </div>
                  </section>
                )}

                {showAboutCard && (
                  <section className="settings-card" aria-label="About whisperlane">
                    <div className="settings-card-icon">
                      <InfoIcon />
                    </div>
                    <div className="settings-card-body">
                      <h2 className="settings-card-title">whisperlane</h2>
                      <p className="settings-card-desc">
                        Version 0.1.0 · Local voice-to-text dictation for Windows.
                      </p>
                      {modelLine && (
                        <p className="settings-card-status">
                          Speech engine: {modelLine}
                        </p>
                      )}
                    </div>
                  </section>
                )}

                {activeTab === "general" &&
                  status !== null &&
                  transcriptMatters(status.last_text, status.delivery) && (
                    <section className="settings-card" aria-label="Last take">
                      <div className="settings-card-icon">
                        <MicIcon />
                      </div>
                      <div className="settings-card-body">
                        <h2 className="settings-card-title">Last Take</h2>
                        <p className="last-take-text">{status.last_text}</p>
                        <div className="field-status-row">
                          <span className="settings-card-status" role="status">
                            {deliveryNote(status.delivery, status.detail)}
                          </span>
                          <button
                            type="button"
                            className="card-action-btn"
                            onClick={() =>
                              invoke<PipelineStatus>("copy_last_text")
                                .then(setStatus)
                                .catch((e) => setError(String(e)))
                            }
                          >
                            {status.delivery === "clipboard"
                              ? "Copy again"
                              : "Copy to clipboard"}
                          </button>
                        </div>
                      </div>
                    </section>
                  )}
              </div>
            </main>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
