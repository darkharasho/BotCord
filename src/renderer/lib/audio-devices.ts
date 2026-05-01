// Renderer-side wrapper around navigator.mediaDevices for the Voice & Video
// settings section. Keeps the section component free of MediaDevices plumbing.

export type AudioDeviceLists = {
  outputs: MediaDeviceInfo[];
  inputs: MediaDeviceInfo[];
  // True when every audio device has a non-empty `label`. Chromium leaves
  // labels blank until the page has been granted microphone permission once.
  labelsAvailable: boolean;
};

export async function listAudioDevices(): Promise<AudioDeviceLists> {
  const all = await navigator.mediaDevices.enumerateDevices();
  const outputs = all.filter(d => d.kind === 'audiooutput');
  const inputs = all.filter(d => d.kind === 'audioinput');
  const audio = [...outputs, ...inputs];
  const labelsAvailable = audio.length === 0 || audio.every(d => d.label.length > 0);
  return { outputs, inputs, labelsAvailable };
}

export function subscribeDeviceChanges(cb: () => void): () => void {
  navigator.mediaDevices.addEventListener('devicechange', cb);
  return () => navigator.mediaDevices.removeEventListener('devicechange', cb);
}

// One-shot getUserMedia call. Stops every track on the resulting stream
// immediately — the only purpose is to unlock device labels for the rest of
// the session. Resolves false if the user denies the permission prompt.
export async function requestLabelPermission(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());
    return true;
  } catch {
    return false;
  }
}
