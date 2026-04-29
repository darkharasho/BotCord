import { IconSearch } from '@tabler/icons-react';

export function MembersToolbar({
  search, onSearch,
  totalCount, filteredCount, intentMissing,
}: {
  search: string;
  onSearch: (q: string) => void;
  totalCount: number;
  filteredCount: number;
  intentMissing: boolean;
}) {
  const isFiltered = search.trim().length > 0 || filteredCount !== totalCount;
  return (
    <div className="px-4 py-3 border-b border-white/[0.04] flex items-center gap-3">
      <div className="relative flex-1 max-w-[320px]">
        <IconSearch size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-dim" />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search members…"
          className="w-full pl-8 pr-2 py-1.5 text-[13px] rounded bg-bg-input border border-white/[0.08] text-fg outline-none focus:border-accent"
        />
      </div>
      <div className="ml-auto text-fg-dim text-[12px]">
        {isFiltered ? `${filteredCount} of ${totalCount} members` : `${totalCount} members`}
        {intentMissing && <span className="ml-2 text-warn">(cached only)</span>}
      </div>
    </div>
  );
}
