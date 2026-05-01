import { useEffect, useState } from 'react';
import { IconBrandGithub, IconBug } from '@tabler/icons-react';
import { api } from '../../../lib/api';
import { SectionHeader } from './AccountSection';

const GITHUB_URL = 'https://github.com/darkharasho/BotCord';
const ISSUES_URL = 'https://github.com/darkharasho/BotCord/issues';

export function AboutSection() {
  const [version, setVersion] = useState<string>('');

  useEffect(() => {
    api.system.appVersion().then(setVersion);
  }, []);

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
