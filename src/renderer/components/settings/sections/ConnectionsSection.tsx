import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';

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
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-fg">Connections</h2>
      <div className="space-y-2">
        <label className="block text-xs font-medium text-fg-muted">GIPHY API key</label>
        <input
          type="password"
          value={giphyKey}
          onChange={(e) => setGiphyKey(e.target.value)}
          placeholder="Paste your GIPHY developer key"
          className="w-full px-3 py-2 rounded bg-bg-sunken border border-border text-fg text-sm outline-none focus:border-accent"
        />
        <p className="text-[11px] text-fg-dim leading-relaxed">
          Required for the GIF picker. Get a free key at <span className="text-accent">developers.giphy.com</span>. Stored locally only.
        </p>
      </div>
    </div>
  );
}
