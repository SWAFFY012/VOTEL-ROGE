import * as THREE from 'three';

// The flower sheet peeled as real paper: the lifted part rolls over a cylinder
// and lies back over the sheet, back side up. Bending keeps arc length (Codrops,
// "Real Folds, Real Fire" / paperlab: a sheet doesn't stretch, a point s past
// the start of the curl has turned through s / r), so the flowers never smear.
// Seen from straight above, every screen pixel finds which layer of paper is
// on top of it and where on the flat sheet that paper came from.

export type CurlState = {
  // 0..1 along the pull, as the DOM fallback uses it.
  shown: number;
  // Unit direction in screen pixels, pointing from the grabbed corner inward.
  direction: { x: number; y: number };
  // Only the visible sheet is drawn.
  active: boolean;
};

const vertexShader = `varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`;
const fragmentShader = `precision highp float;
uniform sampler2D tPhoto, tFilm, tFlowers;
uniform vec2 uRes, uDir;
uniform float uCrease, uRadius;
varying vec2 vUv;
const float PI = 3.14159265;
const vec3 PAPER = vec3(.878, .875, .863);

// Same placement as the peel layers' CSS: object-fit:cover,
// object-position:50% 48%, transform:translateY(2vh) scale(1.17).
vec2 imageUv(vec2 px){
  vec2 screen = px / uRes;
  vec2 element = (screen - .5 - vec2(0., .02)) / 1.17 + .5;
  float aspect = 1920. / 1080., view = uRes.x / uRes.y;
  vec2 visible = vec2(min(view / aspect, 1.), min(aspect / view, 1.));
  vec2 image = (1. - visible) * vec2(.5, .48) + element * visible;
  return vec2(image.x, 1. - image.y);
}
float onSheet(vec2 px){ return step(0., px.x) * step(0., px.y) * step(px.x, uRes.x) * step(px.y, uRes.y); }
// Paper is wherever the flower print is: the face opening is a real hole.
float paper(vec2 px){ return onSheet(px) * texture2D(tFlowers, imageUv(px)).a; }
// Point of the flat sheet that lies s past the crease, on the line through px.
vec2 source(vec2 px, float u, float s){ return px + (u - s) * uDir; }

// How much lifted paper (cylinder or flap) covers px: casts the shadow.
float lifted(vec2 px){
  float u = uCrease - dot(px, uDir), r = uRadius;
  if (u <= 0.) return paper(source(px, u, PI * r - u));
  if (u < r) {
    float a = asin(u / r);
    return max(paper(source(px, u, r * (PI - a))), paper(source(px, u, r * a)));
  }
  return 0.;
}

void main(){
  vec2 px = vec2(vUv.x, 1. - vUv.y) * uRes;
  float r = uRadius, u = uCrease - dot(px, uDir);
  vec2 uv = imageUv(px);
  vec3 color = texture2D(tPhoto, uv).rgb;

  // The part still stuck down: the film's own face in the opening, flowers around.
  if (u < 0.) {
    vec4 film = texture2D(tFilm, uv), flowers = texture2D(tFlowers, uv);
    color = mix(mix(color, film.rgb, film.a), flowers.rgb, flowers.a);
  }
  // Shadow of the lifted paper, falling down-right from a light at the top left.
  // The curl stands 2r above the sheet, so the shadow reaches further as it grows.
  vec2 offset = vec2(.35, .55) * (6. + r * .5);
  float shade = .55 * lifted(px - offset) + .25 * lifted(px - offset * 2.);
  // Soft shadow on the uncovered photo right beside the roll.
  if (u >= r) shade = max(shade, .42 * (1. - smoothstep(r, r * 2.2 + 16., u)));
  color *= 1. - min(shade, .62);

  if (u >= 0. && u < r) {
    float a = asin(u / r);
    // Underside of the roll: the flower print, turning away from the light.
    vec2 low = source(px, u, r * a);
    float lowPaper = paper(low);
    vec3 print = texture2D(tFlowers, imageUv(low)).rgb * (.42 + .58 * cos(a));
    color = mix(color, print, lowPaper);
    // Top of the roll: the paper back, brightest where it faces the light.
    vec2 high = source(px, u, r * (PI - a));
    float highPaper = paper(high);
    vec3 back = PAPER * (.6 + .4 * cos(a)) + vec3(.1) * pow(max(0., cos(a - .75)), 40.);
    color = mix(color, back, highPaper);
  } else if (u < 0.) {
    // The flap lying back over the sheet: plain paper with the face cut out.
    vec2 flap = source(px, u, PI * r - u);
    float flapPaper = paper(flap);
    float fold = 1. - smoothstep(0., r * 2.5 + 20., -u);
    vec3 back = PAPER * (.97 - .1 * fold);
    color = mix(color, back, flapPaper);
  }
  gl_FragColor = vec4(color, 1.);
}`;

