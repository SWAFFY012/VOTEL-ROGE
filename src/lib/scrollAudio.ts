// Scroll-driven film sound: the original sound of the portrait being cut and
// the paper flying off plays at its natural speed — never reversed, never
// pitched — from the point the scroll has reached. Scrolling down plays it;
// stopping lets it fade; scrolling up is silent.
export type ScrollAudio = {
  // Where the scroll is, in seconds of the clip.
  seek: (time: number) => void;
  setEnabled: (enabled: boolean) => void;
  dispose: () => void;
};

// Kept just under the background music: a texture, not a sound effect.
const LEVEL = .2;

export function createScrollAudio(url: string): ScrollAudio {
  let context: AudioContext | null = null, gain: GainNode | null = null, clip: AudioBuffer | null = null;
  let source: AudioBufferSourceNode | null = null;
  let playhead = 0, target = 0, previous = 0, enabled = true, frame = 0, last = 0, disposed = false;
  let data: Promise<ArrayBuffer | null> | null = fetch(url).then((r) => r.arrayBuffer()).catch(() => null);

  // Browsers only start audio after a real gesture (click, key, touch).
  const unlock = () => {
    if (disposed) return;
    if (!context) {
      context = new AudioContext();
      gain = context.createGain(); gain.gain.value = 0; gain.connect(context.destination);
      data?.then((bytes) => (bytes ? context!.decodeAudioData(bytes) : null)).then((buffer) => {
        if (buffer && !disposed) clip = buffer;
        data = null;
      }).catch(() => {});
    }
    void context.resume();
  };
  const gestures = ['pointerdown', 'keydown', 'touchend'] as const;
  gestures.forEach((type) => addEventListener(type, unlock, { passive: true }));

  const stop = (fade = .08) => {
    if (!source || !context || !gain) return;
    const now = context.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setTargetAtTime(0, now, fade / 3);
    source.stop(now + fade * 2);
    source = null;
  };
  const play = (from: number) => {
    if (!context || !gain || !clip) return;
    const now = context.currentTime;
    if (source) source.stop(now + .06);
    source = context.createBufferSource();
    source.buffer = clip; source.connect(gain);
    source.start(now, Math.min(Math.max(0, from), clip.duration - .01));
    playhead = from;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setTargetAtTime(LEVEL, now, .03);
  };

  const tick = (time: number) => {
    frame = requestAnimationFrame(tick);
    const dt = Math.min(.05, (time - (last || time)) / 1000); last = time;
    const back = target < previous - .001; previous = target;
    if (!context || context.state !== 'running' || !clip || !enabled) { playhead = target; if (source) stop(); return; }
    if (source) playhead += dt;
    // Scrolling up: silence, the clip simply waits at the new position.
    if (back) { playhead = target; if (source) stop(.12); return; }
    const gap = target - playhead;
    if (!source) { if (gap > .02) play(playhead); else playhead = target; return; }
    // The hand ran well ahead: continue from where the scroll is now.
    if (gap > .6) play(target - .15);
    // The hand stopped: let the sound ring a moment, then fade it out.
    else if (-gap > .45 || playhead >= clip.duration) stop(.25);
  };
  frame = requestAnimationFrame(tick);

  return {
    seek: (time) => { target = Math.max(0, time); },
    setEnabled: (next) => { enabled = next; if (!next) stop(); },
    dispose: () => {
      disposed = true; cancelAnimationFrame(frame); stop();
      gestures.forEach((type) => removeEventListener(type, unlock));
      void context?.close();
    },
  };
}
