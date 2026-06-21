// Phase 1 Review Panel (?phase1Review=1) — DEV-ONLY visual-QA harness.
//
// The headless preview freezes rAF, so continuous-play QA can only be done in a
// real foreground browser (see MOTION_AUTHORING_GUIDE §7). This panel gives the
// master a clickable way to drive that QA without typing console commands: pick a
// mode loop, fire an Ambient/Transition and watch it SETTLE BACK INTO ITS LOOP
// (Stage 1, issue #1), run the Director, and toggle gaze / anchor debug markers.
//
// It is a self-contained floating DOM overlay that only calls window.__motionLab
// — it adds NO React state and is installed ONLY when ?phase1Review=1, so it can
// never pollute the production wallpaper. Press "P" to hide/show.

import type { MotionLab } from './motionLab';

const MODES = ['work_normal', 'work_sleepy', 'video_relax', 'sleep_desk'] as const;
const AMBIENTS = [
  'amb_work_screen_scan', 'amb_work_posture_reset', 'amb_work_neck_roll', 'amb_work_sip',
  'amb_slpy_head_bob', 'amb_slpy_slow_blink', 'amb_slpy_tilt_drift',
  'amb_vid_chuckle', 'amb_vid_nod_watch', 'amb_vid_eyes_widen',
  'amb_slp_head_shift', 'amb_slp_dream_smile',
];
const TRANSITIONS = [
  'tr_lean_back', 'tr_lean_forward', 'tr_sit_to_slump', 'tr_slump_wake',
  'tr_stand_to_sit', 'tr_sit_to_stand', 'tr_walk_start', 'loop_walk', 'tr_walk_stop',
];

