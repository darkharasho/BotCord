import { api } from '../../../lib/api';
import { ScreenshotSlot } from '../../../components/Placeholder';

export function Step1Application({ onNext }: { onNext: () => void }) {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">1. Create a Discord application</h2>
      <p className="text-fg-muted">
        Open the Discord Developer Portal and click "New Application". Pick a name — this is what your bot will be called.
      </p>
      <ScreenshotSlot name="step-1-new-application" alt="Developer portal new application button" />
      <div className="flex gap-2">
        <button
          className="px-3 py-2 rounded bg-accent text-white hover:bg-accent-hover"
          onClick={() => api.system.openExternal('https://discord.com/developers/applications')}
        >
          Open Developer Portal
        </button>
        <button className="px-3 py-2 rounded border border-border hover:bg-bg-subtle" onClick={onNext}>
          I've created an application →
        </button>
      </div>
    </div>
  );
}
