import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-contract';
import { ok, err, type Result } from '../../shared/errors';
import type { DraftRow, DraftInput } from '../../shared/domain';
import { createDraftsRepo } from '../db/repos/drafts';
import type { IpcDeps } from './index';

export function registerDraftsHandlers({ db }: IpcDeps): void {
  const repo = createDraftsRepo(db);

  ipcMain.handle(IPC_CHANNELS['drafts.list'], async (): Promise<Result<DraftRow[]>> => ok(repo.list()));

  ipcMain.handle(IPC_CHANNELS['drafts.upsert'], async (_, input: unknown): Promise<Result<DraftRow>> => {
    if (typeof input !== 'object' || input === null) return err('INTERNAL', 'draft input must be an object');
    try {
      return ok(repo.upsert(input as DraftInput));
    } catch (e) {
      return err('INTERNAL', e instanceof Error ? e.message : String(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS['drafts.delete'], async (_, id: unknown): Promise<Result<void>> => {
    if (typeof id !== 'string') return err('INTERNAL', 'id must be a string');
    repo.delete(id);
    return ok(undefined);
  });
}
