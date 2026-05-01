import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconX } from '@tabler/icons-react';
import { api } from '../../lib/api';
import { SettingsSidebar } from './SettingsSidebar';
import { DEFAULT_SECTION, NAV_GROUPS, type SectionId } from './types';
import { AccountSection } from './sections/AccountSection';
import { ConnectionsSection } from './sections/ConnectionsSection';
import { AppearanceSection } from './sections/AppearanceSection';
import { NotificationsSection } from './sections/NotificationsSection';
import { AutonomySection } from './sections/AutonomySection';
import { ServersSection } from './sections/ServersSection';
import { AboutSection } from './sections/AboutSection';
import { SavingIndicator, SavingStateProvider } from './SavingState';

const SECTION_LABEL: Record<SectionId, string> = Object.fromEntries(
  NAV_GROUPS.flatMap(g => g.items.map(i => [i.id, i.label] as const)),
) as Record<SectionId, string>;

export function SettingsOverlay({ onClose }: { onClose: () => void }) {
  const [active, setActive] = useState<SectionId>(DEFAULT_SECTION);
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const resetToken = async () => {
    if (!confirm('Reset bot token? You will need to re-paste it on next launch.')) return;
    await api.bot.clearToken();
    navigate('/onboarding', { replace: true });
  };

  return (
    <SavingStateProvider>
    <div
      className="fixed inset-0 z-50 flex bg-black/70 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="m-auto w-[92vw] h-[92vh] max-w-[1180px] flex overflow-hidden rounded-xl border border-border bg-bg-subtle shadow-2xl shadow-black/40 animate-lightbox-in"
        onClick={(e) => e.stopPropagation()}
      >
        <SettingsSidebar active={active} onSelect={setActive} onResetToken={resetToken} />
        <div className="flex-1 flex flex-col min-w-0">
          <div className="h-14 shrink-0 px-8 flex items-center justify-between border-b border-border bg-bg-subtle/60 backdrop-blur">
            <div className="flex items-center gap-3">
              <div key={active} className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-dim animate-fade-in">
                {SECTION_LABEL[active]}
              </div>
              <SavingIndicator />
            </div>
            <button
              aria-label="Close settings"
              onClick={onClose}
              className="text-fg-muted hover:text-fg p-1.5 rounded-md hover:bg-hover transition-colors"
            >
              <IconX size={18} stroke={2} />
            </button>
          </div>
          <div key={active} className="flex-1 overflow-y-auto px-10 py-8 animate-fade-in-up">
            {active === 'account' && <AccountSection />}
            {active === 'connections' && <ConnectionsSection />}
            {active === 'appearance' && <AppearanceSection />}
            {active === 'notifications' && <NotificationsSection />}
            {active === 'autonomy' && <AutonomySection />}
            {active === 'servers' && <ServersSection />}
            {active === 'about' && <AboutSection />}
          </div>
        </div>
      </div>
    </div>
    </SavingStateProvider>
  );
}
