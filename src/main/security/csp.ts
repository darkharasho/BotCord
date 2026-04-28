import { session } from 'electron';

const CSP = [
  "default-src 'self'",
  "img-src 'self' https://cdn.discordapp.com data:",
  "connect-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
].join('; ');

export function installCSP(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CSP],
      },
    });
  });
}
