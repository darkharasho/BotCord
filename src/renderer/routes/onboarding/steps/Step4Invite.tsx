import { useState } from 'react';
import { api } from '../../../lib/api';

export function Step4Invite({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [clientId, setClientId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  const generate = async () => {
    setError(null);
    const res = await api.bot.buildInviteUrl(clientId.trim());
    if (!res.ok) { setError(res.error.message); return; }
    setInviteUrl(res.data);
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">4. Invite the bot to your server</h2>
      <p className="text-fg-muted">
        On the General Information tab in the developer portal, copy your <strong>Application (Client) ID</strong> and paste it here.
      </p>
      <input
        value={clientId}
        onChange={(e) => setClientId(e.target.value)}
        placeholder="123456789012345678"
        className="w-full bg-bg-sunken border border-border rounded px-3 py-2 font-mono"
      />
      <button className="px-3 py-2 rounded bg-accent text-white hover:bg-accent-hover" onClick={generate}>
        Generate invite URL
      </button>
      {error && <div className="text-danger text-sm">{error}</div>}
      {inviteUrl && (
        <div className="space-y-2">
          <code className="block break-all text-xs bg-bg-sunken p-2 rounded border border-border">{inviteUrl}</code>
          <button
            className="px-3 py-2 rounded border border-border hover:bg-bg-subtle"
            onClick={() => api.system.openExternal(inviteUrl)}
          >
            Open invite in browser
          </button>
        </div>
      )}
      <div className="flex gap-2 pt-4">
        <button className="px-3 py-2 rounded border border-border hover:bg-bg-subtle" onClick={onBack}>← Back</button>
        <button
          className="px-3 py-2 rounded bg-accent text-white hover:bg-accent-hover disabled:opacity-50"
          disabled={!inviteUrl}
          onClick={onNext}
        >
          I've invited the bot →
        </button>
      </div>
    </div>
  );
}
