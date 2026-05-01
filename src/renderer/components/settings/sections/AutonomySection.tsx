import { GlobalAutonomySettings } from '../../GlobalAutonomySettings';
import { SectionHeader } from './AccountSection';

export function AutonomySection() {
  return (
    <div className="max-w-3xl space-y-8">
      <SectionHeader title="Autonomy" subtitle="Global defaults for autonomous bot replies. Per-server overrides live in the Servers section." />
      <div className="rounded-xl border border-border bg-bg-input p-5">
        <GlobalAutonomySettings />
      </div>
    </div>
  );
}
