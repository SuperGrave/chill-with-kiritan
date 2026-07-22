import './style.css';
import { AudioInputEngine, type InputFrame } from './audioEngine';
import {
  BpmComparisonAnalyzer,
  DETECTOR_DEFINITIONS,
  DETECTOR_IDS,
  type AnalysisFrame,
  type DetectorId,
  type DetectorEstimate,
} from './algorithms';

interface HistoryPoint {
  at: number;
  values: Record<DetectorId, number | null>;
}

interface ComparisonRecord {
  source: string;
  expected: number;
  recordedAt: string;
  values: Record<DetectorId, number | null>;
  support: number;
}

const app = document.querySelector<HTMLDivElement>('#app');
if (app === null) throw new Error('#app not found');

app.innerHTML = `
  <header class="hero">
    <div>
      <p class="eyebrow">KIRITAN AUDIO RESEARCH / STANDALONE</p>
      <h1>BPM COMPARISON LAB</h1>
      <p class="lead">同じ音を帯域8方式＋PCM 2方式へ同時入力し、安定までの速さ・倍テンポ・取りこぼしをまとめて比較します。</p>
    </div>
    <div class="live-badge" id="liveBadge"><span></span><b>STOPPED</b></div>
  </header>

  <main>
    <section class="panel source-panel">
      <div class="section-title"><span>01</span><div><h2>音源</h2><p id="sourceStatus">停止中</p></div></div>
      <div class="source-grid">
        <label class="source-button file-button">
          <input id="fileInput" type="file" accept="audio/*" />
          <b>音声ファイル</b><small>選択 / ドロップ</small>
        </label>
        <button class="source-button" id="systemButton"><b>PC音声</b><small>画面共有の音声</small></button>
        <button class="source-button" id="micButton"><b>マイク</b><small>外部入力</small></button>
        <button class="source-button stop" id="stopButton"><b>停止</b><small>入力を解放</small></button>
      </div>
      <div class="synthetic-row">
        <span>合成テスト</span>
        <button data-synthetic="88">88 BPM</button>
        <button data-synthetic="120">120 BPM</button>
        <button data-synthetic="174">174 BPM</button>
        <button data-synthetic="120" data-mode="bass-light">120 BPM / 低音なし</button>
      </div>
      <div id="dropZone" class="drop-zone">音声ファイルをここへドロップ</div>
      <div id="audioSlot" class="audio-slot"></div>
      <p class="capture-note">PC音声では共有画面の選択時に「音声を共有」をONにしてください。Spotifyなど保護された音源は環境によって共有できない場合があります。</p>
    </section>

    <section class="panel monitor-panel">
      <div class="section-title"><span>02</span><div><h2>同時推定</h2><p>生の推定値と信頼度を比較</p></div></div>
      <div class="detector-grid">
        ${DETECTOR_DEFINITIONS.map((definition) => detectorCard(
          definition.id,
          definition.label,
          definition.subtitle,
          definition.family,
        )).join('')}
      </div>
      <div class="signal-row">
        <div><span>BASS ENERGY</span><i><b id="bassMeter"></b></i></div>
        <div><span>SUPERFLUX NOVELTY</span><i><b id="fluxMeter"></b></i></div>
      </div>
      <canvas id="timeline" aria-label="BPM timeline"></canvas>
      <div class="legend">${DETECTOR_DEFINITIONS.map((definition) => `<span class="${definition.id}">${definition.shortLabel}</span>`).join('')}</div>
    </section>

    <section class="panel settings-panel">
      <div class="section-title"><span>03</span><div><h2>判定条件</h2><p>変更すると検出履歴をリセット</p></div></div>
      <div class="settings-grid">
        <label>最低BPM<input id="minBpm" type="number" min="30" max="120" value="50" /></label>
        <label>最高BPM<input id="maxBpm" type="number" min="120" max="300" value="220" /></label>
        <label>安定ロック秒<input id="stableSeconds" type="number" min="1" max="12" step="0.5" value="5" /></label>
      </div>
    </section>

    <section class="panel record-panel">
      <div class="section-title"><span>04</span><div><h2>曲ごとの比較記録</h2><p>正解BPMを入れてスナップショット保存</p></div></div>
      <div class="record-controls">
        <label>曲名<input id="recordName" type="text" placeholder="ファイル名・曲名" /></label>
        <label>正解BPM<input id="expectedBpm" type="number" min="30" max="300" placeholder="120" /></label>
        <button id="recordButton">現在値を記録</button>
        <button id="exportButton" class="secondary">CSV出力</button>
        <button id="clearButton" class="secondary">消去</button>
      </div>
      <div class="table-wrap">
        <table><thead><tr><th>曲</th><th>正解</th>${DETECTOR_DEFINITIONS.map((definition) => `<th>${definition.shortLabel}</th>`).join('')}<th>票</th></tr></thead><tbody id="recordRows"><tr class="empty"><td colspan="${DETECTOR_IDS.length + 3}">まだ記録がありません</td></tr></tbody></table>
      </div>
    </section>

    <section class="panel method-panel">
      <div class="section-title"><span>05</span><div><h2>方式の範囲</h2><p>この128帯域プレビューだけで比較できるもの</p></div></div>
      <div class="method-grid">
        <article><b>今回動かす 10方式</b><p>帯域値だけで動く8方式に、AudioWorkletのリアルタイムPCM方式とBeatRoot系ローリング波形解析を追加しました。</p></article>
        <article><b>PCM方式の入力</b><p>音声ファイル・PC音声・マイク・合成テストのすべてを同じWeb Audioグラフへ通し、波形を外部へ送信せずブラウザ内で解析します。</p></article>
        <article class="unavailable"><b>AIモデルは保留</b><p>TempoCNNは非商用継承モデル、BeatNetはWindowsでPython・PyTorch等が必要です。配布負担とライセンスが軽い2方式を先に実測します。</p></article>
      </div>
    </section>
  </main>
`;

