import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconX } from '@tabler/icons-react';
import { api } from '../../lib/api';
import { SettingsSidebar } from './SettingsSidebar';
import { DEFAULT_SECTION, type SectionId } from './types';
import { AccountSection } from './sections/AccountSection';
import { ConnectionsSection } from './sections/ConnectionsSection';
import { AppearanceSection } from './sections/AppearanceSection';
import { NotificationsSection } from './sections/NotificationsSection';
import { AutonomySection } from './sections/AutonomySection';
import { ServersSection } from './sections/ServersSection';
import { AboutSection } from './sections/AboutSection';

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
    <div className="fixed inset-0 bg-black/70 z-50 flex" onClick={onClose}>
      <div
        className="m-auto w-[90vw] h-[90vh] max-w-[1100px] bg-bg-subtle border border-border rounded-lg flex overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <SettingsSidebar active={active} onSelect={setActive} onResetToken={resetToken} />
        <div className="flex-1 flex flex-col min-w-0">
          <div className="h-12 shrink-0 px-6 flex items-center justify-end border-b border-border">
            <button
              aria-label="Close settings"
              onClick={onClose}
              className="text-fg-muted hover:text-fg p-1 rounded hover:bg-hover"
            >
              <IconX size={18} stroke={2} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-8 py-6">
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
  );
}
