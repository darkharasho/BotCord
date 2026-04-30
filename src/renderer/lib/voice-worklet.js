// AudioWorklet processor for the listen-only voice channel. Runs on the
// audio thread; the main renderer thread feeds it 20ms PCM frames via
// MessagePort. We keep ~6 frames (~120ms) of jitter buffer — anything
// less crackles when IPC stalls; anything more pushes latency past where
// it's noticeable in conversation.
class VoiceSinkProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.cursor = 0;
    this.port.onmessage = (e) => {
      // e.data is a Float32Array of length 1920 (interleaved stereo @ 48kHz).
      this.queue.push(e.data);
      // Drop the oldest frames if the buffer is way ahead — happens after a
      // tab freeze or DevTools pause. Better to lose audio than to drift.
      if (this.queue.length > 25) this.queue.splice(0, this.queue.length - 6);
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const left = out[0];
    const right = out[1] ?? out[0];
    const N = left.length; // Always 128 in standard AudioWorklet.

    for (let i = 0; i < N; i++) {
      let frame = this.queue[0];
      if (!frame) {
        left[i] = 0;
        right[i] = 0;
        continue;
      }
      const j = this.cursor;
      // Frame is already Float32 in [-1, 1) — the sink does the Int16
      // normalization before postMessage so we can stream straight out.
      left[i]  = frame[j];
      right[i] = frame[j + 1];
      this.cursor += 2;
      if (this.cursor >= frame.length) {
        this.queue.shift();
        this.cursor = 0;
      }
    }
    return true;
  }
}

registerProcessor('voice-sink', VoiceSinkProcessor);
