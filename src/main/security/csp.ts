import { session } from 'electron';

const PROD_CSP = [
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

const DEV_CSP = [
  "default-src 'self' http://localhost:* ws://localhost:*",
  "img-src 'self' https://cdn.discordapp.com data:",
  "connect-src 'self' http://localhost:* ws://localhost:*",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:*",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
].join('; ');

export function installCSP(): void {
  const csp = process.env.ELECTRON_RENDERER_URL ? DEV_CSP : PROD_CSP;
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });
}
