import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { DMChannelRow, MemberSummary } from '@shared/domain';

type Match = MemberSummary & { guildName: string };

export function NewDMModal({
  onClose, onOpened,
}: {
  onClose: () => void;
  onOpened: (row: DMChannelRow) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Match[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); return; }
    let cancelled = false;
    (async () => {
      const guildsRes = await api.guilds.list();
      console.log('[NewDMModal] guilds.list →', guildsRes);
      if (!guildsRes.ok || cancelled) return;
      const all: Match[] = [];
      const seen = new Set<string>();
      await Promise.all(guildsRes.data.map(async g => {
        const res = await api.guilds.searchMembers(g.id, q, { limit: 10 });
        console.log('[NewDMModal] searchMembers', g.name, q, '→', res);
        if (!res.ok) return;
        for (const m of res.data) {
          if (seen.has(m.id)) continue;
          seen.add(m.id);
          all.push({ ...m, guildName: g.name });
        }
      }));
      console.log('[NewDMModal] total results', all.length);
      if (!cancelled) setResults(all.slice(0, 25));
    })();
    return () => { cancelled = true; };
  }, [query]);

  const open = async (userId: string) => {
    setBusy(true); setError(null);
    const res = await api.dms.openWithUser(userId);
    setBusy(false);
    if (!res.ok) {
      setError(res.error.code === 'MISSING_PERMISSIONS'
        ? 'This user has DMs disabled or shares no servers with the bot.'
        : res.error.message);
      return;
    }
    onOpened(res.data);
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 animate-fade-in"
      onMouseDown={onClose}
    >
      <div
        className="w-[420px] max-w-[90vw] rounded-md border border-white/[0.08] bg-bg-subtle p-4 shadow-2xl"
        onMouseDown={e => e.stopPropagation()}
      >
        <h2 className="mb-2 text-[16px] font-semibold text-fg">New direct message</h2>
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search members across servers"
          className="w-full rounded bg-bg-input px-2 py-1.5 text-sm text-fg placeholder:text-fg-dim focus:outline-none"
        />
        {error && <div className="mt-2 rounded bg-danger/20 px-2 py-1 text-sm text-danger">{error}</div>}
        <div className="mt-2 max-h-72 overflow-y-auto">
          {results.map(r => (
            <button
              key={r.id}
              type="button"
              disabled={busy}
              onClick={() => open(r.id)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-hover disabled:opacity-50"
            >
              {r.avatarUrl
                ? <img src={r.avatarUrl} alt="" className="h-7 w-7 rounded-full bg-bg-input shrink-0" />
                : <div className="h-7 w-7 rounded-full bg-bg-input shrink-0" />}
              <div className="min-w-0 flex-1">
                <div
                  className="truncate text-sm text-fg"
                  style={r.roleColor ? { color: r.roleColor } : undefined}
                >
                  {r.displayName}
                </div>
                <div className="truncate text-xs text-fg-dim">{r.username} · {r.guildName}</div>
              </div>
            </button>
          ))}
          {query.trim().length >= 2 && results.length === 0 && (
            <div className="p-3 text-center text-sm text-fg-dim">No matches</div>
          )}
        </div>
      </div>
    </div>
  );
}
