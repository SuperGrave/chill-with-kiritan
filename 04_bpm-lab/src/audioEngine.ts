import { LAB_BAND_COUNT, makeSyntheticBands } from './algorithms';

export type InputKind = 'none' | 'file' | 'system' | 'microphone' | 'synthetic';

export interface InputFrame {
  bands: Float32Array;
  at: number;
  sourceLabel: string;
  kind: InputKind;
}

type FrameHandler = (frame: InputFrame) => void;
type StateHandler = (message: string, active: boolean) => void;

export class AudioInputEngine {
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private frequencyDb = new Float32Array(0);
  private timer: number | null = null;
  private stream: MediaStream | null = null;
  private sourceNode: AudioNode | null = null;
  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private sourceLabel = '入力なし';
  private kind: InputKind = 'none';

  constructor(
    private readonly onFrame: FrameHandler,
    private readonly onState: StateHandler,
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
    this.kind = 'microphone';
    this.sourceLabel = 'マイク入力';
    this.startAnalysisTimer();
    this.onState('マイク入力を解析中', true);
  }

  async startSynthetic(bpm: number, mode: 'full' | 'bass-light' = 'full'): Promise<void> {
    await this.stop();
    const startedAt = performance.now();
    this.kind = 'synthetic';
    this.sourceLabel = mode === 'bass-light' ? `合成 ${bpm} BPM（低音なし）` : `合成 ${bpm} BPM`;
    this.timer = window.setInterval(() => {
      const now = performance.now();
      this.onFrame({
        bands: makeSyntheticBands(bpm, now - startedAt, mode),
        at: now,
        sourceLabel: this.sourceLabel,
        kind: this.kind,
      });
    }, 1000 / 30);
    this.onState(`${this.sourceLabel} を解析中`, true);
  }

  async stop(): Promise<void> {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
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
