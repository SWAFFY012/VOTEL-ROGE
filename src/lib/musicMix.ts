// The landing page's music: three tracks, one playing at a time.
//   misery    MIZERY, the project's own track: the film, the flower sheet, the finale
//   letov     «Летов 88», from the moment the flower sheet starts coming off
//   solitude  «Сто лет одиночества», over the child cover
// A change of track is a slow crossfade: the leaving track is also sent into
// a reverb, so it dissolves into the room while the next one rises. The files
// are already quiet and soft (upper mids and highs cut, -20 LUFS, see
// public/audio/SOURCES.md); LEVEL sets how loud they sit on the page.
export type Scene = 'misery' | 'letov' | 'solitude';
const sources: Record<Scene, string> = {
  misery: '/audio/misery.m4a',
  letov: '/audio/letov-88.m4a',
  solitude: '/audio/sto-let-odinochestva.m4a',
};
const scenes = Object.keys(sources) as Scene[];
const LEVEL = .35;
// Seconds: the old track fades out over FADE_OUT; the new one waits a moment
// under the reverb and rises over FADE_IN.
const FADE_OUT = 3.2, FADE_IN = 3.6, ENTRY = .7;

type Channel = { element: HTMLAudioElement; dry: GainNode; send: GainNode; pan: StereoPannerNode; idle?: ReturnType<typeof setTimeout> };
type Graph = { context: AudioContext; master: GainNode; channels: Record<Scene, Channel> };

// A dark, wide hall: decaying stereo noise, low-passed so the tail is warm.
function impulse(context: AudioContext, seconds = 4.2) {
  const length = Math.floor(context.sampleRate * seconds);
  const buffer = context.createBuffer(2, length, context.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    let smooth = 0;
    for (let i = 0; i < length; i++) {
      smooth += (Math.random() * 2 - 1 - smooth) * .18;
      data[i] = smooth * Math.pow(1 - i / length, 2.6);
    }
  }
  return buffer;
}

// Glides from wherever the param is now to target, mostly done after
// `seconds`. setTargetAtTime may start on top of a glide still running (a
// value curve may not), so quick changes back and forth never throw or jump.
function glide(param: AudioParam, context: AudioContext, target: number, seconds: number, delay = 0) {
  const now = context.currentTime;
  param.cancelScheduledValues(now);
  param.setTargetAtTime(target, now + delay, Math.max(.01, seconds / 3));
}

export function createMusicMix() {
  const elements = Object.fromEntries(scenes.map((scene) => {
    const element = new Audio(sources[scene]);
    element.loop = true; element.preload = scene === 'misery' ? 'auto' : 'metadata';
    return [scene, element];
  })) as Record<Scene, HTMLAudioElement>;
  let graph: Graph | null = null;
  let scene: Scene = 'misery';
  const pans: Record<Scene, number> = { misery: 0, letov: 0, solitude: 0 };

  // Built on the first successful play (after a gesture), so the context starts running.
  const build = () => {
    if (graph) return graph;
    const context = new AudioContext(), master = context.createGain();
    master.gain.value = 0;
    const reverb = context.createConvolver(), wet = context.createGain();
    reverb.buffer = impulse(context); wet.gain.value = .9;
    reverb.connect(wet).connect(master);
    master.connect(context.destination);
    const channels = Object.fromEntries(scenes.map((name) => {
      const element = elements[name];
      const pan = context.createStereoPanner(), dry = context.createGain(), send = context.createGain();
      pan.pan.value = pans[name]; dry.gain.value = name === scene ? 1 : 0; send.gain.value = 0;
      context.createMediaElementSource(element).connect(pan);
      pan.connect(dry).connect(master);
      pan.connect(send).connect(reverb);
      return [name, { element, dry, send, pan }];
    })) as Record<Scene, Channel>;
    graph = { context, master, channels };
    return graph;
  };

  // Sound on/off: a 4 s fade of everything, from wherever the last one got to.
  const ramp = (target: number) => {
    const { context, master } = build();
    void context.resume();
    glide(master.gain, context, target * LEVEL, 4);
  };

  return {
    // Plays the current scene's track; resolves once the browser allowed it.
    play: () => elements[scene].play().then(() => { build(); }),
    fadeIn: () => ramp(1),
    fadeOut: () => ramp(0),
    get paused() { return elements[scene].paused; },
    get scene() { return scene; },
    setScene(next: Scene) {
      if (next === scene) return;
      const previous = scene; scene = next;
      if (!graph) {
        // Nothing audible yet: just switch which element will start.
        if (!elements[previous].paused) { elements[previous].pause(); void elements[next].play().catch(() => {}); }
        return;
      }
      const { context, channels } = graph;
      const out = channels[previous], into = channels[next];
      // The leaving track swells into the reverb as it fades, then the send closes.
      const now = context.currentTime;
      glide(out.dry.gain, context, 0, FADE_OUT);
      glide(out.send.gain, context, .85, FADE_OUT * .5);
      out.send.gain.setTargetAtTime(0, now + FADE_OUT * .6, .5);
      clearTimeout(out.idle);
      out.idle = setTimeout(() => { if (scene !== previous) out.element.pause(); }, (FADE_OUT + 4.6) * 1000);
      // The arriving track comes out of the same reverb: a little wet at first.
      clearTimeout(into.idle);
      glide(into.dry.gain, context, 1, FADE_IN, ENTRY);
      into.send.gain.cancelScheduledValues(now);
      into.send.gain.setTargetAtTime(.45, now, .05);
      into.send.gain.setTargetAtTime(0, now + ENTRY, FADE_IN / 3);
      if (into.element.paused) void into.element.play().catch(() => {});
    },
    // -1 left ear … 0 centre … 1 right ear; follows its input smoothly.
    setPan(name: Scene, value: number) {
      pans[name] = value;
      if (graph) graph.channels[name].pan.pan.setTargetAtTime(value, graph.context.currentTime, .08);
    },
    stop() {
      scenes.forEach((name) => { elements[name].pause(); clearTimeout(graph?.channels[name].idle); });
    },
    dispose() {
      this.stop();
      void graph?.context.close();
      graph = null;
    },
  };
}
export type MusicMix = ReturnType<typeof createMusicMix>;