export function createPeelCurl(container: HTMLElement, state: { current: CurlState }, onReady: () => void) {
  let renderer: THREE.WebGLRenderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false }); } catch { return null; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.domElement.className = 'peel-canvas';
  container.appendChild(renderer.domElement);
  const loader = new THREE.TextureLoader();
  let pending = 3;
  const loaded = (texture: THREE.Texture) => {
    // Sampled raw and written raw: the canvas shows the files' own pixels.
    texture.minFilter = THREE.LinearFilter; texture.generateMipmaps = false;
    if (--pending === 0) { dirty = true; onReady(); }
  };
  const photo = loader.load('/peel/letov-aligned.webp?v=7', loaded);
  const film = loader.load('/peel/film-face.webp?v=7', loaded);
  const flowers = loader.load('/peel/flowers-cutout.png?v=7', loaded);
  const uniforms = {
    tPhoto: { value: photo }, tFilm: { value: film }, tFlowers: { value: flowers },
    uRes: { value: new THREE.Vector2(1, 1) }, uDir: { value: new THREE.Vector2(Math.SQRT1_2, Math.SQRT1_2) },
    uCrease: { value: 0 }, uRadius: { value: 40 },
  };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader });
  material.toneMapped = false;
  const geometry = new THREE.PlaneGeometry(2, 2), scene = new THREE.Scene(), camera = new THREE.Camera();
  scene.add(new THREE.Mesh(geometry, material));
  let width = 1, height = 1, dirty = true, last = '';
  const resize = () => {
    width = container.clientWidth || innerWidth; height = container.clientHeight || innerHeight;
    renderer.setSize(width, height, false); dirty = true;
  };
  resize();
  const observer = new ResizeObserver(resize); observer.observe(container);
  let frame = 0;
  const draw = () => {
    frame = requestAnimationFrame(draw);
    const { shown, direction, active } = state.current;
    if (pending || document.hidden || !active) { dirty = true; return; }
    // A tight curl at the corner that opens up as the pull grows.
    const radius = Math.max(22, Math.min(width, height) * (.035 + .045 * Math.min(1, shown * 2.5)));
    const corners = [[0, 0], [width, 0], [width, height], [0, height]].map(([x, y]) => x * direction.x + y * direction.y);
    const minimum = Math.min(...corners), maximum = Math.max(...corners);
    // At 1 the crease has passed the far corner by the curl's radius: no paper left.
    const crease = minimum + shown * (maximum - minimum + radius + .5);
    const key = `${crease}:${direction.x}:${direction.y}:${radius}`;
    if (!dirty && key === last) return;
    dirty = false; last = key;
    uniforms.uRes.value.set(width, height);
    uniforms.uDir.value.set(direction.x, direction.y);
    uniforms.uCrease.value = crease; uniforms.uRadius.value = radius;
    renderer.render(scene, camera);
  };
  draw();
  return () => {
    cancelAnimationFrame(frame); observer.disconnect();
    photo.dispose(); film.dispose(); flowers.dispose(); material.dispose(); geometry.dispose();
    renderer.dispose(); renderer.domElement.remove();
  };
}
