import { useEffect, useState } from "react";
import type { RibbonId } from "./brandmarkGeometry";
import { BrandWave } from "./BrandWave";
import {
  cloneRibbonTuningConfig,
  DEFAULT_RIBBON_TUNING_CONFIG,
  getRibbonTuningConfig,
  resetRibbonTuningConfig,
  setRibbonTuningConfig,
  type BrandRibbonMotionMode,
  type BrandWaveState,
  type RibbonMaterialTuning,
  type RibbonShapingTuning,
  type RibbonTuningConfig,
  type RibbonWaveCoupling,
  type StatePresetTuning,
} from "./RibbonDeformer";

const PRESET_STATES: { id: BrandWaveState; label: string; badge: string }[] = [
  { id: "idle", label: "Idle", badge: "Sakin" },
  { id: "ready", label: "Ready", badge: "Hazır" },
  { id: "thinking", label: "Thinking", badge: "Düşünüyor" },
  { id: "done", label: "Done", badge: "Tamamlandı" },
  { id: "muted", label: "Muted", badge: "Sessiz" },
];

const RIBBON_TABS: { id: RibbonId; label: string }[] = [
  { id: "ribbon-left", label: "Sol Ribbon (Left)" },
  { id: "ribbon-center", label: "Merkez Ribbon (Center)" },
  { id: "ribbon-right", label: "Sağ Ribbon (Right)" },
];

type SectionTab = "state" | "shaping" | "ribbons" | "material";

interface SliderRowProps {
  label: string;
  hint?: string;
  value: number;
  defaultValue: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  decimals?: number;
  onChange: (next: number) => void;
}

function SliderRow({
  label,
  hint,
  value,
  defaultValue,
  min,
  max,
  step,
  unit = "",
  decimals = 2,
  onChange,
}: SliderRowProps) {
  const isModified = Math.abs(value - defaultValue) > step * 0.25;

  return (
    <div className={`dev-slider-row${isModified ? " is-modified" : ""}`}>
      <div className="dev-slider-header">
        <div className="dev-slider-label-wrap">
          <span className="dev-slider-label">{label}</span>
          {hint && <span className="dev-slider-hint">{hint}</span>}
        </div>
        <div className="dev-slider-readout">
          {isModified && (
            <button
              type="button"
              className="dev-slider-reset-btn"
              title={`Varsayılana dön (${defaultValue.toFixed(decimals)}${unit})`}
              onClick={() => onChange(defaultValue)}
            >
              ↺
            </button>
          )}
          <input
            type="number"
            className="dev-slider-number"
            value={Number(value.toFixed(decimals))}
            min={min}
            max={max}
            step={step}
            onChange={(e) => {
              const parsed = parseFloat(e.target.value);
              if (!Number.isNaN(parsed)) {
                onChange(Math.min(max, Math.max(min, parsed)));
              }
            }}
          />
          {unit && <span className="dev-slider-unit">{unit}</span>}
        </div>
      </div>
      <input
        type="range"
        className="dev-slider-range"
        min={min}
        max={max}
        step={step}
        value={value}
        onDoubleClick={() => onChange(defaultValue)}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </div>
  );
}

