// src/renderer/lib/mic-worklet-source.ts
//
// AudioWorkletProcessor source. Runs in the audio thread. Receives 128-sample
// Float32 blocks from the input stream, accumulates them into 960-sample
// (20 ms @ 48 kHz) frames, applies gain, computes RMS, and posts each frame
// to the main thread as { rms, pcm } where pcm is an Int16Array buffer.
//
// The main thread decides whether to forward the frame to IPC (gate logic
// lives outside the audio thread so it can react to PTT key events without
// crossing thread boundaries).

export const MIC_WORKLET_SOURCE = /* js */ `
class MicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._frame = new Float32Array(960);
    this._filled = 0;
    this._gain = 1;
    this.port.onmessage = (e) => {
      if (e.data && typeof e.data.gain === 'number') this._gain = e.data.gain;
    };
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    let read = 0;
    while (read < ch.length) {
      const need = 960 - this._filled;
      const take = Math.min(need, ch.length - read);
      for (let i = 0; i < take; i++) {
        this._frame[this._filled + i] = ch[read + i] * this._gain;
      }
      this._filled += take;
      read += take;
      if (this._filled === 960) {
        // Compute RMS and convert to Int16.
        let sumSq = 0;
        const pcm = new Int16Array(960);
        for (let i = 0; i < 960; i++) {
          const f = Math.max(-1, Math.min(1, this._frame[i]));
          sumSq += f * f;
          pcm[i] = Math.round(f * 32767);
        }
        const rms = Math.sqrt(sumSq / 960);
        this.port.postMessage({ rms, pcm: pcm.buffer }, [pcm.buffer]);
        this._filled = 0;
      }
    }
    return true;
  }
}
registerProcessor('botcord-mic', MicProcessor);
`;
