import { Readable, Transform } from 'node:stream';
import { createAudioPlayer, createAudioResource, StreamType, VoiceConnectionStatus, type AudioPlayer } from '@discordjs/voice';
import prism from 'prism-media';
import type { VoiceManager } from './voice-manager';

const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
const FRAME_SAMPLES = 960; // 20 ms @ 48 kHz mono

// Wraps an in-process Readable that we push PCM frames into and end on `stop`.
function makePushable(): Readable & { pushFrame: (b: Buffer) => void; end: () => void } {
  const stream = new Readable({ read() { /* push-driven */ } }) as any;
  stream.pushFrame = (b: Buffer) => stream.push(b);
  stream.end = () => stream.push(null);
  return stream;
}

// Mono Int16LE PCM → interleaved stereo Int16LE. The opus encoder expects
// `CHANNELS=2` interleaved input.
function makeStereoizer(): Transform {
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      const samples = chunk.length / 2;
      const out = Buffer.alloc(samples * 4);
      for (let i = 0; i < samples; i++) {
        const s = chunk.readInt16LE(i * 2);
        out.writeInt16LE(s, i * 4);     // L
        out.writeInt16LE(s, i * 4 + 2); // R
      }
      cb(null, out);
    },
  });
}

export class MicTransmitter {
  private player: AudioPlayer | null = null;
  private pcmStream: ReturnType<typeof makePushable> | null = null;
  private encoder: prism.opus.Encoder | null = null;
  private active = false;

  constructor(private voiceManager: Pick<VoiceManager, 'getConnection'>) {}

  start(): void {
    if (this.active) return;
    const connection = this.voiceManager.getConnection();
    // If a stale `voice.mic.start` IPC arrives after voice.leave has
    // destroyed the connection (the renderer's worklet may emit one more
    // frame between the leave click and the state event landing), this
    // returns early — getConnection() reports null. The IPC frame that
    // immediately follows is also dropped because `active` stays false.
    if (!connection) return;

    this.pcmStream = makePushable();
    // Build the encoder per cycle: a long-lived encoder would emit residual
    // buffered frames after pcmStream.end() on the next start(), causing a
    // tail of stale audio after PTT release / VAD close.
    this.encoder = new prism.opus.Encoder({
      rate: SAMPLE_RATE,
      channels: CHANNELS,
      frameSize: FRAME_SAMPLES,
    });

    const opusStream = this.pcmStream.pipe(makeStereoizer()).pipe(this.encoder);
    const resource = createAudioResource(opusStream, { inputType: StreamType.Opus });

    this.player = createAudioPlayer();
    connection.subscribe(this.player);
    this.player.play(resource);

    connection.setSpeaking(1);
    this.active = true;
  }

  frame(pcm: Int16Array): void {
    if (!this.active || !this.pcmStream) return;
    // The worklet transferred this ArrayBuffer over postMessage so the
    // renderer no longer owns it. The Buffer view here is zero-copy onto
    // those bytes; the stereoizer downstream allocates a fresh buffer
    // per chunk, so there is no further reuse hazard once we push.
    const buf = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    this.pcmStream.pushFrame(buf);
  }

  stop(): void {
    if (!this.active) return;
    const connection = this.voiceManager.getConnection();
    this.pcmStream?.end();
    this.player?.stop(true);
    this.encoder?.destroy();
    this.player = null;
    this.pcmStream = null;
    this.encoder = null;
    this.active = false;
    if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) {
      connection.setSpeaking(0);
    }
  }

  isActive(): boolean { return this.active; }
}
