export type IpcErrorCode =
  | 'NOT_CONFIGURED'
  | 'INVALID_TOKEN'
  | 'MISSING_INTENTS'
  | 'MISSING_PERMISSIONS'
  | 'DISCORD_RATE_LIMITED'
  | 'DISCORD_HTTP_ERROR'
  | 'GATEWAY_OFFLINE'
  | 'NOT_FOUND'
  | 'INTERNAL';

export type IpcError = {
  code: IpcErrorCode;
  message: string;
  retryAfterMs?: number;
};

export type Result<T> = { ok: true; data: T } | { ok: false; error: IpcError };

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });
export const err = (code: IpcErrorCode, message: string, retryAfterMs?: number): Result<never> =>
  ({ ok: false, error: retryAfterMs !== undefined ? { code, message, retryAfterMs } : { code, message } });