function detectorCard(id: string, title: string, subtitle: string, family: string): string {
  return `<article class="detector-card ${family}" id="card-${id}">
    <div class="card-heading"><span>${title}</span><em id="status-${id}">STANDBY</em></div>
    <div class="bpm"><strong id="bpm-${id}">---</strong><small>BPM</small></div>
    <p>${subtitle}</p><div class="confidence"><i><b id="confidence-${id}"></b></i><span id="confidenceText-${id}">0%</span></div>
    <small class="detail" id="detail-${id}">入力待ち</small>
  </article>`;
}

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`#${id} not found`);
  return found as T;
}

const history: HistoryPoint[] = [];
const records: ComparisonRecord[] = [];
let analyzer = createAnalyzer();
let latest: AnalysisFrame | null = null;
let latestSource = '';
let lastHistoryAt = 0;
let errorTimer: number | null = null;

function createAnalyzer(): BpmComparisonAnalyzer {
  const min = Number((document.getElementById('minBpm') as HTMLInputElement | null)?.value ?? 50);
  const max = Number((document.getElementById('maxBpm') as HTMLInputElement | null)?.value ?? 220);
  const stable = Number((document.getElementById('stableSeconds') as HTMLInputElement | null)?.value ?? 5);
  return new BpmComparisonAnalyzer({ minBpm: min, maxBpm: max, stableMs: stable * 1000 });
}

const engine = new AudioInputEngine(
  handleInputFrame,
  (message, active) => {
    element('sourceStatus').textContent = message;
    const badge = element('liveBadge');
    badge.classList.toggle('active', active);
    badge.querySelector('b')!.textContent = active ? 'ANALYZING' : 'STOPPED';
  },
  (estimate) => analyzer.updatePcmEstimate(
    estimate.id, estimate.bpm, estimate.confidence, estimate.at, estimate.detail,
  ),
);

function handleInputFrame(input: InputFrame): void {
  latestSource = input.sourceLabel;
  latest = analyzer.process(input.bands, input.at);
  if (input.at - lastHistoryAt >= 180) {
    history.push({
      at: input.at,
      values: Object.fromEntries(DETECTOR_IDS.map((id) => [id, shownBpm(latest!.estimates[id])])) as Record<DetectorId, number | null>,
    });
    while (history.length > 320) history.shift();
    lastHistoryAt = input.at;
  }
  DETECTOR_IDS.forEach((id) => renderEstimate(latest!.estimates[id]));
  element<HTMLDivElement>('bassMeter').style.width = `${Math.min(100, latest.bassEnergy * 120)}%`;
  element<HTMLDivElement>('fluxMeter').style.width = `${Math.min(100, latest.superFluxStrength * 1100)}%`;
  drawTimeline();
}

