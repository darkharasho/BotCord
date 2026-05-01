import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import type { BotIdentity } from '../../../../shared/domain';
import { pushToast } from '../../Toaster';

const INTENT_LABELS = [
  'Guilds',
  'Guild Messages',
  'Message Content',
  'Guild Members',
  'Guild Presences',
  'Voice States',
  'Reactions',
  'Polls',
  'Typing',
];

export function AccountSection() {
  const [identity, setIdentity] = useState<BotIdentity | null>(null);
  const [busy, setBusy] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    api.bot.getStatus().then(s => {
      if (s.kind === 'configured') setIdentity(s.identity);
    });
  }, []);

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
    const url = res.data as string;
    setInviteUrl(url);
    api.system.openExternal(url);
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-fg">Account</h2>

      {identity && (
        <div className="flex items-center gap-3">
          {identity.avatarUrl && <img src={identity.avatarUrl} alt="" className="w-16 h-16 rounded-full" />}
          <div>
            <div className="text-base font-semibold text-fg">{identity.username}</div>
            <div className="text-xs text-fg-muted">ID: {identity.id}</div>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <button
          className="px-3 py-2 rounded bg-accent text-white hover:bg-accent-hover disabled:opacity-50"
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

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-fg">Required intents</h3>
        <p className="text-[11px] text-fg-muted">
          BotCord requests these gateway intents. Configure them in your bot's Discord developer portal.
        </p>
        <ul className="text-xs text-fg-muted grid grid-cols-2 gap-1">
          {INTENT_LABELS.map(name => (
            <li key={name} className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-ok" />
              {name}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
