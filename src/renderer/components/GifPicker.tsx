import { useEffect, useRef, useState } from 'react';
import { IconSearch, IconX } from '@tabler/icons-react';

const KEY = (import.meta.env.VITE_GIPHY_API_KEY as string | undefined) ?? '';

type GiphyImage = { url: string; width: string; height: string };
type GiphyResult = {
  id: string;
  url: string;       // share page url
  title: string;
  images: {
    original: GiphyImage;
    fixed_height_small: GiphyImage;
    fixed_width_downsampled: GiphyImage;
    preview_gif: GiphyImage;
  };
};

type GifEntry = { id: string; pageUrl: string; previewUrl: string; alt: string };

async function fetchGiphy(path: 'trending' | 'search', query?: string): Promise<GifEntry[]> {
  if (!KEY) return [];
  const url = new URL(`https://api.giphy.com/v1/gifs/${path}`);
  url.searchParams.set('api_key', KEY);
  url.searchParams.set('limit', '24');
  url.searchParams.set('rating', 'pg-13');
  if (query) url.searchParams.set('q', query);
  const res = await fetch(url.toString());
  if (!res.ok) return [];
  const data = await res.json() as { data: GiphyResult[] };
  return data.data.map(r => ({
    id: r.id,
    pageUrl: r.url,
    previewUrl: r.images.fixed_width_downsampled?.url ?? r.images.fixed_height_small?.url ?? r.images.preview_gif?.url ?? r.images.original.url,
    alt: r.title,
  })).filter(g => g.previewUrl);
}

export function GifPicker({ onSelect, onClose }: { onSelect: (url: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GifEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const lastReq = useRef(0);

  useEffect(() => {
    const id = ++lastReq.current;
    setLoading(true);
    const handle = setTimeout(() => {
      const q = query.trim();
      const fetcher = q ? fetchGiphy('search', q) : fetchGiphy('trending');
      fetcher.then(r => {
        if (id !== lastReq.current) return;
        setResults(r);
        setLoading(false);
      });
    }, query ? 250 : 0);
    return () => clearTimeout(handle);
  }, [query]);

  return (
    <div className="absolute bottom-full right-0 mb-2 w-[420px] max-h-[480px] bg-bg-subtle border border-white/[0.06] rounded-lg shadow-2xl flex flex-col z-50">
      <div className="px-3 py-2 border-b border-white/[0.06] flex items-center gap-2">
        <IconSearch size={14} stroke={2} className="text-fg-dim shrink-0" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search GIPHY"
          className="flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-dim min-w-0"
        />
        <button onClick={onClose} className="text-fg-muted hover:text-fg shrink-0" title="Close">
          <IconX size={16} stroke={2} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {!KEY && (
          <div className="text-fg-muted text-xs p-3 leading-relaxed">
            <p className="mb-2 font-semibold text-fg">GIPHY API key required</p>
            <p>Create a free key at <span className="text-accent">developers.giphy.com</span> and add it to <code className="bg-bg-input px-1 rounded">.env.local</code>:</p>
            <pre className="mt-2 bg-bg-input rounded p-2 text-[11px]">VITE_GIPHY_API_KEY=your_key_here</pre>
            <p className="mt-2">Then restart <code className="bg-bg-input px-1 rounded">npm run dev</code>.</p>
          </div>
        )}
        {KEY && loading && results.length === 0 && (
          <div className="text-fg-dim text-xs p-3 text-center">Loading…</div>
        )}
        {KEY && !loading && results.length === 0 && (
          <div className="text-fg-dim text-xs p-3 text-center">No GIFs found</div>
        )}
        {results.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {results.map(g => (
              <button
                key={g.id}
                onClick={() => { onSelect(g.pageUrl); onClose(); }}
                className="block rounded overflow-hidden bg-bg-input hover:ring-2 hover:ring-accent transition"
                title={g.alt}
              >
                <img src={g.previewUrl} alt={g.alt} loading="lazy" className="w-full h-32 object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