function renderEstimate(estimate: DetectorEstimate): void {
  const shown = estimate.lockedBpm ?? estimate.bpm;
  element(`bpm-${estimate.id}`).textContent = shown === null ? '---' : Math.round(shown).toString();
  element(`status-${estimate.id}`).textContent = estimate.status.toUpperCase();
  element(`status-${estimate.id}`).className = estimate.status;
  element(`confidence-${estimate.id}`).style.width = `${Math.round(estimate.confidence * 100)}%`;
  element(`confidenceText-${estimate.id}`).textContent = `${Math.round(estimate.confidence * 100)}%`;
  element(`detail-${estimate.id}`).textContent = estimate.detail;
  const card = element(`card-${estimate.id}`);
  card.classList.toggle('locked', estimate.status === 'locked');
  if (estimate.onset) {
    card.classList.remove('onset');
    void card.offsetWidth;
    card.classList.add('onset');
  }
}

function drawTimeline(): void {
  const canvas = element<HTMLCanvasElement>('timeline');
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(300, Math.round(rect.width));
  const height = Math.max(190, Math.round(rect.height));
  if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
    canvas.width = width * dpr;
    canvas.height = height * dpr;
  }
  const context = canvas.getContext('2d');
  if (context === null) return;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  const min = Number(element<HTMLInputElement>('minBpm').value);
  const max = Number(element<HTMLInputElement>('maxBpm').value);
  context.strokeStyle = 'rgba(165, 199, 222, 0.12)';
  context.fillStyle = 'rgba(187, 210, 226, 0.48)';
  context.font = '10px ui-monospace, monospace';
  for (let bpm = Math.ceil(min / 20) * 20; bpm <= max; bpm += 20) {
    const y = height - ((bpm - min) / (max - min)) * (height - 24) - 12;
    context.beginPath(); context.moveTo(34, y); context.lineTo(width, y); context.stroke();
    context.fillText(String(bpm), 4, y + 3);
  }
  const colors: Record<string, string> = {
    legacy: '#62d6ff', flux: '#ffba6b', superflux: '#ff7f8c', autocorr: '#d99cff',
    comb: '#54e0cf', dp: '#f1dd63', 'pcm-realtime': '#ff6fe1',
    'pcm-beatroot': '#ff9d4f', pulse: '#a8ff75', consensus: '#ffffff',
  };
  for (const key of DETECTOR_IDS) {
    context.strokeStyle = colors[key];
    context.lineWidth = key === 'consensus' ? 2.8 : key === 'pulse' ? 2.1 : 1.15;
    context.beginPath();
    let drawing = false;
    history.forEach((point, index) => {
      const value = point.values[key];
      if (value === null || value < min || value > max) { drawing = false; return; }
      const x = 38 + (index / Math.max(1, history.length - 1)) * (width - 46);
      const y = height - ((value - min) / (max - min)) * (height - 24) - 12;
      if (!drawing) { context.moveTo(x, y); drawing = true; } else context.lineTo(x, y);
    });
    context.stroke();
  }
}

function resetAnalysis(): void {
  analyzer = createAnalyzer();
  latest = null;
  history.length = 0;
  DETECTOR_IDS.forEach((id) => renderEstimate({
    id, label: id, bpm: null, lockedBpm: null, confidence: 0,
    status: 'standby', onset: false, detail: '履歴をリセットしました',
  }));
  drawTimeline();
}

function showError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const status = element('sourceStatus');
  status.textContent = message;
  status.classList.add('error');
  if (errorTimer !== null) window.clearTimeout(errorTimer);
  errorTimer = window.setTimeout(() => status.classList.remove('error'), 5000);
}

async function loadFile(file: File): Promise<void> {
  resetAnalysis();
  await engine.startFile(file);
  const slot = element('audioSlot');
  slot.replaceChildren();
  if (engine.audioElement !== null) slot.append(engine.audioElement);
  element<HTMLInputElement>('recordName').value = file.name;
}

