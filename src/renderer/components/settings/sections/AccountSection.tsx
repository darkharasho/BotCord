import { useEffect, useState } from 'react';
import { IconExternalLink, IconCopy, IconCheck } from '@tabler/icons-react';
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
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.bot.getStatus().then(s => {
      if (s.kind === 'configured') setIdentity(s.identity);
    });
  }, []);

  const invite = async () => {
    setBusy(true);
    setInviteUrl(undefined);
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

  const copyInvite = () => {
    if (!inviteUrl) return;
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    pushToast('ok', 'Invite URL copied');
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="max-w-2xl space-y-8">
      <SectionHeader title="Account" subtitle="Bot identity and invite controls." />

      {identity && (
        <div className="relative overflow-hidden rounded-xl border border-border bg-gradient-to-br from-bg-input to-bg-sunken">
          <div className="absolute inset-0 opacity-[0.07] bg-[radial-gradient(circle_at_top_left,theme(colors.accent.DEFAULT),transparent_60%)] pointer-events-none" />
          <div className="relative flex items-center gap-4 p-5">
            {identity.avatarUrl
              ? <img src={identity.avatarUrl} alt="" className="w-16 h-16 rounded-full ring-2 ring-border" />
              : <div className="w-16 h-16 rounded-full bg-bg-subtle flex items-center justify-center text-lg font-semibold text-fg">{identity.username.slice(0, 2).toUpperCase()}</div>
            }
            <div className="min-w-0">
              <div className="text-lg font-semibold text-fg truncate">{identity.username}</div>
              <code className="text-[11px] text-fg-dim font-mono">{identity.id}</code>
            </div>
          </div>
        </div>
      )}

      <Subsection title="Invite">
        <button
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors"
          onClick={invite}
          disabled={busy}
        >
          <IconExternalLink size={15} stroke={2} />
          Invite bot to a new server
        </button>
        {inviteUrl && (
          <div className="mt-3 space-y-1.5 animate-fade-in-up">
            <div className="text-xs text-fg-muted">Opened in your browser. Pick a server, then approve.</div>
            <button
              onClick={copyInvite}
              className="w-full flex items-start gap-2 text-left bg-bg-input border border-border rounded-md px-3 py-2 hover:border-accent/50 transition-colors group"
              title="Click to copy"
            >
              <span className="flex-1 break-all font-mono text-[11px] text-fg-muted group-hover:text-fg">{inviteUrl}</span>
              {copied
                ? <IconCheck size={14} className="text-ok shrink-0 mt-0.5" />
                : <IconCopy size={14} className="text-fg-dim group-hover:text-fg-muted shrink-0 mt-0.5" />}
            </button>
          </div>
        )}
      </Subsection>

      <Subsection title="Required intents" subtitle="Enable these in your bot's Discord developer portal.">
        <ul className="grid grid-cols-2 gap-2">
          {INTENT_LABELS.map(name => (
            <li key={name} className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-bg-input border border-border text-xs text-fg">
              <span className="w-1.5 h-1.5 rounded-full bg-ok" />
              {name}
            </li>
          ))}
        </ul>
      </Subsection>
    </div>
  );
}

export function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <h2 className="text-2xl font-bold text-fg tracking-tight">{title}</h2>
      {subtitle && <p className="text-sm text-fg-muted mt-1">{subtitle}</p>}
    </div>
  );
}

function Subsection({
  title, subtitle, children,
}: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-dim">{title}</h3>
        {subtitle && <p className="text-xs text-fg-muted mt-1">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}
