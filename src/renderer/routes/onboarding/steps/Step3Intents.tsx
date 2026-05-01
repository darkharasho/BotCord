import { ScreenshotSlot } from '../../../components/Placeholder';

export function Step3Intents({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">3. Enable privileged intents</h2>
      <p className="text-fg-muted">On the Bot tab, scroll to <strong>Privileged Gateway Intents</strong> and toggle all three on:</p>
      <ul className="list-disc pl-6 text-fg-muted space-y-1">
        <li><strong>Presence Intent</strong> — required to see members come online.</li>
        <li><strong>Server Members Intent</strong> — required to list members and resolve mentions.</li>
        <li><strong>Message Content Intent</strong> — required to read message bodies for history and bulk-delete.</li>
      </ul>
      <ScreenshotSlot name="step-3-intents" alt="Privileged Gateway Intents toggles" />
      <p className="text-fg-muted text-sm">BotCord also uses these non-privileged intents (no toggle needed):</p>
      <ul className="list-disc pl-6 text-fg-muted space-y-1">
        <li><strong>Direct Messages Intent</strong> — enables sending and receiving direct messages with users the bot shares servers with.</li>
      </ul>
      <div className="flex gap-2">
        <button className="px-3 py-2 rounded border border-border hover:bg-bg-subtle" onClick={onBack}>← Back</button>
        <button className="px-3 py-2 rounded bg-accent text-white hover:bg-accent-hover" onClick={onNext}>Next →</button>
      </div>
    </div>
  );
}
