import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckIcon, PlusIcon, RefreshIcon, XIcon } from "../icons";
import { api, type UiPreset, type UiState } from "../api";
import { overlayLayout as defaultLayout, DOCK_BASE_HEIGHT, DOCK_GAP_COUNT } from "../../../02_ui-overlay/src/config/layout";
import {
  aiPanelDefaults,
  lyricsPanelDefaults,
  memoPanelDefaults,
  musicPanelDefaults,
  newsPanelDefaults,
  uiSettings as defaultSettings,
} from "../../../02_ui-overlay/src/config/uiSettings";

type JsonMap = Record<string, any>;
type SaveState = "idle" | "saving" | "saved";

const resolutionOptions = [
  "1366x768",
  "1440x900",
  "1920x1080",
  "1920x1200",
  "2240x1400",
  "2560x1440",
  "2560x1600",
  "3440x1440",
];

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

function isObject(v: unknown): v is JsonMap {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function mergeDeep(base: any, patch: any): any {
  if (!isObject(base)) return patch === undefined ? clone(base) : clone(patch);
  const out: JsonMap = clone(base);
  if (!isObject(patch)) return out;
  for (const [k, v] of Object.entries(patch)) {
    out[k] = isObject(out[k]) && isObject(v) ? mergeDeep(out[k], v) : clone(v);
  }
  return out;
}

function defaultsWith(ui: UiState | null) {
  return {
    layout: mergeDeep(defaultLayout, ui?.layout ?? {}),
    settings: mergeDeep(defaultSettings, ui?.settings ?? {}),
  };
}

function parseResolution(value: string): [number, number] {
  const [w, h] = value.split("x").map((n) => Number(n));
  return [Number.isFinite(w) ? w : 1920, Number.isFinite(h) ? h : 1080];
}

function ControlRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="display-control">
      <span>{label}</span>
      {children}
    </label>
  );
}

function NumberControl(props: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const min = props.min ?? 0;
  const max = props.max ?? 3000;
  const step = props.step ?? 1;
  const value = Number.isFinite(props.value) ? props.value : min;
  return (
    <ControlRow label={props.label}>
      <div className="display-number-control">
        <input
          type="range"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => props.onChange(Number(e.target.value))}
        />
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => props.onChange(Number(e.target.value))}
        />
      </div>
    </ControlRow>
  );
}

