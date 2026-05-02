import { useMemo, useState } from 'react';
import { IconPhoneOff } from '@tabler/icons-react';
import type { ChannelSummary, VoiceConnectionState } from '../../../shared/domain';
import { DEFAULT_VOICE_INPUT_SETTINGS, type VoiceInputSettings } from '../../../shared/voice-input';
import { useMic } from '../../lib/use-mic';
import { MicIndicator } from './MicIndicator';

// Until Task 13 wires prefs, settings live in component-local state. Task 13
// will replace this with a prefs-backed hook so settings persist and sync
// with the settings panel.
function useVoiceInputSettingsLocal(): [VoiceInputSettings, (next: VoiceInputSettings) => void] {
  return useState<VoiceInputSettings>(DEFAULT_VOICE_INPUT_SETTINGS);
}

export function VoiceConnectionFooter(props: {
  voiceState: VoiceConnectionState;
  channels: ChannelSummary[];
}) {
  const [settings, setSettings] = useVoiceInputSettingsLocal();
  const connected = props.voiceState.kind === 'connected';
  const channel = useMemo(() => {
    const vs = props.voiceState;
    if (vs.kind !== 'connected' && vs.kind !== 'connecting') return null;
    return props.channels.find((c) => c.id === vs.channelId) ?? null;
  }, [props.voiceState, props.channels]);

  const mic = useMic({
    enabled: connected,
    settings,
    onPersist: setSettings,
  });

  if (!connected && props.voiceState.kind !== 'connecting') return null;

  const channelLabel = channel?.name ?? 'voice';
  const stateLabel = props.voiceState.kind === 'connecting' ? 'Connecting…' : `In #${channelLabel}`;

  return (
    <div className="flex items-center gap-2 px-2 py-2 border-t border-zinc-800 bg-zinc-900/60">
      <div className="flex-1 min-w-0">
        <div className="text-xs text-emerald-400 truncate">{stateLabel}</div>
        {mic.permissionDenied && (
          <div className="text-[10px] text-amber-400 truncate">Microphone access denied</div>
        )}
      </div>
      <MicIndicator
        muted={settings.muted}
        speaking={mic.gateOpen}
        onClick={() => setSettings({ ...settings, muted: !settings.muted })}
      />
      <button
        type="button"
        onClick={() => { void window.botcord.voice.leave(); }}
        title="Leave voice channel"
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-rose-400 hover:bg-rose-500/10 transition"
      >
        <IconPhoneOff size={16} stroke={2} />
      </button>
    </div>
  );
}
