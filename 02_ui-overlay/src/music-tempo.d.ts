declare module 'music-tempo' {
  export default class MusicTempo {
    constructor(audioData: Float32Array, params?: Record<string, number>);
    tempo: string | number;
    beats: number[];
    beatInterval: number;
  }
}
