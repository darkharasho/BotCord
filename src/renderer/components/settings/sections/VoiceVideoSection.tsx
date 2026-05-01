import { useEffect, useRef, useState } from 'react';
import { IconVolume, IconMicrophone, IconAlertTriangle } from '@tabler/icons-react';
import { api } from '../../../lib/api';
import { setVoiceSinkOutput } from '../../../lib/voice-sink';
import {
  listAudioDevices,
  requestLabelPermission,
  subscribeDeviceChanges,
  type AudioDeviceLists,
} from '../../../lib/audio-devices';
import { SelectField } from '../fields/SelectField';
import { useSaver } from '../SavingState';
import { SectionHeader } from './AccountSection';
import { pushToast } from '../../Toaster';

const DEFAULT_VALUE = '';
const DEFAULT_LABEL = 'Default (system)';

export function VoiceVideoSection() {
  const [devices, setDevices] = useState<AudioDeviceLists | null>(null);
  const [outputId, setOutputId] = useState<string>(DEFAULT_VALUE);
  const [inputId, setInputId] = useState<string>(DEFAULT_VALUE);
  const [toneBusy, setToneBusy] = useState(false);
  const [micTesting, setMicTesting] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [permRequested, setPermRequested] = useState(false);
  const { trigger } = useSaver();

  const refresh = async () => setDevices(await listAudioDevices());

  useEffect(() => {
    refresh();
    const off = subscribeDeviceChanges(() => { refresh(); });
    return off;
  }, []);

  useEffect(() => {
    api.prefs.get('audioOutputDeviceId').then(r => {
      if (r.ok && typeof r.data === 'string') setOutputId(r.data);
    });
    api.prefs.get('audioInputDeviceId').then(r => {
      if (r.ok && typeof r.data === 'string') setInputId(r.data);
    });
  }, []);

  const onChangeOutput = (next: string) => {
    let previous = '';
    setOutputId(prev => { previous = prev; return next; });
    trigger(api.prefs.set('audioOutputDeviceId', next));
    setVoiceSinkOutput(next).catch(() => {
      pushToast('danger', "Couldn't switch output — device may be unplugged.");
      setOutputId(previous);
      trigger(api.prefs.set('audioOutputDeviceId', previous));
    });
  };

  const onChangeInput = (next: string) => {
    setInputId(next);
    trigger(api.prefs.set('audioInputDeviceId', next));
  };

  const onShowLabels = async () => {
    setPermRequested(true);
    const ok = await requestLabelPermission();
    if (!ok) {
      pushToast('warn', 'Microphone access denied. You can enable it in your OS settings.');
      return;
    }
    await refresh();
  };

  if (!devices) return null;

  const outputOptions = [
    { value: DEFAULT_VALUE, label: DEFAULT_LABEL },
    ...devices.outputs.map(d => ({ value: d.deviceId, label: d.label || `Output ${d.deviceId.slice(0, 6)}` })),
  ];
  const inputOptions = [
    { value: DEFAULT_VALUE, label: DEFAULT_LABEL },
    ...devices.inputs.map(d => ({ value: d.deviceId, label: d.label || `Input ${d.deviceId.slice(0, 6)}` })),
  ];

  return (
    <div className="max-w-2xl space-y-8">
      <SectionHeader title="Voice & Video" subtitle="Choose which devices BotCord uses for voice playback and capture." />

      {!devices.labelsAvailable && !permRequested && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-warn/40 bg-warn/10">
          <IconAlertTriangle size={18} className="text-warn shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="text-sm text-fg font-medium">Allow microphone access to see device names</div>
            <p className="text-xs text-fg-muted mt-0.5">BotCord won't record anything — this just unlocks the device labels.</p>
            <button
              onClick={onShowLabels}
              className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-accent text-white text-xs font-medium hover:bg-accent-hover transition-colors"
            >
              Show device names
            </button>
          </div>
        </div>
      )}

      <Subsection title="Output (Speakers)" icon={<IconVolume size={14} className="text-accent" />}>
        <SelectField
          label="Output Device"
          value={outputId}
          onChange={onChangeOutput}
          options={outputOptions}
        />
        <button
          onClick={() => playTestTone(outputId, () => setToneBusy(false), () => setToneBusy(true))}
          disabled={toneBusy}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-bg-input text-xs font-medium text-fg hover:border-accent/50 disabled:opacity-50 transition-colors"
        >
          {toneBusy ? 'Playing…' : 'Test speaker'}
        </button>
      </Subsection>

      <Subsection title="Input (Microphone)" icon={<IconMicrophone size={14} className="text-accent" />} hint="Used when BotCord gains microphone features.">
        <SelectField
          label="Input Device"
          value={inputId}
          onChange={onChangeInput}
          options={inputOptions}
        />
        <MicTester
          deviceId={inputId}
          active={micTesting}
          level={micLevel}
          onToggle={setMicTesting}
          onLevel={setMicLevel}
        />
      </Subsection>
    </div>
  );
}

function Subsection({ title, icon, hint, children }: { title: string; icon: React.ReactNode; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-1.5">
        {icon}
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-dim">{title}</h3>
      </div>
      {hint && <p className="text-xs text-fg-muted">{hint}</p>}
      {children}
    </section>
  );
}

async function playTestTone(deviceId: string, onEnd: () => void, onStart: () => void) {
  onStart();
  const ac = new AudioContext();
  try {
    const ctxAny = ac as unknown as { setSinkId?: (id: string) => Promise<void> };
    if (deviceId && typeof ctxAny.setSinkId === 'function') {
      await ctxAny.setSinkId(deviceId);
    }
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.frequency.value = 440;
    gain.gain.setValueAtTime(0, ac.currentTime);
    gain.gain.linearRampToValueAtTime(0.2, ac.currentTime + 0.05);
    gain.gain.linearRampToValueAtTime(0, ac.currentTime + 0.4);
    osc.connect(gain).connect(ac.destination);
    osc.start();
    osc.stop(ac.currentTime + 0.42);
    osc.onended = () => { ac.close(); onEnd(); };
  } catch (e) {
    console.warn('[voice-test] tone failed', e);
    await ac.close();
    onEnd();
  }
}

function MicTester({
  deviceId, active, level, onToggle, onLevel,
}: {
  deviceId: string;
  active: boolean;
  level: number;
  onToggle: (v: boolean) => void;
  onLevel: (v: number) => void;
}) {
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) { onLevel(0); return; }
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        const ac = new AudioContext();
        ctxRef.current = ac;
        const src = ac.createMediaStreamSource(stream);
        const analyser = ac.createAnalyser();
        analyser.fftSize = 1024;
        src.connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        const tick = () => {
          if (cancelled) return;
          analyser.getFloatTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i]! * buf[i]!;
          const rms = Math.sqrt(sum / buf.length);
          onLevel(Math.min(1, rms * 4));
          rafRef.current = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        onToggle(false);
      }
    })();
    return () => {
      cancelled = true;
      if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      ctxRef.current?.close().catch(() => { /* best-effort */ });
      ctxRef.current = null;
      onLevel(0);
    };
  }, [active, deviceId, onLevel, onToggle]);

  return (
    <div className="space-y-2">
      <button
        onClick={() => onToggle(!active)}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-bg-input text-xs font-medium text-fg hover:border-accent/50 transition-colors"
      >
        {active ? 'Stop mic test' : 'Test microphone'}
      </button>
      {active && (
        <div className="h-2 w-full max-w-sm rounded-full bg-bg-sunken overflow-hidden">
          <div
            className="h-full bg-accent transition-[width] duration-75"
            style={{ width: `${Math.round(level * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}
