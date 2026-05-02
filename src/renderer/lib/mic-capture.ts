// src/renderer/lib/mic-capture.ts
import { MIC_WORKLET_SOURCE } from './mic-worklet-source';
import {
  createVadGate,
  type VoiceInputSettings,
} from '../../shared/voice-input';

type Listener = (rms: number) => void;
type GateListener = (open: boolean) => void;

const FRAME_MS = 20;
const TAIL_MS = 200;
const TAIL_FRAMES = TAIL_MS / FRAME_MS; // 10

export class MicCaptureManager {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private settings: VoiceInputSettings | null = null;
  private gate = createVadGate({ threshold: 1, tailFrames: TAIL_FRAMES });
  private pttHeld = false;
  private gateOpen = false;
  private levelListeners = new Set<Listener>();
  private gateListeners = new Set<GateListener>();

  async start(settings: VoiceInputSettings): Promise<void> {
    if (this.ctx) await this.stop();
    this.settings = settings;
    this.gate = createVadGate({ threshold: settings.vadThreshold, tailFrames: TAIL_FRAMES });

    const audio: MediaTrackConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: false,
      channelCount: 1,
      sampleRate: 48_000,
    };
    if (settings.inputDeviceId) audio.deviceId = settings.inputDeviceId;
    const constraints: MediaStreamConstraints = { audio };
    this.stream = await navigator.mediaDevices.getUserMedia(constraints);

    this.ctx = new AudioContext({ sampleRate: 48_000 });
    const blob = new Blob([MIC_WORKLET_SOURCE], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    try {
      await this.ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }

    const source = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'botcord-mic');
    this.node.port.postMessage({ gain: settings.inputGain });
    this.node.port.onmessage = (e) => this.onFrame(e.data as { rms: number; pcm: ArrayBuffer });
    source.connect(this.node);
    // Sink into the destination only if needed; we don't, so leave dangling.

    // Devices ending mid-call.
    this.stream.getAudioTracks().forEach((t) => t.addEventListener('ended', () => this.handleTrackEnded()));
  }

  async stop(): Promise<void> {
    // Flush level meter so consumers' bars don't stick at the last value.
    for (const l of this.levelListeners) l(0);
    if (this.gateOpen) {
      window.botcord.voice.micStop();
      this.gateOpen = false;
      this.emitGate(false);
    }
    this.node?.disconnect();
    this.node = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.ctx) { await this.ctx.close().catch(() => {}); this.ctx = null; }
  }

  updateSettings(next: VoiceInputSettings): void {
    this.settings = next;
    this.gate = createVadGate({ threshold: next.vadThreshold, tailFrames: TAIL_FRAMES });
    this.node?.port.postMessage({ gain: next.inputGain });
  }

  setPttHeld(held: boolean): void {
    if (this.pttHeld !== held) console.log('[mic] setPttHeld', held);
    this.pttHeld = held;
  }

  onLevel(cb: Listener): () => void {
    this.levelListeners.add(cb);
    return () => { this.levelListeners.delete(cb); };
  }
  onGateChange(cb: GateListener): () => void {
    this.gateListeners.add(cb);
    return () => { this.gateListeners.delete(cb); };
  }

  private onFrame(data: { rms: number; pcm: ArrayBuffer }): void {
    const s = this.settings;
    if (!s) return;
    for (const l of this.levelListeners) l(data.rms);

    let shouldOpen = false;
    if (s.muted) shouldOpen = false;
    else if (s.mode === 'ptt') shouldOpen = this.pttHeld;
    else shouldOpen = this.gate.step(data.rms);

    if (shouldOpen && !this.gateOpen) {
      console.log('[mic] gate OPEN — mode:', s.mode, 'pttHeld:', this.pttHeld, 'rms:', data.rms.toFixed(3));
      this.gateOpen = true;
      window.botcord.voice.micStart();
      this.emitGate(true);
    }
    if (shouldOpen) {
      window.botcord.voice.micFrame(data.pcm);
    }
    if (!shouldOpen && this.gateOpen) {
      console.log('[mic] gate CLOSE — mode:', s.mode, 'pttHeld:', this.pttHeld);
      this.gateOpen = false;
      window.botcord.voice.micStop();
      this.emitGate(false);
    }
  }

  private emitGate(open: boolean): void {
    for (const l of this.gateListeners) l(open);
  }

  private handleTrackEnded(): void {
    // Force gate closed and tear down. Consumer hook will re-acquire if asked.
    this.stop().catch(() => {});
  }
}
