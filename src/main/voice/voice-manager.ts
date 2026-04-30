import { EventEmitter } from 'node:events';
import {
  joinVoiceChannel,
  entersState,
  VoiceConnectionStatus,
  EndBehaviorType,
  type VoiceConnection,
} from '@discordjs/voice';
import prism from 'prism-media';
import type { Client, VoiceBasedChannel } from 'discord.js';
import type { VoiceConnectionState } from '../../shared/domain';

export type { VoiceConnectionState };

// 48 kHz / 20 ms / 2 channels — discord's wire format. One frame = 1920
// samples per channel, stored interleaved => 3840 Int16 values.
const SAMPLE_RATE = 48_000;
const FRAME_MS = 20;
const CHANNELS = 2;
const SAMPLES_PER_FRAME = (SAMPLE_RATE * FRAME_MS) / 1000; // 960 per channel
const INTERLEAVED_LEN = SAMPLES_PER_FRAME * CHANNELS;       // 1920
const BYTES_PER_FRAME = INTERLEAVED_LEN * 2;                // 3840

type SpeakerEntry = {
  // Queue of decoded interleaved PCM frames, oldest first. We mix the head
  // of each speaker on every tick.
  queue: Int16Array[];
  // RMS level of the most recent emitted frame (0..1). Used to drive the
  // "is talking" UI ring.
  level: number;
};

export interface VoiceManagerEvents {
  state: (state: VoiceConnectionState) => void;
  // Mixed PCM frame ready for the renderer. 48kHz / 20ms / stereo / s16le.
  frame: (pcm: Int16Array) => void;
  // Per-tick speaker levels (RMS 0..1) keyed by userId. Empty map on silence.
  speakers: (levels: Map<string, number>) => void;
}

export interface VoiceManager extends EventEmitter {
  on<E extends keyof VoiceManagerEvents>(event: E, listener: VoiceManagerEvents[E]): this;
  off<E extends keyof VoiceManagerEvents>(event: E, listener: VoiceManagerEvents[E]): this;
  emit<E extends keyof VoiceManagerEvents>(event: E, ...args: Parameters<VoiceManagerEvents[E]>): boolean;
}

export class VoiceManager extends EventEmitter {
  private connection: VoiceConnection | null = null;
  private speakers = new Map<string, SpeakerEntry>();
  private tickHandle: NodeJS.Timeout | null = null;
  private state: VoiceConnectionState = { kind: 'idle' };

  constructor(private getClient: () => Client | null) { super(); }

  getState(): VoiceConnectionState { return this.state; }

  async joinChannel(guildId: string, channelId: string): Promise<void> {
    const client = this.getClient();
    if (!client) throw new Error('Bot is not connected');

    // Hopping to a different connection: tear the old one down first so
    // discord.js doesn't reject the second `joinVoiceChannel` for the same
    // guild. We allow only one active connection at a time.
    if (this.connection) this.leaveChannel();

    const guild = client.guilds.cache.get(guildId);
    if (!guild) throw new Error('Guild not found');
    const channel = guild.channels.cache.get(channelId) as VoiceBasedChannel | undefined;
    if (!channel || !('joinable' in channel)) throw new Error('Channel not found');
    if (!channel.joinable) throw new Error('Bot lacks permission to join this channel');

    this.setState({ kind: 'connecting', guildId, channelId });

    const connection = joinVoiceChannel({
      channelId,
      guildId,
      adapterCreator: guild.voiceAdapterCreator,
      // Listen-only: we never transmit, but `selfDeaf` MUST stay false or
      // the gateway will not forward voice receive packets.
      selfDeaf: false,
      selfMute: true,
    });
    this.connection = connection;

    connection.on('stateChange', (_old, next) => {
      if (next.status === VoiceConnectionStatus.Disconnected) {
        this.setState({ kind: 'disconnected', guildId, channelId });
      }
    });

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    } catch (err) {
      this.leaveChannel();
      this.setState({
        kind: 'error',
        guildId,
        channelId,
        message: err instanceof Error ? err.message : 'voice handshake failed',
      });
      throw err;
    }

