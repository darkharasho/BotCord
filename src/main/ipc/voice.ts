import { BrowserWindow, ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-contract';
import { ok, err, type Result } from '../../shared/errors';
import type { ClientManager } from '../discord/client-manager';
import { VoiceManager, type VoiceConnectionState } from '../voice/voice-manager';

export function registerVoiceHandlers({ manager }: { manager: ClientManager }): VoiceManager {
  const voice = new VoiceManager(() => manager.getClient());

  voice.on('state', (state) => broadcast(IPC_CHANNELS['event.voiceState'], state));
  // Frame events fire at 50 Hz — only forward to whichever window is active
  // and connected to a sink (the renderer flips a flag via voice.subscribe).
  voice.on('frame', (frame) => {
    const buf = Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength);
    broadcast(IPC_CHANNELS['event.voiceFrame'], buf);
  });
  voice.on('speakers', (levels) => {
    if (levels.size === 0) return;
    broadcast(IPC_CHANNELS['event.voiceSpeakers'], Object.fromEntries(levels));
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
    voice.leaveChannel();
    return ok(voice.getState());
  });

  ipcMain.handle(IPC_CHANNELS['voice.getState'], (): VoiceConnectionState => voice.getState());

  return voice;
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload);
}
