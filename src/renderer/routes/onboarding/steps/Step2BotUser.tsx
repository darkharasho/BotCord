import { ScreenshotSlot } from '../../../components/Placeholder';

export function Step2BotUser({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">2. Add a bot user</h2>
      <p className="text-fg-muted">
        In your application's left sidebar, click <strong>Bot</strong>. Discord will create a bot user for the application automatically.
      </p>
      <ScreenshotSlot name="step-2-bot-tab" alt="Bot tab in the developer portal sidebar" />
      <div className="flex gap-2">
        <button className="px-3 py-2 rounded border border-border hover:bg-bg-subtle" onClick={onBack}>← Back</button>
        <button className="px-3 py-2 rounded bg-accent text-white hover:bg-accent-hover" onClick={onNext}>Next →</button>
      </div>
    </div>
  );
}
