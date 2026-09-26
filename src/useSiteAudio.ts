import { useCallback, useEffect, useRef, useState } from 'react';
import gsap from 'gsap';

export function useSiteAudio() {
  const music = useRef<HTMLAudioElement>(null);
  const hover = useRef<HTMLAudioElement>(null);
  const click = useRef<HTMLAudioElement>(null);
  const guitar = useRef<HTMLAudioElement>(null);
  const toggle = useRef<HTMLAudioElement>(null);
  const enabled = useRef(true);
  const request = useRef(0);
  const audioGraph=useRef<{context:AudioContext;gain:GainNode}|null>(null);
  const envelope=useRef({from:0,to:0,start:0,duration:4});
  const ramp=useCallback((target:number)=>{
    const track=music.current;if(!track)return;
    if(!audioGraph.current){
      const context=new AudioContext(),gain=context.createGain();
      context.createMediaElementSource(track).connect(gain);gain.connect(context.destination);
      const initial=track.paused?0:track.volume;
      gain.gain.value=initial;audioGraph.current={context,gain};track.volume=1;
      envelope.current={from:initial,to:initial,start:context.currentTime,duration:4};
    }
    const {context,gain}=audioGraph.current;
    void context.resume();
    const now=context.currentTime;
    const previous=envelope.current;
    const t=Math.min(1,Math.max(0,(now-previous.start)/previous.duration));
    const current=previous.from+(previous.to-previous.from)*(t*t*(3-2*t));
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(current,now);
    const curve=Float32Array.from({length:129},(_,i)=>{const p=i/128;return current+(target-current)*p*p*(3-2*p);});
    gain.gain.setValueCurveAtTime(curve,now,4);
    envelope.current={from:current,to:target,start:now,duration:4};
  },[]);
  const [soundEnabled, setEnabled] = useState(true);
  const [needsInteraction, setNeedsInteraction] = useState(false);

  const startMusic = useCallback((version: number) => {
    const track = music.current;
    if (!track || !enabled.current) return;
    if (track.paused && !audioGraph.current) track.volume = 0;
    // Browsers may require an interaction before allowing audible playback.
    void track.play().then(() => {
      if (version !== request.current || !enabled.current) return;
      setNeedsInteraction(false);
      gsap.killTweensOf(track);
      ramp(0.3);
    }).catch(() => {
      if (version === request.current && enabled.current) setNeedsInteraction(true);
    });
  }, [ramp]);

  const setSoundEnabled = useCallback((next: boolean) => {
    const track = music.current;
    if (!track) return;
    if (next === enabled.current) {
      if (next && track.paused) {
        if (toggle.current) {
          toggle.current.volume = 0.2;
          toggle.current.currentTime = 0;
          void toggle.current.play().catch(() => {});
        }
        startMusic(++request.current);
      }
      return;
    }
    // The switch acknowledges both enabling and disabling, independently of mute.
    if (toggle.current) {
      toggle.current.volume = 0.2;
      toggle.current.currentTime = 0;
      void toggle.current.play().catch(() => {});
    }
    const version = ++request.current;
    enabled.current = next;
    setEnabled(next);
    if (!next) setNeedsInteraction(false);
    gsap.killTweensOf(track);
    if (next) {
      startMusic(version);
    } else {
      [hover.current, click.current, guitar.current].forEach(effect => {
        if (effect) { effect.pause(); effect.currentTime = 0; }
      });
      ramp(0);
      // Silence is scheduled on the audio clock. No wall-clock pause may cut
      // the envelope short if the context was suspended in a background tab.
    }
  }, [startMusic,ramp]);

  const playEffect = useCallback((kind: 'hover' | 'click' | 'guitar') => {
    if (!enabled.current) return;
    if (kind === 'click' && hover.current) {
      hover.current.pause();
      hover.current.currentTime = 0;
    }
    const effect = kind === 'guitar' ? guitar.current : kind === 'hover' ? hover.current : click.current;
    if (!effect) return;
    effect.volume = kind === 'guitar' ? 0.18 : kind === 'hover' ? 0.1 : 0.2;
    effect.currentTime = 0;
    void effect.play().catch(() => {});
  }, []);

  useEffect(() => {
    const tracks = [music.current, hover.current, click.current, guitar.current, toggle.current];
    const version = ++request.current;
    startMusic(version);
    const resume = (event: Event) => {
      if (!enabled.current || !music.current?.paused) return;
      if ((event.target as Element | null)?.closest?.('[aria-label="Выключить звук"]')) return;
      startMusic(request.current);
    };
    document.addEventListener('pointerdown', resume, true);
    document.addEventListener('keydown', resume, true);
    document.addEventListener('touchend', resume, true);
    document.addEventListener('wheel', resume, { passive: true });
    return () => {
      ++request.current;
      document.removeEventListener('pointerdown', resume, true);
      document.removeEventListener('keydown', resume, true);
      document.removeEventListener('touchend', resume, true);
      document.removeEventListener('wheel', resume);
      tracks.forEach(track => {
        if (track) { gsap.killTweensOf(track); track.pause(); }
      });
    };
  }, [startMusic]);

  return { music, hover, click, guitar, toggle, soundEnabled, needsInteraction, setSoundEnabled, playEffect };
}
