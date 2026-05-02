import { IconMicrophone, IconMicrophoneOff } from '@tabler/icons-react';

export function MicIndicator(props: {
  muted: boolean;
  speaking: boolean;
  onClick?: () => void;
  title?: string;
}) {
  const Icon = props.muted ? IconMicrophoneOff : IconMicrophone;
  // Tailwind classes follow the existing conventions in this codebase (zinc/emerald/rose).
  const colorClass = props.muted
    ? 'text-rose-400 hover:bg-rose-500/10'
    : props.speaking
      ? 'text-emerald-400 bg-emerald-500/10'
      : 'text-zinc-300 hover:bg-zinc-700/50';
  return (
    <button
      type="button"
      onClick={props.onClick}
      title={props.title ?? (props.muted ? 'Unmute microphone' : 'Mute microphone')}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition ${colorClass}`}
    >
      <Icon size={16} stroke={2} />
    </button>
  );
}
