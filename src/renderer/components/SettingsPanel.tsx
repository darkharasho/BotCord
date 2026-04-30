import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useNavigate } from 'react-router-dom';
import { pushToast } from './Toaster';

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [giphyKey, setGiphyKey] = useState('');
  const [giphyKeyLoaded, setGiphyKeyLoaded] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api.prefs.get('giphyApiKey').then(res => {
      if (res.ok && typeof res.data === 'string') setGiphyKey(res.data);
      setGiphyKeyLoaded(true);
    });
  }, []);

  // Persist the GIPHY key on every change after the initial load. No debounce
  // needed — typing in the field doesn't hit the network, only writes to prefs.
  useEffect(() => {
    if (!giphyKeyLoaded) return;
    api.prefs.set('giphyApiKey', giphyKey);
  }, [giphyKey, giphyKeyLoaded]);

  const reset = async () => {
    if (!confirm('Reset bot token? You will need to re-paste it on next launch.')) return;
    setBusy(true);
    await api.bot.clearToken();
    setBusy(false);
    navigate('/onboarding', { replace: true });
  };

  const invite = async () => {
    setBusy(true);
    const status = await api.bot.getStatus();
    if (status.kind !== 'configured') {
      pushToast('warn', 'Bot must be connected to generate an invite');
      setBusy(false);
      return;
    }
    const res = await api.bot.buildInviteUrl(status.identity.id);
    setBusy(false);
    if (!res.ok) {
      pushToast('danger', `Couldn't build invite: ${res.error.message}`);
      return;
    }
    setInviteUrl(res.data);
    api.system.openExternal(res.data);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-bg-subtle border border-border rounded-lg p-6 w-[28rem] space-y-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-fg">Settings</h2>

        <div className="space-y-2">
          <button
            className="w-full px-3 py-2 rounded bg-accent text-white hover:bg-accent-hover disabled:opacity-50"
            onClick={invite}
            disabled={busy}
          >
            Invite bot to a new server
          </button>
          {inviteUrl && (
            <div className="text-xs text-fg-muted space-y-1">
              <div>Opened in your browser. Pick a server, then approve.</div>
              <code
                className="block break-all bg-bg-sunken border border-border rounded px-2 py-1 text-fg cursor-pointer hover:bg-hover"
                onClick={() => { navigator.clipboard.writeText(inviteUrl); pushToast('ok', 'Invite URL copied'); }}
                title="Click to copy"
              >
                {inviteUrl}
              </code>
            </div>
          )}
        </div>

        <div className="border-t border-border pt-4 space-y-2">
          <label className="block text-xs font-medium text-fg-muted">GIPHY API key</label>
          <input
            type="password"
            value={giphyKey}
            onChange={(e) => setGiphyKey(e.target.value)}
            placeholder="Paste your GIPHY developer key"
            className="w-full px-3 py-2 rounded bg-bg-sunken border border-border text-fg text-sm outline-none focus:border-accent"
          />
          <p className="text-[11px] text-fg-dim leading-relaxed">
            Required for the GIF picker. Get a free key at <span className="text-accent">developers.giphy.com</span>. Stored locally only.
          </p>
        </div>

        <div className="border-t border-border pt-4 space-y-2">
          <button
            className="w-full px-3 py-2 rounded border border-danger/50 text-danger hover:bg-danger/10 disabled:opacity-50"
            onClick={reset}
            disabled={busy}
          >
            Reset bot token
          </button>
        </div>

        <button className="w-full px-3 py-2 rounded border border-border text-fg hover:bg-bg-sunken" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
