import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../lib/api';

export function Step5Token({ onBack, goToIntents }: { onBack: () => void; goToIntents: () => void }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const navigate = useNavigate();

  const submit = async () => {
    setBusy(true);
    setError(null);
    const res = await api.bot.saveToken(token.trim());
    setBusy(false);
    if (!res.ok) {
      setError({ code: res.error.code, message: res.error.message });
      return;
    }
    navigate('/shell', { replace: true });
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">5. Paste your bot token</h2>
      <p className="text-fg-muted">
        On the Bot tab, click <strong>Reset Token</strong> (or <strong>Copy</strong> if you've never used it). Paste the token below.
        It's encrypted with your OS keychain and never leaves this machine.
      </p>
      <input
        type="password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="Bot token"
        className="w-full bg-bg-sunken border border-border rounded px-3 py-2 font-mono"
        autoComplete="off"
        spellCheck={false}
      />
      {error && (
        <div className="rounded border border-danger/50 bg-danger/10 p-3 text-sm space-y-2">
          <div className="text-danger font-medium">Couldn't connect: {error.code}</div>
          <div className="text-fg-muted">{error.message}</div>
          {error.code === 'MISSING_INTENTS' && (
            <button className="text-accent underline" onClick={goToIntents}>← Back to intents step</button>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <button className="px-3 py-2 rounded border border-border hover:bg-bg-subtle" onClick={onBack} disabled={busy}>← Back</button>
        <button
          className="px-3 py-2 rounded bg-accent text-white hover:bg-accent-hover disabled:opacity-50"
          onClick={submit}
          disabled={busy || !token.trim()}
        >
          {busy ? 'Connecting…' : 'Save and connect'}
        </button>
      </div>
    </div>
  );
}
