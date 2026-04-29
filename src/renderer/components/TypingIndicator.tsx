import { useTypingIndicators } from '../lib/use-typing';

// "X is typing…" strip rendered between the message list and the composer.
// Empty when nobody's typing — the height collapses so it doesn't push the
// composer up unless there's actually a typer.
export function TypingIndicator({ channelId }: { channelId: string | null }) {
  const names = useTypingIndicators(channelId);
  if (names.length === 0) return <div className="h-[18px] shrink-0" aria-hidden />;
  return (
    <div className="h-[18px] shrink-0 px-4 flex items-center gap-1.5 text-[12px] text-fg-muted leading-none animate-fade-in">
      <span className="flex items-center gap-0.5">
        <span className="w-1 h-1 rounded-full bg-fg-muted animate-bounce [animation-delay:-0.24s]" />
        <span className="w-1 h-1 rounded-full bg-fg-muted animate-bounce [animation-delay:-0.12s]" />
        <span className="w-1 h-1 rounded-full bg-fg-muted animate-bounce" />
      </span>
      <span className="truncate">{describe(names)}</span>
    </div>
  );
}

function describe(names: string[]): string {
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]} are typing…`;
  return 'Several people are typing…';
}
