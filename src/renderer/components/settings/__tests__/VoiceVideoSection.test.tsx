import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VoiceVideoSection } from '../sections/VoiceVideoSection';

const prefsGet = vi.fn();
const prefsSet = vi.fn().mockResolvedValue({ ok: true });

vi.mock('../../../lib/api', () => ({
  api: {
    prefs: {
      get: (k: string) => prefsGet(k),
      set: (k: string, v: unknown) => prefsSet(k, v),
    },
  },
}));

const setVoiceSinkOutput = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../lib/voice-sink', () => ({
  setVoiceSinkOutput: (id: string) => setVoiceSinkOutput(id),
}));

vi.mock('../../Toaster', () => ({ pushToast: vi.fn() }));

const enumerateDevices = vi.fn();
const getUserMedia = vi.fn();
const addEventListener = vi.fn();
const removeEventListener = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  prefsGet.mockImplementation((k: string) =>
    Promise.resolve({ ok: true, data: k === 'audioOutputDeviceId' ? '' : '' }),
  );
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      enumerateDevices,
      getUserMedia,
      addEventListener,
      removeEventListener,
    },
  });
});

const labeledDevices = () => [
  { kind: 'audiooutput', deviceId: 'speakers', label: 'Built-in Speakers', groupId: '' },
  { kind: 'audiooutput', deviceId: 'headset', label: 'USB Headset', groupId: '' },
  { kind: 'audioinput', deviceId: 'mic1', label: 'Built-in Mic', groupId: '' },
  { kind: 'videoinput', deviceId: 'cam', label: 'Webcam', groupId: '' },
] as MediaDeviceInfo[];

describe('VoiceVideoSection', () => {
  it('renders dropdowns from enumerated devices, with "Default" first', async () => {
    enumerateDevices.mockResolvedValue(labeledDevices());
    render(<VoiceVideoSection />);

    const outputSelect = await screen.findByLabelText('Output Device');
    const outputOptions = Array.from(outputSelect.querySelectorAll('option')).map(o => o.textContent);
    expect(outputOptions[0]).toMatch(/Default/);
    expect(outputOptions).toContain('Built-in Speakers');
    expect(outputOptions).toContain('USB Headset');

    const inputSelect = screen.getByLabelText('Input Device');
    const inputOptions = Array.from(inputSelect.querySelectorAll('option')).map(o => o.textContent);
    expect(inputOptions[0]).toMatch(/Default/);
    expect(inputOptions).toContain('Built-in Mic');
  });

  it('saves the output pref and applies it live when changed', async () => {
    enumerateDevices.mockResolvedValue(labeledDevices());
    render(<VoiceVideoSection />);

    const outputSelect = await screen.findByLabelText('Output Device');
    fireEvent.change(outputSelect, { target: { value: 'headset' } });

    await waitFor(() => {
      expect(prefsSet).toHaveBeenCalledWith('audioOutputDeviceId', 'headset');
      expect(setVoiceSinkOutput).toHaveBeenCalledWith('headset');
    });
  });

  it('saves the input pref when changed', async () => {
    enumerateDevices.mockResolvedValue(labeledDevices());
    render(<VoiceVideoSection />);

    const inputSelect = await screen.findByLabelText('Input Device');
    fireEvent.change(inputSelect, { target: { value: 'mic1' } });

    await waitFor(() => {
      expect(prefsSet).toHaveBeenCalledWith('audioInputDeviceId', 'mic1');
    });
  });

  it('shows a label-permission prompt when device labels are blank', async () => {
    enumerateDevices.mockResolvedValue([
      { kind: 'audiooutput', deviceId: 'a', label: '', groupId: '' },
      { kind: 'audioinput', deviceId: 'b', label: '', groupId: '' },
    ] as MediaDeviceInfo[]);
    getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] });
    render(<VoiceVideoSection />);

    const button = await screen.findByRole('button', { name: /Show device names/i });
    enumerateDevices.mockResolvedValueOnce(labeledDevices());
    fireEvent.click(button);

    await waitFor(() => {
      expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    });
  });

  it('re-enumerates on devicechange', async () => {
    enumerateDevices.mockResolvedValue(labeledDevices());
    render(<VoiceVideoSection />);
    await screen.findByLabelText('Output Device');

    const handler = addEventListener.mock.calls.find(([evt]) => evt === 'devicechange')?.[1];
    expect(typeof handler).toBe('function');

    enumerateDevices.mockClear();
    handler!();
    await waitFor(() => expect(enumerateDevices).toHaveBeenCalled());
  });
});
