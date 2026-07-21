import { LAB_BAND_COUNT } from './algorithms';
import { createRealtimeBpmAnalyzer, type BpmAnalyzer, type BpmCandidates } from 'realtime-bpm-analyzer';

export type InputKind = 'none' | 'file' | 'system' | 'microphone' | 'synthetic';

export interface InputFrame {
  bands: Float32Array;
  at: number;
  sourceLabel: string;
  kind: InputKind;
}

type FrameHandler = (frame: InputFrame) => void;
type StateHandler = (message: string, active: boolean) => void;

export interface PcmEstimateUpdate {
  id: 'pcm-realtime' | 'pcm-beatroot';
  bpm: number | null;
  confidence: number;
  detail: string;
  at: number;
}

type PcmEstimateHandler = (estimate: PcmEstimateUpdate) => void;

export class AudioInputEngine {
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private frequencyDb = new Float32Array(0);
  private timer: number | null = null;
  private stream: MediaStream | null = null;
  private sourceNode: AudioNode | null = null;
  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private bpmAnalyzer: BpmAnalyzer | null = null;
  private pcmSilentGain: GainNode | null = null;
  private pcmInputGain: GainNode | null = null;
  private beatrootWorker: Worker | null = null;
  private syntheticSource: AudioBufferSourceNode | null = null;
  private previewGain: GainNode | null = null;
  private sourceLabel = '入力なし';
  private kind: InputKind = 'none';

  constructor(
    private readonly onFrame: FrameHandler,
    private readonly onState: StateHandler,
    private readonly onPcmEstimate: PcmEstimateHandler,
  ) {}

  get audioElement(): HTMLAudioElement | null {
    return this.audio;
  }

  private async ensureContext(): Promise<AudioContext> {
    if (this.context === null) {
      this.context = new AudioContext({ latencyHint: 'interactive' });
    }
    if (this.context.state === 'suspended') await this.context.resume();
    return this.context;
  }

  private configureAnalyser(context: AudioContext): AnalyserNode {
    const analyser = context.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0;
    analyser.minDecibels = -92;
    analyser.maxDecibels = -12;
    this.analyser = analyser;
    this.frequencyDb = new Float32Array(analyser.frequencyBinCount);
    return analyser;
  }

  private publishRealtimeCandidate(data: BpmCandidates, stable: boolean): void {
    const candidate = data.bpm[0];
    if (candidate === undefined) return;
    const confidence = Math.max(candidate.confidence, Math.min(1, candidate.count / 24));
    this.onPcmEstimate({
      id: 'pcm-realtime',
      bpm: candidate.tempo,
      confidence: Math.max(0, Math.min(1, confidence)),
      detail: `AudioWorklet ${stable ? '安定' : '追跡'} / peaks ${candidate.count} / threshold ${data.threshold.toFixed(2)}`,
      at: performance.now(),
    });
  }

