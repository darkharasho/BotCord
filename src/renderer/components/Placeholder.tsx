import { useState } from 'react';

export function ScreenshotSlot({ name, alt }: { name: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="rounded-md border border-dashed border-border bg-bg-sunken h-48 flex items-center justify-center text-fg-muted text-sm">
        [Screenshot placeholder: {name}]
      </div>
    );
  }
  return (
    <img
      src={`./resources/onboarding/${name}.png`}
      alt={alt}
      className="rounded-md border border-border max-h-64 object-contain bg-bg-sunken"
      onError={() => setFailed(true)}
    />
  );
}
