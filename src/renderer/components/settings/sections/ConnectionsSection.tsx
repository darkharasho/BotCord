import { useEffect, useState } from 'react';
import { IconKey } from '@tabler/icons-react';
import { api } from '../../../lib/api';
import { SectionHeader } from './AccountSection';
import { TextField } from '../fields';

export function ConnectionsSection() {
  const [giphyKey, setGiphyKey] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.prefs.get('giphyApiKey').then(res => {
      if (res.ok && typeof res.data === 'string') setGiphyKey(res.data);
      setLoaded(true);
    });
  }, []);

  // Persist on every change after the initial load. Typing doesn't hit the
  // network — only writes to prefs — so no debounce needed.
  useEffect(() => {
    if (!loaded) return;
    api.prefs.set('giphyApiKey', giphyKey);
  }, [giphyKey, loaded]);

  return (
    <div className="max-w-2xl space-y-8">
      <SectionHeader title="Connections" subtitle="Third-party integrations stored locally on this device." />

      <div className="rounded-xl border border-border bg-bg-input p-5 space-y-4">
        <div className="flex items-center gap-2 text-fg">
          <IconKey size={16} stroke={2} className="text-accent" />
          <span className="text-sm font-semibold">GIPHY</span>
          <span className="ml-auto text-[10px] uppercase tracking-[0.14em] text-fg-dim font-medium">
            {giphyKey ? 'Connected' : 'Not configured'}
          </span>
        </div>
        <TextField
          type="password"
          label="API Key"
          value={giphyKey}
          onChange={setGiphyKey}
          placeholder="Paste your GIPHY developer key"
          monospace
          hint={
            <>
              Required for the GIF picker. Get a free key at{' '}
              <button
                onClick={() => api.system.openExternal('https://developers.giphy.com')}
                className="text-link hover:underline"
              >
                developers.giphy.com
              </button>
              . Stored locally only.
            </>
          }
        />
      </div>
    </div>
  );
}
