import { useEffect, useState } from 'react';
import { api } from './api';
import { DEFAULT_VOICE_INPUT_SETTINGS, DEFAULT_VOICE_INPUT_SOUNDS, type VoiceInputSettings } from '../../shared/voice-input';
import { useSaver } from '../components/settings/SavingState';

// In-process broadcast so multiple components (settings panel, voice footer)
// stay in sync after one of them persists. Each call to setShared() updates
// every mounted hook instance synchronously without a round-trip to the DB.
type Listener = (s: VoiceInputSettings) => void;
const listeners = new Set<Listener>();
let cached: VoiceInputSettings | null = null;
let loadPromise: Promise<VoiceInputSettings> | null = null;

function loadOnce(): Promise<VoiceInputSettings> {
  if (cached) return Promise.resolve(cached);
  if (loadPromise) return loadPromise;
  loadPromise = api.prefs.get('voiceInput').then(r => {
    // Merge stored data over defaults so older saved blobs missing newer
    // fields (e.g. `sounds`) hydrate cleanly without crashing consumers.
    const stored = (r.ok && r.data && typeof r.data === 'object') ? (r.data as Partial<VoiceInputSettings>) : {};
    const next: VoiceInputSettings = {
      ...DEFAULT_VOICE_INPUT_SETTINGS,
      ...stored,
      sounds: { ...DEFAULT_VOICE_INPUT_SOUNDS, ...(stored.sounds ?? {}) },
    };
    cached = next;
    return next;
  });
  return loadPromise;
}

function broadcast(next: VoiceInputSettings): void {
  cached = next;
  for (const l of listeners) l(next);
}

export function useVoiceInputPrefs(): [VoiceInputSettings, (next: VoiceInputSettings) => void] {
  const [settings, setSettings] = useState<VoiceInputSettings>(cached ?? DEFAULT_VOICE_INPUT_SETTINGS);
  const { trigger } = useSaver();

  useEffect(() => {
    let mounted = true;
    void loadOnce().then((next) => { if (mounted) setSettings(next); });
    const listener: Listener = (next) => setSettings(next);
    listeners.add(listener);
    return () => { listeners.delete(listener); mounted = false; };
  }, []);

  const persist = (next: VoiceInputSettings) => {
    broadcast(next);
    trigger(api.prefs.set('voiceInput', next));
  };

  return [settings, persist];
}
