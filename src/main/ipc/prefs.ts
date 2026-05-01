import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-contract';
import { ok, err, type Result } from '../../shared/errors';
import type { Prefs } from '../../shared/domain';
import { createPrefsRepo } from '../db/repos/prefs';
import type { IpcDeps } from './index';

const VALID_KEYS: ReadonlyArray<keyof Prefs> = [
  'lastSelectedGuildId', 'lastSelectedChannelId', 'theme',
  'collapsedCategoryIds', 'memberListOpen', 'channelLastSeen',
  'mutedChannelIds', 'giphyApiKey',
  'autonomyGlobalEnabled', 'autonomyGlobalSystemPrompt', 'autonomyGlobalRateCapPerMin',
  'autonomyVisionEnabled', 'autonomyModel',
  'autonomyQueueMaxDepth', 'autonomyQueueTtlSeconds',
  'closeToTray', 'closeToTrayHintShown',
  'audioOutputDeviceId', 'audioInputDeviceId',
];

export function registerPrefsHandlers({ db }: IpcDeps): void {
  const repo = createPrefsRepo(db);

  ipcMain.handle(IPC_CHANNELS['prefs.get'], async (_, key: unknown): Promise<Result<unknown>> => {
    if (typeof key !== 'string' || !VALID_KEYS.includes(key as keyof Prefs)) {
      return err('INTERNAL', 'invalid prefs key');
    }
    return ok(repo.get(key as keyof Prefs));
  });

  ipcMain.handle(IPC_CHANNELS['prefs.set'], async (_, key: unknown, value: unknown): Promise<Result<void>> => {
    if (typeof key !== 'string' || !VALID_KEYS.includes(key as keyof Prefs)) {
      return err('INTERNAL', 'invalid prefs key');
    }
    repo.set(key as keyof Prefs, value as Prefs[keyof Prefs]);
    return ok(undefined);
  });
}
