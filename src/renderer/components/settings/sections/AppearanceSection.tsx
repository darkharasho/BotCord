import { IconPalette } from '@tabler/icons-react';
import { SectionHeader } from './AccountSection';

export function AppearanceSection() {
  return (
    <div className="max-w-2xl space-y-8">
      <SectionHeader title="Appearance" subtitle="Theming and visual preferences." />

      <div className="relative overflow-hidden rounded-xl border border-border bg-bg-input p-8 text-center">
        <div className="absolute inset-0 opacity-[0.05] bg-[radial-gradient(circle_at_center,theme(colors.accent.DEFAULT),transparent_60%)] pointer-events-none" />
        <div className="relative flex flex-col items-center gap-3 text-fg-muted">
          <div className="w-12 h-12 rounded-full bg-bg border border-border flex items-center justify-center">
            <IconPalette size={22} stroke={1.75} className="text-accent" />
          </div>
          <div className="space-y-1">
            <div className="text-sm font-semibold text-fg">Theme customization coming soon</div>
            <p className="text-xs text-fg-dim max-w-sm">
              We're working on light, high-contrast, and custom accent themes. For now, BotCord runs on a fixed dark palette.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
