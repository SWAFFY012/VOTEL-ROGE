// The sound of Letov's room on the release page: birds outside the window and,
// quieter still, a Sunday-morning broadcast (1965) playing behind the right
// wall. Both files are pre-processed (see public/audio/SOURCES.md): muffled,
// in their own reverb, the broadcast already placed on the right. Here they
// only loop and fade in and out together.
export type RoomAmbience = { dispose: () => void };

// Overall level of the room against the guitar strings (master .85).
const LEVEL = .7;

export function createRoomAmbience(isEnabled: () => boolean): RoomAmbience {
  const context = new AudioContext();
  const master = context.createGain(); master.gain.value = 0; master.connect(context.destination);
  let disposed = false, started = false;

  // The birds are a short loop: a decoded buffer loops without a gap.
  const birds = fetch('/audio/room-birds.wav').then((r) => r.arrayBuffer()).then((bytes) => context.decodeAudioData(bytes));
  // The broadcast is two minutes long: streamed, not decoded whole.
  const tv = new Audio('/audio/room-tv.m4a');
  tv.loop = true; tv.preload = 'auto';
  context.createMediaElementSource(tv).connect(master);

  const start = () => {
    if (disposed || started || !isEnabled()) return;
    void context.resume();
    if (context.state !== 'running') return;
    started = true;
    birds.then((buffer) => {
      if (disposed) return;
      const loop = context.createBufferSource();
      loop.buffer = buffer; loop.loop = true; loop.connect(master);
      // Not from the very top every visit.
      loop.start(0, Math.random() * buffer.duration);
    }).catch(() => {});
    void tv.play().catch(() => {});
    master.gain.setTargetAtTime(LEVEL, context.currentTime, 1.2);
  };
  // Coming from the landing page the click already allowed sound; opened
  // directly, the room starts with the first gesture.
  const gestures = ['pointerdown', 'keydown', 'touchend'] as const;
  gestures.forEach((type) => addEventListener(type, start, { passive: true }));
  context.addEventListener('statechange', start);
  start();

  return {
    dispose: () => {
      disposed = true;
      gestures.forEach((type) => removeEventListener(type, start));
      tv.pause();
      void context.close();
    },
  };
}
