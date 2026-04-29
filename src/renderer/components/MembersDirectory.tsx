export function MembersDirectory({ guildId }: { guildId: string | null }) {
  return (
    <main className="flex-1 min-h-0 bg-bg-sunken text-fg p-6 border-t border-l border-white/[0.04]">
      <h1 className="text-lg font-semibold">Members</h1>
      <p className="text-fg-dim text-sm mt-1">Guild: {guildId ?? '—'}</p>
    </main>
  );
}
