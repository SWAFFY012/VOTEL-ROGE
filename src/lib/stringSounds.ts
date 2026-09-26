// Recorded strings of the Letov guitar, one sample per string, played through
// Web Audio for near-zero latency so a melody can be picked out on the keys.
// string-0 is the thickest (low) string, string-5 the thinnest.
export type StringSounds = { play: (index: number, strength?: number) => void; dispose: () => void };

export function createStringSounds(isEnabled: () => boolean): StringSounds {
  const context = new AudioContext();
  const master = context.createGain(); master.gain.value = .85; master.connect(context.destination);
  const buffers: (AudioBuffer | null)[] = Array(6).fill(null);
  Array.from({ length: 6 }, (_, index) =>
    fetch(`/audio/strings/string-${index}.wav`).then((r) => r.arrayBuffer()).then((bytes) => context.decodeAudioData(bytes))
      .then((buffer) => { buffers[index] = buffer; }).catch(() => {}));
  const unlock = () => { void context.resume(); };
  const gestures = ['pointerdown', 'keydown', 'touchend'] as const;
  gestures.forEach((type) => addEventListener(type, unlock, { passive: true }));
  return {
    // A re-plucked string rings on its own voice; strength scales the volume.
    play: (index, strength = 1) => {
      const buffer = buffers[index];
      if (!buffer || !isEnabled()) return;
      void context.resume();
      const voice = context.createBufferSource(), level = context.createGain();
      voice.buffer = buffer; level.gain.value = Math.min(1, Math.max(.35, strength));
      voice.connect(level); level.connect(master);
      voice.start();
    },
    dispose: () => { gestures.forEach((type) => removeEventListener(type, unlock)); void context.close(); },
  };
}
