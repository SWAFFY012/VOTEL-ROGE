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
  const [soundEnabled, setEnabled] = useState(true);
  const [needsInteraction, setNeedsInteraction] = useState(false);

  const startMusic = useCallback((version: number) => {
    const track = music.current;
    if (!track || !enabled.current) return;
    if (track.paused) track.volume = 0;
    // Browsers may require an interaction before allowing audible playback.
    void track.play().then(() => {
      if (version !== request.current || !enabled.current) return;
      setNeedsInteraction(false);
      gsap.killTweensOf(track);
      gsap.to(track, { volume: 0.3, duration: 4, ease: 'sine.inOut' });
    }).catch(() => {
      if (version === request.current && enabled.current) setNeedsInteraction(true);
    });
  }, []);

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
      gsap.to(track, {
        volume: 0, duration: 4, ease: 'sine.inOut',
        onComplete: () => { if (!enabled.current) track.pause(); },
      });
    }
  }, [startMusic]);

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
