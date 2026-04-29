// Visual placeholder shown while a channel's history is loading. Mirrors
// MessageGroup's geometry (avatar column + author row + body lines) so the
// real content slots in without a layout jump. Each row's shape is varied
// pseudo-randomly by index so the list reads like real conversation rather
// than a stack of identical bars.

const ROW_SHAPES: { author: string; body: string[] }[] = [
  { author: 'w-24', body: ['w-[68%]', 'w-[42%]'] },
  { author: 'w-20', body: ['w-[55%]'] },
  { author: 'w-28', body: ['w-[80%]', 'w-[34%]'] },
  { author: 'w-16', body: ['w-[48%]', 'w-[62%]', 'w-[28%]'] },
  { author: 'w-24', body: ['w-[40%]'] },
  { author: 'w-20', body: ['w-[72%]', 'w-[36%]'] },
];

const SHIMMER = 'bc-shimmer animate-shimmer rounded';

export function MessageSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div
      role="status"
      aria-label="Loading messages"
      aria-live="polite"
      aria-busy="true"
      className="animate-fade-in"
    >
      {Array.from({ length: count }).map((_, i) => {
        const shape = ROW_SHAPES[i % ROW_SHAPES.length]!;
        return (
          <div key={i} className="mt-4 first:mt-2 px-4">
            <div className="flex gap-4 px-4 py-0.5 -mx-4">
              <div className={`w-10 h-10 rounded-full shrink-0 ${SHIMMER}`} />
              <div className="flex-1 min-w-0 space-y-2 pt-1">
                <div className="flex items-center gap-2">
                  <div className={`h-3 ${shape.author} ${SHIMMER}`} />
                  <div className={`h-2 w-12 ${SHIMMER} opacity-60`} />
                </div>
                {shape.body.map((w, j) => (
                  <div key={j} className={`h-3 ${w} ${SHIMMER}`} />
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
