// Removes the strings painted on the fretboard of the guitar photograph, so
// the 3D strings are the only ones seen up close. Frets run across the neck
// and inlay dots are wider than a string, so a narrow horizontal median keeps
// them while the thin lengthwise string lines disappear.
// Run: node scripts/clean-fretboard.mjs  →  public/guitar-atlas-clean.png
import sharp from 'sharp';

const source = 'public/guitar-atlas-restored.png';
const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height } = info;
const sx = width / 660, sy = height / 777;
// Fretboard in reference pixels (same numbers as src/lib/guitarModel.ts).
const nutY = 143.5, endY = 476;
const edges = (y) => {
  const t = Math.min(1, Math.max(0, (y - nutY) / (endY - nutY)));
  return [145.5 + (141.5 - 145.5) * t, 166.5 + (172.5 - 166.5) * t];
};
const out = Buffer.from(data);
const radius = 3, window = [];
for (let py = Math.floor((nutY + 2) * sy); py <= Math.ceil(endY * sy); py++) {
  const [left, right] = edges(py / sy);
  const x0 = Math.ceil((left + 1) * sx), x1 = Math.floor((right - 1) * sx);
  for (let px = x0; px <= x1; px++) {
    for (let c = 0; c < 3; c++) {
      window.length = 0;
      for (let k = -radius; k <= radius; k++) window.push(data[(py * width + Math.min(x1, Math.max(x0, px + k))) * 4 + c]);
      window.sort((a, b) => a - b);
      out[(py * width + px) * 4 + c] = window[radius];
    }
  }
}
await sharp(out, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 9 }).toFile('public/guitar-atlas-clean.png');
console.log('Wrote public/guitar-atlas-clean.png');
