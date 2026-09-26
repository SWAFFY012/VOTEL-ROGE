import { useEffect, useRef } from 'react';
import gsap from 'gsap';

// First-person blink: a fullscreen dark eyelid silhouette with an almond
// opening cut out through an SVG mask. Both lids are smooth cubic arcs that
// meet slightly below the centre, so the upper lid travels further, like a
// real eye. No pupil, lashes or drawn face: only the lids.
export type BlinkOptions = {
  // Image A: stays blurred after the first blink, reset once the second one shuts.
  from: HTMLElement;
  // Swap A → B here; the eye is fully closed, nothing is visible.
  onClosed: () => void;
  reduced: boolean;
};
// skip(): fast-forward to the end (the visitor scrolled during the blink).
export type BlinkControl = { play: (options: BlinkOptions) => Promise<void>; skip: () => void };

export default function EyeBlink({ control }: { control: React.RefObject<BlinkControl | null> }) {
  const svg = useRef<SVGSVGElement>(null), lid = useRef<SVGPathElement>(null), group = useRef<SVGGElement>(null);
  const rect = useRef<SVGRectElement>(null), veil = useRef<SVGRectElement>(null);
  useEffect(() => {
    const element = svg.current!;
    let timeline: gsap.core.Timeline | undefined;
    // openness 1: the opening is larger than the screen (lids out of view);
    // openness 0: the lids meet and the screen is dark.
    const layout = (openness: number) => {
      const w = innerWidth, h = innerHeight, pad = Math.round(Math.min(w, h) * .08);
      element.style.left = element.style.top = -pad + 'px';
      element.setAttribute('width', String(w + 2 * pad));
      element.setAttribute('height', String(h + 2 * pad));
      for (const r of [rect.current!, veil.current!]) { r.setAttribute('width', String(w + 2 * pad)); r.setAttribute('height', String(h + 2 * pad)); }
      group.current!.setAttribute('transform', `translate(${pad} ${pad})`);
      const meet = h * .54, upper = h * 1.95 * openness, lower = h * 1.25 * openness;
      lid.current!.setAttribute('d', `M${-.3 * w} ${meet}C${.1 * w} ${meet - upper} ${.9 * w} ${meet - upper} ${1.3 * w} ${meet}C${.9 * w} ${meet + lower} ${.1 * w} ${meet + lower} ${-.3 * w} ${meet}Z`);
    };
    control.current = {
      play: ({ from, onClosed, reduced }) => new Promise<void>((resolve) => {
        timeline?.progress(1).kill();
        if (reduced) { onClosed(); resolve(); return; }
        const eye = { open: 1 };
        const lids = { onUpdate: () => layout(eye.open) };
        layout(1);
        // Scale hides the transparent fringe a blur leaves at the screen edge.
        timeline = gsap.timeline({ onComplete: () => { element.style.visibility = 'hidden'; resolve(); } })
          .set(element, { visibility: 'visible' })
          // First blink: the lids close and part again, but the picture stays
          // out of focus, as if the eye were misted over.
          .to(eye, { open: 0, duration: .34, ease: 'power2.in', ...lids }, 0)
          .fromTo(from, { filter: 'blur(0px)', scale: 1 }, { filter: 'blur(10px)', scale: 1.04, duration: .34, ease: 'sine.in' }, 0)
          .to(eye, { open: 1, duration: .45, ease: 'power2.out', ...lids }, '+=.09')
          // A beat of blurred sight, then a second, slower blink.
          .to(eye, { open: 0, duration: .52, ease: 'power2.in', ...lids }, '+=.45')
          .to(from, { filter: 'blur(16px)', duration: .52, ease: 'sine.in' }, '<')
          // Fully shut: image B replaces A and is sharp as the lids open.
          .call(() => { onClosed(); gsap.set(from, { clearProps: 'filter,scale' }); })
          .to(eye, { open: 1, duration: .62, ease: 'power2.out', ...lids }, '+=.16');
      }),
      skip: () => { if (timeline && timeline.progress() < 1) timeline.timeScale(6); },
    };
    return () => { timeline?.kill(); control.current = null; };
  }, [control]);
  return <svg ref={svg} className="eye-blink" aria-hidden="true">
    <defs>
      <mask id="eye-blink-mask" maskUnits="userSpaceOnUse">
        <rect ref={rect} fill="#fff"/>
        <g ref={group}><path ref={lid} fill="#000"/></g>
      </mask>
    </defs>
    <rect ref={veil} fill="#050304" mask="url(#eye-blink-mask)"/>
  </svg>;
}