  private ensureBeatrootWorker(sampleRate: number): Worker {
    this.beatrootWorker?.terminate();
    const worker = new Worker(new URL('./pcmBeatroot.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<{ bpm?: number; confidence?: number; detail?: string; error?: string }>) => {
      if (event.data.error) {
        this.onPcmEstimate({
          id: 'pcm-beatroot', bpm: null, confidence: 0,
          detail: `BeatRoot: ${event.data.error}`, at: performance.now(),
        });
        return;
      }
      if (event.data.bpm !== undefined) {
        this.onPcmEstimate({
          id: 'pcm-beatroot',
          bpm: event.data.bpm,
          confidence: event.data.confidence ?? 0,
          detail: event.data.detail ?? 'BeatRoot PCM解析',
          at: performance.now(),
        });
      }
    };
    worker.postMessage({ type: 'reset', sampleRate });
    this.beatrootWorker = worker;
    return worker;
  }

  private async connectPcmAnalysis(context: AudioContext, source: AudioNode): Promise<void> {
    const analyzer = await createRealtimeBpmAnalyzer(context, {
      continuousAnalysis: true,
      stabilizationTime: 5_000,
      muteTimeInIndexes: Math.round(context.sampleRate * 0.16),
      debug: true,
    });
    analyzer.on('bpm', (data) => this.publishRealtimeCandidate(data, false));
    analyzer.on('bpmStable', (data) => this.publishRealtimeCandidate(data, true));
    const worker = this.ensureBeatrootWorker(context.sampleRate);
    analyzer.on('analyzeChunk', (chunk) => {
      const copy = new Float32Array(chunk);
      worker.postMessage({ type: 'chunk', samples: copy }, [copy.buffer]);
    });
    analyzer.on('error', ({ message }) => {
      this.onPcmEstimate({
        id: 'pcm-realtime', bpm: null, confidence: 0,
        detail: `AudioWorklet: ${message}`, at: performance.now(),
      });
    });
    this.pcmSilentGain = context.createGain();
    this.pcmSilentGain.gain.value = 0;
    this.pcmInputGain = context.createGain();
    this.pcmInputGain.gain.value = 2.5;
    source.connect(this.pcmInputGain);
    this.pcmInputGain.connect(analyzer.node);
    analyzer.node.connect(this.pcmSilentGain);
    this.pcmSilentGain.connect(context.destination);
    this.bpmAnalyzer = analyzer;
  }

  private async tryConnectPcmAnalysis(context: AudioContext, source: AudioNode): Promise<void> {
    try {
      await this.connectPcmAnalysis(context, source);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.onPcmEstimate({
        id: 'pcm-realtime', bpm: null, confidence: 0,
        detail: `PCM初期化失敗: ${message}`, at: performance.now(),
      });
    }
  }

  private createSyntheticBuffer(context: AudioContext, bpm: number, mode: 'full' | 'bass-light'): AudioBuffer {
    const beatSeconds = 60 / bpm;
    const duration = beatSeconds * 8;
    const length = Math.ceil(duration * context.sampleRate);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index++) {
      const time = index / context.sampleRate;
      const phase = time % beatSeconds;
      const kick = Math.sin(2 * Math.PI * (62 - Math.min(26, phase * 180)) * phase) * Math.exp(-phase / 0.075);
      const tick = Math.sin(2 * Math.PI * 1_250 * phase) * Math.exp(-phase / 0.018);
      const body = Math.sin(2 * Math.PI * 260 * phase) * Math.exp(-phase / 0.052);
      data[index] = Math.max(-1, Math.min(1, mode === 'bass-light'
        ? tick * 0.52 + body * 0.22
        : kick * 0.82 + tick * 0.24 + body * 0.12));
    }
    return buffer;
  }

  private readBands(): Float32Array {
    const analyser = this.analyser;
    const context = this.context;
    if (analyser === null || context === null) return new Float32Array(LAB_BAND_COUNT);
    analyser.getFloatFrequencyData(this.frequencyDb as Float32Array<ArrayBuffer>);
    const bands = new Float32Array(LAB_BAND_COUNT);
    const nyquist = context.sampleRate / 2;
    const minHz = 35;
    const maxHz = Math.min(16_000, nyquist * 0.96);
    const logSpan = Math.log(maxHz / minHz);
    for (let band = 0; band < LAB_BAND_COUNT; band++) {
      const lowHz = minHz * Math.exp(logSpan * (band / LAB_BAND_COUNT));
      const highHz = minHz * Math.exp(logSpan * ((band + 1) / LAB_BAND_COUNT));
      const start = Math.max(0, Math.floor((lowHz / nyquist) * this.frequencyDb.length));
      const end = Math.max(start + 1, Math.ceil((highHz / nyquist) * this.frequencyDb.length));
      let peakDb = -120;
      for (let index = start; index < Math.min(end, this.frequencyDb.length); index++) {
        if (this.frequencyDb[index] > peakDb) peakDb = this.frequencyDb[index];
      }
      const normalized = Math.max(0, Math.min(1, (peakDb + 92) / 80));
      bands[band] = Math.pow(normalized, 1.55);
    }
    return bands;
  }

  private startAnalysisTimer(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = window.setInterval(() => {
      this.onFrame({
        bands: this.readBands(),
        at: performance.now(),
        sourceLabel: this.sourceLabel,
        kind: this.kind,
      });
    }, 1000 / 30);
  }

