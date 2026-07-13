import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AvatarIcon,
  CameraIcon,
  CheckIcon,
  GearIcon,
  ImageIcon,
  LayoutIcon,
  MotionIcon,
  PlusIcon,
  RefreshIcon,
  VideoIcon,
  XIcon,
} from "../icons";
import { API_BASE, api, type BackgroundMediaItem, type BackgroundUploadKind, type UiPreset, type UiState } from "../api";
import { InfoHint } from "../controls";
import { overlayLayout as defaultLayout } from "../../../02_ui-overlay/src/config/layout";
import {
  lyricsPanelDefaults,
  memoPanelDefaults,
  musicPanelDefaults,
  newsPanelDefaults,
  personalNewsPanelDefaults,
  timerPanelDefaults,
  uiSettings as defaultSettings,
} from "../../../02_ui-overlay/src/config/uiSettings";

type JsonMap = Record<string, any>;
type SaveState = "idle" | "saving" | "saved";
type BackgroundQueueItem = { url: string; type: "image" | "video"; name?: string; presetId?: string; fileName?: string; size?: number };
type BackgroundOverlayItem = {
  url: string;
  name?: string;
  visible?: boolean;
  opacity?: number;
  blendMode?: string;
  fit?: "cover" | "contain";
};
type TimerPreset = JsonMap & { id: string; name: string };

const resolutionOptions = [
  "1366x768",
  "1440x900",
  "1920x1080",
  "1920x1200",
  "2240x1400",
  "2560x1440",
  "2560x1600",
  "3440x1440",
  "3840x2160",
];

const kiritanModeOptions = [
  { value: "work_normal", label: "通常作業" },
  { value: "video_relax", label: "動画くつろぎ" },
  { value: "sleep_desk", label: "机で休む" },
];

const kiritanAutoModeOptions = kiritanModeOptions;

const kiritanSmallActionOptions = [
  { value: "amb_work_neck_roll", label: "通常作業: 首を回す" },
  { value: "amb_work_posture_reset", label: "通常作業: 姿勢を直す" },
  { value: "amb_work_stretch", label: "通常作業: 伸び" },
  { value: "amb_vid_chuckle", label: "動画: くすっと笑う" },
  { value: "amb_vid_nod_watch", label: "動画: うなずく" },
  { value: "amb_vid_eyes_widen", label: "動画: 目を見開く" },
  { value: "amb_slp_head_shift", label: "休憩: 頭をもぞっと動かす" },
  { value: "amb_slp_dream_smile", label: "休憩: 寝笑い" },
];

const intervalPresets = {
  mode: [
    { label: "短め 5-10分", min: 5, max: 10 },
    { label: "標準 15-30分", min: 15, max: 30 },
    { label: "長め 30-60分", min: 30, max: 60 },
  ],
  action: [
    { label: "よく動く 25-70秒", min: 25, max: 70 },
    { label: "標準 90-240秒", min: 90, max: 240 },
    { label: "控えめ 300-600秒", min: 300, max: 600 },
  ],
};

type Vec3 = [number, number, number];
type TransformPart = "position" | "rotation" | "scale";
type TransformEntry = { position: Vec3; rotation: Vec3; scale: Vec3 };

const transformPartLabels: Record<TransformPart, string> = {
  position: "位置",
  rotation: "回転(rad)",
  scale: "拡大",
};

const objectPlacementLabels: Array<{ bucket: "objectLayout" | "itemLayout"; id: string; label: string }> = [
  { bucket: "objectLayout", id: "character", label: "きりたん" },
  { bucket: "objectLayout", id: "desk", label: "机" },
  { bucket: "objectLayout", id: "chair", label: "椅子" },
  { bucket: "objectLayout", id: "laptop", label: "ノートPC" },
  { bucket: "itemLayout", id: "item:phone", label: "スマホ" },
  { bucket: "itemLayout", id: "item:controller", label: "ゲームコントローラー" },
  { bucket: "itemLayout", id: "item:cup", label: "カップ" },
];

// STUDIO 左ペインの対象一覧。1つ選ぶと右のエディタにその対象だけを出す。
type StudioObj = "kiritan" | "bg" | "layout" | "camera" | "motion" | "system";
const STUDIO_OBJECTS: { id: StudioObj; label: string; icon: ReactNode }[] = [
  { id: "kiritan", label: "3Dモデル", icon: <AvatarIcon /> },
  { id: "bg", label: "背景", icon: <ImageIcon /> },
  { id: "layout", label: "パネル表示", icon: <LayoutIcon /> },
  { id: "camera", label: "視点", icon: <CameraIcon /> },
  { id: "motion", label: "モーション", icon: <MotionIcon /> },
  { id: "system", label: "システム", icon: <GearIcon /> },
];

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

function isObject(v: unknown): v is JsonMap {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function vec3(value: unknown, fallback: Vec3): Vec3 {
  if (!Array.isArray(value) || value.length !== 3) return [...fallback] as Vec3;
  return value.map((n, i) => Number.isFinite(Number(n)) ? Number(n) : fallback[i]) as Vec3;
}

function transformEntry(value: unknown, fallback: TransformEntry): TransformEntry {
  const src = isObject(value) ? value : {};
  return {
    position: vec3(src.position, fallback.position),
    rotation: vec3(src.rotation, fallback.rotation),
    scale: vec3(src.scale, fallback.scale),
  };
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

function normalizeBackgroundQueue(value: unknown): BackgroundQueueItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): BackgroundQueueItem[] => {
    if (typeof item === "string" && item.length > 0) {
      return [{ url: item, type: item.startsWith("data:video/") ? "video" : "image" }];
    }
    if (isObject(item) && typeof item.url === "string" && item.url.length > 0) {
      const type = item.type === "video" || item.url.startsWith("data:video/") ? "video" : "image";
      return [{
        url: item.url,
        type,
        name: typeof item.name === "string" ? item.name : undefined,
        presetId: typeof item.presetId === "string" ? item.presetId : undefined,
        fileName: typeof item.fileName === "string" ? item.fileName : undefined,
        size: Number.isFinite(Number(item.size)) ? Number(item.size) : undefined,
      }];
    }
    return [];
  });
}

function normalizeBackgroundOverlays(value: unknown): BackgroundOverlayItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): BackgroundOverlayItem[] => {
    if (!isObject(item) || typeof item.url !== "string" || item.url.length === 0) return [];
    return [{
      url: item.url,
      name: typeof item.name === "string" ? item.name : undefined,
      visible: item.visible !== false,
      opacity: Number.isFinite(Number(item.opacity)) ? Math.min(1, Math.max(0, Number(item.opacity))) : 0.65,
      blendMode: typeof item.blendMode === "string" ? item.blendMode : "screen",
      fit: item.fit === "contain" ? "contain" : "cover",
    }];
  });
}

// Companion runs on the Vite/Tauri origin, so server-relative media paths
// (/api/backgrounds/…) must be resolved against the Companion API origin.
const API_ORIGIN = API_BASE.replace(/\/api$/, "");
function resolveMediaUrl(url: string): string {
  return url.startsWith("/") ? `${API_ORIGIN}${url}` : url;
}

function backgroundKindForFile(file: File): Exclude<BackgroundUploadKind, "overlay"> {
  if (file.type.startsWith("video/") || /\.(mp4|webm|mov|m4v|mkv|avi)$/i.test(file.name)) return "video";
  return "image";
}

function normalizeTimerPresets(value: unknown): TimerPreset[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): TimerPreset[] => {
    if (!isObject(item) || typeof item.id !== "string" || typeof item.name !== "string") return [];
    return [item as TimerPreset];
  });
}

