import { motion, useReducedMotion } from 'motion/react';

// SoftBlurIn from SmoothUI (21st.dev, @educalvolpz/soft-blur-in, MIT):
// each letter fades in with a soft blur and a gentle rise, Apple's ease-out.
// Adapted: words stay unbroken, long text can animate word by word, and an
// exit state lets AnimatePresence blur the text out faster than it came in.
type Props = {
  children: string;
  className?: string;
  /** Delay before the animation starts, in milliseconds. */
  delay?: number;
  /** Per-letter (or per-word) stagger, in milliseconds. */
  stagger?: number;
  /** Seconds each letter takes to settle. */
  duration?: number;
  by?: 'char' | 'word';
  /** Seconds each piece takes to leave. */
  exitDuration?: number;
};

const EASE = [0.22, 1, 0.36, 1] as const;

export default function SoftBlurIn({ children, className = '', delay = 0, stagger = 25, duration = .9, by = 'char', exitDuration = .3 }: Props) {
  const reduced = useReducedMotion();
  const words = children.split(/(\s+)/);
  const piece = {
    hidden: reduced ? { opacity: 0 } : { opacity: 0, y: 16, filter: 'blur(12px)' },
    shown: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: reduced ? 0 : duration, ease: EASE } },
    gone: reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: -10, filter: 'blur(10px)', transition: { duration: exitDuration, ease: [0.4, 0, 1, 1] as const } },
  };
  const container = {
    hidden: {},
    shown: { transition: { delayChildren: delay / 1000, staggerChildren: reduced ? 0 : stagger / 1000 } },
    gone: { transition: { staggerChildren: reduced ? 0 : stagger / 3000 } },
  };
  return <motion.span aria-label={children} className={className} initial="hidden" animate="shown" exit="gone" variants={container}>
    {words.map((word, w) => /^\s+$/.test(word) ? ' ' : by === 'word'
      ? <motion.span key={w} aria-hidden="true" variants={piece} style={{ display: 'inline-block', whiteSpace: 'pre' }}>{word}</motion.span>
      : <span key={w} aria-hidden="true" style={{ display: 'inline-block', whiteSpace: 'nowrap' }}>
        {Array.from(word).map((char, c) => <motion.span key={c} variants={piece} style={{ display: 'inline-block', whiteSpace: 'pre' }}>{char}</motion.span>)}
      </span>)}
  </motion.span>;
}