export function DevRibbonLab() {
  const [config, setConfig] = useState<RibbonTuningConfig>(() =>
    cloneRibbonTuningConfig(getRibbonTuningConfig()),
  );
  const [selectedState, setSelectedState] = useState<BrandWaveState>("idle");
  const [motionMode, setMotionMode] =
    useState<BrandRibbonMotionMode>("animated");
  const [activeSection, setActiveSection] = useState<SectionTab>("state");
  const [selectedRibbon, setSelectedRibbon] =
    useState<RibbonId>("ribbon-center");
  const [replayNonce, setReplayNonce] = useState(0);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [showJsonPreview, setShowJsonPreview] = useState(false);

  useEffect(() => {
    setRibbonTuningConfig(config);
  }, [config]);

  const updateStateParam = <K extends keyof StatePresetTuning>(
    key: K,
    value: StatePresetTuning[K],
  ) => {
    setConfig((prev) => ({
      ...prev,
      states: {
        ...prev.states,
        [selectedState]: {
          ...prev.states[selectedState],
          [key]: value,
        },
      },
    }));
  };

  const updateShapingParam = <K extends keyof RibbonShapingTuning>(
    key: K,
    value: RibbonShapingTuning[K],
  ) => {
    setConfig((prev) => ({
      ...prev,
      shaping: {
        ...prev.shaping,
        [key]: value,
      },
    }));
  };

  const updateRibbonParam = <K extends keyof RibbonWaveCoupling>(
    ribbonId: RibbonId,
    key: K,
    value: RibbonWaveCoupling[K],
  ) => {
    setConfig((prev) => ({
      ...prev,
      ribbons: {
        ...prev.ribbons,
        [ribbonId]: {
          ...prev.ribbons[ribbonId],
          [key]: value,
        },
      },
    }));
  };

  const updateMaterialParam = <K extends keyof RibbonMaterialTuning>(
    key: K,
    value: RibbonMaterialTuning[K],
  ) => {
    setConfig((prev) => ({
      ...prev,
      material: {
        ...prev.material,
        [key]: value,
      },
    }));
  };

  const resetCurrentPreset = () => {
    const def = DEFAULT_RIBBON_TUNING_CONFIG.states[selectedState];
    setConfig((prev) => ({
      ...prev,
      states: {
        ...prev.states,
        [selectedState]: { ...def },
      },
    }));
  };

  const resetAll = () => {
    const fresh = resetRibbonTuningConfig();
    setConfig(fresh);
  };

  const buildExportPayload = (mode: "active" | "full") => {
    if (mode === "active") {
      return {
        preset: selectedState,
        motionMode,
        stateTuning: config.states[selectedState],
        shaping: config.shaping,
        ribbons: config.ribbons,
        material: config.material,
      };
    }
    return config;
  };

  const handleCopyJson = async (mode: "active" | "full") => {
    const payload = buildExportPayload(mode);
    const jsonText = JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard.writeText(jsonText);
      setCopyFeedback(
        mode === "active"
          ? `✓ "${selectedState}" + Genel JSON Kopyalandı!`
          : "✓ Tüm Konfigürasyon JSON Kopyalandı!",
      );
      setTimeout(() => setCopyFeedback(null), 2600);
    } catch {
      setShowJsonPreview(true);
      setCopyFeedback("Panoya erişilemedi, aşağıdan kopyalayabilirsiniz.");
      setTimeout(() => setCopyFeedback(null), 3200);
    }
  };

  const curState = config.states[selectedState];
  const defState = DEFAULT_RIBBON_TUNING_CONFIG.states[selectedState];
  const curShaping = config.shaping;
  const defShaping = DEFAULT_RIBBON_TUNING_CONFIG.shaping;
  const curRibbon = config.ribbons[selectedRibbon];
  const defRibbon = DEFAULT_RIBBON_TUNING_CONFIG.ribbons[selectedRibbon];
  const curMat = config.material;
  const defMat = DEFAULT_RIBBON_TUNING_CONFIG.material;

  return (
    <div className="dev-lab-root">
      {/* 1. Pinned Live Preview Stage + Preset & JSON Toolbar */}
      <section
        className="settings-card dev-preview-card"
        aria-label="Brand Ribbon Canlı Önizleme"
      >
        <div className="dev-preview-stage">
          <div className="dev-preview-box dev-preview-box-pill">
            <span className="dev-preview-caption">Pill Ölçeği (78px · 1x)</span>
            <div className="dev-simulated-pill" data-state={selectedState}>
              <span className="dev-sim-pill-dot" aria-hidden="true" />
              <BrandWave
                state={selectedState}
                width={78}
                motionMode={motionMode}
                tuningConfig={config}
                replayNonce={replayNonce}
              />
              <span className="dev-sim-pill-dots" aria-hidden="true">
                •••
              </span>
            </div>
          </div>

          <div className="dev-preview-box dev-preview-box-zoom">
            <span className="dev-preview-caption">
              Detay İnceleme (186px · 2.4x)
            </span>
            <div className="dev-zoom-stage">
              <BrandWave
                state={selectedState}
                width={186}
                motionMode={motionMode}
                tuningConfig={config}
                replayNonce={replayNonce}
              />
            </div>
          </div>
        </div>

        {/* Preset State Selector */}
        <div className="dev-toolbar-row">
          <div className="dev-preset-group" role="tablist" aria-label="Ribbon Statü Presetleri">
            {PRESET_STATES.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={selectedState === item.id}
                className={`dev-preset-btn${
                  selectedState === item.id ? " is-active" : ""
                }`}
                onClick={() => {
                  setSelectedState(item.id);
                  if (item.id === "done") {
                    setReplayNonce((n) => n + 1);
                  }
                }}
              >
                <span className="dev-preset-name">{item.label}</span>
                <span className="dev-preset-badge">{item.badge}</span>
              </button>
            ))}
          </div>

          <div className="dev-mode-actions">
            {selectedState === "done" && (
              <button
                type="button"
                className="dev-action-btn"
                onClick={() => setReplayNonce((n) => n + 1)}
                title="Done dalgasını tekrar oynat"
              >
                ↻ Tekrar Oynat
              </button>
            )}
            <button
              type="button"
              className={`dev-action-btn${
                motionMode === "static" ? " is-active-warn" : ""
              }`}
              onClick={() =>
                setMotionMode((m) => (m === "animated" ? "static" : "animated"))
              }
            >
              {motionMode === "animated" ? "Hareket: Aktif" : "Hareket: Statik"}
            </button>
          </div>
        </div>

        {/* JSON Copy & Reset Action Bar */}
        <div className="dev-export-bar">
          <div className="dev-export-left">
            <button
              type="button"
              className="dev-copy-primary-btn"
              onClick={() => void handleCopyJson("active")}
            >
              JSON Kopyala ({selectedState.toUpperCase()})
            </button>
            <button
              type="button"
              className="dev-action-btn"
              onClick={() => void handleCopyJson("full")}
            >
              Tüm Presetleri JSON Kopyala
            </button>
            <button
              type="button"
              className="dev-action-btn"
              onClick={() => setShowJsonPreview((s) => !s)}
            >
              {showJsonPreview ? "JSON Gizle" : "JSON Göster"}
            </button>
          </div>
          <div className="dev-export-right">
            <button
              type="button"
              className="dev-action-btn"
              onClick={resetCurrentPreset}
              title="Sadece seçili statünün değerlerini varsayılana döndürür"
            >
              Statüyü Sıfırla
            </button>
            <button
              type="button"
              className="dev-action-btn dev-action-danger"
              onClick={resetAll}
              title="Tüm statü ve materyal ayarlarını varsayılana döndürür"
            >
              Tümünü Sıfırla
            </button>
          </div>
        </div>

        {copyFeedback && (
          <div className="dev-copy-toast" role="status">
            {copyFeedback}
          </div>
        )}

        {showJsonPreview && (
          <pre className="dev-json-preview">
            {JSON.stringify(buildExportPayload("active"), null, 2)}
          </pre>
        )}
      </section>

      {/* 2. Parameter Category Navigation + Scrollable Sliders */}
      <section
        className="settings-card dev-sliders-card"
        aria-label="Ribbon Parametre Kontrolleri"
      >
        <div className="dev-section-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeSection === "state"}
            className={`dev-section-tab${
              activeSection === "state" ? " is-active" : ""
            }`}
            onClick={() => setActiveSection("state")}
          >
            1. Statü Dalga &amp; Hız ({selectedState})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeSection === "shaping"}
            className={`dev-section-tab${
              activeSection === "shaping" ? " is-active" : ""
            }`}
            onClick={() => setActiveSection("shaping")}
          >
            2. Dalga Zarfı &amp; Kontur
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeSection === "ribbons"}
            className={`dev-section-tab${
              activeSection === "ribbons" ? " is-active" : ""
            }`}
            onClick={() => setActiveSection("ribbons")}
          >
            3. Katman Faz Ayrımı (3 Ribbon)
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeSection === "material"}
            className={`dev-section-tab${
              activeSection === "material" ? " is-active" : ""
            }`}
            onClick={() => setActiveSection("material")}
          >
            4. Materyal, Film &amp; Işık
          </button>
        </div>

        <div className="dev-sliders-scroll">
          {activeSection === "state" && (
            <div className="dev-slider-grid">
              <div className="dev-group-title">
                Yatay Dalga Genlikleri ({selectedState.toUpperCase()})
              </div>
              <SliderRow
                label="Ana Dalga Genliği (amplitudeA1)"
                hint="Birincil yatay dalga yüksekliği (viewBox birimi)"
                value={curState.amplitudeA1}
                defaultValue={defState.amplitudeA1}
                min={0}
                max={60}
                step={0.5}
                decimals={1}
                onChange={(v) => updateStateParam("amplitudeA1", v)}
              />
              <SliderRow
                label="İkincil Harmonik Genliği (amplitudeA2)"
                hint="İkincil dalga bileşeni yüksekliği"
                value={curState.amplitudeA2}
                defaultValue={defState.amplitudeA2}
                min={0}
                max={40}
                step={0.2}
                decimals={1}
                onChange={(v) => updateStateParam("amplitudeA2", v)}
              />
              <SliderRow
                label="Üçüncül Girişim Genliği (amplitudeA3)"
                hint="Karşıt yönlü ince girişim dalgası yüksekliği"
                value={curState.amplitudeA3}
                defaultValue={defState.amplitudeA3}
                min={0}
                max={30}
                step={0.2}
                decimals={1}
                onChange={(v) => updateStateParam("amplitudeA3", v)}
              />

              <div className="dev-group-title">
                Uzamsal Frekans — Logo Boyunca Dalga Sayısı
              </div>
              <SliderRow
                label="Ana Dalga Sayısı (k1Cycles)"
                hint="Logo genişliği boyunca oluşan tam dalga adedi"
                value={curState.k1Cycles}
                defaultValue={defState.k1Cycles}
                min={0.25}
                max={6.0}
                step={0.05}
                decimals={2}
                onChange={(v) => updateStateParam("k1Cycles", v)}
              />
              <SliderRow
                label="İkincil Dalga Sayısı (k2Cycles)"
                hint="İkincil harmonik dalga sıklığı"
                value={curState.k2Cycles}
                defaultValue={defState.k2Cycles}
                min={0.5}
                max={8.0}
                step={0.05}
                decimals={2}
                onChange={(v) => updateStateParam("k2Cycles", v)}
              />
              <SliderRow
                label="Üçüncül Dalga Sayısı (k3Cycles)"
                hint="Üçüncül girişim dalga sıklığı"
                value={curState.k3Cycles}
                defaultValue={defState.k3Cycles}
                min={0.5}
                max={10.0}
                step={0.05}
                decimals={2}
                onChange={(v) => updateStateParam("k3Cycles", v)}
              />

              <div className="dev-group-title">
                Dalga Yayılım Süreleri (Düşük Süre = Daha Hızlı)
              </div>
              <SliderRow
                label="Ana Dalga Periyodu (cycleSeconds1)"
                hint="Bir tam dalga döngüsünün saniye cinsinden süresi (0 = durur)"
                value={curState.cycleSeconds1}
                defaultValue={defState.cycleSeconds1}
                min={0}
                max={12.0}
                step={0.1}
                unit="sn"
                decimals={1}
                onChange={(v) => updateStateParam("cycleSeconds1", v)}
              />
              <SliderRow
                label="İkincil Dalga Periyodu (cycleSeconds2)"
                hint="İkincil harmonik döngü süresi"
                value={curState.cycleSeconds2}
                defaultValue={defState.cycleSeconds2}
                min={0}
                max={10.0}
                step={0.1}
                unit="sn"
                decimals={1}
                onChange={(v) => updateStateParam("cycleSeconds2", v)}
              />
              <SliderRow
                label="Karşıt Dalga Periyodu (cycleSeconds3)"
                hint="Üçüncül karşıt girişim dalgası döngü süresi"
                value={curState.cycleSeconds3}
                defaultValue={defState.cycleSeconds3}
                min={0}
                max={10.0}
                step={0.1}
                unit="sn"
                decimals={1}
                onChange={(v) => updateStateParam("cycleSeconds3", v)}
              />

              <div className="dev-group-title">
                Kalınlık Nefes Alıp Verme (Pinch &amp; Swell)
              </div>
              <SliderRow
                label="Ana Kalınlık Modülasyonu (widthModB1)"
                hint="Dalga tepelerinde genişleme / çukurlarda incelme oranı"
                value={curState.widthModB1}
                defaultValue={defState.widthModB1}
                min={0}
                max={0.4}
                step={0.005}
                decimals={3}
                onChange={(v) => updateStateParam("widthModB1", v)}
              />
              <SliderRow
                label="İkincil Kalınlık Modülasyonu (widthModB2)"
                hint="İkincil kalınlık dalgalanması"
                value={curState.widthModB2}
                defaultValue={defState.widthModB2}
                min={0}
                max={0.25}
                step={0.005}
                decimals={3}
                onChange={(v) => updateStateParam("widthModB2", v)}
              />
              <SliderRow
                label="Üçüncül Kalınlık Modülasyonu (widthModB3)"
                hint="Üçüncül ince kalınlık dalgalanması"
                value={curState.widthModB3}
                defaultValue={defState.widthModB3}
                min={0}
                max={0.2}
                step={0.005}
                decimals={3}
                onChange={(v) => updateStateParam("widthModB3", v)}
              />

              <div className="dev-group-title">
                Statüye Özel Işık, Film Hızı &amp; Glow
              </div>
              <SliderRow
                label="İç Kromatik Film Hızı (filmSpeed)"
                hint="Ribbon içindeki renk katmanlarının akış hızı (rad/sn)"
                value={curState.filmSpeed}
                defaultValue={defState.filmSpeed}
                min={0}
                max={6.0}
                step={0.05}
                decimals={2}
                onChange={(v) => updateStateParam("filmSpeed", v)}
              />
              <SliderRow
                label="Speküler Işık Geçiş Süresi (sheenPeriod)"
                hint="Soldan sağa kayan parlak ışık bandı periyodu (0 = kapalı)"
                value={curState.sheenPeriod}
                defaultValue={defState.sheenPeriod}
                min={0}
                max={12.0}
                step={0.1}
                unit="sn"
                decimals={1}
                onChange={(v) => updateStateParam("sheenPeriod", v)}
              />
              <SliderRow
                label="Hacimsel Glow Yoğunluğu (glowOpacity)"
                hint="Ribbon geometrisini takip eden dış ışıma gücü"
                value={curState.glowOpacity}
                defaultValue={defState.glowOpacity}
                min={0}
                max={1.0}
                step={0.02}
                decimals={2}
                onChange={(v) => updateStateParam("glowOpacity", v)}
              />
              <SliderRow
                label="Speküler Çekirdek Parlaklığı (specularIntensity)"
                hint="Merkez sinyal çekirdeği ve speküler yansıma çarpanı"
                value={curState.specularIntensity}
                defaultValue={defState.specularIntensity}
                min={0}
                max={1.6}
                step={0.02}
                decimals={2}
                onChange={(v) => updateStateParam("specularIntensity", v)}
              />
            </div>
          )}

          {activeSection === "shaping" && (
            <div className="dev-slider-grid">
              <div className="dev-group-title">
                Yatay Zarf &amp; Alt/Üst Sınır Faz Farkı
              </div>
              <SliderRow
                label="Yatay Zarf Gücü (envelopePower)"
                hint="E(x) = sin(πx)^p — Yüksek değer hareketi merkeze odaklar, uçları sabitler"
                value={curShaping.envelopePower}
                defaultValue={defShaping.envelopePower}
                min={0.3}
                max={3.5}
                step={0.05}
                decimals={2}
                onChange={(v) => updateShapingParam("envelopePower", v)}
              />
              <SliderRow
                label="Üst Sınır Faz Önceliği (upperPhaseLead)"
                hint="Üst kenarın (v=+1) merkez dalgaya göre faz farkı (radyan)"
                value={curShaping.upperPhaseLead}
                defaultValue={defShaping.upperPhaseLead}
                min={0}
                max={1.5}
                step={0.02}
                unit="rad"
                decimals={2}
                onChange={(v) => updateShapingParam("upperPhaseLead", v)}
              />
              <SliderRow
                label="Alt Sınır Faz Gecikmesi (lowerPhaseLag)"
                hint="Alt kenarın (v=-1) merkez dalgaya göre faz farkı (radyan)"
                value={curShaping.lowerPhaseLag}
                defaultValue={defShaping.lowerPhaseLag}
                min={0}
                max={1.5}
                step={0.02}
                unit="rad"
                decimals={2}
                onChange={(v) => updateShapingParam("lowerPhaseLag", v)}
              />

              <div className="dev-group-title">
                Kalınlık Sınırları &amp; Normal Kayma
              </div>
              <SliderRow
                label="Minimum Kalınlık Oranı (minWidthRatio)"
                hint="Daralma sırasında orijinal kalınlığın altına inebileceği sınır"
                value={curShaping.minWidthRatio}
                defaultValue={defShaping.minWidthRatio}
                min={0.35}
                max={1.0}
                step={0.02}
                decimals={2}
                onChange={(v) => updateShapingParam("minWidthRatio", v)}
              />
              <SliderRow
                label="Maksimum Kalınlık Oranı (maxWidthRatio)"
                hint="Genişleme sırasında orijinal kalınlığın üstüne çıkabileceği sınır"
                value={curShaping.maxWidthRatio}
                defaultValue={defShaping.maxWidthRatio}
                min={1.0}
                max={2.0}
                step={0.02}
                decimals={2}
                onChange={(v) => updateShapingParam("maxWidthRatio", v)}
              />
              <SliderRow
                label="Yatay Normal Kayma (horizontalShear)"
                hint="Kıvrımlarda yüzey normali yönündeki yatay esneme payı"
                value={curShaping.horizontalShear}
                defaultValue={defShaping.horizontalShear}
                min={0}
                max={1.0}
                step={0.02}
                decimals={2}
                onChange={(v) => updateShapingParam("horizontalShear", v)}
              />

              <div className="dev-group-title">
                Kesişim Dikiş Koruma (Underpass Seam Coupling)
              </div>
              <SliderRow
                label="Dikiş Faz Uyumu (seamBlendStrength)"
                hint="Sol ve sağ ribbon'ın merkez kemer altına girerken faz eşitleme oranı"
                value={curShaping.seamBlendStrength}
                defaultValue={defShaping.seamBlendStrength}
                min={0}
                max={1.0}
                step={0.05}
                decimals={2}
                onChange={(v) => updateShapingParam("seamBlendStrength", v)}
              />
              <SliderRow
                label="Dikiş Genlik Sönümleme (seamAmpDamping)"
                hint="Kesişim noktalarında üst üste binmenin bozulmaması için sönümleme"
                value={curShaping.seamAmpDamping}
                defaultValue={defShaping.seamAmpDamping}
                min={0}
                max={0.8}
                step={0.02}
                decimals={2}
                onChange={(v) => updateShapingParam("seamAmpDamping", v)}
              />
            </div>
          )}

          {activeSection === "ribbons" && (
            <div className="dev-slider-grid">
              <div className="dev-ribbon-subtabs" role="tablist">
                {RIBBON_TABS.map((rt) => (
                  <button
                    key={rt.id}
                    type="button"
                    role="tab"
                    aria-selected={selectedRibbon === rt.id}
                    className={`dev-subtab-btn${
                      selectedRibbon === rt.id ? " is-active" : ""
                    }`}
                    onClick={() => setSelectedRibbon(rt.id)}
                  >
                    {rt.label}
                  </button>
                ))}
              </div>

              <div className="dev-group-title">
                Faz Kaymaları ({selectedRibbon})
              </div>
              <SliderRow
                label="Ana Dalga Fazı (phase1)"
                hint="Diğer ribbon katmanlarıyla senkron kırıcı birincil faz farkı"
                value={curRibbon.phase1}
                defaultValue={defRibbon.phase1}
                min={-3.14}
                max={3.14}
                step={0.02}
                unit="rad"
                decimals={2}
                onChange={(v) => updateRibbonParam(selectedRibbon, "phase1", v)}
              />
              <SliderRow
                label="İkincil Dalga Fazı (phase2)"
                hint="İkincil harmonik faz kayması"
                value={curRibbon.phase2}
                defaultValue={defRibbon.phase2}
                min={-3.14}
                max={3.14}
                step={0.05}
                unit="rad"
                decimals={2}
                onChange={(v) => updateRibbonParam(selectedRibbon, "phase2", v)}
              />
              <SliderRow
                label="Üçüncül Dalga Fazı (phase3)"
                hint="Karşıt girişim dalgası faz kayması"
                value={curRibbon.phase3}
                defaultValue={defRibbon.phase3}
                min={-3.14}
                max={3.14}
                step={0.05}
                unit="rad"
                decimals={2}
                onChange={(v) => updateRibbonParam(selectedRibbon, "phase3", v)}
              />

              <div className="dev-group-title">
                Uzamsal Frekans &amp; Genlik Çarpanları ({selectedRibbon})
              </div>
              <SliderRow
                label="Ana Frekans Çarpanı (freqScale1)"
                hint="Bu ribbon'ın birincil dalga sıklığı çarpanı"
                value={curRibbon.freqScale1}
                defaultValue={defRibbon.freqScale1}
                min={0.5}
                max={1.6}
                step={0.01}
                decimals={2}
                onChange={(v) =>
                  updateRibbonParam(selectedRibbon, "freqScale1", v)
                }
              />
              <SliderRow
                label="İkincil Frekans Çarpanı (freqScale2)"
                hint="Bu ribbon'ın ikincil dalga sıklığı çarpanı"
                value={curRibbon.freqScale2}
                defaultValue={defRibbon.freqScale2}
                min={0.5}
                max={1.6}
                step={0.01}
                decimals={2}
                onChange={(v) =>
                  updateRibbonParam(selectedRibbon, "freqScale2", v)
                }
              />
              <SliderRow
                label="Üçüncül Frekans Çarpanı (freqScale3)"
                hint="Bu ribbon'ın üçüncül dalga sıklığı çarpanı"
                value={curRibbon.freqScale3}
                defaultValue={defRibbon.freqScale3}
                min={0.5}
                max={1.6}
                step={0.01}
                decimals={2}
                onChange={(v) =>
                  updateRibbonParam(selectedRibbon, "freqScale3", v)
                }
              />
              <SliderRow
                label="Genlik Çarpanı (ampScale)"
                hint="Bu ribbon'ın genel dalga yüksekliği ağırlığı"
                value={curRibbon.ampScale}
                defaultValue={defRibbon.ampScale}
                min={0.2}
                max={2.0}
                step={0.02}
                decimals={2}
                onChange={(v) =>
                  updateRibbonParam(selectedRibbon, "ampScale", v)
                }
              />
              <SliderRow
                label="Kalınlık Nefes Çarpanı (thicknessScale)"
                hint="Bu ribbon'ın daralma/genişleme ağırlığı"
                value={curRibbon.thicknessScale}
                defaultValue={defRibbon.thicknessScale}
                min={0.2}
                max={2.0}
                step={0.02}
                decimals={2}
                onChange={(v) =>
                  updateRibbonParam(selectedRibbon, "thicknessScale", v)
                }
              />
            </div>
          )}

          {activeSection === "material" && (
            <div className="dev-slider-grid">
              <div className="dev-group-title">
                İç Kromatik Dalga Şeritleri (Chromatic Interference)
              </div>
              <SliderRow
                label="İç Film Salınım Genişliği (filmSwing)"
                hint="İç renk dalgalarının ribbon kesiti içindeki dikey gezinme alanı"
                value={curMat.filmSwing}
                defaultValue={defMat.filmSwing}
                min={0}
                max={1.4}
                step={0.02}
                decimals={2}
                onChange={(v) => updateMaterialParam("filmSwing", v)}
              />
              <SliderRow
                label="Film 0 Opaklığı — Cyan/Mavi/Mor (film0Opacity)"
                hint="İleri yönlü birinci iç dalga katmanı görünürlüğü"
                value={curMat.film0Opacity}
                defaultValue={defMat.film0Opacity}
                min={0}
                max={1.0}
                step={0.02}
                decimals={2}
                onChange={(v) => updateMaterialParam("film0Opacity", v)}
              />
              <SliderRow
                label="Film 1 Opaklığı — Mavi/Magenta/Pembe (film1Opacity)"
                hint="Karşıt fazlı ikinci iç dalga katmanı görünürlüğü"
                value={curMat.film1Opacity}
                defaultValue={defMat.film1Opacity}
                min={0}
                max={1.0}
                step={0.02}
                decimals={2}
                onChange={(v) => updateMaterialParam("film1Opacity", v)}
              />
              <SliderRow
                label="Film 2 Additive Parlama (film2AdditiveOpacity)"
                hint="Kesişimlerde parlayan 'lighter' karışım modlu merkez katman"
                value={curMat.film2AdditiveOpacity}
                defaultValue={defMat.film2AdditiveOpacity}
                min={0}
                max={1.0}
                step={0.02}
                decimals={2}
                onChange={(v) => updateMaterialParam("film2AdditiveOpacity", v)}
              />

              <div className="dev-group-title">
                Üst ve Alt Kenar Işıkları (Rim Highlights)
              </div>
              <SliderRow
                label="Üst Kenar Işık Kalınlığı (upperRimWidth)"
                hint="v = +1 üst sınır çizgisel vurgu kalınlığı"
                value={curMat.upperRimWidth}
                defaultValue={defMat.upperRimWidth}
                min={0}
                max={24}
                step={0.5}
                decimals={1}
                onChange={(v) => updateMaterialParam("upperRimWidth", v)}
              />
              <SliderRow
                label="Üst Kenar Işık Opaklığı (upperRimOpacity)"
                hint="v = +1 üst sınır parlaklık çarpanı"
                value={curMat.upperRimOpacity}
                defaultValue={defMat.upperRimOpacity}
                min={0}
                max={1.5}
                step={0.05}
                decimals={2}
                onChange={(v) => updateMaterialParam("upperRimOpacity", v)}
              />
              <SliderRow
                label="Alt Kenar Işık Kalınlığı (lowerRimWidth)"
                hint="v = -1 alt sınır ikincil yansıma kalınlığı"
                value={curMat.lowerRimWidth}
                defaultValue={defMat.lowerRimWidth}
                min={0}
                max={20}
                step={0.5}
                decimals={1}
                onChange={(v) => updateMaterialParam("lowerRimWidth", v)}
              />
              <SliderRow
                label="Alt Kenar Işık Opaklığı (lowerRimOpacity)"
                hint="v = -1 alt sınır parlaklık çarpanı"
                value={curMat.lowerRimOpacity}
                defaultValue={defMat.lowerRimOpacity}
                min={0}
                max={1.5}
                step={0.05}
                decimals={2}
                onChange={(v) => updateMaterialParam("lowerRimOpacity", v)}
              />

              <div className="dev-group-title">
                Katman Derinliği (Occlusion &amp; Overpass Caustics)
              </div>
              <SliderRow
                label="Alt Geçiş Gölge Gücü (occlusionStrength)"
                hint="Arkadan geçen ribbon katmanının kesişim yerindeki gölge koyuluğu"
                value={curMat.occlusionStrength}
                defaultValue={defMat.occlusionStrength}
                min={0}
                max={1.2}
                step={0.02}
                decimals={2}
                onChange={(v) => updateMaterialParam("occlusionStrength", v)}
              />
              <SliderRow
                label="Üst Geçiş Kostik Parlama (overpassCausticStrength)"
                hint="Üstten geçen kemerin kesişim yerindeki optik parlama gücü"
                value={curMat.overpassCausticStrength}
                defaultValue={defMat.overpassCausticStrength}
                min={0}
                max={1.0}
                step={0.02}
                decimals={2}
                onChange={(v) =>
                  updateMaterialParam("overpassCausticStrength", v)
                }
              />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
