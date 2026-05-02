import { BrowserWindow, ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-contract';
import { ok, err, type Result } from '../../shared/errors';
import type { ClientManager } from '../discord/client-manager';
import { VoiceManager, type VoiceConnectionState } from '../voice/voice-manager';
import { MicTransmitter } from '../voice/mic-transmitter';

export function registerVoiceHandlers({ manager }: { manager: ClientManager }): VoiceManager {
  const voice = new VoiceManager(() => manager.getClient());
  const transmitter = new MicTransmitter(voice);

  voice.on('state', (state) => broadcast(IPC_CHANNELS['event.voiceState'], state));
  voice.on('frame', (frame) => {
    const buf = Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength);
    broadcast(IPC_CHANNELS['event.voiceFrame'], buf);
  });
  voice.on('speakers', (levels) => {
    if (levels.size === 0) return;
    broadcast(IPC_CHANNELS['event.voiceSpeakers'], Object.fromEntries(levels));
  });

  // Tear the transmitter down when the connection goes away so we never call
  // setSpeaking on a destroyed connection. The transmitter itself also guards
  // this, but stopping eagerly avoids leaking the encoder + player.
  voice.on('state', (state) => {
    if (state.kind === 'idle' || state.kind === 'disconnected' || state.kind === 'error') {
      transmitter.stop();
    }
  });

  ipcMain.handle(IPC_CHANNELS['voice.join'], async (_, guildId: unknown, channelId: unknown): Promise<Result<VoiceConnectionState>> => {
    if (typeof guildId !== 'string' || typeof channelId !== 'string') return err('INTERNAL', 'guildId and channelId required');
    try {
      await voice.joinChannel(guildId, channelId);
      return ok(voice.getState());
    } catch (e) {
      return err('INTERNAL', e instanceof Error ? e.message : String(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS['voice.leave'], (): Result<VoiceConnectionState> => {
    transmitter.stop();
    voice.leaveChannel();
    return ok(voice.getState());
  });

  ipcMain.handle(IPC_CHANNELS['voice.getState'], (): VoiceConnectionState => voice.getState());

  ipcMain.on(IPC_CHANNELS['voice.mic.start'], () => {
    // Encoder construction can throw if the native opus binding failed to
    // load. We swallow it here — the renderer will notice no audio is going
    // out and the user can reconnect. Don't crash the IPC loop.
    try { transmitter.start(); } catch { /* swallow */ }
  });

  ipcMain.on(IPC_CHANNELS['voice.mic.frame'], (_evt, payload: ArrayBuffer | Uint8Array) => {
    // Electron may deliver ArrayBuffer payloads as Uint8Array depending on
    // version / contextBridge path; normalize to a typed Int16 view.
    const u8 = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
    if (u8.byteLength % 2 !== 0) return;
    const view = new Int16Array(u8.buffer, u8.byteOffset, u8.byteLength / 2);
    transmitter.frame(view);
  });

  ipcMain.on(IPC_CHANNELS['voice.mic.stop'], () => transmitter.stop());

  return voice;
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload);
}
