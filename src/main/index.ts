import { app, BrowserWindow } from 'electron';

app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 1200, height: 800 });
  win.loadURL('about:blank');
});