  async startFile(file: File): Promise<void> {
    await this.stop();
    const context = await this.ensureContext();
    const analyser = this.configureAnalyser(context);
    this.objectUrl = URL.createObjectURL(file);
    this.audio = new Audio(this.objectUrl);
    this.audio.controls = true;
    this.audio.loop = false;
    this.audio.preload = 'auto';
    this.sourceNode = context.createMediaElementSource(this.audio);
    this.sourceNode.connect(analyser);
    analyser.connect(context.destination);
    await this.tryConnectPcmAnalysis(context, this.sourceNode);
    this.kind = 'file';
    this.sourceLabel = file.name;
    this.startAnalysisTimer();
    this.onState(`${file.name} を解析中`, true);
    try {
      await this.audio.play();
    } catch {
      this.onState(`${file.name} を読み込みました。再生ボタンを押してください`, true);
    }
  }

  async startSystemAudio(): Promise<void> {
    await this.stop();
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error('共有対象から音声を取得できませんでした。「音声を共有」を有効にしてください。');
    }
    const context = await this.ensureContext();
    const analyser = this.configureAnalyser(context);
    this.stream = stream;
    this.sourceNode = context.createMediaStreamSource(stream);
    this.sourceNode.connect(analyser);
    await this.tryConnectPcmAnalysis(context, this.sourceNode);
    this.kind = 'system';
    this.sourceLabel = 'PC共有音声';
    stream.getVideoTracks()[0]?.addEventListener('ended', () => void this.stop());
    this.startAnalysisTimer();
    this.onState('PC共有音声を解析中', true);
  }

  async startMicrophone(): Promise<void> {
    await this.stop();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const context = await this.ensureContext();
    const analyser = this.configureAnalyser(context);
    this.stream = stream;
    this.sourceNode = context.createMediaStreamSource(stream);
    this.sourceNode.connect(analyser);
    await this.tryConnectPcmAnalysis(context, this.sourceNode);
    this.kind = 'microphone';
    this.sourceLabel = 'マイク入力';
    this.startAnalysisTimer();
    this.onState('マイク入力を解析中', true);
  }

  async startSynthetic(bpm: number, mode: 'full' | 'bass-light' = 'full'): Promise<void> {
    await this.stop();
    const context = await this.ensureContext();
    const analyser = this.configureAnalyser(context);
    const source = context.createBufferSource();
    source.buffer = this.createSyntheticBuffer(context, bpm, mode);
    source.loop = true;
    source.connect(analyser);
    this.previewGain = context.createGain();
    this.previewGain.gain.value = 0.04;
    analyser.connect(this.previewGain);
    this.previewGain.connect(context.destination);
    await this.tryConnectPcmAnalysis(context, source);
    source.start();
    this.syntheticSource = source;
    this.sourceNode = source;
    this.kind = 'synthetic';
    this.sourceLabel = mode === 'bass-light' ? `合成 ${bpm} BPM（低音なし）` : `合成 ${bpm} BPM`;
    this.startAnalysisTimer();
    this.onState(`${this.sourceLabel} を解析中`, true);
  }

  async stop(): Promise<void> {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    if (this.syntheticSource !== null) {
      try { this.syntheticSource.stop(); } catch { /* already stopped */ }
      this.syntheticSource = null;
    }
    this.bpmAnalyzer?.stop();
    this.bpmAnalyzer?.disconnect();
    this.bpmAnalyzer = null;
    this.pcmSilentGain?.disconnect();
    this.pcmSilentGain = null;
    this.pcmInputGain?.disconnect();
    this.pcmInputGain = null;
    this.previewGain?.disconnect();
    this.previewGain = null;
    this.beatrootWorker?.terminate();
    this.beatrootWorker = null;
    this.sourceNode?.disconnect();
    this.sourceNode = null;
    this.analyser?.disconnect();
    this.analyser = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (this.audio !== null) {
      this.audio.pause();
      this.audio.src = '';
      this.audio.load();
      this.audio = null;
    }
    if (this.objectUrl !== null) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.frequencyDb = new Float32Array(0);
    this.kind = 'none';
    this.sourceLabel = '入力なし';
    this.onState('停止中', false);
  }
}