function CheckControl({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="display-check">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function SelectControl({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <ControlRow label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </ControlRow>
  );
}

function DisplaySection({ title, children, open = false }: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="display-section" open={open}>
      <summary>{title}</summary>
      <div className="display-section-body">{children}</div>
    </details>
  );
}

export default function TabDisplay({ embedded = false }: { embedded?: boolean }) {
  const [ui, setUi] = useState<UiState | null>(null);
  const [presets, setPresets] = useState<UiPreset[]>([]);
  const initial = defaultsWith(null);
  const [draftLayout, setDraftLayout] = useState<JsonMap>(initial.layout);
  const [draftSettings, setDraftSettings] = useState<JsonMap>(initial.settings);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState<SaveState>("idle");
  const dirtyRef = useRef(false);
  const saveSeq = useRef(0);

  const markDirty = () => {
    saveSeq.current += 1;
    dirtyRef.current = true;
    setDirty(true);
    setSaving("idle");
  };

  const adopt = (u: UiState, forceDraft = false) => {
    setUi(u);
    setPresets(u.presets);
    if (forceDraft || !dirtyRef.current) {
      const merged = defaultsWith(u);
      setDraftLayout(merged.layout);
      setDraftSettings(merged.settings);
      dirtyRef.current = false;
      setDirty(false);
    }
  };

  const load = async (forceDraft = false) => {
    try {
      const u = await api.getUi();
      adopt(u, forceDraft);
      setError(null);
    } catch {
      setError("APIに接続できませんでした（Companion が起動しているか確認）");
    }
  };

  useEffect(() => {
    load(true);
    const id = setInterval(() => load(false), 4000);
    return () => clearInterval(id);
  }, []);

  const setLayoutValue = (section: string, key: string, value: number) => {
    setDraftLayout((prev) => ({ ...prev, [section]: { ...(prev[section] ?? {}), [key]: value } }));
    markDirty();
  };

  const setSettingValue = (section: string, key: string, value: unknown) => {
    setDraftSettings((prev) => ({ ...prev, [section]: { ...(prev[section] ?? {}), [key]: value } }));
    markDirty();
  };

  const setRootSetting = (key: string, value: unknown) => {
    setDraftSettings((prev) => ({ ...prev, [key]: value }));
    markDirty();
  };

  const setBaseResolution = (value: string) => {
    const [width, height] = parseResolution(value);
    setDraftSettings((prev) => ({ ...prev, baseResolution: value }));
    setDraftLayout((prev) => ({ ...prev, canvas: { ...(prev.canvas ?? {}), width, height } }));
    markDirty();
  };

  const resetDraft = () => {
    setDraftLayout(clone(defaultLayout));
    setDraftSettings(clone(defaultSettings));
    markDirty();
  };

  const saveCurrent = async () => {
    const nm = name.trim() || `プリセット ${presets.length + 1}`;
    setName("");
    try {
      await api.createPreset(nm, draftLayout, draftSettings);
      await load(false);
    } catch {
      setError("保存に失敗しました");
    }
  };

  const apply = async (id: string) => {
    try {
      dirtyRef.current = false;
      setDirty(false);
      await api.applyPreset(id);
      await load(true);
    } catch {
      setError("適用に失敗しました");
    }
  };

  const overwrite = async (id: string) => {
    try {
      await api.overwritePreset(id, draftLayout, draftSettings);
      await load(false);
    } catch {
      setError("更新に失敗しました");
    }
  };

  const remove = async (id: string) => {
    setPresets((prev) => prev.filter((p) => p.id !== id));
    try { await api.deletePreset(id); await load(false); }
    catch { load(false); }
  };

  const commitRename = async (id: string) => {
    const nm = renameText.trim();
    setRenaming(null);
    if (!nm) return;
    try { await api.renamePreset(id, nm); await load(false); }
    catch { setError("名前変更に失敗しました"); }
  };

  const [canvasW, canvasH] = parseResolution(draftSettings.baseResolution ?? "1920x1080");
  const hasLiveUi = ui && ui.settings && Object.keys(ui.settings).length > 0;
  const syncLabel = saving === "saving" ? "自動反映中..." : saving === "saved" ? "反映済み" : dirty ? "反映待ち" : "反映済み";

  useEffect(() => {
    if (!dirty) return;
    const seq = saveSeq.current;
    setSaving("saving");
    const id = window.setTimeout(async () => {
      try {
        const u = await api.putUi(draftLayout, draftSettings) as UiState;
        setUi(u);
        setPresets(u.presets);
        setError(null);
        if (saveSeq.current === seq) {
          dirtyRef.current = false;
          setDirty(false);
          setSaving("saved");
          window.setTimeout(() => setSaving("idle"), 1200);
        }
      } catch {
        if (saveSeq.current === seq) {
          setSaving("idle");
          setError("壁紙への自動反映に失敗しました");
        }
      }
    }, 180);
    return () => window.clearTimeout(id);
  }, [draftLayout, draftSettings, dirty]);

  const renderPlacement = (section: string, title: string, defaults: JsonMap) => {
    const panelSettings = { ...defaults, ...(draftSettings[section] ?? {}) };
    const panelLayout = draftLayout[section] ?? {};
    return (
      <DisplaySection title={title}>
        <div className="control-grid">
          <CheckControl label="表示する" checked={panelSettings.show !== false} onChange={(v) => setSettingValue(section, "show", v)} />
          <CheckControl label="ヘッダー" checked={panelSettings.showHeader !== false} onChange={(v) => setSettingValue(section, "showHeader", v)} />
          <CheckControl label="背景" checked={panelSettings.showBackground !== false} onChange={(v) => setSettingValue(section, "showBackground", v)} />
          <NumberControl label="背景濃度" value={panelSettings.backgroundOpacity ?? 0.4} min={0} max={1} step={0.05} onChange={(v) => setSettingValue(section, "backgroundOpacity", v)} />
          <NumberControl label="X" value={panelLayout.x ?? 0} max={canvasW} onChange={(v) => setLayoutValue(section, "x", v)} />
          <NumberControl label="Y" value={panelLayout.y ?? 0} max={canvasH} onChange={(v) => setLayoutValue(section, "y", v)} />
          <NumberControl label="幅" value={panelLayout.width ?? 300} max={canvasW} onChange={(v) => setLayoutValue(section, "width", v)} />
          <NumberControl label="高さ" value={panelLayout.height ?? 300} max={canvasH} onChange={(v) => setLayoutValue(section, "height", v)} />
        </div>
      </DisplaySection>
    );
  };

  const news = { ...newsPanelDefaults, ...(draftSettings.newsPanel ?? {}) };
  const music = { ...musicPanelDefaults, ...(draftSettings.musicPanel ?? {}) };
  const lyrics = { ...lyricsPanelDefaults, ...(draftSettings.lyricsPanel ?? {}) };
  const ai = { ...aiPanelDefaults, ...(draftSettings.aiPanel ?? {}) };
  const memo = { ...memoPanelDefaults, ...(draftSettings.memoPanel ?? {}) };

  return (
    <section className={`tab-panel display-panel ${embedded ? "embedded" : ""}`}>
      <header className="panel-head">
        <h2>表示設定</h2>
        <span className="panel-sub">位置・サイズは変更すると自動で反映</span>
      </header>

      {!hasLiveUi && (
        <p className="note">
          まだ壁紙から設定が送られていません。ここでは既定値を編集できます。反映すると壁紙側が次回同期時に採用します。
        </p>
      )}

      <div className="display-toolbar">
        <div className="field">
          <span>画面サイズ</span>
          <select value={draftSettings.baseResolution ?? "1920x1080"} onChange={(e) => setBaseResolution(e.target.value)}>
            {resolutionOptions.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <span className={`display-sync-pill pill ${saving === "saving" || dirty ? "warn" : "ok"}`}>{syncLabel}</span>
        <button className="secondary-btn" onClick={() => load(true)}>
          <RefreshIcon />
          再読込
        </button>
        <button className="secondary-btn" onClick={resetDraft}>既定値</button>
      </div>

      <div className="display-save-state">
        <span className="hint">スライダーを動かすとCompanionへ自動保存され、壁紙側が短い間隔で取り込みます。プリセット保存/上書きは、現在この画面で編集中の内容を使います。</span>
      </div>

      <form className="add-row" onSubmit={(e) => { e.preventDefault(); saveCurrent(); }}>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="プリセット名（この編集内容を保存）"
        />
        <button type="submit">
          <PlusIcon />
          保存
        </button>
      </form>

      {error && <p className="error-banner">⚠ {error}</p>}

      {presets.length > 0 && (
        <ul className="preset-list">
          {presets.map((p) => {
            const active = ui?.activePresetId === p.id;
            return (
              <li key={p.id} className={`preset-item ${active ? "active" : ""}`}>
                {renaming === p.id ? (
                  <input
                    autoFocus
                    className="preset-rename"
                    value={renameText}
                    onChange={(e) => setRenameText(e.target.value)}
                    onBlur={() => commitRename(p.id)}
                    onKeyDown={(e) => { if (e.key === "Enter") commitRename(p.id); }}
                  />
                ) : (
                  <span className="preset-name" onDoubleClick={() => { setRenaming(p.id); setRenameText(p.name); }}>
                    {active && <CheckIcon />} {p.name}
                  </span>
                )}
                <div className="preset-actions">
                  <button className="secondary-btn" onClick={() => apply(p.id)}>適用</button>
                  <button className="secondary-btn" onClick={() => overwrite(p.id)}>上書</button>
                  <button className="secondary-btn" onClick={() => { setRenaming(p.id); setRenameText(p.name); }}>名前</button>
                  <button className="icon-btn danger" onClick={() => remove(p.id)} aria-label="削除"><XIcon /></button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="display-editor">
        <DisplaySection title="全体 / デバッグ" open>
          <div className="control-grid">
            <CheckControl label="デバッグ枠" checked={draftSettings.debugMode === true} onChange={(v) => setRootSetting("debugMode", v)} />
            <NumberControl label="全体不透明度" value={draftSettings.overlay?.opacity ?? 1} min={0} max={1} step={0.05} onChange={(v) => setSettingValue("overlay", "opacity", v)} />
          </div>
        </DisplaySection>

        <DisplaySection title="時計 / 左上情報" open>
          <div className="control-grid">
            <CheckControl label="時計を表示" checked={draftSettings.clock?.showClock !== false} onChange={(v) => setSettingValue("clock", "showClock", v)} />
            <CheckControl label="日付" checked={draftSettings.clock?.showDate !== false} onChange={(v) => setSettingValue("clock", "showDate", v)} />
            <CheckControl label="秒" checked={draftSettings.clock?.showSeconds !== false} onChange={(v) => setSettingValue("clock", "showSeconds", v)} />
            <CheckControl label="天気" checked={draftSettings.clock?.showWeather !== false} onChange={(v) => setSettingValue("clock", "showWeather", v)} />
            <CheckControl label="湿度" checked={draftSettings.clock?.showHumidity !== false} onChange={(v) => setSettingValue("clock", "showHumidity", v)} />
            <CheckControl label="場所" checked={draftSettings.clock?.showLocation !== false} onChange={(v) => setSettingValue("clock", "showLocation", v)} />
            <NumberControl label="X" value={draftLayout.clock?.x ?? 0} max={canvasW} onChange={(v) => setLayoutValue("clock", "x", v)} />
            <NumberControl label="Y" value={draftLayout.clock?.y ?? 0} max={canvasH} onChange={(v) => setLayoutValue("clock", "y", v)} />
            <NumberControl label="幅" value={draftLayout.clock?.width ?? 480} max={canvasW} onChange={(v) => setLayoutValue("clock", "width", v)} />
            <NumberControl label="日付サイズ" value={draftLayout.clock?.dateSize ?? 63} max={140} onChange={(v) => setLayoutValue("clock", "dateSize", v)} />
            <NumberControl label="時刻サイズ" value={draftLayout.clock?.timeSize ?? 105} max={220} onChange={(v) => setLayoutValue("clock", "timeSize", v)} />
          </div>
        </DisplaySection>

        <DisplaySection title="天気パネル">
          <div className="control-grid">
            <CheckControl label="表示する" checked={draftSettings.weatherCompact?.showCompactWeather !== false} onChange={(v) => setSettingValue("weatherCompact", "showCompactWeather", v)} />
            <SelectControl
              label="表示形式"
              value={draftSettings.weatherCompact?.displayMode ?? "compact"}
              onChange={(v) => setSettingValue("weatherCompact", "displayMode", v)}
              options={[{ value: "compact", label: "コンパクト" }, { value: "detailed", label: "詳細" }]}
            />
            <CheckControl label="場所" checked={draftSettings.weatherCompact?.showLocation !== false} onChange={(v) => setSettingValue("weatherCompact", "showLocation", v)} />
            <CheckControl label="天気" checked={draftSettings.weatherCompact?.showWeather !== false} onChange={(v) => setSettingValue("weatherCompact", "showWeather", v)} />
            <CheckControl label="気温バー" checked={draftSettings.weatherCompact?.showTemperature !== false} onChange={(v) => setSettingValue("weatherCompact", "showTemperature", v)} />
            <CheckControl label="湿度バー" checked={draftSettings.weatherCompact?.showHumidity !== false} onChange={(v) => setSettingValue("weatherCompact", "showHumidity", v)} />
            <CheckControl label="気圧" checked={draftSettings.weatherCompact?.showPressure === true} onChange={(v) => setSettingValue("weatherCompact", "showPressure", v)} />
            <NumberControl label="X" value={draftLayout.weatherCompact?.x ?? 0} max={canvasW} onChange={(v) => setLayoutValue("weatherCompact", "x", v)} />
            <NumberControl label="Y" value={draftLayout.weatherCompact?.y ?? 0} max={canvasH} onChange={(v) => setLayoutValue("weatherCompact", "y", v)} />
            <NumberControl label="幅" value={draftLayout.weatherCompact?.width ?? 440} max={canvasW} onChange={(v) => setLayoutValue("weatherCompact", "width", v)} />
            <NumberControl label="文字サイズ" value={draftLayout.weatherCompact?.fontSize ?? 24} max={100} onChange={(v) => setLayoutValue("weatherCompact", "fontSize", v)} />
          </div>
        </DisplaySection>

        {renderPlacement("newsPanel", "ニュースパネル", newsPanelDefaults)}
        <DisplaySection title="ニュース内容">
          <div className="control-grid">
            <CheckControl label="番号" checked={news.showIndex !== false} onChange={(v) => setSettingValue("newsPanel", "showIndex", v)} />
            <CheckControl label="時刻" checked={news.showTime !== false} onChange={(v) => setSettingValue("newsPanel", "showTime", v)} />
            <CheckControl label="ソース" checked={news.showSource !== false} onChange={(v) => setSettingValue("newsPanel", "showSource", v)} />
            <CheckControl label="概要" checked={news.showSummary !== false} onChange={(v) => setSettingValue("newsPanel", "showSummary", v)} />
            <CheckControl label="フッター" checked={news.showFooter !== false} onChange={(v) => setSettingValue("newsPanel", "showFooter", v)} />
            <NumberControl label="最大件数" value={news.maxItems ?? 5} min={1} max={20} onChange={(v) => setSettingValue("newsPanel", "maxItems", v)} />
            <NumberControl label="タイトルサイズ" value={news.titleSize ?? 17} min={8} max={48} onChange={(v) => setSettingValue("newsPanel", "titleSize", v)} />
            <NumberControl label="概要サイズ" value={news.summarySize ?? 14} min={8} max={40} onChange={(v) => setSettingValue("newsPanel", "summarySize", v)} />
          </div>
        </DisplaySection>

        {renderPlacement("musicPanel", "音楽パネル", musicPanelDefaults)}
        <DisplaySection title="音楽内容">
          <div className="control-grid">
            <CheckControl label="アートワーク" checked={music.showArtwork !== false} onChange={(v) => setSettingValue("musicPanel", "showArtwork", v)} />
            <CheckControl label="アルバム" checked={music.showAlbum !== false} onChange={(v) => setSettingValue("musicPanel", "showAlbum", v)} />
            <CheckControl label="時間表示" checked={music.showTimeCodes !== false} onChange={(v) => setSettingValue("musicPanel", "showTimeCodes", v)} />
            <CheckControl label="操作ボタン" checked={music.showControls !== false} onChange={(v) => setSettingValue("musicPanel", "showControls", v)} />
            <CheckControl label="進捗マーカー" checked={music.showMarker !== false} onChange={(v) => setSettingValue("musicPanel", "showMarker", v)} />
            <NumberControl label="タイトルサイズ" value={music.titleSize ?? 26} min={8} max={64} onChange={(v) => setSettingValue("musicPanel", "titleSize", v)} />
            <NumberControl label="アーティストサイズ" value={music.artistSize ?? 16} min={8} max={48} onChange={(v) => setSettingValue("musicPanel", "artistSize", v)} />
            <NumberControl label="バー高さ" value={music.barHeight ?? 16} min={4} max={50} onChange={(v) => setSettingValue("musicPanel", "barHeight", v)} />
          </div>
        </DisplaySection>

        {renderPlacement("lyricsPanel", "歌詞パネル", lyricsPanelDefaults)}
        <DisplaySection title="歌詞内容">
          <div className="control-grid">
            <CheckControl label="曲名行" checked={lyrics.showTrack !== false} onChange={(v) => setSettingValue("lyricsPanel", "showTrack", v)} />
            <CheckControl label="状態バッジ" checked={lyrics.showStatus !== false} onChange={(v) => setSettingValue("lyricsPanel", "showStatus", v)} />
            <SelectControl
              label="文字揃え"
              value={lyrics.align ?? "center"}
              onChange={(v) => setSettingValue("lyricsPanel", "align", v)}
              options={[{ value: "left", label: "左" }, { value: "center", label: "中央" }, { value: "right", label: "右" }]}
            />
            <NumberControl label="現在行サイズ" value={lyrics.currentSize ?? 30} min={12} max={80} onChange={(v) => setSettingValue("lyricsPanel", "currentSize", v)} />
            <NumberControl label="前後行サイズ" value={lyrics.sideSize ?? 18} min={8} max={56} onChange={(v) => setSettingValue("lyricsPanel", "sideSize", v)} />
            <NumberControl label="曲名サイズ" value={lyrics.metaSize ?? 12} min={8} max={36} onChange={(v) => setSettingValue("lyricsPanel", "metaSize", v)} />
            <NumberControl label="行間" value={lyrics.lineGap ?? 12} min={0} max={80} onChange={(v) => setSettingValue("lyricsPanel", "lineGap", v)} />
            <NumberControl label="前後行濃度" value={lyrics.sideOpacity ?? 0.45} min={0} max={1} step={0.05} onChange={(v) => setSettingValue("lyricsPanel", "sideOpacity", v)} />
          </div>
        </DisplaySection>

        {renderPlacement("aiPanel", "AIパネル", aiPanelDefaults)}
        <DisplaySection title="AI内容">
          <div className="control-grid">
            <CheckControl label="ロール名" checked={ai.showLabels !== false} onChange={(v) => setSettingValue("aiPanel", "showLabels", v)} />
            <CheckControl label="時刻" checked={ai.showTimestamps !== false} onChange={(v) => setSettingValue("aiPanel", "showTimestamps", v)} />
            <CheckControl label="状態行" checked={ai.showStatus !== false} onChange={(v) => setSettingValue("aiPanel", "showStatus", v)} />
            <CheckControl label="入力欄" checked={ai.showInput !== false} onChange={(v) => setSettingValue("aiPanel", "showInput", v)} />
            <NumberControl label="本文サイズ" value={ai.textSize ?? 15} min={8} max={40} onChange={(v) => setSettingValue("aiPanel", "textSize", v)} />
            <NumberControl label="ラベルサイズ" value={ai.labelSize ?? 12} min={8} max={28} onChange={(v) => setSettingValue("aiPanel", "labelSize", v)} />
            <NumberControl label="行間" value={ai.msgGap ?? 16} max={80} onChange={(v) => setSettingValue("aiPanel", "msgGap", v)} />
          </div>
        </DisplaySection>

        {renderPlacement("memoPanel", "メモパネル", memoPanelDefaults)}
        <DisplaySection title="メモ内容">
          <div className="control-grid">
            <CheckControl label="日付" checked={memo.showDates !== false} onChange={(v) => setSettingValue("memoPanel", "showDates", v)} />
            <CheckControl label="ピン留め欄" checked={memo.showPinnedSection !== false} onChange={(v) => setSettingValue("memoPanel", "showPinnedSection", v)} />
            <CheckControl label="フッター" checked={memo.showFooter !== false} onChange={(v) => setSettingValue("memoPanel", "showFooter", v)} />
            <NumberControl label="最大件数" value={memo.maxItems ?? 0} max={20} onChange={(v) => setSettingValue("memoPanel", "maxItems", v)} />
            <NumberControl label="本文サイズ" value={memo.textSize ?? 15} min={8} max={40} onChange={(v) => setSettingValue("memoPanel", "textSize", v)} />
            <NumberControl label="カード余白" value={memo.cardPadding ?? 14} max={50} onChange={(v) => setSettingValue("memoPanel", "cardPadding", v)} />
          </div>
        </DisplaySection>

        <DisplaySection title="右ドック">
          <div className="control-grid">
            <NumberControl label="X" value={draftLayout.rightDock?.x ?? 0} max={canvasW} onChange={(v) => setLayoutValue("rightDock", "x", v)} />
            <NumberControl label="Y" value={draftLayout.rightDock?.y ?? 0} max={canvasH} onChange={(v) => setLayoutValue("rightDock", "y", v)} />
            <NumberControl label="幅" value={draftLayout.rightDock?.width ?? 110} min={80} max={220} onChange={(v) => setLayoutValue("rightDock", "width", v)} />
          </div>
          <p className="hint">現在の画面サイズでは、Yは {Math.max(0, canvasH - (DOCK_BASE_HEIGHT + DOCK_GAP_COUNT * (draftLayout.rightDock?.gap ?? 16)))} 以下が収まりやすいです。</p>
        </DisplaySection>
      </div>
    </section>
  );
}
