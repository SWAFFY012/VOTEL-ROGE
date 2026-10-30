import { useCallback, useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { createMusicMix, type MusicMix, type Scene } from '@/lib/musicMix';

export function useSiteAudio() {
  const music = useRef<MusicMix | null>(null);
  music.current ??= createMusicMix();
  const hover = useRef<HTMLAudioElement>(null);
  const click = useRef<HTMLAudioElement>(null);
  const guitar = useRef<HTMLAudioElement>(null);
  const toggle = useRef<HTMLAudioElement>(null);
  const enabled = useRef(true);
  const request = useRef(0);
  const [soundEnabled, setEnabled] = useState(true);
  const [needsInteraction, setNeedsInteraction] = useState(false);

  const startMusic = useCallback((version: number) => {
    const mix = music.current;
    if (!mix || !enabled.current) return;
    // Browsers may require an interaction before allowing audible playback.
    void mix.play().then(() => {
      if (version !== request.current || !enabled.current) return;
      setNeedsInteraction(false);
      mix.fadeIn();
    }).catch(() => {
      if (version === request.current && enabled.current) setNeedsInteraction(true);
    });
  }, []);

  const setSoundEnabled = useCallback((next: boolean) => {
    const mix = music.current;
    if (!mix) return;
    if (next === enabled.current) {
      if (next && mix.paused) {
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
    if (next) {
      startMusic(version);
    } else {
      [hover.current, click.current, guitar.current].forEach(effect => {
        if (effect) { effect.pause(); effect.currentTime = 0; }
      });
      mix.fadeOut();
      // Silence is scheduled on the audio clock. No wall-clock pause may cut
      // the envelope short if the context was suspended in a background tab.
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
    const mix = music.current;
    const tracks = [hover.current, click.current, guitar.current, toggle.current];
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
      mix?.dispose();
      music.current = null;
    };
  }, [startMusic]);

  // Which track plays, and where Letov's track sits between the ears.
  const setScene = useCallback((scene: Scene) => { music.current?.setScene(scene); }, []);
  const setPan = useCallback((scene: Scene, pan: number) => { music.current?.setPan(scene, pan); }, []);

  return { setScene, setPan, hover, click, guitar, toggle, soundEnabled, needsInteraction, setSoundEnabled, playEffect };
}
