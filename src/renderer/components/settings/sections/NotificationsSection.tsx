import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { CheckBox } from '../../CheckBox';
import { SectionHeader } from './AccountSection';
import { useSaver } from '../SavingState';

export function NotificationsSection() {
  const [closeToTray, setCloseToTray] = useState<boolean | null>(null);
  const { trigger } = useSaver();

  useEffect(() => {
    api.prefs.get('closeToTray').then(res => {
      setCloseToTray(res.ok && typeof res.data === 'boolean' ? res.data : true);
    });
  }, []);

  if (closeToTray === null) return null;

  const toggleTray = () => {
    const next = !closeToTray;
    setCloseToTray(next);
    trigger(api.prefs.set('closeToTray', next));
  };

  return (
    <div className="max-w-2xl space-y-8">
      <SectionHeader title="Notifications" subtitle="Control how BotCord surfaces activity." />

      <ToggleRow
        title="Minimize to system tray on close"
        description="When off, clicking the close button quits BotCord. macOS uses the dock and ignores this."
        checked={closeToTray}
        onChange={toggleTray}
        ariaLabel="Minimize to tray on close"
      />
    </div>
  );
}

function ToggleRow({
  title, description, checked, onChange, ariaLabel,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: () => void;
  ariaLabel: string;
}) {
  return (
    <label className="flex items-start gap-3 p-4 rounded-xl border border-border bg-bg-input cursor-pointer hover:border-border/0 hover:bg-hover/40 transition-colors">
      <CheckBox checked={checked} onChange={onChange} ariaLabel={ariaLabel} />
      <span className="flex-1">
        <span className="block text-sm text-fg font-medium">{title}</span>
        <span className="block text-[11px] text-fg-muted mt-0.5 leading-relaxed">{description}</span>
      </span>
    </label>
  );
}
