// Pose Composer 0.8 — DOM panel (Stage 2)
//
// A self-contained floating DOM overlay (the reviewPanel.ts pattern: no React
// state, drives only window.__poseComposer) installed with ?poseEdit=1. It is
// dev-only and can never reach the production wallpaper.
//
// Stage 2 surface: Begin/End session, mode selector, a Front/Side SVG body map
// for bone selection (synced to the 3D highlight overlay), and a numeric
// inspector (XYZ degrees) with Reset selected / Reset all + a dirty indicator.
// Gizmo, drag pad, asset save and Undo/Redo arrive in later stages. Press "H"
// to hide/show (only while a pose session is the focus — see the listener note).

import type { PoseComposer } from './poseComposer';
import { BONE_MAP_NODES, BONE_MAP_BY_NAME, BONE_MAP_VIEWBOX, boneLabel } from './boneMapDefinition';

const SVGNS = 'http://www.w3.org/2000/svg';
type View = 'front' | 'side';

export function installPoseComposerPanel(pc: PoseComposer): void {
  if (document.getElementById('pose-composer-panel')) return;

  // React StrictMode (and HMR) re-mount VrmViewer, which installs a NEW
  // PoseComposer as window.__poseComposer while THIS panel's DOM (installed by
  // the first mount) survives the install guard. So always drive the LIVE
  // instance — the one the viewer's freeze gate actually checks — not the `pc`
  // captured at install (which may be the orphaned first-mount instance).
  const PC = (): PoseComposer => window.__poseComposer ?? pc;

  const css = `
  #pose-composer-panel{position:fixed;top:12px;left:12px;width:300px;max-height:94vh;overflow:auto;
    z-index:99998;background:rgba(20,22,28,.94);color:#e8e8ee;font:12px/1.45 system-ui,sans-serif;
    border:1px solid #3a3f4b;border-radius:10px;padding:10px 12px;box-shadow:0 6px 24px rgba(0,0,0,.5)}
  #pose-composer-panel h4{margin:9px 0 4px;font-size:11px;letter-spacing:.04em;color:#9fb3ff;text-transform:uppercase}
  #pose-composer-panel .row{display:flex;flex-wrap:wrap;gap:5px;align-items:center;margin-bottom:3px}
  #pose-composer-panel button{background:#2b3140;cursor:pointer;color:#e8e8ee;border:1px solid #444b5a;
    border-radius:6px;padding:4px 8px;font-size:11px}
  #pose-composer-panel button:hover{background:#39414f}
  #pose-composer-panel button:disabled{opacity:.4;cursor:not-allowed}
  #pose-composer-panel button.go{background:#34507a;border-color:#4a6ea8}
  #pose-composer-panel button.warn{background:#5a3030;border-color:#8a4a4a}
  #pose-composer-panel select,#pose-composer-panel input[type=number]{background:#222734;color:#e8e8ee;
    border:1px solid #444b5a;border-radius:6px;padding:3px 5px;font-size:12px}
  #pose-composer-panel input[type=number]{width:66px}
  #pose-composer-panel .pill{font-size:10px;padding:2px 6px;border-radius:10px;background:#2b3140;color:#8b93a3}
  #pose-composer-panel .pill.on{background:#234a2a;color:#9be6a0}
  #pose-composer-panel .pill.dirty{background:#4a3a23;color:#e6c79b}
  #pose-composer-panel .map-wrap{background:#15171d;border-radius:8px;padding:4px;margin:4px 0}
  #pose-composer-panel svg{display:block;width:100%;height:auto;touch-action:none}
  #pose-composer-panel .bone{cursor:pointer}
  #pose-composer-panel .insp{display:grid;grid-template-columns:auto 1fr;gap:4px 6px;align-items:center;margin-top:2px}
  #pose-composer-panel .axisrow{display:flex;gap:6px;align-items:center}
  #pose-composer-panel .status{font-size:11px;color:#9be6a0;background:#1a2420;border-radius:6px;padding:4px 6px;margin-top:7px;white-space:pre-wrap}
  #pose-composer-panel .hint{color:#8b93a3;font-size:10px;margin-top:6px}
  #pose-composer-panel .selname{color:#cfe0ff;font-weight:600}`;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.id = 'pose-composer-panel';
  document.body.appendChild(panel);

  // --- state -----------------------------------------------------------------
  let view: View = 'front';
  let selected: string | null = null;
  const circleByBone = new Map<string, SVGCircleElement>();

  // --- helpers ---------------------------------------------------------------
  const el = (tag: string, props: Record<string, unknown> = {}, ...kids: (Node | string)[]) => {
    const e = document.createElement(tag);
    Object.assign(e, props);
    for (const k of kids) e.append(k);
    return e;
  };
  const section = (title: string) => { const h = document.createElement('h4'); h.textContent = title; panel.appendChild(h); return h; };
  const setStatus = (s: string) => { statusEl.textContent = s; };
  const guard = (label: string, r: unknown): unknown => {
    const ok = (r as { ok?: boolean })?.ok;
    if (ok === false) setStatus(`${label}: ${(r as { error?: string }).error ?? 'failed'}`);
    return r;
  };

  // --- header ----------------------------------------------------------------
  panel.appendChild(el('div', { style: 'display:flex;justify-content:space-between;align-items:center' },
    el('strong', { style: 'font-size:13px', textContent: 'きりたん Pose Composer' }),
    el('span', { style: 'color:#8b93a3;font-size:10px', textContent: '[H]隠す' }),
  ));

  // --- session row -----------------------------------------------------------
  const activePill = el('span', { className: 'pill', textContent: 'inactive' }) as HTMLSpanElement;
  const dirtyPill = el('span', { className: 'pill', textContent: 'clean' }) as HTMLSpanElement;
  const beginBtn = el('button', { className: 'go', textContent: '▶ Begin' }) as HTMLButtonElement;
  const endBtn = el('button', { textContent: '■ End' }) as HTMLButtonElement;
  beginBtn.onclick = () => { guard('begin', PC().begin({ mode: modeSel.value as never })); refresh(); };
  endBtn.onclick = () => {
    const st = PC().status() as { dirty?: boolean };
    const r = PC().end(st.dirty ? { discard: true } : undefined);
    guard('end', r); refresh();
  };
  const modeSel = el('select') as HTMLSelectElement;
  for (const m of ['basePose', 'keyPose', 'handPose']) modeSel.appendChild(el('option', { value: m, textContent: m }));
  modeSel.onchange = () => { if ((PC().status() as { active?: boolean }).active) guard('setMode', PC().setMode(modeSel.value as never)); };
  const sessionRow = el('div', { className: 'row' }, beginBtn, endBtn, modeSel, activePill, dirtyPill);
  panel.appendChild(sessionRow);

  // --- bone map --------------------------------------------------------------
  section('ボーン選択');
  const viewRow = el('div', { className: 'row' }) as HTMLDivElement;
  const frontBtn = el('button', { textContent: 'Front' }) as HTMLButtonElement;
  const sideBtn = el('button', { textContent: 'Side' }) as HTMLButtonElement;
  frontBtn.onclick = () => { view = 'front'; layoutMap(); updateViewButtons(); };
  sideBtn.onclick = () => { view = 'side'; layoutMap(); updateViewButtons(); };
  viewRow.append(frontBtn, sideBtn);
  panel.appendChild(viewRow);
  const updateViewButtons = () => {
    frontBtn.className = view === 'front' ? 'go' : '';
    sideBtn.className = view === 'side' ? 'go' : '';
  };

  const mapWrap = el('div', { className: 'map-wrap' }) as HTMLDivElement;
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${BONE_MAP_VIEWBOX.w} ${BONE_MAP_VIEWBOX.h}`);
  const linesG = document.createElementNS(SVGNS, 'g');
  const dotsG = document.createElementNS(SVGNS, 'g');
  svg.append(linesG, dotsG);
  mapWrap.appendChild(svg);
  panel.appendChild(mapWrap);

  // Build line + circle elements once; positions are (re)assigned by layoutMap.
  const lineByBone = new Map<string, SVGLineElement>();
  for (const node of BONE_MAP_NODES) {
    if (node.parent && BONE_MAP_BY_NAME[node.parent]) {
      const ln = document.createElementNS(SVGNS, 'line');
      ln.setAttribute('stroke', '#444b5a');
      ln.setAttribute('stroke-width', '1.4');
      linesG.appendChild(ln);
      lineByBone.set(node.bone, ln);
    }
  }
  for (const node of BONE_MAP_NODES) {
    const c = document.createElementNS(SVGNS, 'circle');
    c.setAttribute('r', '3.6');
    c.setAttribute('class', 'bone');
    c.dataset.bone = node.bone;
    const title = document.createElementNS(SVGNS, 'title');
    title.textContent = `${node.label} (${node.bone})`;
    c.appendChild(title);
    c.addEventListener('click', () => onPickBone(node.bone));
    dotsG.appendChild(c);
    circleByBone.set(node.bone, c);
  }

  const layoutMap = () => {
    for (const node of BONE_MAP_NODES) {
      const p = node[view];
      const c = circleByBone.get(node.bone)!;
      c.setAttribute('cx', String(p.x));
      c.setAttribute('cy', String(p.y));
      const ln = lineByBone.get(node.bone);
      if (ln && node.parent) {
        const pp = BONE_MAP_BY_NAME[node.parent][view];
        ln.setAttribute('x1', String(p.x)); ln.setAttribute('y1', String(p.y));
        ln.setAttribute('x2', String(pp.x)); ln.setAttribute('y2', String(pp.y));
      }
    }
  };

  // --- inspector -------------------------------------------------------------
  section('選択ボーン');
  const selName = el('div', {}, el('span', { className: 'selname', textContent: '（未選択）' })) as HTMLDivElement;
  panel.appendChild(selName);
  const axisInputs: Record<'x' | 'y' | 'z', HTMLInputElement> = {
    x: el('input', { type: 'number', step: '1' }) as HTMLInputElement,
    y: el('input', { type: 'number', step: '1' }) as HTMLInputElement,
    z: el('input', { type: 'number', step: '1' }) as HTMLInputElement,
  };
  const inspGrid = el('div', { className: 'insp' }) as HTMLDivElement;
  for (const ax of ['x', 'y', 'z'] as const) {
    inspGrid.append(el('span', { textContent: `${ax.toUpperCase()}°` }), axisInputs[ax]);
    axisInputs[ax].addEventListener('input', applyInspector);
    // One committed numeric edit (focus → blur / Enter) = one undo entry: open a
    // command group on focus, fold every keystroke into it, close it on blur.
    axisInputs[ax].addEventListener('focus', () => { if (selected) PC().beginCommandGroup(); });
    axisInputs[ax].addEventListener('blur', () => { PC().endCommandGroup(); refresh(); });
    axisInputs[ax].addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { PC().endCommandGroup(); (e.target as HTMLInputElement).blur(); }
    });
  }
  panel.appendChild(inspGrid);
  const resetBoneBtn = el('button', { textContent: 'このボーンをReset' }) as HTMLButtonElement;
  const resetAllBtn = el('button', { className: 'warn', textContent: '全Reset' }) as HTMLButtonElement;
  resetBoneBtn.onclick = () => { if (selected) { guard('resetBone', PC().resetBone(selected)); loadInspector(selected); refresh(); } };
  resetAllBtn.onclick = () => { guard('resetAll', PC().resetAll()); if (selected) loadInspector(selected); refresh(); };
  panel.appendChild(el('div', { className: 'row' }, resetBoneBtn, resetAllBtn));

  // --- gizmo + undo/redo (Stage 3) -------------------------------------------
  section('編集ツール');
  const gizmoBtn = el('button', { textContent: '⊹ ギズモ' }) as HTMLButtonElement;
  const gizmoRotBtn = el('button', { textContent: '回転' }) as HTMLButtonElement;
  const gizmoTransBtn = el('button', { textContent: '移動(hips)' }) as HTMLButtonElement;
  gizmoBtn.onclick = () => { guard('gizmo', PC().enableGizmo(!(PC().status() as { gizmo?: boolean }).gizmo)); refresh(); };
  gizmoRotBtn.onclick = () => { guard('gizmoMode', PC().setGizmoMode('rotate')); refresh(); };
  gizmoTransBtn.onclick = () => { guard('gizmoMode', PC().setGizmoMode('translate')); refresh(); };
  panel.appendChild(el('div', { className: 'row' }, gizmoBtn, gizmoRotBtn, gizmoTransBtn));
  const undoBtn = el('button', { textContent: '↩ Undo' }) as HTMLButtonElement;
  const redoBtn = el('button', { textContent: '↪ Redo' }) as HTMLButtonElement;
  undoBtn.onclick = () => { guard('undo', PC().undo()); syncAfterHistory(); };
  redoBtn.onclick = () => { guard('redo', PC().redo()); syncAfterHistory(); };
  panel.appendChild(el('div', { className: 'row' }, undoBtn, redoBtn));

  function syncAfterHistory() {
    if (selected) loadInspector(selected);
    refresh();
  }

  // --- status / hint ---------------------------------------------------------
  const statusEl = el('div', { className: 'status', textContent: 'Begin で編集開始 → 人型でボーンを選び XYZ° を入力' }) as HTMLDivElement;
  panel.appendChild(statusEl);
  panel.appendChild(el('div', { className: 'hint', textContent: '基準姿勢からのローカルoffset（度）。ギズモをドラッグで回転／マウスでカメラ周回。Ctrl+Z / Ctrl+Shift+Z でUndo/Redo。保存は次段。' }));

  // --- behavior --------------------------------------------------------------
  function onPickBone(bone: string) {
    if (!(PC().status() as { active?: boolean }).active) { setStatus('まず Begin を押してください'); return; }
    if (!BONE_MAP_BY_NAME[bone]) return;
    const r = PC().selectBone(bone) as { ok: boolean; present?: boolean; error?: string };
    if (!r.ok) { setStatus(r.error ?? 'select failed'); return; }
    selected = bone;
    loadInspector(bone);
    refresh();
  }

  function loadInspector(bone: string) {
    const info = PC().inspectBone(bone) as { ok: boolean; present?: boolean; offsetEulerDeg?: [number, number, number] };
    selName.firstChild!.textContent = `${boneLabel(bone)} (${bone})${info.present === false ? ' — モデルに無し' : ''}`;
    const e = info.offsetEulerDeg ?? [0, 0, 0];
    axisInputs.x.value = String(e[0]); axisInputs.y.value = String(e[1]); axisInputs.z.value = String(e[2]);
    const disabled = info.present === false;
    for (const ax of ['x', 'y', 'z'] as const) axisInputs[ax].disabled = disabled;
  }

  function applyInspector() {
    if (!selected) return;
    const v = (ax: 'x' | 'y' | 'z') => parseFloat(axisInputs[ax].value);
    const x = v('x'), y = v('y'), z = v('z');
    if (![x, y, z].every(Number.isFinite)) return; // mid-edit (e.g. "-") — wait
    guard('setBone', PC().setBoneOffsetEuler(selected, [x, y, z], { degrees: true }));
    paintDots();
    refreshDirty();
  }

  function paintDots() {
    const states = PC().boneStates();
    for (const [bone, c] of circleByBone) {
      const st = states[bone] ?? { present: false, edited: false };
      let fill = '#2b3140', stroke = '#6b7689', sw = '1', op = '1', pointer = 'auto';
      if (!st.present) { fill = '#1a1d24'; stroke = '#333a45'; op = '.45'; pointer = 'none'; }
      else if (st.edited) { fill = '#e0a23a'; stroke = '#f0c070'; }
      if (bone === selected) { stroke = '#3aa0ff'; sw = '2'; c.setAttribute('r', '4.6'); } else { c.setAttribute('r', '3.6'); }
      c.setAttribute('fill', fill);
      c.setAttribute('stroke', stroke);
      c.setAttribute('stroke-width', sw);
      c.setAttribute('opacity', op);
      c.style.pointerEvents = pointer;
    }
  }

  function refreshDirty() {
    const st = PC().status() as { dirty?: boolean; active?: boolean };
    dirtyPill.textContent = st.dirty ? 'dirty' : 'clean';
    dirtyPill.className = 'pill' + (st.dirty ? ' dirty' : '');
  }

  function refresh() {
    const st = PC().status() as {
      active?: boolean; selectedBone?: string | null; vrmLoaded?: boolean;
      gizmo?: boolean; gizmoMode?: 'rotate' | 'translate'; canUndo?: boolean; canRedo?: boolean;
    };
    activePill.textContent = st.active ? 'active' : 'inactive';
    activePill.className = 'pill' + (st.active ? ' on' : '');
    // Begin is enabled whenever inactive; begin() itself reports gracefully if the
    // VRM isn't ready yet (never-throw), so we don't gate on a polled vrmLoaded.
    beginBtn.disabled = !!st.active;
    endBtn.disabled = !st.active;
    modeSel.disabled = !st.active;
    // Keep local selection in sync with the composer (API-driven changes too).
    if (st.active && st.selectedBone && st.selectedBone !== selected) { selected = st.selectedBone; loadInspector(selected); }
    if (!st.active) { selected = null; selName.firstChild!.textContent = '（未選択）'; for (const ax of ['x','y','z'] as const){ axisInputs[ax].value=''; axisInputs[ax].disabled = true; } }
    resetBoneBtn.disabled = !st.active || !selected;
    resetAllBtn.disabled = !st.active;
    // gizmo + history controls
    const gz = st.gizmo === true;
    gizmoBtn.disabled = !st.active;
    gizmoBtn.className = st.active && gz ? 'go' : '';
    gizmoRotBtn.disabled = !st.active || !gz;
    gizmoRotBtn.className = gz && st.gizmoMode === 'rotate' ? 'go' : '';
    gizmoTransBtn.disabled = !st.active || !gz || st.selectedBone !== 'hips';
    gizmoTransBtn.className = gz && st.gizmoMode === 'translate' ? 'go' : '';
    undoBtn.disabled = !st.active || !st.canUndo;
    redoBtn.disabled = !st.active || !st.canRedo;
    paintDots();
    refreshDirty();
  }

  // Hide/show with H (only acts on this panel; does not stop other H handlers).
  window.addEventListener('keydown', (e) => {
    if ((e.key === 'h' || e.key === 'H') && (e.target as HTMLElement)?.tagName !== 'INPUT') {
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    }
  });

  // Undo/redo: Ctrl/⌘+Z and Ctrl/⌘+Shift+Z (or Ctrl+Y). Capture phase + a pose-
  // active guard so it only fires while authoring, and stopPropagation so the
  // App's own window shortcuts never also see it (§17 collision isolation). Text
  // inputs keep their native undo (skip when focus is in a field).
  window.addEventListener('keydown', (e) => {
    if (!(PC().status() as { active?: boolean }).active) return;
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) {
      e.preventDefault(); e.stopPropagation();
      guard('undo', PC().undo()); syncAfterHistory();
    } else if ((k === 'z' && e.shiftKey) || k === 'y') {
      e.preventDefault(); e.stopPropagation();
      guard('redo', PC().redo()); syncAfterHistory();
    }
  }, true);

  // Light poll so external (console) begin/end/edits reflect in the panel.
  setInterval(refresh, 1000);

  layoutMap();
  updateViewButtons();
  refresh();
  // eslint-disable-next-line no-console
  console.log('[POSE] Pose Composer panel installed (?poseEdit=1). Press H to hide.');
}
