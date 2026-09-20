import { useCallback, useEffect, useRef, useState } from 'react';
import gsap from 'gsap';

export function useSiteAudio() {
  const music = useRef<HTMLAudioElement>(null);
  const hover = useRef<HTMLAudioElement>(null);
  const click = useRef<HTMLAudioElement>(null);
  const guitar = useRef<HTMLAudioElement>(null);
  const toggle = useRef<HTMLAudioElement>(null);
  const enabled = useRef(false);
  const request = useRef(0);
  const [soundEnabled, setEnabled] = useState(false);

  const setSoundEnabled = useCallback((next: boolean) => {
    const track = music.current;
    if (!track || next === enabled.current) return;
    // The switch acknowledges both enabling and disabling, independently of mute.
    if (toggle.current) {
      toggle.current.volume = 0.2;
      toggle.current.currentTime = 0;
      void toggle.current.play().catch(() => {});
    }
    const version = ++request.current;
    enabled.current = next;
    setEnabled(next);
    gsap.killTweensOf(track);
    if (next) {
      if (track.paused) track.volume = 0;
      // Start inside the user gesture; begin fading only when playback is ready.
      void track.play().then(() => {
        if (version !== request.current || !enabled.current) return;
        gsap.to(track, { volume: 0.3, duration: 4, ease: 'sine.inOut' });
      }).catch(() => {
        if (version !== request.current) return;
        enabled.current = false;
        setEnabled(false);
      });
    } else {
      [hover.current, click.current, guitar.current].forEach(effect => {
        if (effect) { effect.pause(); effect.currentTime = 0; }
      });
      gsap.to(track, {
        volume: 0, duration: 4, ease: 'sine.inOut',
        onComplete: () => { if (!enabled.current) track.pause(); },
      });
    }
  }, []);

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
    return () => {
      ++request.current;
      tracks.forEach(track => {
        if (track) { gsap.killTweensOf(track); track.pause(); }
      });
    };
  }, []);

  return { music, hover, click, guitar, toggle, soundEnabled, setSoundEnabled, playEffect };
}
