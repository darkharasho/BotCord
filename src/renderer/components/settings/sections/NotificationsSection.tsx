import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { CheckBox } from '../../CheckBox';

export function NotificationsSection() {
  const [closeToTray, setCloseToTray] = useState<boolean | null>(null);

  useEffect(() => {
    api.prefs.get('closeToTray').then(res => {
      setCloseToTray(res.ok && typeof res.data === 'boolean' ? res.data : true);
    });
  }, []);

  if (closeToTray === null) return null;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-fg">Notifications</h2>
      <label className="flex items-start gap-2 text-sm cursor-pointer">
        <CheckBox
          checked={closeToTray}
          onChange={() => {
            const next = !closeToTray;
            setCloseToTray(next);
            api.prefs.set('closeToTray', next);
          }}
          ariaLabel="Minimize to tray on close"
        />
        <span>
          Minimize to system tray on close
          <span className="block text-[11px] text-fg-muted">
            When off, clicking the close button quits BotCord. macOS uses the dock and ignores this.
          </span>
        </span>
      </label>
    </div>
  );
}