export function installReviewPanel(lab: MotionLab): void {
  if (document.getElementById('phase1-review-panel')) return;

  const css = `
  #phase1-review-panel{position:fixed;top:12px;right:12px;width:280px;max-height:92vh;overflow:auto;
    z-index:99999;background:rgba(20,22,28,.92);color:#e8e8ee;font:12px/1.45 system-ui,sans-serif;
    border:1px solid #3a3f4b;border-radius:10px;padding:10px 12px;box-shadow:0 6px 24px rgba(0,0,0,.5)}
  #phase1-review-panel h4{margin:8px 0 4px;font-size:11px;letter-spacing:.04em;color:#9fb3ff;text-transform:uppercase}
  #phase1-review-panel .row{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:2px}
  #phase1-review-panel button{background:#2b3140;cursor:pointer;color:#e8e8ee;
    border:1px solid #444b5a;border-radius:6px;padding:4px 7px;font-size:11px}
  #phase1-review-panel button:hover{background:#39414f}
  #phase1-review-panel button.go{background:#34507a;border-color:#4a6ea8}
  #phase1-review-panel select{width:100%;background:#222734;color:#e8e8ee;border:1px solid #444b5a;border-radius:6px;padding:3px}
  #phase1-review-panel label{display:flex;align-items:center;gap:5px;margin:2px 0}
  #phase1-review-panel .status{font-size:11px;color:#9be6a0;background:#1a2420;border-radius:6px;padding:4px 6px;margin-top:6px;white-space:pre-wrap}
  #phase1-review-panel .hint{color:#8b93a3;font-size:10px;margin-top:6px}`;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.id = 'phase1-review-panel';
  panel.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center">
      <strong style="font-size:13px">きりたん Phase 1 Review</strong>
      <span style="color:#8b93a3;font-size:10px">[P]隠す</span></div>`;
  document.body.appendChild(panel);

  const status = document.createElement('div');
  status.className = 'status';
  status.textContent = 'ready';

  const setStatus = (s: string) => { status.textContent = s; };
  const guard = async (label: string, fn: () => Promise<unknown> | unknown) => {
    try { const r = await fn(); setStatus(`${label}\n${JSON.stringify(r).slice(0, 160)}`); }
    catch (e) { setStatus(`${label} ERROR: ${e instanceof Error ? e.message : String(e)}`); }
  };
  const playId = (id: string, settle: boolean) => guard(`play ${id}${settle ? ' →loop' : ''}`, async () => {
    const ld = await lab.load(id);
    if (!(ld as { ok: boolean }).ok) return ld;
    return lab.play(id, { settleToContextLoop: settle });
  });

  const section = (title: string) => { const h = document.createElement('h4'); h.textContent = title; panel.appendChild(h); };
  const rowOf = (els: HTMLElement[]) => { const r = document.createElement('div'); r.className = 'row'; els.forEach((e) => r.appendChild(e)); panel.appendChild(r); return r; };
  const btn = (text: string, on: () => void, cls = '') => { const b = document.createElement('button'); b.textContent = text; if (cls) b.className = cls; b.onclick = on; return b; };
  const selectOf = (ids: string[]) => { const s = document.createElement('select'); ids.forEach((id) => { const o = document.createElement('option'); o.value = id; o.textContent = id; s.appendChild(o); }); return s; };

  // Modes — play the base loop, or start the Director from this mode.
  section('モード Loop（10秒見る）');
  rowOf(MODES.map((m) => btn(m.replace('work_', 'w_').replace('video_', 'v_').replace('sleep_', 'sl_'), () => playId('loop_' + m, false))));

  // Ambients — fire one and confirm it settles back into its mode loop (issue #1).
  section('Ambient（終了後Loopへ復帰を確認）');
  const ambSel = selectOf(AMBIENTS);
  panel.appendChild(ambSel);
  rowOf([btn('▶ 再生 →Loop復帰', () => playId(ambSel.value, true), 'go'), btn('単体(復帰なし)', () => playId(ambSel.value, false))]);

  // Transitions — same, settle into the target loop.
  section('Transition（遷移先Loopへ）');
  const trSel = selectOf(TRANSITIONS);
  panel.appendChild(trSel);
  rowOf([btn('▶ 再生 →Loop復帰', () => playId(trSel.value, true), 'go'), btn('単体', () => playId(trSel.value, false))]);

  // Director — self-running.
  section('Director（自走）');
  const dirSel = selectOf([...MODES]);
  panel.appendChild(dirSel);
  rowOf([
    btn('▶ 開始', () => guard('director start', () => lab.director(true, { initialMode: dirSel.value as never })), 'go'),
    btn('■ 停止', () => guard('director stop', () => lab.director(false))),
    btn('停止/idle', () => guard('stop', () => lab.stop())),
  ]);

  // Debug overlays.
  section('デバッグ表示');
  const gaze = document.createElement('input'); gaze.type = 'checkbox';
  const gazeLbl = document.createElement('label'); gazeLbl.append(gaze, document.createTextNode(' 視線マーカー (gaze)'));
  gaze.onchange = () => guard('gazeDebug', () => lab.gazeDebug(gaze.checked));
  const anch = document.createElement('input'); anch.type = 'checkbox';
  const anchLbl = document.createElement('label'); anchLbl.append(anch, document.createTextNode(' propアンカー/手 位置'));
  anch.onchange = () => guard('anchorDebug', () => lab.anchorDebug(anch.checked));
  panel.appendChild(gazeLbl); panel.appendChild(anchLbl);

  panel.appendChild(status);
  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = '離席(away)はDirector稼働中に自動で発生します。視線が動くかは「視線マーカー」を出して各Ambientを再生して確認。';
  panel.appendChild(hint);

  // Live Director status line.
  setInterval(() => {
    const lab2 = window.__motionLab as unknown as { directorStatus?: () => { running?: boolean; mode?: string; state?: string; ambientCount?: number } };
    const s = lab2?.directorStatus?.();
    if (s && s.running !== false && s.mode) {
      status.textContent = `Director: ${s.mode} / ${s.state} (ambients ${s.ambientCount ?? 0})`;
    }
  }, 1000);

  // Hide/show with P.
  window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  });

  // eslint-disable-next-line no-console
  console.log('[REVIEW] Phase 1 review panel installed (?phase1Review=1). Press P to hide.');
}