    this.attachReceiver(connection);
    this.startMixer();
    this.setState({ kind: 'connected', guildId, channelId });
  }

  leaveChannel(): void {
    if (this.tickHandle) { clearInterval(this.tickHandle); this.tickHandle = null; }
    if (this.connection) {
      try { this.connection.destroy(); } catch { /* already destroyed */ }
      this.connection = null;
    }
    this.speakers.clear();
    this.setState({ kind: 'idle' });
  }

  // Wire each speaker's opus stream to a per-user PCM queue. Discord's
  // receiver emits a fresh stream every time the speaker stops and starts
  // again (silence suppression), so we re-subscribe on each `start` event.
  private attachReceiver(connection: VoiceConnection): void {
    const receiver = connection.receiver;
    receiver.speaking.on('start', (userId) => this.subscribe(userId));
    // Pre-subscribe to anyone already speaking when we joined.
    for (const userId of receiver.speaking.users.keys()) this.subscribe(userId);
  }

  private subscribe(userId: string): void {
    if (!this.connection) return;
    const opusStream = this.connection.receiver.subscribe(userId, {
      // Auto-end the stream when the speaker has been silent for a frame.
      // We start a fresh subscription on the next `start` event.
      end: { behavior: EndBehaviorType.AfterSilence, duration: 100 },
    });
    let decoder: prism.opus.Decoder;
    try {
      decoder = new prism.opus.Decoder({
        rate: SAMPLE_RATE,
        channels: CHANNELS,
        frameSize: SAMPLES_PER_FRAME,
      });
    } catch (err) {
      // The native opus module failed to load (broken prebuild after a
      // reinstall, missing rebuild step, etc). Surface it as a state event
      // and tear the connection down rather than crashing the main process.
      this.setState({
        kind: 'error',
        guildId: this.connection.joinConfig.guildId ?? '',
        channelId: this.connection.joinConfig.channelId ?? '',
        message: err instanceof Error ? `opus decoder unavailable: ${err.message}` : 'opus decoder unavailable',
      });
      this.leaveChannel();
      return;
    }

    opusStream.pipe(decoder);

    decoder.on('data', (chunk: Buffer) => {
      // prism emits one decoded frame per opus packet — already 3840 bytes.
      // Defensive split in case a future version coalesces.
      for (let off = 0; off + BYTES_PER_FRAME <= chunk.length; off += BYTES_PER_FRAME) {
        const view = new Int16Array(
          chunk.buffer,
          chunk.byteOffset + off,
          INTERLEAVED_LEN,
        );
        // Copy — the underlying Buffer pool may be reused.
        const frame = new Int16Array(view);
        let entry = this.speakers.get(userId);
        if (!entry) {
          entry = { queue: [], level: 0 };
          this.speakers.set(userId, entry);
        }
        // Cap per-speaker backlog (~400ms) so a slow consumer can't grow
        // memory unboundedly on a chatty channel.
        if (entry.queue.length >= 20) entry.queue.shift();
        entry.queue.push(frame);
      }
    });

    decoder.on('error', () => { /* a corrupt opus packet is non-fatal — skip frame */ });
    opusStream.on('error', () => { /* speaker disconnected mid-stream */ });
  }

  // 50 Hz mixer. Pulls one frame from each speaker's queue (zero-fills if
  // empty), sums them sample-wise with clipping, and emits the result.
  private startMixer(): void {
    if (this.tickHandle) return;
    const mix = new Int16Array(INTERLEAVED_LEN);
    const levels = new Map<string, number>();

    this.tickHandle = setInterval(() => {
      mix.fill(0);
      levels.clear();
      let anyAudio = false;

      for (const [userId, entry] of this.speakers) {
        const frame = entry.queue.shift();
        if (!frame) {
          entry.level = 0;
          // Drop speakers with no recent audio so the map doesn't grow
          // without bound across re-subscriptions.
          if (entry.queue.length === 0) this.speakers.delete(userId);
          continue;
        }
        anyAudio = true;
        let sumSq = 0;
        for (let i = 0; i < INTERLEAVED_LEN; i++) {
          const s = frame[i]!;
          sumSq += s * s;
          // Clip on add — mixing ints in JS can overflow Int16 range.
          const sum = mix[i]! + s;
          mix[i] = sum > 32_767 ? 32_767 : sum < -32_768 ? -32_768 : sum;
        }
        const rms = Math.sqrt(sumSq / INTERLEAVED_LEN) / 32_768;
        entry.level = rms;
        levels.set(userId, rms);
      }

      if (anyAudio) {
        // Copy: the renderer-side IPC may serialize asynchronously and the
        // shared `mix` buffer is reused on the next tick.
        this.emit('frame', new Int16Array(mix));
      }
      this.emit('speakers', new Map(levels));
    }, FRAME_MS);
  }

  private setState(next: VoiceConnectionState): void {
    this.state = next;
    this.emit('state', next);
  }
}
