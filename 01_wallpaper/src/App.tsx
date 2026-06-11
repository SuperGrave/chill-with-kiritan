import { useState, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { CameraMode, SpringBoneMode, ExternalRequestAction, MotionRequest } from './VrmViewer';
import type { IdleState, IdleDebug } from './lib/motion/idleStateMachine';
import { IDLE_STATES, IDLE_STATE_LABELS } from './lib/motion/idleStateMachine';
import type { ExternalMotionDebug } from './lib/motion/externalMotionController';
import type { SceneDebug } from './lib/scene/sceneTypes';
import { DEFAULT_SCENE_ID } from './lib/scene/scenePresets';
// Scene Layout Calibration (Motion Probe 0.6)
import {
  LAYOUT_TARGETS,
  LAYOUT_TARGET_LABELS,
  POS_STEP,
  ROT_STEP,
  SCALE_FACTOR,
  CAM_PAN_STEP,
  CAM_DOLLY_STEP,
  applyNudge,
  cycleTarget,
  exportSceneLayout,
  r3,
} from './lib/scene/layoutCalibration';
import type { LayoutTransforms, LayoutTargetId } from './lib/scene/layoutCalibration';
import SceneBackgroundLayer from './components/SceneBackgroundLayer';
import type { BgAssetStatus, BgDebug, BgFit } from './components/SceneBackgroundLayer';
import VrmViewer from './VrmViewer';
import './index.css';

// Short labels for the background asset states (debug section).
const BG_STATUS_LABEL: Record<BgAssetStatus, string> = {
  ok: 'ok',
  fallback: 'fallback',
  none: 'none',
  loading: '…',
};

// Keyboard 4-8 map to the five idle states, in the order shown in the UI.
const IDLE_KEYS: Record<string, IdleState> = {
  '4': 'idle_breath',
  '5': 'idle_look_monitor',
  '6': 'idle_glance_user',
  '7': 'idle_sleepy',
  '8': 'idle_small_smile',
};

// Known labels for the pixiv VRMA MotionPack files (served via /__lab/vrma-pack).
const VRMA_LABELS: Record<string, string> = {
  sample_idle: 'サンプル idle',
  VRMA_01: '全身を見せる',
  VRMA_02: '挨拶',
  VRMA_03: 'Vサイン',
  VRMA_04: '撃つ',
  VRMA_05: '回る',
  VRMA_06: 'モデルポーズ',
  VRMA_07: '屈伸運動',
};

// --- Motion selector ------------------------------------------------------------

interface MotionEntry {
  kind: 'builtin' | 'vrma' | 'dsl';
  ref: string; // dsl: motion id / vrma: fetch URL / builtin: 'builtin'
  label: string;
  group: '自作モーション' | 'VRMAパック' | '検証用' | 'その他';
}

const MOTION_GROUPS: MotionEntry['group'][] = ['自作モーション', 'VRMAパック', '検証用', 'その他'];
const BUILTIN_ENTRY: MotionEntry = { kind: 'builtin', ref: 'builtin', label: '組み込み: 見回し（コード生成）', group: 'その他' };
const motionKey = (e: MotionEntry) => `${e.kind}:${e.ref}`;

// --- Collapsible section -----------------------------------------------------------

type SectionId = 'motion' | 'idle' | 'camera' | 'expression' | 'scene' | 'layout' | 'display' | 'debug';

const SECTION_DEFAULT_OPEN: Record<SectionId, boolean> = {
  motion: true,
  idle: false,
  camera: false,
  expression: false,
  scene: false,
  layout: false,
  display: false,
  debug: false,
};

const OPEN_SECTIONS_STORAGE_KEY = 'probe.openSections.v1';

function Section(props: {
  id: SectionId;
  icon: string;
  title: string;
  summary?: ReactNode;
  open: boolean;
  onToggle: (id: SectionId) => void;
  children: ReactNode;
}) {
  return (
    <section className={`panel-section${props.open ? ' is-open' : ''}`}>
      <button type="button" className="section-header" aria-expanded={props.open} onClick={() => props.onToggle(props.id)}>
        <span className="section-icon" aria-hidden>{props.icon}</span>
        <span className="section-title">{props.title}</span>
        <span className="section-summary">{props.summary}</span>
        <span className="section-chevron" aria-hidden>▾</span>
      </button>
      {props.open && <div className="section-body">{props.children}</div>}
    </section>
  );
}

function App() {
  const [cameraMode, setCameraMode] = useState<CameraMode>('desk wide');
  const [lookAtEnabled, setLookAtEnabled] = useState(true);
  const [springBoneMode, setSpringBoneMode] = useState<SpringBoneMode>('normal');
  const [fpsLimit, setFpsLimit] = useState(true); // 30fps by default
  const [currentExpression, setCurrentExpression] = useState('neutral');
  const [autoBlink, setAutoBlink] = useState(true);
  const [idleMotion, setIdleMotion] = useState(true);

  // Idle state machine controls (Motion Probe 0.2). idleRequest is a nonce so
  // the same state can be re-requested after auto-idle has moved on.
  const [idleRequest, setIdleRequest] = useState<{ state: IdleState; seq: number }>({
    state: 'idle_breath',
    seq: 0,
  });
  const [autoIdle, setAutoIdle] = useState(false);
  const [idleDebug, setIdleDebug] = useState<IdleDebug>({
    current: 'idle_breath',
    from: 'idle_breath',
    progress: 1,
    blendWeight: 1,
    duration: 1,
    dwell: 0,
    autoIdle: false,
  });

  // External Motion (Motion Probe 0.3). clipWeight is a continuous slider;
  // discrete commands go through an {action, seq} nonce.
  const [externalClipWeight, setExternalClipWeight] = useState(1.0);
  const [externalRequest, setExternalRequest] = useState<{ action: ExternalRequestAction; seq: number }>({
    action: 'returnToIdle',
    seq: 0,
  });
  const [externalDebug, setExternalDebug] = useState<ExternalMotionDebug>({
    enabled: false,
    playing: false,
    loop: true,
    clipLoaded: false,
    clipName: '',
    clipSource: 'none',
    hasExpressionTracks: false,
    clipWeight: 1,
    blend: 0,
    weight: 0,
    crossfading: false,
  });

  // Motion selector (0.7 UI): the list comes from /__lab/ls (dev server); picking
  // an entry loads it through VrmViewer.motionRequest and starts playback.
  const [motionList, setMotionList] = useState<MotionEntry[]>([BUILTIN_ENTRY]);
  const [selectedMotionKey, setSelectedMotionKey] = useState<string>('');
  const [motionRequest, setMotionRequest] = useState<MotionRequest>({ kind: 'builtin', ref: 'builtin', play: false, seq: 0 });
  const [motionListNote, setMotionListNote] = useState('');

  // Scene / Props (Motion Probe 0.4). One scene preset this phase; toggles flip
  // prop / placeholder visibility, and Reload Scene re-reads scene.json (a nonce).
  const [sceneId] = useState<string>(DEFAULT_SCENE_ID);
  const [propsEnabled, setPropsEnabled] = useState(true);
  const [placeholdersEnabled, setPlaceholdersEnabled] = useState(true);
  const [sceneReloadSeq, setSceneReloadSeq] = useState(0);
  const [sceneDebug, setSceneDebug] = useState<SceneDebug>({
    sceneId: DEFAULT_SCENE_ID,
    label: '',
    sceneOk: false,
    usedDefault: false,
    propTotal: 0,
    propLoaded: 0,
    propMissing: 0,
    placeholders: 0,
    propsEnabled: true,
    placeholdersEnabled: true,
    warnings: [],
    results: [],
  });

  // Background / Window / Light Overlay (Motion Probe 0.5).
  const [backgroundEnabled, setBackgroundEnabled] = useState(true);
  const [lightOverlayEnabled, setLightOverlayEnabled] = useState(true);
  const [bgFit, setBgFit] = useState<BgFit>('cover');
  const [bgDebug, setBgDebug] = useState<BgDebug>({
    room: 'loading',
    outside: 'loading',
    light: 'none',
    enabled: true,
    lightOverlayEnabled: true,
    fit: 'cover',
  });

  // Scene Layout Calibration (Motion Probe 0.6).
  const [layout, setLayout] = useState<LayoutTransforms | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<LayoutTargetId>('character');
  const [guidesEnabled, setGuidesEnabled] = useState(false);
  const [cameraNudge, setCameraNudge] = useState({ dx: 0, dy: 0, dz: 0, dolly: 0, seq: 0 });
  const [cameraReadback, setCameraReadback] = useState<{ position: [number, number, number]; target: [number, number, number]; fov: number }>({
    position: [0, 0, 0],
    target: [0, 0, 0],
    fov: 45,
  });
  const [exportText, setExportText] = useState('');
  const [showExport, setShowExport] = useState(false);

  const [fps, setFps] = useState(0);
  const [status, setStatus] = useState('Initializing...');

  // Panel chrome (0.7 UI): collapsible genre sections + a whole-panel hide (H)
  // so the screen can be watched uncluttered. Open state persists per browser.
  const [panelVisible, setPanelVisible] = useState(true);
  const [openSections, setOpenSections] = useState<Record<SectionId, boolean>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(OPEN_SECTIONS_STORAGE_KEY) ?? '{}') as Partial<Record<SectionId, boolean>>;
      return { ...SECTION_DEFAULT_OPEN, ...saved };
    } catch {
      return SECTION_DEFAULT_OPEN;
    }
  });
  const toggleSection = (id: SectionId) =>
    setOpenSections((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem(OPEN_SECTIONS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* private mode etc. — non-fatal */
      }
      return next;
    });

  // Mirror calibration state into refs so the once-registered keydown handler
  // (deps []) always reads current values (it never re-binds per keystroke).
  const selectedTargetRef = useRef(selectedTarget);
  const layoutRef = useRef(layout);
  const cameraReadbackRef = useRef(cameraReadback);
  const cameraModeRef = useRef(cameraMode);
  useEffect(() => {
    selectedTargetRef.current = selectedTarget;
    layoutRef.current = layout;
    cameraReadbackRef.current = cameraReadback;
    cameraModeRef.current = cameraMode;
  }, [selectedTarget, layout, cameraReadback, cameraMode]);

  // --- Motion list (0.7 UI) ---------------------------------------------------

  const refreshMotionList = async () => {
    const entries: MotionEntry[] = [BUILTIN_ENTRY];
    try {
      const res = await fetch(`/__lab/ls?ts=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ls = (await res.json()) as { motions?: string[]; vrma?: { id: string; url: string }[] };
      const dslEntries = await Promise.all(
        (ls.motions ?? []).map(async (id): Promise<MotionEntry> => {
          let label = id;
          try {
            const r = await fetch(`/motions/dsl/${id}.motion.json?ts=${Date.now()}`, { cache: 'no-store' });
            if (r.ok) label = ((await r.json()) as { label?: string }).label || id;
          } catch {
            /* keep the id as label */
          }
          return { kind: 'dsl', ref: id, label, group: id.startsWith('_') ? '検証用' : '自作モーション' };
        }),
      );
      entries.push(...dslEntries);
      entries.push(
        ...(ls.vrma ?? []).map(
          (v): MotionEntry => ({ kind: 'vrma', ref: v.url, label: VRMA_LABELS[v.id] ? `${VRMA_LABELS[v.id]}（${v.id}）` : v.id, group: 'VRMAパック' }),
        ),
      );
      setMotionListNote('');
    } catch {
      // Production build (no dev middleware): fall back to the statically known files.
      entries.push({ kind: 'vrma', ref: '/motions/sample_idle.vrma', label: 'sample_idle.vrma', group: 'VRMAパック' });
      setMotionListNote('一覧の自動取得は devサーバ専用です（既知の項目のみ表示中）');
    }
    setMotionList(entries);
  };
  useEffect(() => {
    refreshMotionList();
  }, []);

  const playMotionByKey = (key: string) => {
    setSelectedMotionKey(key);
    const entry = motionList.find((m) => motionKey(m) === key);
    if (!entry) return;
    setMotionRequest((prev) => ({ kind: entry.kind, ref: entry.ref, label: entry.label, play: true, seq: prev.seq + 1 }));
  };

  const selectedMotion = motionList.find((m) => motionKey(m) === selectedMotionKey);

  // --- Layout helpers (0.6) ------------------------------------------------------

  const exportLayout = () => {
    const l = layoutRef.current;
    if (!l) return;
    const cam = cameraReadbackRef.current;
    const text = exportSceneLayout({
      character: l.character,
      props: [
        { id: 'desk', transform: l.desk },
        { id: 'chair', transform: l.chair },
        { id: 'laptop', transform: l.laptop },
      ],
      camera: { preset: cameraModeRef.current, position: cam.position, target: cam.target, fov: cam.fov },
    });
    setExportText(text);
    setShowExport(true);
    console.log('[LAYOUT] scene.json export:\n' + text);
    navigator.clipboard?.writeText(text).catch(() => {});
  };

  const nudgeSelected = (op: 'pos' | 'rot' | 'scale', axis: 0 | 1 | 2, deltaOrFactor: number) => {
    if (selectedTarget === 'camera') return;
    setLayout((prev) => (prev ? { ...prev, [selectedTarget]: applyNudge(prev[selectedTarget], op, axis, deltaOrFactor) } : prev));
  };
  const nudgeCamera = (dx: number, dy: number, dz: number, dolly: number) => {
    setCameraMode('free');
    setCameraNudge((prev) => ({ dx, dy, dz, dolly, seq: prev.seq + 1 }));
  };
  const fmtV = (v: [number, number, number]) => `[${r3(v[0])}, ${r3(v[1])}, ${r3(v[2])}]`;
  const fmtVdeg = (v: [number, number, number]) =>
    `[${r3((v[0] * 180) / Math.PI)}, ${r3((v[1] * 180) / Math.PI)}, ${r3((v[2] * 180) / Math.PI)}]`;

  const requestIdle = (state: IdleState) => setIdleRequest((prev) => ({ state, seq: prev.seq + 1 }));
  const requestExternal = (action: ExternalRequestAction) => setExternalRequest((prev) => ({ action, seq: prev.seq + 1 }));
  const reloadScene = () => setSceneReloadSeq((s) => s + 1);

  // --- Keyboard shortcuts (unchanged from 0.6, plus H = panel show/hide) ----------

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();

      // Ctrl/Cmd+S exports; other Ctrl/Cmd combos pass through to the browser.
      if ((e.ctrlKey || e.metaKey) && key === 's') {
        e.preventDefault();
        exportLayout();
        return;
      }
      if (e.ctrlKey || e.metaKey) return;

      if (key === '[') { e.preventDefault(); setSelectedTarget((p) => cycleTarget(p, -1)); return; }
      if (key === ']') { e.preventDefault(); setSelectedTarget((p) => cycleTarget(p, 1)); return; }
      if (key === 't') { e.preventDefault(); setGuidesEnabled((p) => !p); return; }

      const isArrow = key === 'arrowleft' || key === 'arrowright' || key === 'arrowup' || key === 'arrowdown';
      const isLayoutKey = isArrow || key === 'pageup' || key === 'pagedown' || key === '+' || key === '=' || key === '-';
      if (isLayoutKey) {
        e.preventDefault();
        const target = selectedTargetRef.current;
        if (target === 'camera') {
          setCameraMode('free'); // nudges are only visible in free mode
          let dx = 0, dy = 0, dz = 0, dolly = 0;
          if (key === 'arrowleft') dx = -CAM_PAN_STEP;
          else if (key === 'arrowright') dx = CAM_PAN_STEP;
          else if (key === 'arrowup') dz = -CAM_PAN_STEP;
          else if (key === 'arrowdown') dz = CAM_PAN_STEP;
          else if (key === 'pageup') dy = CAM_PAN_STEP;
          else if (key === 'pagedown') dy = -CAM_PAN_STEP;
          else if (key === '+' || key === '=') dolly = CAM_DOLLY_STEP;
          else if (key === '-') dolly = -CAM_DOLLY_STEP;
          setCameraNudge((prev) => ({ dx, dy, dz, dolly, seq: prev.seq + 1 }));
          return;
        }
        let op: 'pos' | 'rot' | 'scale' | null = null;
        let axis: 0 | 1 | 2 = 0;
        let amt = 0;
        if (e.shiftKey) {
          if (key === 'arrowleft') { op = 'rot'; axis = 1; amt = -ROT_STEP; }
          else if (key === 'arrowright') { op = 'rot'; axis = 1; amt = ROT_STEP; }
          else if (key === 'arrowup') { op = 'rot'; axis = 0; amt = -ROT_STEP; }
          else if (key === 'arrowdown') { op = 'rot'; axis = 0; amt = ROT_STEP; }
        } else if (key === 'arrowleft') { op = 'pos'; axis = 0; amt = -POS_STEP; }
        else if (key === 'arrowright') { op = 'pos'; axis = 0; amt = POS_STEP; }
        else if (key === 'arrowup') { op = 'pos'; axis = 2; amt = -POS_STEP; }
        else if (key === 'arrowdown') { op = 'pos'; axis = 2; amt = POS_STEP; }
        else if (key === 'pageup') { op = 'pos'; axis = 1; amt = POS_STEP; }
        else if (key === 'pagedown') { op = 'pos'; axis = 1; amt = -POS_STEP; }
        else if (key === '+' || key === '=') { op = 'scale'; amt = SCALE_FACTOR; }
        else if (key === '-') { op = 'scale'; amt = 1 / SCALE_FACTOR; }
        if (op) {
          const o = op, a = axis, m = amt;
          setLayout((prev) => (prev ? { ...prev, [target]: applyNudge(prev[target], o, a, m) } : prev));
        }
        return;
      }

      if (key === '1') setCameraMode('desk wide');
      if (key === '2') setCameraMode('face close');
      if (key === '3') setCameraMode('monitor side');
      if (key === 'b') setAutoBlink(prev => !prev);
      if (key === 'l') setLookAtEnabled(prev => !prev);
      if (key === 'f') setFpsLimit(prev => !prev);
      if (key === 'n') setCurrentExpression('neutral');
      if (key === 'j') setCurrentExpression('joy');
      if (key === 'u') setCurrentExpression('fun');
      if (key === 's') setCurrentExpression('sorrow');
      if (key === 'a') setCurrentExpression('angry');
      if (key === 'm') {
        setSpringBoneMode(prev => {
          if (prev === 'normal') return 'lightweight';
          if (prev === 'lightweight') return 'off';
          return 'normal';
        });
      }
      if (key === ' ') {
        setIdleMotion(prev => !prev);
      }
      if (IDLE_KEYS[key]) requestIdle(IDLE_KEYS[key]);
      if (key === 'r') setAutoIdle(prev => !prev);
      if (key === '9') requestExternal('toggleEnabled');
      if (key === '0') requestExternal('returnToIdle');
      if (key === 'p') requestExternal('togglePlay');
      if (key === 'v') setPropsEnabled((prev) => !prev);
      if (key === 'c') setPlaceholdersEnabled((prev) => !prev);
      if (key === 'g') setSceneReloadSeq((s) => s + 1);
      if (key === 'k') setBackgroundEnabled((prev) => !prev);
      if (key === 'o') setLightOverlayEnabled((prev) => !prev);
      if (key === 'h') setPanelVisible((prev) => !prev);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const idleKeyFor = (state: IdleState) => Object.keys(IDLE_KEYS).find((k) => IDLE_KEYS[k] === state) ?? '';
  const fading = idleDebug.progress < 1;

  const chip = (active: boolean) => `chip${active ? ' active' : ''}`;

  return (
    <div id="root">
      <SceneBackgroundLayer
        background={sceneDebug.background}
        enabled={backgroundEnabled}
        lightOverlayEnabled={lightOverlayEnabled}
        fit={bgFit}
        onBgDebug={setBgDebug}
      />

      <VrmViewer
        cameraMode={cameraMode}
        lookAtEnabled={lookAtEnabled}
        springBoneMode={springBoneMode}
        fpsLimit={fpsLimit}
        currentExpression={currentExpression}
        autoBlink={autoBlink}
        idleMotion={idleMotion}
        idleRequest={idleRequest}
        autoIdle={autoIdle}
        externalClipWeight={externalClipWeight}
        externalRequest={externalRequest}
        motionRequest={motionRequest}
        sceneId={sceneId}
        propsEnabled={propsEnabled}
        placeholdersEnabled={placeholdersEnabled}
        sceneReloadSeq={sceneReloadSeq}
        layoutTransforms={layout}
        selectedTarget={selectedTarget}
        guidesEnabled={guidesEnabled}
        cameraNudge={cameraNudge}
        onFpsUpdate={setFps}
        onStatusUpdate={setStatus}
        onIdleDebug={setIdleDebug}
        onExternalDebug={setExternalDebug}
        onSceneDebug={setSceneDebug}
        onLayoutInit={(init) => {
          setLayout(init.transforms);
          setCameraReadback({ position: init.camera.position, target: init.camera.target, fov: init.camera.fov });
        }}
        onCameraReadback={setCameraReadback}
      />

      <div className="ui-layer">
        {!panelVisible && (
          <button type="button" className="panel-reveal" onClick={() => setPanelVisible(true)} title="パネルを表示 (H)">
            ☰
          </button>
        )}

        {panelVisible && (
          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">Motion Probe 0.7</span>
              <span className="panel-fps">{fps} fps</span>
              <button type="button" className="icon-btn" onClick={() => setPanelVisible(false)} title="パネルを隠す (H)">
                ✕
              </button>
            </div>

            {/* ------------------------------------------------ motion playback */}
            <Section
              id="motion"
              icon="🎬"
              title="モーション再生"
              summary={externalDebug.clipLoaded ? `${externalDebug.clipName}${externalDebug.playing ? ' ▶' : ''}` : '未選択'}
              open={openSections.motion}
              onToggle={toggleSection}
            >
              <div className="field-row">
                <select
                  className="select motion-select"
                  value={selectedMotionKey}
                  onChange={(e) => playMotionByKey(e.target.value)}
                >
                  <option value="" disabled>
                    モーションを選択（選ぶと再生）
                  </option>
                  {MOTION_GROUPS.map((group) => {
                    const items = motionList.filter((m) => m.group === group);
                    if (items.length === 0) return null;
                    return (
                      <optgroup key={group} label={group}>
                        {items.map((m) => (
                          <option key={motionKey(m)} value={motionKey(m)}>
                            {m.label}
                          </option>
                        ))}
                      </optgroup>
                    );
                  })}
                </select>
                <button type="button" className="chip" onClick={refreshMotionList} title="一覧を再取得">
                  ↻
                </button>
              </div>
              {motionListNote && <p className="muted small">{motionListNote}</p>}

              <div className="btn-row">
                <button
                  type="button"
                  className={chip(externalDebug.playing)}
                  onClick={() => {
                    if (!externalDebug.playing && selectedMotion) playMotionByKey(selectedMotionKey);
                    else requestExternal('togglePlay');
                  }}
                >
                  {externalDebug.playing ? '⏸ 停止' : '▶ 再生'} <kbd>P</kbd>
                </button>
                <button type="button" className="chip" onClick={() => requestExternal('returnToIdle')}>
                  ↩ 待機へ <kbd>0</kbd>
                </button>
                <button type="button" className={chip(externalDebug.loop)} onClick={() => requestExternal('toggleLoop')}>
                  🔁 ループ
                </button>
                <button type="button" className={chip(externalDebug.enabled)} onClick={() => requestExternal('toggleEnabled')}>
                  合成 {externalDebug.enabled ? 'ON' : 'OFF'} <kbd>9</kbd>
                </button>
              </div>

              <label className="slider-label">
                ブレンド上限 <span className="mono">{externalClipWeight.toFixed(2)}</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={externalClipWeight}
                  onChange={(e) => setExternalClipWeight(parseFloat(e.target.value))}
                />
              </label>
              <p className="muted small">
                {externalDebug.clipLoaded ? (
                  <>
                    {externalDebug.clipName} [{externalDebug.clipSource}] · blend {(externalDebug.blend * 100).toFixed(0)}% · weight{' '}
                    {externalDebug.weight.toFixed(2)}
                    {externalDebug.crossfading && ' · crossfading…'}
                  </>
                ) : (
                  'クリップ未ロード — 上のリストから選択'
                )}
              </p>
            </Section>

            {/* ------------------------------------------------ idle */}
            <Section
              id="idle"
              icon="🧍"
              title="アイドル"
              summary={
                <>
                  {IDLE_STATE_LABELS[idleDebug.current]}
                  {autoIdle && ' · Auto'}
                  {!idleMotion && ' · OFF'}
                </>
              }
              open={openSections.idle}
              onToggle={toggleSection}
            >
              <div className="btn-row">
                {IDLE_STATES.map((state) => (
                  <button key={state} type="button" className={chip(idleDebug.current === state)} onClick={() => requestIdle(state)}>
                    {IDLE_STATE_LABELS[state]} <kbd>{idleKeyFor(state)}</kbd>
                  </button>
                ))}
              </div>
              <div className="btn-row">
                <button type="button" className={chip(autoIdle)} onClick={() => setAutoIdle(!autoIdle)}>
                  自動切替 {autoIdle ? 'ON' : 'OFF'} <kbd>R</kbd>
                </button>
                <button type="button" className={chip(idleMotion)} onClick={() => setIdleMotion(!idleMotion)}>
                  アイドル合成 {idleMotion ? 'ON' : 'OFF'} <kbd>␣</kbd>
                </button>
              </div>
              {fading && (
                <p className="muted small">
                  {IDLE_STATE_LABELS[idleDebug.from]} → {IDLE_STATE_LABELS[idleDebug.current]}（{(idleDebug.progress * 100).toFixed(0)}%）
                </p>
              )}
            </Section>

            {/* ------------------------------------------------ camera */}
            <Section id="camera" icon="🎥" title="カメラ" summary={cameraMode} open={openSections.camera} onToggle={toggleSection}>
              <div className="btn-row">
                <button type="button" className={chip(cameraMode === 'desk wide')} onClick={() => setCameraMode('desk wide')}>
                  机ワイド <kbd>1</kbd>
                </button>
                <button type="button" className={chip(cameraMode === 'face close')} onClick={() => setCameraMode('face close')}>
                  顔アップ <kbd>2</kbd>
                </button>
                <button type="button" className={chip(cameraMode === 'monitor side')} onClick={() => setCameraMode('monitor side')}>
                  モニタ横 <kbd>3</kbd>
                </button>
              </div>
              <div className="btn-row">
                <button type="button" className={chip(cameraMode === 'workdesk_front')} onClick={() => setCameraMode('workdesk_front')}>
                  作業机・正面
                </button>
                <button type="button" className={chip(cameraMode === 'workdesk_side')} onClick={() => setCameraMode('workdesk_side')}>
                  作業机・斜め
                </button>
                <button type="button" className={chip(cameraMode === 'workdesk_close')} onClick={() => setCameraMode('workdesk_close')}>
                  作業机・寄り
                </button>
                <button type="button" className={chip(cameraMode === 'free')} onClick={() => setCameraMode('free')}>
                  フリー（ドラッグ）
                </button>
              </div>
            </Section>

            {/* ------------------------------------------------ expression */}
            <Section id="expression" icon="😊" title="表情" summary={currentExpression} open={openSections.expression} onToggle={toggleSection}>
              <p className="group-label">感情</p>
              <div className="btn-row">
                <button type="button" className={chip(currentExpression === 'neutral')} onClick={() => setCurrentExpression('neutral')}>
                  ニュートラル <kbd>N</kbd>
                </button>
                <button type="button" className={chip(currentExpression === 'joy')} onClick={() => setCurrentExpression('joy')}>
                  喜び <kbd>J</kbd>
                </button>
                <button type="button" className={chip(currentExpression === 'fun')} onClick={() => setCurrentExpression('fun')}>
                  楽しい <kbd>U</kbd>
                </button>
                <button type="button" className={chip(currentExpression === 'sorrow')} onClick={() => setCurrentExpression('sorrow')}>
                  悲しみ <kbd>S</kbd>
                </button>
                <button type="button" className={chip(currentExpression === 'angry')} onClick={() => setCurrentExpression('angry')}>
                  怒り <kbd>A</kbd>
                </button>
              </div>
              <p className="group-label">口パク</p>
              <div className="btn-row">
                {(['a', 'i', 'u', 'e', 'o'] as const).map((v) => (
                  <button key={v} type="button" className={chip(currentExpression === v)} onClick={() => setCurrentExpression(v)}>
                    {v.toUpperCase()}
                  </button>
                ))}
              </div>
              <p className="group-label">目</p>
              <div className="btn-row">
                <button type="button" className={chip(currentExpression === 'blink')} onClick={() => setCurrentExpression('blink')}>
                  両目閉じ
                </button>
                <button type="button" className={chip(currentExpression === 'blinkLeft')} onClick={() => setCurrentExpression('blinkLeft')}>
                  左ウインク
                </button>
                <button type="button" className={chip(currentExpression === 'blinkRight')} onClick={() => setCurrentExpression('blinkRight')}>
                  右ウインク
                </button>
              </div>
            </Section>

            {/* ------------------------------------------------ scene & background */}
            <Section
              id="scene"
              icon="🛋"
              title="シーン・背景"
              summary={`props ${sceneDebug.propLoaded}/${sceneDebug.propTotal}`}
              open={openSections.scene}
              onToggle={toggleSection}
            >
              <p className="muted small">
                {sceneDebug.label || sceneDebug.sceneId || sceneId}
                {sceneDebug.usedDefault && <span className="warn">（scene.json欠損 → 既定値）</span>}
                {' · '}placeholder {sceneDebug.placeholders} · missing {sceneDebug.propMissing}
              </p>
              <div className="btn-row">
                <button type="button" className={chip(propsEnabled)} onClick={() => setPropsEnabled(!propsEnabled)}>
                  小道具 {propsEnabled ? 'ON' : 'OFF'} <kbd>V</kbd>
                </button>
                <button type="button" className={chip(placeholdersEnabled)} onClick={() => setPlaceholdersEnabled(!placeholdersEnabled)}>
                  代替箱 {placeholdersEnabled ? 'ON' : 'OFF'} <kbd>C</kbd>
                </button>
                <button type="button" className="chip" onClick={reloadScene}>
                  再読込 <kbd>G</kbd>
                </button>
              </div>
              <div className="btn-row">
                <button type="button" className={chip(backgroundEnabled)} onClick={() => setBackgroundEnabled(!backgroundEnabled)}>
                  背景 {backgroundEnabled ? 'ON' : 'OFF'} <kbd>K</kbd>
                </button>
                <button type="button" className={chip(lightOverlayEnabled)} onClick={() => setLightOverlayEnabled(!lightOverlayEnabled)}>
                  光オーバーレイ {lightOverlayEnabled ? 'ON' : 'OFF'} <kbd>O</kbd>
                </button>
                <button type="button" className="chip" onClick={() => setBgFit(bgFit === 'cover' ? 'contain' : 'cover')}>
                  フィット: {bgFit}
                </button>
              </div>
              {sceneDebug.warnings.length > 0 && <p className="warn small">⚠ {sceneDebug.warnings.length} 件の警告 — コンソール参照</p>}
            </Section>

            {/* ------------------------------------------------ layout calibration */}
            <Section
              id="layout"
              icon="📐"
              title="レイアウト調整"
              summary={LAYOUT_TARGET_LABELS[selectedTarget]}
              open={openSections.layout}
              onToggle={toggleSection}
            >
              <div className="btn-row">
                {LAYOUT_TARGETS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={chip(selectedTarget === t)}
                    onClick={() => {
                      setSelectedTarget(t);
                      if (t === 'camera') setCameraMode('free');
                    }}
                  >
                    {LAYOUT_TARGET_LABELS[t]}
                  </button>
                ))}
                <button type="button" className={chip(guidesEnabled)} onClick={() => setGuidesEnabled(!guidesEnabled)}>
                  ガイド <kbd>T</kbd>
                </button>
              </div>

              {selectedTarget !== 'camera' && layout && (
                <div className="nudge-block">
                  <p className="muted small mono">
                    pos {fmtV(layout[selectedTarget].position)} · rot {fmtVdeg(layout[selectedTarget].rotation)}° · scale{' '}
                    {fmtV(layout[selectedTarget].scale)}
                  </p>
                  <div className="nudge-row">
                    <span className="nudge-label">移動</span>
                    <button type="button" className="chip" onClick={() => nudgeSelected('pos', 0, -POS_STEP)}>X−</button>
                    <button type="button" className="chip" onClick={() => nudgeSelected('pos', 0, POS_STEP)}>X+</button>
                    <button type="button" className="chip" onClick={() => nudgeSelected('pos', 1, POS_STEP)}>Y+</button>
                    <button type="button" className="chip" onClick={() => nudgeSelected('pos', 1, -POS_STEP)}>Y−</button>
                    <button type="button" className="chip" onClick={() => nudgeSelected('pos', 2, -POS_STEP)}>Z−</button>
                    <button type="button" className="chip" onClick={() => nudgeSelected('pos', 2, POS_STEP)}>Z+</button>
                  </div>
                  <div className="nudge-row">
                    <span className="nudge-label">回転</span>
                    <button type="button" className="chip" onClick={() => nudgeSelected('rot', 0, ROT_STEP)}>X+</button>
                    <button type="button" className="chip" onClick={() => nudgeSelected('rot', 0, -ROT_STEP)}>X−</button>
                    <button type="button" className="chip" onClick={() => nudgeSelected('rot', 1, ROT_STEP)}>Y+</button>
                    <button type="button" className="chip" onClick={() => nudgeSelected('rot', 1, -ROT_STEP)}>Y−</button>
                    <button type="button" className="chip" onClick={() => nudgeSelected('rot', 2, ROT_STEP)}>Z+</button>
                    <button type="button" className="chip" onClick={() => nudgeSelected('rot', 2, -ROT_STEP)}>Z−</button>
                  </div>
                  <div className="nudge-row">
                    <span className="nudge-label">拡縮</span>
                    <button type="button" className="chip" onClick={() => nudgeSelected('scale', 0, SCALE_FACTOR)}>＋</button>
                    <button type="button" className="chip" onClick={() => nudgeSelected('scale', 0, 1 / SCALE_FACTOR)}>−</button>
                  </div>
                </div>
              )}

              {selectedTarget === 'camera' && (
                <div className="nudge-block">
                  <p className="muted small mono">
                    pos {fmtV(cameraReadback.position)} · target {fmtV(cameraReadback.target)} · fov {r3(cameraReadback.fov)}
                  </p>
                  <p className="muted small">
                    {cameraMode === 'free' ? 'フリー: マウスでオービット、下でパン/ドリー。' : 'パン/ドリー操作でフリーに切り替わります。'}
                  </p>
                  <div className="nudge-row">
                    <span className="nudge-label">パン</span>
                    <button type="button" className="chip" onClick={() => nudgeCamera(-CAM_PAN_STEP, 0, 0, 0)}>X−</button>
                    <button type="button" className="chip" onClick={() => nudgeCamera(CAM_PAN_STEP, 0, 0, 0)}>X+</button>
                    <button type="button" className="chip" onClick={() => nudgeCamera(0, CAM_PAN_STEP, 0, 0)}>Y+</button>
                    <button type="button" className="chip" onClick={() => nudgeCamera(0, -CAM_PAN_STEP, 0, 0)}>Y−</button>
                    <button type="button" className="chip" onClick={() => nudgeCamera(0, 0, -CAM_PAN_STEP, 0)}>Z−</button>
                    <button type="button" className="chip" onClick={() => nudgeCamera(0, 0, CAM_PAN_STEP, 0)}>Z+</button>
                  </div>
                  <div className="nudge-row">
                    <span className="nudge-label">ドリー</span>
                    <button type="button" className="chip" onClick={() => nudgeCamera(0, 0, 0, CAM_DOLLY_STEP)}>近づく</button>
                    <button type="button" className="chip" onClick={() => nudgeCamera(0, 0, 0, -CAM_DOLLY_STEP)}>離れる</button>
                  </div>
                </div>
              )}

              <div className="btn-row">
                <button type="button" className="chip" onClick={exportLayout}>
                  scene.json 形式で Export <kbd>Ctrl+S</kbd>
                </button>
                {showExport && (
                  <button type="button" className="chip" onClick={() => setShowExport(false)}>
                    隠す
                  </button>
                )}
              </div>
              {showExport && <textarea className="export-area" readOnly value={exportText} onFocus={(e) => e.currentTarget.select()} />}
              <p className="muted small">[ ] 対象切替 · 矢印 x/z · PgUp/Dn y · Shift+矢印 回転 · +/− 拡縮</p>
            </Section>

            {/* ------------------------------------------------ display & perf */}
            <Section
              id="display"
              icon="⚙️"
              title="表示・負荷"
              summary={`SB:${springBoneMode} · ${fpsLimit ? '30fps' : '60fps+'}`}
              open={openSections.display}
              onToggle={toggleSection}
            >
              <div className="btn-row">
                <button type="button" className={chip(autoBlink)} onClick={() => setAutoBlink(!autoBlink)}>
                  自動まばたき {autoBlink ? 'ON' : 'OFF'} <kbd>B</kbd>
                </button>
                <button type="button" className={chip(lookAtEnabled)} onClick={() => setLookAtEnabled(!lookAtEnabled)}>
                  視線追従 {lookAtEnabled ? 'ON' : 'OFF'} <kbd>L</kbd>
                </button>
              </div>
              <div className="btn-row">
                <button
                  type="button"
                  className="chip"
                  onClick={() => {
                    const next = springBoneMode === 'normal' ? 'lightweight' : springBoneMode === 'lightweight' ? 'off' : 'normal';
                    setSpringBoneMode(next);
                  }}
                >
                  揺れ物: {springBoneMode} <kbd>M</kbd>
                </button>
                <button type="button" className={chip(!fpsLimit)} onClick={() => setFpsLimit(!fpsLimit)}>
                  FPS上限: {fpsLimit ? '30' : '60+'} <kbd>F</kbd>
                </button>
              </div>
            </Section>

            {/* ------------------------------------------------ debug detail */}
            <Section id="debug" icon="🔍" title="デバッグ詳細" summary={`${fps} fps`} open={openSections.debug} onToggle={toggleSection}>
              <p className="muted small mono">
                Idle: {IDLE_STATE_LABELS[idleDebug.from]} → {IDLE_STATE_LABELS[idleDebug.current]} ({(idleDebug.progress * 100).toFixed(0)}%)
                <br />
                crossfade {idleDebug.duration.toFixed(1)}s · blend {idleDebug.blendWeight.toFixed(2)} · dwell {idleDebug.dwell.toFixed(1)}s · auto{' '}
                {idleDebug.autoIdle ? 'ON' : 'OFF'}
                <br />
                Ext: {externalDebug.enabled ? 'ON' : 'OFF'} | {externalDebug.clipSource} {externalDebug.playing ? '▶' : '⏸'} | w{' '}
                {externalDebug.weight.toFixed(2)}
                {externalDebug.hasExpressionTracks && ' | expr-tracks ignored'}
                <br />
                Scene: {sceneDebug.sceneId} | props {sceneDebug.propLoaded}/{sceneDebug.propTotal} | ph {sceneDebug.placeholders} | miss{' '}
                {sceneDebug.propMissing}
                {sceneDebug.results.length > 0 && (
                  <>
                    <br />
                    {sceneDebug.results.map((r) => `${r.id}:${r.ok ? 'glb' : r.usedPlaceholder ? 'box' : 'none'}`).join('  ')}
                  </>
                )}
                <br />
                BG: {backgroundEnabled ? 'ON' : 'OFF'} | room {BG_STATUS_LABEL[bgDebug.room]} | outside {BG_STATUS_LABEL[bgDebug.outside]} | light{' '}
                {BG_STATUS_LABEL[bgDebug.light]} | fit {bgFit}
                <br />
                Cam: {fmtV(cameraReadback.position)} → {fmtV(cameraReadback.target)} fov {r3(cameraReadback.fov)}
              </p>
            </Section>

            <p className="panel-footer muted small">ショートカット: 1-3 カメラ · 4-8 アイドル · P 再生 · H パネル · Space アイドル合成</p>
          </div>
        )}

        <div className="statusbar">
          <span className="statusbar-text">{status}</span>
          <span className="statusbar-meta mono">
            {fps}fps · {externalDebug.clipSource} {externalDebug.playing ? '▶' : '⏸'}
          </span>
        </div>
      </div>
    </div>
  );
}

export default App;
