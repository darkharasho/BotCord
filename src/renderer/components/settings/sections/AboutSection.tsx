import { useEffect, useState } from 'react';
import { IconBrandGithub, IconBug, IconRefresh } from '@tabler/icons-react';
import { api } from '../../../lib/api';
import { SectionHeader } from './AccountSection';

const GITHUB_URL = 'https://github.com/darkharasho/BotCord';
const ISSUES_URL = 'https://github.com/darkharasho/BotCord/issues';

type CheckState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'up-to-date' }
  | { kind: 'available'; version: string }
  | { kind: 'downloaded'; version: string }
  | { kind: 'error'; message: string };

export function AboutSection() {
  const [version, setVersion] = useState<string>('');
  const [checkState, setCheckState] = useState<CheckState>({ kind: 'idle' });

  useEffect(() => {
    api.system.appVersion().then(setVersion);
  }, []);

  useEffect(() => {
    const offStatus = api.update.onStatus((s) => {
      if (s === 'checking') setCheckState({ kind: 'checking' });
      else if (s === 'up-to-date') setCheckState({ kind: 'up-to-date' });
    });
    const offAvail = api.update.onAvailable((info) => setCheckState({ kind: 'available', version: info.version }));
    const offDone = api.update.onDownloaded((info) => setCheckState({ kind: 'downloaded', version: info.version }));
    const offErr = api.update.onError((info) => setCheckState({ kind: 'error', message: info.message }));
    return () => { offStatus(); offAvail(); offDone(); offErr(); };
  }, []);

  const checking = checkState.kind === 'checking';

  return (
    <div className="max-w-2xl space-y-8">
      <SectionHeader title="About" subtitle="Version info and project links." />

      <div className="relative overflow-hidden rounded-xl border border-border bg-gradient-to-br from-bg-input via-bg-subtle to-bg-sunken p-6">
        <div className="absolute inset-0 opacity-[0.06] bg-[radial-gradient(circle_at_top_right,theme(colors.accent.DEFAULT),transparent_55%)] pointer-events-none" />
        <div className="relative flex items-end justify-between gap-6">
          <div className="space-y-1">
            <div className="text-3xl font-bold text-fg tracking-tight">BotCord</div>
            <p className="text-xs text-fg-muted max-w-sm leading-relaxed">
              A desktop admin cockpit for Discord that operates through your own bot. Tokens are stored locally and encrypted via the OS keychain.
            </p>
          </div>
          <div className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-accent/40 bg-accent/10 text-accent text-xs font-mono font-semibold">
            v{version || '—'}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-bg-input p-4 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm text-fg font-medium">Updates</div>
          <div className="text-xs text-fg-muted truncate">{describeCheckState(checkState)}</div>
        </div>
        {checkState.kind === 'downloaded' ? (
          <button
            onClick={() => api.update.install()}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors"
          >
            Restart and install
          </button>
        ) : (
          <button
            onClick={() => { setCheckState({ kind: 'checking' }); api.update.check(); }}
            disabled={checking}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-bg-subtle hover:bg-hover hover:border-accent/50 text-fg text-sm font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <IconRefresh size={16} stroke={2} className={checking ? 'animate-spin' : undefined} />
            {checking ? 'Checking…' : 'Check for updates'}
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <LinkCard
          icon={<IconBrandGithub size={18} stroke={2} />}
          label="Source code"
          href={GITHUB_URL}
        />
        <LinkCard
          icon={<IconBug size={18} stroke={2} />}
          label="Report an issue"
          href={ISSUES_URL}
        />
      </div>
    </div>
  );
}

function describeCheckState(s: CheckState): string {
  switch (s.kind) {
    case 'idle': return 'Click to check whether a newer version is available.';
    case 'checking': return 'Checking for updates…';
    case 'up-to-date': return 'You’re on the latest version.';
    case 'available': return `Update available: v${s.version} — downloading in the background.`;
    case 'downloaded': return `v${s.version} downloaded. Restart to install.`;
    case 'error': return `Update check failed: ${s.message}`;
  }
}

function LinkCard({ icon, label, href }: { icon: React.ReactNode; label: string; href: string }) {
  return (
    <button
      onClick={() => api.system.openExternal(href)}
      className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-bg-input hover:border-accent/50 hover:bg-hover transition-colors text-left"
    >
      <span className="text-fg-muted">{icon}</span>
      <span className="text-sm text-fg font-medium">{label}</span>
    </button>
  );
}
