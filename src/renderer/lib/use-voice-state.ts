import { useEffect, useState } from 'react';
import type { VoiceConnectionState } from '../../shared/domain';
import { startVoiceSink, stopVoiceSink } from './voice-sink';

export function useVoiceState(): VoiceConnectionState {
  const [state, setState] = useState<VoiceConnectionState>({ kind: 'idle' });
  useEffect(() => {
    void window.botcord.voice.getState().then(setState);
    const off = window.botcord.voice.onState((next) => {
      setState(next);
      // Manage the audio sink lifecycle alongside the connection — start
      // it on `connected` so the user hears audio immediately, tear down
      // on `idle`/`error` so we release the AudioContext.
      if (next.kind === 'connected') void startVoiceSink();
      else if (next.kind === 'idle' || next.kind === 'error' || next.kind === 'disconnected') void stopVoiceSink();
    });
    return () => off();
  }, []);
  return state;
}
