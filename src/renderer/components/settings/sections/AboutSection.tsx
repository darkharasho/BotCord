import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';

const GITHUB_URL = 'https://github.com/darkharasho/BotCord';

export function AboutSection() {
  const [version, setVersion] = useState<string>('');

  useEffect(() => {
    api.system.appVersion().then(setVersion);
  }, []);

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-fg">About</h2>

      <div className="space-y-1">
        <div className="text-2xl font-semibold text-fg">BotCord</div>
        <div className="text-sm text-fg-muted">Version {version || '—'}</div>
      </div>

      <div className="space-y-2 text-sm">
        <button
          onClick={() => api.system.openExternal(GITHUB_URL)}
          className="text-accent hover:text-accent-hover underline"
        >
          GitHub repository
        </button>
      </div>

      <p className="text-[11px] text-fg-dim leading-relaxed max-w-md">
        BotCord is a desktop admin cockpit for Discord that operates through your own bot. Tokens are stored locally and encrypted via the OS keychain.
      </p>
    </div>
  );
}
