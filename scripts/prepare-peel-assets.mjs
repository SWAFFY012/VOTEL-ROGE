import sharp from 'sharp';
import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const out = join(root, 'public', 'peel');
const sourceFrames = 'C:/Users/a_zlo/Downloads/video letov/frames';
await mkdir(join(out, 'frames'), { recursive: true });

// The film is already fully coloured at the handoff. Keep the supplied WebP
// pixels intact so the scroll sequence has the same texture as the movie.
for (let number = 100; number <= 301; number++) {
  const name = `frame_${String(number).padStart(4, '0')}.webp`;
  await copyFile(join(sourceFrames, name), join(out, 'frames', name));
}

const flowerSource = join(root, 'цветы с вырезом 1-ый слой.jpg');
const { data, info } = await sharp(flowerSource).raw().toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;
const count = width * height;
const connected = new Uint8Array(count);
const queue = new Int32Array(count);
let head = 0;
let tail = 0;
const seed = 360 * width + 610;
connected[seed] = 1;
queue[tail++] = seed;
const nearWhite = (index) => {
  const offset = index * channels;
  const r = data[offset], g = data[offset + 1], b = data[offset + 2];
  return r > 218 && g > 218 && b > 218 && Math.max(r, g, b) - Math.min(r, g, b) < 20;
};
while (head < tail) {
  const index = queue[head++];
  const x = index % width;
  const y = Math.floor(index / width);
  for (const next of [x > 0 ? index - 1 : -1, x < width - 1 ? index + 1 : -1, y > 0 ? index - width : -1, y < height - 1 ? index + width : -1]) {
    if (next >= 0 && !connected[next] && nearWhite(next)) {
      connected[next] = 1;
      queue[tail++] = next;
    }
  }
}
const rgba = Buffer.alloc(count * 4);
// Use the finished film frame as the sheet's colour source so RGB values and
// flower placement are identical at the handoff. Register the supplied
// cut-out mask to the film (feature match: sx=.995746, sy=.970038, tx=-5.04,
// ty=4.29 in this 1280×720 working space).
const finalPixels = await sharp(join(sourceFrames,'frame_0301.webp')).resize(width,height).removeAlpha().raw().toBuffer();
const portraitPatch = Buffer.alloc(count * 4);
// JPEG leaves a pale compression halo around the white opening. Expand the
// connected opening a few pixels and feather its perimeter over the portrait.
const distance = new Uint8Array(count);
const edgeQueue = new Int32Array(count);
let edgeHead = 0;
let edgeTail = 0;
for (let index = 0; index < count; index++) {
  if (connected[index]) { distance[index] = 1; edgeQueue[edgeTail++] = index; }
}
while (edgeHead < edgeTail) {
  const index = edgeQueue[edgeHead++];
  const step = distance[index];
  if (step > 10) continue;
  const x = index % width;
  const y = Math.floor(index / width);
  for (const next of [x > 0 ? index - 1 : -1, x < width - 1 ? index + 1 : -1, y > 0 ? index - width : -1, y < height - 1 ? index + width : -1]) {
    if (next >= 0 && !distance[next]) { distance[next] = step + 1; edgeQueue[edgeTail++] = next; }
  }
}
for (let index = 0; index < count; index++) {
  const from = index * channels;
  const to = index * 4;
  const x=index%width,y=Math.floor(index/width);
  const sx=(x+5.04)/.995746,sy=(y-4.29)/.970038;
  const x0=Math.floor(sx),y0=Math.floor(sy),fx=sx-x0,fy=sy-y0;
  const sample=(xx,yy)=>xx>=0&&xx<width&&yy>=0&&yy<height?distance[yy*width+xx]:0;
  const maskAlpha=(sample(x0,y0)*(1-fx)+sample(x0+1,y0)*fx)*(1-fy)+(sample(x0,y0+1)*(1-fx)+sample(x0+1,y0+1)*fx)*fy;
  // Remove the red matte surrounding the supplied JPEG cut-out.
  const insideBorder=x>=30&&x<width-30&&y>=28&&y<height-28;
  rgba[to] = portraitPatch[to] = finalPixels[from];
  rgba[to + 1] = portraitPatch[to + 1] = finalPixels[from + 1];
  rgba[to + 2] = portraitPatch[to + 2] = finalPixels[from + 2];
  const sheetAlpha=maskAlpha>0?Math.max(0,Math.min(1,(maskAlpha-7)/5))*255:255;
  rgba[to + 3] = insideBorder ? Math.round(sheetAlpha) : 0;
  portraitPatch[to + 3] = maskAlpha>0?255:0;
}
// Preserve every decoded film pixel at its native resolution. Only the alpha
// channel is resampled; no sharpening, colour conversion or second resize.
const nativeWidth=1920,nativeHeight=1080;
const alpha=await sharp(rgba,{raw:{width,height,channels:4}}).extractChannel(3).resize(nativeWidth,nativeHeight).raw().toBuffer();
const nativeFrame=await sharp(join(sourceFrames,'frame_0301.webp')).removeAlpha().raw().toBuffer();
const nativeSheet=Buffer.alloc(nativeWidth*nativeHeight*4);
for(let i=0;i<alpha.length;i++){
  nativeSheet[i*4]=nativeFrame[i*3];nativeSheet[i*4+1]=nativeFrame[i*3+1];nativeSheet[i*4+2]=nativeFrame[i*3+2];nativeSheet[i*4+3]=alpha[i];
}
await sharp(nativeSheet,{raw:{width:nativeWidth,height:nativeHeight,channels:4}}).png().toFile(join(out,'flowers-cutout.png'));
// Resolve the portrait change during the closing film frames, inside the
// opening only. The final frame is the exact two-layer composite, so switching
// to the draggable sheet changes no pixels, even when scrolling backwards.
const photo=await sharp(join(out,'letov-aligned.webp')).removeAlpha().raw().toBuffer();
for(let number=277;number<=301;number++){
  const frame=await sharp(join(sourceFrames,`frame_${String(number).padStart(4,'0')}.webp`)).removeAlpha().raw().toBuffer();
  const t=(number-277)/24,ease=t*t*(3-2*t);
  for(let i=0;i<alpha.length;i++){
    const blend=(1-alpha[i]/255)*ease;
    for(let c=0;c<3;c++)frame[i*3+c]=Math.round(frame[i*3+c]*(1-blend)+photo[i*3+c]*blend);
  }
  await sharp(frame,{raw:{width:nativeWidth,height:nativeHeight,channels:3}}).webp({lossless:true}).toFile(join(out,'frames',`frame_${String(number).padStart(4,'0')}.webp`));
}
await sharp(portraitPatch, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 9 }).toFile(join(out, 'portrait-match.png'));
await sharp(join(root, 'летов ориг 2-ой слой.jpg')).webp({ quality: 94 }).toFile(join(out, 'letov-original.webp'));
console.log(`Prepared ${301 - 100 + 1} scroll frames and transparent floral layer (${tail} cutout pixels).`);
