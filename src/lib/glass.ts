// Dark "gorilla glass" preset for GlassCard (21st.dev): a light smoky tint and
// a soft frost, so the cover stays clearly visible through the pane while the
// refractive rim still bends it.
export const darkGlass = {
  tint: 'oklch(0.15 0.012 25 / 0.38)',
  blur: 1.5,
  refraction: 20,
  rimWidth: 9,
} as const;