element<HTMLInputElement>('fileInput').addEventListener('change', (event) => {
  const file = (event.currentTarget as HTMLInputElement).files?.[0];
  if (file) void loadFile(file).catch(showError);
});
element('systemButton').addEventListener('click', () => {
  resetAnalysis();
  void engine.startSystemAudio().catch(showError);
});
element('micButton').addEventListener('click', () => {
  resetAnalysis();
  void engine.startMicrophone().catch(showError);
});
element('stopButton').addEventListener('click', () => void engine.stop());
document.querySelectorAll<HTMLButtonElement>('[data-synthetic]').forEach((button) => {
  button.addEventListener('click', () => {
    const bpm = Number(button.dataset.synthetic);
    const mode = button.dataset.mode === 'bass-light' ? 'bass-light' : 'full';
    resetAnalysis();
    element<HTMLInputElement>('expectedBpm').value = String(bpm);
    element<HTMLInputElement>('recordName').value = mode === 'bass-light' ? `合成 ${bpm} BPM（低音なし）` : `合成 ${bpm} BPM`;
    void engine.startSynthetic(bpm, mode);
  });
});

const dropZone = element('dropZone');
for (const name of ['dragenter', 'dragover']) dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.add('dragging'); });
for (const name of ['dragleave', 'drop']) dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.remove('dragging'); });
dropZone.addEventListener('drop', (event) => {
  const file = (event as DragEvent).dataTransfer?.files[0];
  if (file?.type.startsWith('audio/')) void loadFile(file).catch(showError);
  else showError(new Error('音声ファイルをドロップしてください'));
});

for (const id of ['minBpm', 'maxBpm', 'stableSeconds']) element(id).addEventListener('change', resetAnalysis);

function shownBpm(estimate: DetectorEstimate): number | null {
  return estimate.lockedBpm ?? estimate.bpm;
}

function formatResult(value: number | null, expected: number): string {
  if (value === null) return '---';
  const rounded = Math.round(value);
  const error = Math.abs(rounded - expected);
  return `${rounded} (${error === 0 ? '±0' : `Δ${error}`})`;
}

function renderRecords(): void {
  const rows = element<HTMLTableSectionElement>('recordRows');
  if (records.length === 0) {
    rows.innerHTML = `<tr class="empty"><td colspan="${DETECTOR_IDS.length + 3}">まだ記録がありません</td></tr>`;
    return;
  }
  rows.innerHTML = records.map((record) => `<tr>
    <td>${escapeHtml(record.source)}</td><td>${record.expected}</td>
    ${DETECTOR_IDS.map((id) => `<td>${formatResult(record.values[id], record.expected)}</td>`).join('')}
    <td>${record.support}/5</td></tr>`).join('');
}

function escapeHtml(value: string): string {
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
}

element('recordButton').addEventListener('click', () => {
  const expected = Number(element<HTMLInputElement>('expectedBpm').value);
  if (latest === null || !Number.isFinite(expected) || expected <= 0) {
    showError(new Error('解析中に正解BPMを入力してください'));
    return;
  }
  const name = element<HTMLInputElement>('recordName').value.trim() || latestSource || '名称未入力';
  records.unshift({
    source: name,
    expected,
    recordedAt: new Date().toISOString(),
    values: Object.fromEntries(DETECTOR_IDS.map((id) => [id, shownBpm(latest!.estimates[id])])) as Record<DetectorId, number | null>,
    support: latest.consensus.support ?? 0,
  });
  renderRecords();
});

element('clearButton').addEventListener('click', () => { records.length = 0; renderRecords(); });
element('exportButton').addEventListener('click', () => {
  if (records.length === 0) { showError(new Error('出力する比較記録がありません')); return; }
  const header = ['source', 'expected_bpm', ...DETECTOR_IDS.map((id) => `${id}_bpm`), 'support', 'recorded_at'];
  const lines = records.map((record) => [record.source, record.expected, ...DETECTOR_IDS.map((id) => record.values[id] ?? ''), record.support, record.recordedAt]
    .map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','));
  const blob = new Blob([`\uFEFF${[header.join(','), ...lines].join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = `bpm-comparison-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click();
  URL.revokeObjectURL(url);
});

window.addEventListener('resize', drawTimeline);
drawTimeline();

declare global {
  interface Window {
    __bpmLab: {
      snapshot: () => AnalysisFrame | null;
      records: () => ComparisonRecord[];
      synthetic: (bpm: number, mode?: 'full' | 'bass-light') => Promise<void>;
    };
  }
}

window.__bpmLab = {
  snapshot: () => latest,
  records: () => [...records],
  synthetic: async (bpm, mode = 'full') => {
    resetAnalysis();
    await engine.startSynthetic(bpm, mode);
  },
};
