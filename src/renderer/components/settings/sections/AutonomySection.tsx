import { GlobalAutonomySettings } from '../../GlobalAutonomySettings';

export function AutonomySection() {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-fg">Autonomy</h2>
      <GlobalAutonomySettings />
    </div>
  );
}
