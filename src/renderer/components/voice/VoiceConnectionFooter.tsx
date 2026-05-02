import { useEffect, useMemo, useRef } from 'react';
import { IconPhoneOff } from '@tabler/icons-react';
import type { ChannelSummary, VoiceConnectionState } from '../../../shared/domain';
import { useMic } from '../../lib/use-mic';
import { useVoiceInputPrefs } from '../../lib/use-voice-input-prefs';
import { useBotIdentity } from '../../lib/use-bot-identity';
import { setLocalSpeaking } from '../../lib/use-voice-speakers';
import { playVoiceSound } from '../../lib/voice-sounds';
import { MicIndicator } from './MicIndicator';

export function VoiceConnectionFooter(props: {
  voiceState: VoiceConnectionState;
  channels: ChannelSummary[];
}) {
  const [settings, setSettings] = useVoiceInputPrefs();
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

  // Drive the bot's own speaking ring from the local gate state. The receive
  // pipeline never hears the bot, so without this bridge the bot's avatar
  // would stay un-ringed even when transmitting.
  const bot = useBotIdentity();
  useEffect(() => {
    setLocalSpeaking(bot?.id, connected && mic.gateOpen && !settings.muted);
    return () => setLocalSpeaking(bot?.id, false);
  }, [bot?.id, connected, mic.gateOpen, settings.muted]);

  // Join/leave notification chimes. Compare to the previous voice-state kind
  // so we only fire on the transition, not on every connecting tick.
  const prevKind = useRef<VoiceConnectionState['kind'] | null>(null);
  useEffect(() => {
    const wasConnected = prevKind.current === 'connected';
    const isConnected = props.voiceState.kind === 'connected';
    if (!wasConnected && isConnected && settings.sounds.join) playVoiceSound('join');
    if (wasConnected && !isConnected && settings.sounds.leave) playVoiceSound('leave');
    prevKind.current = props.voiceState.kind;
  }, [props.voiceState.kind, settings.sounds.join, settings.sounds.leave]);

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