function timerPresetSnapshot(timer: JsonMap): JsonMap {
  const keys = [
    "mode",
    "timerTitle",
    "focusTitle",
    "shortBreakTitle",
    "longBreakTitle",
    "timerLabel",
    "focusLabel",
    "shortBreakLabel",
    "longBreakLabel",
    "timerMinutes",
    "pomodoroMinutes",
    "shortBreakMinutes",
    "longBreakMinutes",
    "itemGap",
  ];
  return Object.fromEntries(keys.map((key) => [key, timer[key]]).filter(([, value]) => value !== undefined));
}

function toggleStringArray(value: unknown, item: string, checked: boolean): string[] {
  const set = new Set(Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);
  if (checked) set.add(item);
  else set.delete(item);
  return [...set];
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

function ColorControl({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const color = /^#[0-9a-f]{6}$/i.test(value) ? value : "#b8dcff";
  return (
    <ControlRow label={label}>
      <div className="display-color-control">
        <input type="color" value={color} onChange={(e) => onChange(e.target.value)} />
        <input type="text" value={value || color} onChange={(e) => onChange(e.target.value)} />
      </div>
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

const VRM_STALE_MS = 90_000;

export default function TabDisplay({ embedded = false }: { embedded?: boolean }) {
  const [ui, setUi] = useState<UiState | null>(null);
  const [studioObj, setStudioObj] = useState<StudioObj>("kiritan");
  // Wallpaper reports kiritan state only while a VRM is loaded, so a stale/missing
  // report means camera/placement edits won't visibly apply until the next sync.
  const [kiritanReceivedAt, setKiritanReceivedAt] = useState<string | null>(null);
  const [presets, setPresets] = useState<UiPreset[]>([]);
  const initial = defaultsWith(null);
  const [draftLayout, setDraftLayout] = useState<JsonMap>(initial.layout);
  const [draftSettings, setDraftSettings] = useState<JsonMap>(initial.settings);
  const [name, setName] = useState("");
  const [timerPresetName, setTimerPresetName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState<SaveState>("idle");
  const [modelUploadStatus, setModelUploadStatus] = useState("");
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
    try {
      const k = await api.kiritanState();
      setKiritanReceivedAt(k?.receivedAt ?? null);
    } catch {
      // VRM badge stays in its last state if the poll misses once.
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

  const patchSettingSection = (section: string, patch: JsonMap) => {
    setDraftSettings((prev) => ({ ...prev, [section]: { ...(prev[section] ?? {}), ...patch } }));
    markDirty();
  };

  const setRootSetting = (key: string, value: unknown) => {
    setDraftSettings((prev) => ({ ...prev, [key]: value }));
    markDirty();
  };

  const uploadBackgroundFile = async (file: File, mediaType: BackgroundUploadKind): Promise<BackgroundMediaItem> => {
    const result = await api.uploadBackground(file, mediaType);
    if (!result.item?.url) throw new Error("missing uploaded background url");
    return result.item;
  };

  const setVrmModelFile = async (file: File | undefined) => {
    if (!file) return;
    setModelUploadStatus("VRMを読み込み中…");
    try {
      const result = await api.uploadModel(file);
      if (!result.item?.url) throw new Error("missing uploaded model url");
      patchSettingSection("wallpaper", {
        vrmModelPath: result.item.url,
        modelVisible: true,
      });
      setModelUploadStatus(`${result.item.name} を選択しました。壁紙側で読み込みを試します。`);
      setError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "VRMの保存に失敗しました";
      setModelUploadStatus(`VRMの読み込み準備に失敗: ${message}`);
      setError("VRMファイルを読み込めませんでした");
    }
  };

  const setBackgroundImageFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const item = await uploadBackgroundFile(file, "image");
      patchSettingSection("wallpaper", {
        backgroundImageDataUrl: item.url,
        backgroundImageEnabled: true,
        backgroundMode: "single",
      });
      setError(null);
    } catch (e) {
      setError(`背景画像の保存に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const setBackgroundMediaFiles = async (files: FileList | null | undefined) => {
    const list = Array.from(files ?? []);
    if (list.length === 0) return;
    try {
      const items = await Promise.all(list.map(async (file): Promise<BackgroundQueueItem> => {
        const kind = backgroundKindForFile(file);
        const item = await uploadBackgroundFile(file, kind);
        return {
          url: item.url,
          type: item.type,
          name: item.name ?? file.name,
          fileName: item.fileName,
          size: item.size,
        };
      }));
      const nextQueue = [...normalizeBackgroundQueue(draftSettings.wallpaper?.backgroundQueue), ...items];
      setDraftSettings((prev) => ({
        ...prev,
        wallpaper: {
          ...(prev.wallpaper ?? {}),
          backgroundQueue: nextQueue,
          backgroundImageEnabled: true,
          backgroundMode: items.some((item) => item.type === "video") ? "videoSlideshow" : (prev.wallpaper?.backgroundMode ?? "slideshow"),
          backgroundImageDataUrl: items[0]?.type === "image" ? items[0].url : (prev.wallpaper?.backgroundImageDataUrl ?? ""),
        },
      }));
      setError(null);
      markDirty();
    } catch (e) {
      setError(`背景メディアの保存に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const setBackgroundOverlayFiles = async (files: FileList | null | undefined) => {
    const list = Array.from(files ?? []);
    if (list.length === 0) return;
    try {
      const items = await Promise.all(list.map(async (file): Promise<BackgroundOverlayItem> => {
        const item = await uploadBackgroundFile(file, "overlay");
        return {
          url: item.url,
          name: item.name ?? file.name,
          visible: true,
          opacity: 0.65,
          blendMode: "screen",
          fit: "cover",
        };
      }));
      const nextOverlays = [...normalizeBackgroundOverlays(draftSettings.wallpaper?.backgroundOverlays), ...items];
      patchSettingSection("wallpaper", { backgroundOverlays: nextOverlays });
      setError(null);
    } catch (e) {
      setError(`背景オーバーレイの保存に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const updateBackgroundOverlay = (index: number, patch: Partial<BackgroundOverlayItem>) => {
    const overlays = normalizeBackgroundOverlays(draftSettings.wallpaper?.backgroundOverlays);
    if (!overlays[index]) return;
    overlays[index] = { ...overlays[index], ...patch };
    setSettingValue("wallpaper", "backgroundOverlays", overlays);
  };

  const removeBackgroundOverlay = (index: number) => {
    const overlays = normalizeBackgroundOverlays(draftSettings.wallpaper?.backgroundOverlays);
    overlays.splice(index, 1);
    setSettingValue("wallpaper", "backgroundOverlays", overlays);
  };

  const removeBackgroundQueueItem = (index: number) => {
    const queue = normalizeBackgroundQueue(draftSettings.wallpaper?.backgroundQueue);
    queue.splice(index, 1);
    setSettingValue("wallpaper", "backgroundQueue", queue);
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
    const presetName = presets.find((preset) => preset.id === id)?.name ?? "このプリセット";
    if (!window.confirm(`「${presetName}」を現在の表示設定で上書きします。よろしいですか？`)) {
      return;
    }
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
  const kiritanMs = kiritanReceivedAt ? Date.parse(kiritanReceivedAt) : NaN;
  const vrmLive = Number.isFinite(kiritanMs) && Date.now() - kiritanMs <= VRM_STALE_MS;
  const vrmBadge = (
    <span
      className={`pill ${vrmLive ? "ok" : "warn"}`}
      title={vrmLive
        ? "壁紙がきりたんの状態を報告しています。カメラ・配置の調整が見た目に反映されます。"
        : "壁紙からきりたんの状態が届いていません。Wallpaper Engine 側で models/kiritan.vrm が読み込まれているか確認してください。届くまでカメラ・配置の変更は見た目に反映されません（設定自体は保存されます）。"}
    >
      {vrmLive ? "VRM 読込済" : "VRM 未報告"}
    </span>
  );

  // どのパネルを触っているか掴むための目安プレビュー。draft値でライブ更新される。
  const layoutPreviewPanels: { section: string; label: string }[] = [
    { section: "clock", label: "時計" },
    { section: "weatherCompact", label: "天気" },
    { section: "newsPanel", label: "ニュース" },
    { section: "musicPanel", label: "音楽" },
    { section: "lyricsPanel", label: "歌詞" },
    { section: "personalNewsPanel", label: "個人" },
    { section: "memoPanel", label: "メモ" },
    { section: "timerPanel", label: "タイマー" },
  ];
  const previewPanelVisible = (section: string): boolean => {
    const s = draftSettings[section] ?? {};
    if (section === "clock") return s.showClock !== false;
    if (section === "weatherCompact") return s.showCompactWeather !== false;
    return s.show !== false;
  };
  const layoutPreview = (
    <div
      className="layout-preview"
      style={{ aspectRatio: `${canvasW} / ${canvasH}` }}
      aria-label={`レイアウトプレビュー ${canvasW}x${canvasH}`}
    >
      {layoutPreviewPanels.map((p) => {
        const rect = draftLayout[p.section] ?? {};
        const x = Number(rect.x ?? 0);
        const y = Number(rect.y ?? 0);
        const w = Number(rect.width ?? 300);
        const h = Number(rect.height ?? 140);
        const visible = previewPanelVisible(p.section);
        return (
          <span
            key={p.section}
            className={`layout-preview-panel ${visible ? "" : "hidden"}`}
            style={{
              left: `${(x / canvasW) * 100}%`,
              top: `${(y / canvasH) * 100}%`,
              width: `${(w / canvasW) * 100}%`,
              height: `${(h / canvasH) * 100}%`,
            }}
            title={`${p.label} ${visible ? "" : "(非表示)"} x:${x} y:${y} w:${w} h:${h}`}
          >
            {p.label}
          </span>
        );
      })}
    </div>
  );
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
  const personalNews = { ...personalNewsPanelDefaults, ...(draftSettings.personalNewsPanel ?? {}) };
  const lyricsUnavailableReplacementEnabled =
    personalNews.autoShowWhenLyricsUnavailable !== false && personalNews.hideLyricsWhenAutoShown !== false;
  const memo = { ...memoPanelDefaults, ...(draftSettings.memoPanel ?? {}) };
  const timer = { ...timerPanelDefaults, ...(draftSettings.timerPanel ?? {}) };
  const wallpaper = { ...defaultSettings.wallpaper, ...(draftSettings.wallpaper ?? {}) };
  const motion = { ...defaultSettings.motion, ...(draftSettings.motion ?? {}) };
  const overlay = { ...defaultSettings.overlay, ...(draftSettings.overlay ?? {}) };
  const defaultWallpaper = defaultSettings.wallpaper as JsonMap;
  const fallbackTransform = (bucket: "objectLayout" | "itemLayout", id: string): TransformEntry => {
    const source = isObject(defaultWallpaper[bucket]) ? defaultWallpaper[bucket] : {};
    return transformEntry(source[id], { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
  };
  const currentTransform = (bucket: "objectLayout" | "itemLayout", id: string): TransformEntry => {
    const source = isObject(wallpaper[bucket]) ? wallpaper[bucket] : {};
    return transformEntry(source[id], fallbackTransform(bucket, id));
  };
  const setWallpaperTransformValue = (
    bucket: "objectLayout" | "itemLayout",
    id: string,
    part: TransformPart,
    axis: 0 | 1 | 2,
    value: number,
  ) => {
    setDraftSettings((prev) => {
      const prevWallpaper = isObject(prev.wallpaper) ? prev.wallpaper : {};
      const prevBucket = isObject(prevWallpaper[bucket]) ? prevWallpaper[bucket] : {};
      const current = transformEntry(prevBucket[id], fallbackTransform(bucket, id));
      const nextPart = [...current[part]] as Vec3;
      nextPart[axis] = value;
      return {
        ...prev,
        wallpaper: {
          ...prevWallpaper,
          [bucket]: {
            ...prevBucket,
            [id]: {
              ...current,
              [part]: nextPart,
            },
          },
        },
      };
    });
    markDirty();
  };
  const resetWallpaperTransform = (bucket: "objectLayout" | "itemLayout", id: string) => {
    setDraftSettings((prev) => {
      const prevWallpaper = isObject(prev.wallpaper) ? prev.wallpaper : {};
      const prevBucket = isObject(prevWallpaper[bucket]) ? prevWallpaper[bucket] : {};
      return {
        ...prev,
        wallpaper: {
          ...prevWallpaper,
          [bucket]: {
            ...prevBucket,
            [id]: clone(fallbackTransform(bucket, id)),
          },
        },
      };
    });
    markDirty();
  };
  const renderTransformControls = (bucket: "objectLayout" | "itemLayout", id: string, label: string) => {
    const entry = currentTransform(bucket, id);
    const ranges: Record<TransformPart, { min: number; max: number; step: number }> = {
      position: { min: -3, max: 3, step: 0.01 },
      rotation: { min: -6.28, max: 6.28, step: 0.01 },
      scale: { min: 0.001, max: 3, step: 0.001 },
    };
    return (
      <DisplaySection key={`${bucket}.${id}`} title={`配置: ${label}`}>
        <div className="control-grid">
          {(["position", "rotation", "scale"] as TransformPart[]).flatMap((part) =>
            ([0, 1, 2] as Array<0 | 1 | 2>).map((axis) => (
              <NumberControl
                key={`${part}.${axis}`}
                label={`${transformPartLabels[part]} ${["X", "Y", "Z"][axis]}`}
                value={entry[part][axis]}
                min={ranges[part].min}
                max={ranges[part].max}
                step={ranges[part].step}
                onChange={(v) => setWallpaperTransformValue(bucket, id, part, axis, v)}
              />
            )),
          )}
          <button type="button" className="secondary-btn" onClick={() => resetWallpaperTransform(bucket, id)}>
            初期値に戻す
          </button>
        </div>
      </DisplaySection>
    );
  };
  const hasCustomBackground = typeof wallpaper.backgroundImageDataUrl === "string" && wallpaper.backgroundImageDataUrl.length > 0;
  const backgroundQueue = normalizeBackgroundQueue(wallpaper.backgroundQueue);
  const backgroundOverlays = normalizeBackgroundOverlays(wallpaper.backgroundOverlays);
  const timerPresets = normalizeTimerPresets(timer.timerPresets);
  const cameraMoveStep = Number(wallpaper.cameraMoveStep ?? 0.05);
  const cameraRotateStep = Number(wallpaper.cameraRotateStep ?? 1);
  const nudgeWallpaperNumber = (key: string, delta: number) => {
    const current = Number(wallpaper[key] ?? 0);
    setSettingValue("wallpaper", key, (Number.isFinite(current) ? current : 0) + delta);
  };
  const setLyricsUnavailableReplacement = (enabled: boolean) => {
    patchSettingSection("personalNewsPanel", {
      autoShowWhenLyricsUnavailable: enabled,
      hideLyricsWhenAutoShown: enabled,
    });
  };
  const setMotionIntervalPreset = (type: "mode" | "action", min: number, max: number) => {
    patchSettingSection("motion", type === "mode"
      ? { modeMinMinutes: min, modeMaxMinutes: max }
      : { motionMinSeconds: min, motionMaxSeconds: max });
  };
  const setDisabledMode = (modeId: string, disabled: boolean) => {
    setSettingValue("motion", "disabledModes", toggleStringArray(motion.disabledModes, modeId, disabled));
  };
  const setDisabledMotion = (motionId: string, disabled: boolean) => {
    setSettingValue("motion", "disabledMotions", toggleStringArray(motion.disabledMotions, motionId, disabled));
  };
  const saveTimerPreset = () => {
    const preset: TimerPreset = {
      id: globalThis.crypto?.randomUUID?.() ?? `timer-${Date.now()}`,
      name: timerPresetName.trim() || `タイマー ${timerPresets.length + 1}`,
      ...timerPresetSnapshot(timer),
    };
    setTimerPresetName("");
    setSettingValue("timerPanel", "timerPresets", [...timerPresets, preset]);
  };
  const applyTimerPreset = (preset: TimerPreset) => {
    const values: JsonMap = {};
    for (const [key, value] of Object.entries(preset)) {
      if (key !== "id" && key !== "name") values[key] = value;
    }
    patchSettingSection("timerPanel", values);
  };
  const deleteTimerPreset = (id: string) => {
    setSettingValue("timerPanel", "timerPresets", timerPresets.filter((preset) => preset.id !== id));
  };

  return (
    <section className={`tab-panel display-panel ${embedded ? "embedded" : ""}`}>
      <header className="panel-head">
        <h2>表示設定</h2>
        <span className="panel-sub">位置・サイズは変更すると自動で反映</span>
        <InfoHint text="スライダーを動かすとCompanionへ自動保存され、壁紙側が短い間隔で取り込みます。プリセットの保存・上書きは、いまこの画面で編集中の内容を使います。" />
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

      <div className="studio">
        <div className="studio-objlist">
          {STUDIO_OBJECTS.map((o) => (
            <button
              key={o.id}
              type="button"
              className={`studio-obj ${studioObj === o.id ? "active" : ""}`}
              onClick={() => setStudioObj(o.id)}
              aria-pressed={studioObj === o.id}
            >
              {o.icon}
              <span>{o.label}</span>
            </button>
          ))}
        </div>
        <div className="studio-editor">
        {studioObj === "kiritan" && (
        <div className="display-editor">
          <div className="studio-ed-head">{vrmBadge}</div>
          <div className="control-grid">
            <CheckControl label="3Dモデルを表示" checked={wallpaper.modelVisible !== false} onChange={(v) => setSettingValue("wallpaper", "modelVisible", v)} />
            <NumberControl label="3D明るさ" value={wallpaper.modelLightScale ?? 1} min={0} max={3} step={0.05} onChange={(v) => setSettingValue("wallpaper", "modelLightScale", v)} />
            <div className="display-control control-grid-wide">
              <span>VRMファイル</span>
              <div className="vrm-file-picker">
                <input
                  type="file"
                  aria-label="VRMファイルを選択"
                  accept=".vrm,model/gltf-binary,application/octet-stream"
                  onChange={(e) => { void setVrmModelFile(e.target.files?.[0]); e.currentTarget.value = ""; }}
                />
                <input
                  className="mono"
                  readOnly
                  value={wallpaper.vrmModelPath ?? ""}
                  placeholder="未選択（パッケージ内 models/kiritan.vrm を使用）"
                />
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => {
                    patchSettingSection("wallpaper", { vrmModelPath: "" });
                    setModelUploadStatus("パッケージ内の既定モデルへ戻します。");
                  }}
                >
                  既定モデルに戻す
                </button>
                {modelUploadStatus && <span className="hint">{modelUploadStatus}</span>}
              </div>
            </div>
            <CheckControl label="スマホ" checked={wallpaper.propPhoneVisible !== false} onChange={(v) => setSettingValue("wallpaper", "propPhoneVisible", v)} />
            <CheckControl label="ゲームコントローラー" checked={wallpaper.propControllerVisible !== false} onChange={(v) => setSettingValue("wallpaper", "propControllerVisible", v)} />
            <CheckControl label="カップ" checked={wallpaper.propCupVisible !== false} onChange={(v) => setSettingValue("wallpaper", "propCupVisible", v)} />
          </div>

          <div className="settings-divider" />
          <DisplaySection title="3Dオブジェクト配置">
            <p className="hint">位置・回転・拡大は表示プリセットに保存されます。回転は壁紙側と同じラジアン値です。</p>
            <div className="display-editor">
              {objectPlacementLabels.map((item) => renderTransformControls(item.bucket, item.id, item.label))}
            </div>
          </DisplaySection>
        </div>
        )}
        {studioObj === "camera" && (
        <div className="display-editor">
          <div className="studio-ed-head">{vrmBadge}</div>
          <div className="control-grid">
            <CheckControl label="Companionからカメラを調整" checked={wallpaper.cameraAdjustmentEnabled === true} onChange={(v) => setSettingValue("wallpaper", "cameraAdjustmentEnabled", v)} />
            <button type="button" className="secondary-btn" onClick={() => patchSettingSection("wallpaper", { cameraX: 0, cameraY: 0, cameraZ: 0, cameraYaw: 0, cameraPitch: 0, cameraRoll: 0 })}>
              idealに戻す
            </button>
            <NumberControl label="idealからX" value={wallpaper.cameraX ?? 0} min={-10} max={10} step={0.05} onChange={(v) => setSettingValue("wallpaper", "cameraX", v)} />
            <NumberControl label="idealからY" value={wallpaper.cameraY ?? 0} min={-10} max={10} step={0.05} onChange={(v) => setSettingValue("wallpaper", "cameraY", v)} />
            <NumberControl label="idealからZ" value={wallpaper.cameraZ ?? 0} min={-10} max={10} step={0.05} onChange={(v) => setSettingValue("wallpaper", "cameraZ", v)} />
            <NumberControl label="idealからYaw" value={wallpaper.cameraYaw ?? 0} min={-180} max={180} step={1} onChange={(v) => setSettingValue("wallpaper", "cameraYaw", v)} />
            <NumberControl label="idealからPitch" value={wallpaper.cameraPitch ?? 0} min={-90} max={90} step={1} onChange={(v) => setSettingValue("wallpaper", "cameraPitch", v)} />
            <NumberControl label="移動ステップ" value={wallpaper.cameraMoveStep ?? 0.05} min={0.01} max={1} step={0.01} onChange={(v) => setSettingValue("wallpaper", "cameraMoveStep", v)} />
            <NumberControl label="回転ステップ" value={wallpaper.cameraRotateStep ?? 1} min={0.1} max={15} step={0.1} onChange={(v) => setSettingValue("wallpaper", "cameraRotateStep", v)} />
          </div>
          <div className="display-pad-row">
            <div className="display-pad-card">
              <span>移動 X/Z</span>
              <div className="display-pad">
                <button type="button" onClick={() => nudgeWallpaperNumber("cameraZ", -cameraMoveStep)}>Z-</button>
                <button type="button" onClick={() => nudgeWallpaperNumber("cameraX", -cameraMoveStep)}>X-</button>
                <button type="button" onClick={() => patchSettingSection("wallpaper", { cameraX: 0, cameraZ: 0 })}>0</button>
                <button type="button" onClick={() => nudgeWallpaperNumber("cameraX", cameraMoveStep)}>X+</button>
                <button type="button" onClick={() => nudgeWallpaperNumber("cameraZ", cameraMoveStep)}>Z+</button>
              </div>
            </div>
            <div className="display-y-pad">
              <span>Y</span>
              <button type="button" onClick={() => nudgeWallpaperNumber("cameraY", cameraMoveStep)}>Y+</button>
              <button type="button" onClick={() => setSettingValue("wallpaper", "cameraY", 0)}>0</button>
              <button type="button" onClick={() => nudgeWallpaperNumber("cameraY", -cameraMoveStep)}>Y-</button>
            </div>
            <div className="display-pad-card">
              <span>方向</span>
              <div className="display-pad">
                <button type="button" onClick={() => nudgeWallpaperNumber("cameraPitch", -cameraRotateStep)}>P-</button>
                <button type="button" onClick={() => nudgeWallpaperNumber("cameraYaw", -cameraRotateStep)}>Yw-</button>
                <button type="button" onClick={() => patchSettingSection("wallpaper", { cameraYaw: 0, cameraPitch: 0, cameraRoll: 0 })}>0</button>
                <button type="button" onClick={() => nudgeWallpaperNumber("cameraYaw", cameraRotateStep)}>Yw+</button>
                <button type="button" onClick={() => nudgeWallpaperNumber("cameraPitch", cameraRotateStep)}>P+</button>
              </div>
            </div>
          </div>
          <p className="hint">0がidealカメラそのものです。カメラを細かくずらしたい時だけオンにして、いつものカメラからの差分として調整してください。</p>
        </div>
        )}
        {studioObj === "bg" && (
        <div className="display-editor">
          <div className="control-grid">
            <CheckControl label="背景画像" checked={wallpaper.backgroundImageEnabled !== false} onChange={(v) => setSettingValue("wallpaper", "backgroundImageEnabled", v)} />
            <SelectControl
              label="背景フィット"
              value={wallpaper.backgroundFit ?? "cover"}
              onChange={(v) => setSettingValue("wallpaper", "backgroundFit", v)}
              options={[{ value: "cover", label: "画面いっぱい" }, { value: "contain", label: "全体を表示" }]}
            />
            <SelectControl
              label="背景モード"
              value={wallpaper.backgroundMode ?? "single"}
              onChange={(v) => setSettingValue("wallpaper", "backgroundMode", v)}
              options={[
                { value: "single", label: "単体画像" },
                { value: "slideshow", label: "スライドショー" },
                { value: "video", label: "単体動画" },
                { value: "videoSlideshow", label: "動画スライドショー" },
              ]}
            />
            <SelectControl
              label="切替"
              value={wallpaper.backgroundTransition ?? "fade"}
              onChange={(v) => setSettingValue("wallpaper", "backgroundTransition", v)}
              options={[{ value: "loop", label: "ループ" }, { value: "fade", label: "フェード" }, { value: "advance", label: "順送り" }]}
            />
            <ControlRow label="背景ファイル">
              <input type="file" accept="image/*" onChange={(e) => { void setBackgroundImageFile(e.target.files?.[0]); e.currentTarget.value = ""; }} />
            </ControlRow>
            <ControlRow label="キュー追加">
              <input type="file" accept="image/*,video/*" multiple onChange={(e) => { void setBackgroundMediaFiles(e.target.files); e.currentTarget.value = ""; }} />
            </ControlRow>
            <NumberControl label="キュー間隔(秒)" value={wallpaper.backgroundQueueIntervalSeconds ?? 60} min={5} max={3600} onChange={(v) => setSettingValue("wallpaper", "backgroundQueueIntervalSeconds", v)} />
            <NumberControl label="フェード秒" value={wallpaper.backgroundQueueFadeSeconds ?? 1} min={0} max={20} step={0.5} onChange={(v) => setSettingValue("wallpaper", "backgroundQueueFadeSeconds", v)} />
            <CheckControl label="動画ミュート" checked={wallpaper.backgroundVideoMuted !== false} onChange={(v) => setSettingValue("wallpaper", "backgroundVideoMuted", v)} />
            <button
              type="button"
              className="secondary-btn"
              disabled={!hasCustomBackground}
              onClick={() => setSettingValue("wallpaper", "backgroundImageDataUrl", "")}
            >
              背景画像をクリア
            </button>
            <button
              type="button"
              className="secondary-btn"
              disabled={backgroundQueue.length === 0}
              onClick={() => setSettingValue("wallpaper", "backgroundQueue", [])}
            >
              キューをクリア
            </button>
            <ControlRow label="透過PNG追加">
              <input type="file" accept="image/png,image/webp,image/*" multiple onChange={(e) => { void setBackgroundOverlayFiles(e.target.files); e.currentTarget.value = ""; }} />
            </ControlRow>
            <button
              type="button"
              className="secondary-btn"
              disabled={backgroundOverlays.length === 0}
              onClick={() => setSettingValue("wallpaper", "backgroundOverlays", [])}
            >
              オーバーレイをクリア
            </button>
          </div>
          <p className="hint">背景ファイルはCompanion内の backgrounds フォルダへ保存し、設定には軽いURLだけを残します。動画モードでは動画終了ごとに次へ進めて最後から先頭へ戻します。現在のキュー: {backgroundQueue.length}件（画像 {backgroundQueue.filter((item) => item.type === "image").length} / 動画 {backgroundQueue.filter((item) => item.type === "video").length}）、オーバーレイ: {backgroundOverlays.length}件。</p>

          {backgroundQueue.length > 0 && (
            <div className="bg-thumbs">
              {backgroundQueue.map((item, index) => (
                <div
                  className="bg-thumb"
                  key={`${item.url}:${index}`}
                  title={item.name ?? item.fileName ?? item.url}
                >
                  {item.type === "image" ? (
                    <img src={resolveMediaUrl(item.url)} alt={item.name ?? `背景 ${index + 1}`} loading="lazy" />
                  ) : (
                    <span className="bg-thumb-video"><VideoIcon /></span>
                  )}
                  <span className="bg-thumb-tag">{item.type === "image" ? "IMG" : "MOV"}</span>
                  <button
                    type="button"
                    className="bg-thumb-remove"
                    aria-label={`${item.name ?? `背景 ${index + 1}`} をキューから削除`}
                    onClick={() => removeBackgroundQueueItem(index)}
                  >
                    <XIcon />
                  </button>
                </div>
              ))}
            </div>
          )}

          {backgroundOverlays.length > 0 && (
            <div className="background-overlay-list">
              {backgroundOverlays.map((overlay, index) => (
                <div className="background-overlay-item" key={`${overlay.url}:${index}`}>
                  <div className="background-overlay-head">
                    <span className="background-overlay-name" title={overlay.url}>{overlay.name ?? `Overlay ${index + 1}`}</span>
                    <button type="button" className="icon-btn danger" onClick={() => removeBackgroundOverlay(index)} aria-label="削除">
                      <XIcon />
                    </button>
                  </div>
                  <div className="background-overlay-controls">
                    <CheckControl label="表示" checked={overlay.visible !== false} onChange={(v) => updateBackgroundOverlay(index, { visible: v })} />
                    <NumberControl label="濃度" value={overlay.opacity ?? 0.65} min={0} max={1} step={0.05} onChange={(v) => updateBackgroundOverlay(index, { opacity: v })} />
                    <SelectControl
                      label="合成"
                      value={overlay.blendMode ?? "screen"}
                      onChange={(v) => updateBackgroundOverlay(index, { blendMode: v })}
                      options={[
                        { value: "normal", label: "通常" },
                        { value: "screen", label: "発光" },
                        { value: "multiply", label: "影" },
                        { value: "overlay", label: "オーバーレイ" },
                        { value: "soft-light", label: "柔らかく" },
                        { value: "lighten", label: "明るい方" },
                        { value: "darken", label: "暗い方" },
                      ]}
                    />
                    <SelectControl
                      label="フィット"
                      value={overlay.fit ?? "cover"}
                      onChange={(v) => updateBackgroundOverlay(index, { fit: v === "contain" ? "contain" : "cover" })}
                      options={[{ value: "cover", label: "画面いっぱい" }, { value: "contain", label: "全体を表示" }]}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        )}
        {studioObj === "motion" && (
        <div className="display-editor">
          <div className="control-grid">
            <SelectControl
              label="きりたんの動き方"
              value={motion.directorMode ?? "auto"}
              onChange={(v) => setSettingValue("motion", "directorMode", v)}
              options={[
                { value: "auto", label: "通常: 自動でモード切替" },
                { value: "fixed", label: "固定: 指定モードのまま" },
              ]}
            />
            <SelectControl
              label="固定するモード"
              value={motion.fixedMode ?? "work_normal"}
              onChange={(v) => setSettingValue("motion", "fixedMode", v)}
              options={kiritanModeOptions}
            />
          </div>
          <p className="hint">固定モードは通常作業・動画くつろぎ・机で休むから選べます。通常モードでは、下の除外設定を使って混ぜたくないモードや小アクションを外せます。</p>

          <div className="settings-divider" />
          <ControlRow label="モード切替間隔">
            <div className="display-button-row">
              {intervalPresets.mode.map((preset) => (
                <button key={preset.label} type="button" className="secondary-btn" onClick={() => setMotionIntervalPreset("mode", preset.min, preset.max)}>
                  {preset.label}
                </button>
              ))}
            </div>
          </ControlRow>
          <div className="control-grid">
            <NumberControl label="モード切替 最短(分)" value={motion.modeMinMinutes ?? 15} min={1} max={120} onChange={(v) => setSettingValue("motion", "modeMinMinutes", v)} />
            <NumberControl label="モード切替 最長(分)" value={motion.modeMaxMinutes ?? 30} min={1} max={180} onChange={(v) => setSettingValue("motion", "modeMaxMinutes", v)} />
          </div>

          <ControlRow label="小アクション間隔">
            <div className="display-button-row">
              {intervalPresets.action.map((preset) => (
                <button key={preset.label} type="button" className="secondary-btn" onClick={() => setMotionIntervalPreset("action", preset.min, preset.max)}>
                  {preset.label}
                </button>
              ))}
            </div>
          </ControlRow>
          <div className="control-grid">
            <NumberControl label="小アクション 最短(秒)" value={motion.motionMinSeconds ?? 90} min={5} max={3600} onChange={(v) => setSettingValue("motion", "motionMinSeconds", v)} />
            <NumberControl label="小アクション 最長(秒)" value={motion.motionMaxSeconds ?? 240} min={5} max={7200} onChange={(v) => setSettingValue("motion", "motionMaxSeconds", v)} />
          </div>

          <div className="settings-divider" />
          <DisplaySection title="通常モードで出さないモード">
            <div className="control-grid">
              {kiritanAutoModeOptions.map((mode) => (
                <CheckControl
                  key={mode.value}
                  label={mode.label}
                  checked={Array.isArray(motion.disabledModes) && motion.disabledModes.includes(mode.value)}
                  onChange={(v) => setDisabledMode(mode.value, v)}
                />
              ))}
            </div>
          </DisplaySection>

          <DisplaySection title="出さない小アクション">
            <div className="control-grid">
              {kiritanSmallActionOptions.map((action) => (
                <CheckControl
                  key={action.value}
                  label={action.label}
                  checked={Array.isArray(motion.disabledMotions) && motion.disabledMotions.includes(action.value)}
                  onChange={(v) => setDisabledMotion(action.value, v)}
                />
              ))}
            </div>
          </DisplaySection>
        </div>
        )}
        {studioObj === "layout" && (
        <DisplaySection title="情報表示部設定" open>
          {layoutPreview}
          <div className="display-editor">
            <DisplaySection title="時計 / 左上情報" open>
              <div className="control-grid">
                <CheckControl label="時計を表示" checked={draftSettings.clock?.showClock !== false} onChange={(v) => setSettingValue("clock", "showClock", v)} />
                <CheckControl label="日付" checked={draftSettings.clock?.showDate !== false} onChange={(v) => setSettingValue("clock", "showDate", v)} />
                <CheckControl label="秒" checked={draftSettings.clock?.showSeconds !== false} onChange={(v) => setSettingValue("clock", "showSeconds", v)} />
                <CheckControl label="背景" checked={draftSettings.clock?.showBackground === true} onChange={(v) => setSettingValue("clock", "showBackground", v)} />
                <NumberControl label="背景濃度" value={draftSettings.clock?.backgroundOpacity ?? 0.28} min={0} max={1} step={0.05} onChange={(v) => setSettingValue("clock", "backgroundOpacity", v)} />
                <NumberControl label="余白X" value={draftSettings.clock?.paddingX ?? 0} max={120} onChange={(v) => setSettingValue("clock", "paddingX", v)} />
                <NumberControl label="余白Y" value={draftSettings.clock?.paddingY ?? 0} max={120} onChange={(v) => setSettingValue("clock", "paddingY", v)} />
                <NumberControl label="X" value={draftLayout.clock?.x ?? 0} max={canvasW} onChange={(v) => setLayoutValue("clock", "x", v)} />
                <NumberControl label="Y" value={draftLayout.clock?.y ?? 0} max={canvasH} onChange={(v) => setLayoutValue("clock", "y", v)} />
                <NumberControl label="幅" value={draftLayout.clock?.width ?? 480} max={canvasW} onChange={(v) => setLayoutValue("clock", "width", v)} />
                <NumberControl label="日付サイズ" value={draftLayout.clock?.dateSize ?? 63} max={140} onChange={(v) => setLayoutValue("clock", "dateSize", v)} />
                <NumberControl label="時刻サイズ" value={draftLayout.clock?.timeSize ?? 105} max={220} onChange={(v) => setLayoutValue("clock", "timeSize", v)} />
                <NumberControl label="日付X補正" value={draftSettings.clock?.dateOffsetX ?? 0} min={-400} max={400} onChange={(v) => setSettingValue("clock", "dateOffsetX", v)} />
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
                <CheckControl label="コンパクト背景" checked={draftSettings.weatherCompact?.showBackground === true} onChange={(v) => setSettingValue("weatherCompact", "showBackground", v)} />
                <NumberControl label="コンパクト背景濃度" value={draftSettings.weatherCompact?.backgroundOpacity ?? 0.28} min={0} max={1} step={0.05} onChange={(v) => setSettingValue("weatherCompact", "backgroundOpacity", v)} />
                <CheckControl label="詳細背景" checked={draftSettings.weatherDetail?.showBackground === true} onChange={(v) => setSettingValue("weatherDetail", "showBackground", v)} />
                <NumberControl label="詳細背景濃度" value={draftSettings.weatherDetail?.backgroundOpacity ?? 0.4} min={0} max={1} step={0.05} onChange={(v) => setSettingValue("weatherDetail", "backgroundOpacity", v)} />
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
                <CheckControl
                  label="時刻/ソースをタイトル行左に表示"
                  checked={news.metaPlacement === "titleLeft"}
                  onChange={(v) => setSettingValue("newsPanel", "metaPlacement", v ? "titleLeft" : "separate")}
                />
                <CheckControl label="タイトル1行省略" checked={news.singleLineTitle === true} onChange={(v) => setSettingValue("newsPanel", "singleLineTitle", v)} />
                <NumberControl label="ヘッダー余白" value={news.contentTopGap ?? 18} min={0} max={160} onChange={(v) => setSettingValue("newsPanel", "contentTopGap", v)} />
                <NumberControl label="最大件数" value={news.maxItems ?? 5} min={1} max={20} onChange={(v) => setSettingValue("newsPanel", "maxItems", v)} />
                <NumberControl label="タイトルサイズ" value={news.titleSize ?? 17} min={8} max={48} onChange={(v) => setSettingValue("newsPanel", "titleSize", v)} />
                <NumberControl label="概要サイズ" value={news.summarySize ?? 14} min={8} max={40} onChange={(v) => setSettingValue("newsPanel", "summarySize", v)} />
              </div>
            </DisplaySection>

            {renderPlacement("musicPanel", "音楽パネル", musicPanelDefaults)}
            <DisplaySection title="音楽内容">
              <div className="control-grid">
                <CheckControl label="アートワーク" checked={music.showArtwork !== false} onChange={(v) => setSettingValue("musicPanel", "showArtwork", v)} />
                <SelectControl
                  label="アート位置"
                  value={music.artworkMode ?? "classic"}
                  onChange={(v) => setSettingValue("musicPanel", "artworkMode", v)}
                  options={[{ value: "classic", label: "従来" }, { value: "topRight", label: "右上" }]}
                />
                <CheckControl label="アルバム" checked={music.showAlbum !== false} onChange={(v) => setSettingValue("musicPanel", "showAlbum", v)} />
                <CheckControl label="時間表示" checked={music.showTimeCodes !== false} onChange={(v) => setSettingValue("musicPanel", "showTimeCodes", v)} />
                <CheckControl label="操作ボタン" checked={music.showControls !== false} onChange={(v) => setSettingValue("musicPanel", "showControls", v)} />
                <CheckControl label="進捗マーカー" checked={music.showMarker !== false} onChange={(v) => setSettingValue("musicPanel", "showMarker", v)} />
                <CheckControl label="フッター" checked={music.showFooter !== false} onChange={(v) => setSettingValue("musicPanel", "showFooter", v)} />
                <NumberControl label="右上アートサイズ" value={music.artworkCornerSize ?? 0} min={0} max={400} onChange={(v) => setSettingValue("musicPanel", "artworkCornerSize", v)} />
                <NumberControl label="アート上余白" value={music.artworkTopGap ?? 0} min={0} max={160} onChange={(v) => setSettingValue("musicPanel", "artworkTopGap", v)} />
                <NumberControl label="アート-バー間隔" value={music.artworkProgressGap ?? 20} min={0} max={240} onChange={(v) => setSettingValue("musicPanel", "artworkProgressGap", v)} />
                <NumberControl label="タイトルサイズ" value={music.titleSize ?? 26} min={8} max={64} onChange={(v) => setSettingValue("musicPanel", "titleSize", v)} />
                <NumberControl label="アーティストサイズ" value={music.artistSize ?? 16} min={8} max={48} onChange={(v) => setSettingValue("musicPanel", "artistSize", v)} />
                <NumberControl label="バー高さ" value={music.barHeight ?? 16} min={4} max={50} onChange={(v) => setSettingValue("musicPanel", "barHeight", v)} />
              </div>
            </DisplaySection>

            <DisplaySection title="歌詞 / 個人ニュース表示" open>
              <div className="control-grid">
                <CheckControl label="歌詞パネルを表示" checked={lyrics.show !== false} onChange={(v) => setSettingValue("lyricsPanel", "show", v)} />
                <CheckControl label="個人用ニュースパネルを表示" checked={personalNews.show !== false} onChange={(v) => setSettingValue("personalNewsPanel", "show", v)} />
                <CheckControl
                  label="歌詞が利用できない間は歌詞パネルを非表示にして個人用ニュースを表示する"
                  checked={lyricsUnavailableReplacementEnabled}
                  onChange={setLyricsUnavailableReplacement}
                />
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
                <SelectControl
                  label="長い行"
                  value={lyrics.lineOverflowMode ?? "wrap"}
                  onChange={(v) => setSettingValue("lyricsPanel", "lineOverflowMode", v)}
                  options={[{ value: "wrap", label: "改行する" }, { value: "ellipsis", label: "...で収める" }]}
                />
                <NumberControl label="ヘッダー余白" value={lyrics.contentTopGap ?? 18} min={0} max={160} onChange={(v) => setSettingValue("lyricsPanel", "contentTopGap", v)} />
                <NumberControl label="現在行サイズ" value={lyrics.currentSize ?? 30} min={12} max={80} onChange={(v) => setSettingValue("lyricsPanel", "currentSize", v)} />
                <NumberControl label="前後行サイズ" value={lyrics.sideSize ?? 18} min={8} max={56} onChange={(v) => setSettingValue("lyricsPanel", "sideSize", v)} />
                <NumberControl label="曲名サイズ" value={lyrics.metaSize ?? 12} min={8} max={36} onChange={(v) => setSettingValue("lyricsPanel", "metaSize", v)} />
                <NumberControl label="行間" value={lyrics.lineGap ?? 12} min={0} max={80} onChange={(v) => setSettingValue("lyricsPanel", "lineGap", v)} />
                <NumberControl label="前後行濃度" value={lyrics.sideOpacity ?? 0.45} min={0} max={1} step={0.05} onChange={(v) => setSettingValue("lyricsPanel", "sideOpacity", v)} />
              </div>
            </DisplaySection>

            {renderPlacement("personalNewsPanel", "個人ニュースパネル", personalNewsPanelDefaults)}
            <DisplaySection title="個人ニュース内容">
              <div className="control-grid">
                <CheckControl label="状態バッジ" checked={personalNews.showStatus !== false} onChange={(v) => setSettingValue("personalNewsPanel", "showStatus", v)} />
                <CheckControl label="ニュースタイトル" checked={personalNews.personalNewsShowTitle !== false} onChange={(v) => setSettingValue("personalNewsPanel", "personalNewsShowTitle", v)} />
                <CheckControl label="ニューストピック" checked={personalNews.personalNewsShowTopic !== false} onChange={(v) => setSettingValue("personalNewsPanel", "personalNewsShowTopic", v)} />
                <CheckControl label="ニュース本文" checked={personalNews.personalNewsShowBody !== false} onChange={(v) => setSettingValue("personalNewsPanel", "personalNewsShowBody", v)} />
                <CheckControl label="補足表示" checked={personalNews.personalNewsShowSource !== false} onChange={(v) => setSettingValue("personalNewsPanel", "personalNewsShowSource", v)} />
                <CheckControl label="ニュース進捗" checked={personalNews.personalNewsShowProgress !== false} onChange={(v) => setSettingValue("personalNewsPanel", "personalNewsShowProgress", v)} />
                <CheckControl label="チャプターマーク" checked={personalNews.personalNewsShowChapterMarks !== false} onChange={(v) => setSettingValue("personalNewsPanel", "personalNewsShowChapterMarks", v)} />
                <NumberControl label="ニュースタイトルサイズ" value={personalNews.personalNewsTitleSize ?? 14} min={8} max={36} onChange={(v) => setSettingValue("personalNewsPanel", "personalNewsTitleSize", v)} />
                <NumberControl label="トピックサイズ" value={personalNews.personalNewsTopicSize ?? 17} min={8} max={42} onChange={(v) => setSettingValue("personalNewsPanel", "personalNewsTopicSize", v)} />
                <NumberControl label="ニュース本文サイズ" value={personalNews.personalNewsBodySize ?? 34} min={12} max={86} onChange={(v) => setSettingValue("personalNewsPanel", "personalNewsBodySize", v)} />
                <NumberControl label="補足サイズ" value={personalNews.personalNewsSourceSize ?? 12} min={8} max={30} onChange={(v) => setSettingValue("personalNewsPanel", "personalNewsSourceSize", v)} />
                <ColorControl label="補足色" value={personalNews.personalNewsSupplementColor ?? "#b8dcff"} onChange={(v) => setSettingValue("personalNewsPanel", "personalNewsSupplementColor", v)} />
                <NumberControl label="進捗バー高さ" value={personalNews.personalNewsProgressHeight ?? 10} min={4} max={34} onChange={(v) => setSettingValue("personalNewsPanel", "personalNewsProgressHeight", v)} />
                <NumberControl label="ニュース行間" value={personalNews.personalNewsGap ?? 12} min={0} max={70} onChange={(v) => setSettingValue("personalNewsPanel", "personalNewsGap", v)} />
                <NumberControl label="横スクロール速度" value={personalNews.personalNewsScrollSpeed ?? 1} min={0.2} max={3} step={0.1} onChange={(v) => setSettingValue("personalNewsPanel", "personalNewsScrollSpeed", v)} />
              </div>
            </DisplaySection>

            {renderPlacement("memoPanel", "メモパネル", memoPanelDefaults)}
            <DisplaySection title="メモ内容">
              <div className="control-grid">
                <CheckControl label="日付" checked={memo.showDates !== false} onChange={(v) => setSettingValue("memoPanel", "showDates", v)} />
                <CheckControl label="ピン留め欄" checked={memo.showPinnedSection !== false} onChange={(v) => setSettingValue("memoPanel", "showPinnedSection", v)} />
                <CheckControl label="フッター" checked={memo.showFooter !== false} onChange={(v) => setSettingValue("memoPanel", "showFooter", v)} />
                <NumberControl label="ヘッダー余白" value={memo.contentTopGap ?? 18} min={0} max={160} onChange={(v) => setSettingValue("memoPanel", "contentTopGap", v)} />
                <NumberControl label="最大件数" value={memo.maxItems ?? 0} max={20} onChange={(v) => setSettingValue("memoPanel", "maxItems", v)} />
                <NumberControl label="本文サイズ" value={memo.textSize ?? 15} min={8} max={40} onChange={(v) => setSettingValue("memoPanel", "textSize", v)} />
                <NumberControl label="カード余白" value={memo.cardPadding ?? 14} max={50} onChange={(v) => setSettingValue("memoPanel", "cardPadding", v)} />
              </div>
            </DisplaySection>

            {renderPlacement("timerPanel", "タイマーパネル", timerPanelDefaults)}
            <DisplaySection title="タイマー内容">
              <div className="control-grid">
                <SelectControl
                  label="モード"
                  value={timer.mode ?? "pomodoro"}
                  onChange={(v) => setSettingValue("timerPanel", "mode", v)}
                  options={[{ value: "timer", label: "タイマー" }, { value: "pomodoro", label: "ポモドーロ" }]}
                />
                <CheckControl label="操作ボタン" checked={timer.showControls !== false} onChange={(v) => setSettingValue("timerPanel", "showControls", v)} />
                <CheckControl label="セット表示" checked={timer.showCycle !== false} onChange={(v) => setSettingValue("timerPanel", "showCycle", v)} />
                <ControlRow label="プリセット名">
                  <input value={timerPresetName} onChange={(e) => setTimerPresetName(e.target.value)} placeholder="作業用 / 休憩短め など" />
                </ControlRow>
                <button type="button" className="secondary-btn" onClick={saveTimerPreset}>タイマー設定を追加</button>
                <ControlRow label="タイマー名">
                  <input value={timer.timerTitle ?? "Countdown"} onChange={(e) => setSettingValue("timerPanel", "timerTitle", e.target.value)} />
                </ControlRow>
                <ControlRow label="集中名">
                  <input value={timer.focusTitle ?? "Pomodoro"} onChange={(e) => setSettingValue("timerPanel", "focusTitle", e.target.value)} />
                </ControlRow>
                <ControlRow label="短休止名">
                  <input value={timer.shortBreakTitle ?? "Rest"} onChange={(e) => setSettingValue("timerPanel", "shortBreakTitle", e.target.value)} />
                </ControlRow>
                <ControlRow label="長休止名">
                  <input value={timer.longBreakTitle ?? "Long Rest"} onChange={(e) => setSettingValue("timerPanel", "longBreakTitle", e.target.value)} />
                </ControlRow>
                <ControlRow label="タイマー表示">
                  <input value={timer.timerLabel ?? "TIMER"} onChange={(e) => setSettingValue("timerPanel", "timerLabel", e.target.value)} />
                </ControlRow>
                <ControlRow label="集中表示">
                  <input value={timer.focusLabel ?? "FOCUS"} onChange={(e) => setSettingValue("timerPanel", "focusLabel", e.target.value)} />
                </ControlRow>
                <ControlRow label="短休止表示">
                  <input value={timer.shortBreakLabel ?? "BREAK"} onChange={(e) => setSettingValue("timerPanel", "shortBreakLabel", e.target.value)} />
                </ControlRow>
                <ControlRow label="長休止表示">
                  <input value={timer.longBreakLabel ?? "LONG BREAK"} onChange={(e) => setSettingValue("timerPanel", "longBreakLabel", e.target.value)} />
                </ControlRow>
                <NumberControl label="タイマー(分)" value={timer.timerMinutes ?? 10} min={1} max={180} onChange={(v) => setSettingValue("timerPanel", "timerMinutes", v)} />
                <NumberControl label="集中(分)" value={timer.pomodoroMinutes ?? 25} min={1} max={90} onChange={(v) => setSettingValue("timerPanel", "pomodoroMinutes", v)} />
                <NumberControl label="短休憩(分)" value={timer.shortBreakMinutes ?? 5} min={1} max={30} onChange={(v) => setSettingValue("timerPanel", "shortBreakMinutes", v)} />
                <NumberControl label="長休憩(分)" value={timer.longBreakMinutes ?? 15} min={1} max={60} onChange={(v) => setSettingValue("timerPanel", "longBreakMinutes", v)} />
                <NumberControl label="タイトルサイズ" value={timer.titleSize ?? 20} min={10} max={52} onChange={(v) => setSettingValue("timerPanel", "titleSize", v)} />
                <NumberControl label="時刻サイズ" value={timer.timeSize ?? 52} min={24} max={110} onChange={(v) => setSettingValue("timerPanel", "timeSize", v)} />
                <NumberControl label="バー高さ" value={timer.barHeight ?? 12} min={4} max={50} onChange={(v) => setSettingValue("timerPanel", "barHeight", v)} />
                <NumberControl label="要素間隔" value={timer.itemGap ?? 6} min={0} max={40} onChange={(v) => setSettingValue("timerPanel", "itemGap", v)} />
              </div>
              {timerPresets.length > 0 && (
                <div className="timer-preset-list">
                  {timerPresets.map((preset) => (
                    <div className="timer-preset-item" key={preset.id}>
                      <span>{preset.name}</span>
                      <button type="button" className="secondary-btn" onClick={() => applyTimerPreset(preset)}>適用</button>
                      <button type="button" className="icon-btn danger" onClick={() => deleteTimerPreset(preset.id)} aria-label={`${preset.name}を削除`}><XIcon /></button>
                    </div>
                  ))}
                </div>
              )}
            </DisplaySection>
          </div>
        </DisplaySection>
        )}
        {studioObj === "system" && (
        <DisplaySection title="システム設定" open>
          <div className="control-grid">
            <CheckControl label="デバッグ枠" checked={draftSettings.debugMode === true} onChange={(v) => setRootSetting("debugMode", v)} />
            <NumberControl label="全体不透明度" value={overlay.opacity ?? 1} min={0} max={1} step={0.05} onChange={(v) => setSettingValue("overlay", "opacity", v)} />
            <NumberControl label="FPS制限" value={overlay.fpsLimit ?? 30} min={15} max={60} step={1} onChange={(v) => setSettingValue("overlay", "fpsLimit", v)} />
          </div>
        </DisplaySection>
        )}
        </div>
      </div>
    </section>
  );
}
