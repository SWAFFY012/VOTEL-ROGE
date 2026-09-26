// Two views in one app, switched by the URL hash so they survive a reload and
// work on any static host: the landing page and the release page.
//   #/release  release page with the levitating guitar
//   #/final    landing page opened straight at the platform cards
export type View = 'main' | 'release';
export const viewFromHash = (): View => (location.hash.startsWith('#/release') ? 'release' : 'main');
export const startsAtFinal = () => location.hash === '#/final';

// Dark veil over the page while the view changes ("moving to another page").
export function travel(hash: string) {
  const veil = document.querySelector<HTMLElement>('.route-veil');
  if (!veil || matchMedia('(prefers-reduced-motion: reduce)').matches) { location.hash = hash; return; }
  veil.classList.add('is-covering');
  setTimeout(() => { location.hash = hash; }, 520);
}

// Back to the very beginning: drop the hash and reload, so the loader and the
// intro film play again from a clean state.
export function restart(delay = 0) {
  setTimeout(() => {
    history.replaceState(null, '', location.pathname + location.search);
    location.reload();
  }, delay);
}

// The card click from the landing page, for pages without the audio hook.
export function clickSound() {
  if (!soundPreference.enabled) return;
  const audio = new Audio('/audio/card-click.mp3');
  audio.volume = .2;
  audio.play().catch(() => {});
}

// Last sound choice made on the landing page, read by the release page.
export const soundPreference = { enabled: true };
