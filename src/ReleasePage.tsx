import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import gsap from 'gsap';
import { ArrowLeft, Minus, Plus, RotateCcw, ZoomOut } from 'lucide-react';
import { createGuitar } from '@/lib/guitarModel';
import { clickSound, restart, soundPreference, travel } from '@/lib/navigation';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import SoftBlurIn from '@/components/ui/soft-blur-in';
import { createStringSounds } from '@/lib/stringSounds';

// Physical key positions (layout-independent): thickest string on Q.
const stringKeys = ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY'];
const keyLabels = ['Q', 'W', 'E', 'R', 'T', 'Y'];

// Placeholder facts for the visual; replace with the real release notes.
const facts = [
  'Альбом записан за одиннадцать ночей — только живые дубли, без метронома.',
  'В релизе нет ни одной строчки текста: всё сказано струнами.',
  'Каждая композиция начинается с одной и той же ноты — ми.',
  'Финальный трек сыгран с первого дубля в 4:17 утра.',
  'В одной из пьес слышен дождь по стеклу студии — его решили не вырезать.',
  'Обложку собирали вручную из трёхсот вырезанных цветов.',
  'Гитару для записи восстанавливали полгода, сохранив каждую наклейку.',
  'Двенадцать композиций — ровно столько струн у двух гитар, стоявших в студии.',
];

// Facts land in the four corners around the guitar, on its diagonals.
type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
const corners: Corner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
type Fact = { id: number; text: string; corner: Corner };
// How long a fact stays before it dissolves on its own.
const factHold = 3200;
type Pluck = { index: number; at: number; amplitude: number; start: number; released: boolean; hookX: number };
type Controls = { zoomOut: () => void; zoomBy: (factor: number) => void; pluck: (index: number) => void };

// Letov's room: the photograph projected back onto a rough box seen from the
// home camera (the window wall, the side walls, the floor), read off the
// photo's one-point perspective. From home it is exactly the photo; as the
// camera moves in or sideways, near and far parts of the room shift against
// each other like a real room. The mesh reaches a little past the photo so a
// moved camera never sees its edge (the border pixels just stretch, blurred).
const roomVertex = `
  uniform vec2 uHalf; uniform float uOffsetY, uBack, uHome;
  varying vec2 vUv;
  // The window wall in photo uv: its left and right corners and the floor line.
  const vec3 wall = vec3(.305, .64, .135);
  void main(){
    vUv = uv;
    vec2 ray = vec2((uv.x - .5) * 2. * uHalf.x, uOffsetY + (uv.y - .5) * 2. * uHalf.y);
    float left = (wall.x - .5) * 2. * uHalf.x, right = (wall.y - .5) * 2. * uHalf.x;
    float floorLine = uOffsetY + (wall.z - .5) * 2. * uHalf.y;
    float depth = uBack;
    if (ray.x < left) depth = min(depth, uBack * left / ray.x);
    if (ray.x > right) depth = min(depth, uBack * right / ray.x);
    if (floorLine < 0. && ray.y < floorLine) depth = min(depth, uBack * floorLine / ray.y);
    depth = max(depth, 2.);
    gl_Position = projectionMatrix * viewMatrix * vec4(ray * depth, uHome - depth, 1.);
  }`;
// Daylight from the window: it falls off into the room, breathes with the
// clouds (uLight) and glows around the frame; the room is out of focus
// (uBlur, a disc blur radius in photo pixels), more so the closer the camera.
const roomFragment = `
  uniform sampler2D uPhoto; uniform float uLight, uBlur;
  varying vec2 vUv;
  const vec2 windowCentre = vec2(.495, .65);
  void main(){
    vec2 uv = clamp(vUv, 0., 1.);
    // 24 taps on a golden-angle disc, from a softened mip level.
    vec3 photo = vec3(0.);
    for (int i = 0; i < 24; i++) {
      float a = float(i) * 2.39996, r = sqrt((float(i) + .5) / 24.) * uBlur;
      photo += texture2D(uPhoto, uv + vec2(cos(a) / 1671., sin(a) / 941.) * r, 2.).rgb;
    }
    photo /= 24.;
    photo = mix(vec3(dot(photo, vec3(.299, .587, .114))), photo, .82);
    vec3 haze = texture2D(uPhoto, uv, 6.).rgb;
    vec2 d = (uv - windowCentre) * vec2(1.5, 1.);
    float near = exp(-dot(d, d) * 3.5);
    vec3 colour = photo * mix(.48, .9, near) * mix(1., uLight, .3 + .7 * near);
    colour += max(haze - .62, 0.) * .5 * uLight * near;
    // Keep the panes from burning out: the trees behind the glass show, and
    // the light rays added on top carry the glare.
    colour = min(colour, vec3(.72)) + max(colour - .72, 0.) * .4;
    vec2 v = vUv - .5;
    colour *= 1. - dot(v, v) * .7;
    gl_FragColor = vec4(colour, 1.);
  }`;
// The bright panes of the window, for the light rays (everything else black).
const windowFragment = `
  uniform sampler2D uPhoto; uniform float uLight;
  varying vec2 vUv;
  void main(){
    vec2 uv = clamp(vUv, 0., 1.);
    float lum = dot(texture2D(uPhoto, uv, 1.).rgb, vec3(.299, .587, .114));
    vec2 inside = smoothstep(vec2(.40, .405), vec2(.415, .43), uv) * (1. - smoothstep(vec2(.575, .87), vec2(.59, .894), uv));
    gl_FragColor = vec4(vec3(1., .97, .9) * smoothstep(.6, .92, lum) * inside.x * inside.y * uLight, 1.);
  }`;
// Light scattering in the room's air: the window mask smeared toward the
// window on screen (GPU Gems 3, ch. 13). The guitar is drawn black into the
// mask first, so the shafts break around its silhouette.
const raysFragment = `
  uniform sampler2D uMask; uniform vec2 uSource; uniform float uStrength;
  varying vec2 vUv;
  void main(){
    vec2 step = (vUv - uSource) * (.9 / 48.);
    // A per-pixel offset along the ray hides the banding between samples.
    float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    vec2 coord = vUv - step * jitter; float fall = 1.; vec3 sum = vec3(0.);
    for (int i = 0; i < 48; i++) { coord -= step; sum += texture2D(uMask, coord).rgb * fall; fall *= .955; }
    gl_FragColor = vec4(sum * uStrength / 48., 1.);
  }`;
const flatVertex = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;

// Clouds over the window: a slow, irregular swell of the daylight, shared by
// the room, the rays, the guitar's lights and its shadow.
const daylight = (t: number) => 1 + .1 * Math.sin(t * .21) + .06 * Math.sin(t * .53 + 1.3) + .035 * Math.sin(t * 1.07 + .4);

// A soft dark blot (shadow) on a canvas, darkest at (x, y) of 128 × 128.
const blot = (x: number, y: number, radius: number) => {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const paint = canvas.getContext('2d')!;
  const gradient = paint.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, 'rgba(0,0,0,1)'); gradient.addColorStop(.4, 'rgba(0,0,0,.5)'); gradient.addColorStop(1, 'rgba(0,0,0,0)');
  paint.fillStyle = gradient; paint.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
};

export default function ReleasePage() {
  const host = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState({ free: false, strings: false });
  // At most one fact per corner; a newer one in a corner replaces the older.
  const [shownFacts, setShownFacts] = useState<Fact[]>([]);
  const controls = useRef<Controls>({ zoomOut: () => {}, zoomBy: () => {}, pluck: () => {} });
  const [litKey, setLitKey] = useState(-1);
  // Touch screens have no wheel or Q–Y keys: say pinch and the keycaps instead.
  const [touch] = useState(() => matchMedia('(pointer: coarse)').matches);

  useEffect(() => {
    const root = document.documentElement, previous = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => { root.style.overflow = previous; };
  }, []);

  useEffect(() => {
    const container = host.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); } catch { return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x050304, 1);
    container.appendChild(renderer.domElement);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, .05, 80);
    const home = new THREE.Vector3(0, 0, 12);
    camera.position.copy(home);

    // Reflections: a dim warm room, the bright window behind the guitar and
    // daylight bounced off the walls in front of it; the lacquer picks these
    // up as soft highlights that slide over it as it turns.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const envParts: { geometry: THREE.BufferGeometry; material: THREE.Material }[] = [];
    const envPart = (geometry: THREE.BufferGeometry, color: THREE.Color, at: [number, number, number]) => {
      const material = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geometry, material); mesh.position.set(...at); mesh.lookAt(0, 0, 0);
      envScene.add(mesh); envParts.push({ geometry, material });
    };
    envPart(new THREE.SphereGeometry(30, 32, 16), new THREE.Color(0x2c1e18), [0, 0, 0]);
    envPart(new THREE.PlaneGeometry(7, 10), new THREE.Color(0xf2f5ff).multiplyScalar(5), [0, 3, -16]);
    envPart(new THREE.PlaneGeometry(10, 7), new THREE.Color(0xfff0e0).multiplyScalar(1.3), [-7, 4, 13]);
    envPart(new THREE.PlaneGeometry(40, 40), new THREE.Color(0x3c1611), [0, -12, 0]);
    const environment = pmrem.fromScene(envScene, .04).texture;
    scene.environment = environment; scene.environmentIntensity = .45;

    // Lights: daylight from the window behind and above, the room's warm
    // bounce in front, the red carpet from below.
    const sky = new THREE.HemisphereLight(0xfff3e6, 0x4a1d14, .38); scene.add(sky);
    const windowLight = new THREE.DirectionalLight(0xeef2ff, 3); scene.add(windowLight);
    const bounce = new THREE.DirectionalLight(0xffe2c8, .42); bounce.position.set(-4, 2.5, 8); scene.add(bounce);

    const model = createGuitar(renderer, undefined, { lit: true });
    const holder = new THREE.Group();
    holder.add(model.group); scene.add(holder);

    // The room (drawn first, behind everything) and its window mask.
    const photo = new THREE.TextureLoader().load('/release/letov-room.webp');
    photo.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const roomUniforms = {
      uPhoto: { value: photo }, uHalf: { value: new THREE.Vector2(1, 1) }, uOffsetY: { value: 0 },
      uBack: { value: 15 }, uHome: { value: home.z }, uLight: { value: 1 }, uBlur: { value: 5 },
    };
    const roomGeometry = new THREE.PlaneGeometry(1, 1, 192, 108);
    const roomUv = roomGeometry.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < roomUv.count; i++) roomUv.setXY(i, roomUv.getX(i) * 1.3 - .15, roomUv.getY(i) * 1.3 - .15);
    const roomMaterial = new THREE.ShaderMaterial({ uniforms: roomUniforms, vertexShader: roomVertex, fragmentShader: roomFragment, depthTest: false, depthWrite: false });
    const room = new THREE.Mesh(roomGeometry, roomMaterial);
    room.frustumCulled = false; room.renderOrder = -1; scene.add(room);
    const windowMaterial = new THREE.ShaderMaterial({ uniforms: roomUniforms, vertexShader: roomVertex, fragmentShader: windowFragment, depthTest: false, depthWrite: false });
    const windowScene = new THREE.Scene(), windowMesh = new THREE.Mesh(roomGeometry, windowMaterial);
    windowMesh.frustumCulled = false; windowScene.add(windowMesh);
    // Light rays: the window mask (with the guitar black in it) at half size,
    // smeared toward the window and added over the picture.
    const mask = new THREE.WebGLRenderTarget(1, 1);
    const rayUniforms = { uMask: { value: mask.texture }, uSource: { value: new THREE.Vector2(.5, .65) }, uStrength: { value: 1 } };
    const raysMaterial = new THREE.ShaderMaterial({ uniforms: rayUniforms, vertexShader: flatVertex, fragmentShader: raysFragment, blending: THREE.AdditiveBlending, transparent: true, depthTest: false, depthWrite: false });
    const raysGeometry = new THREE.PlaneGeometry(2, 2);
    const raysScene = new THREE.Scene(), rays = new THREE.Mesh(raysGeometry, raysMaterial);
    rays.frustumCulled = false; raysScene.add(rays);
    const flatCamera = new THREE.Camera();
    const black = new THREE.MeshBasicMaterial({ color: 0 });
    const windowCentre = new THREE.Vector3(), lightSource = new THREE.Vector3();

    // Shadow on the carpet: a dark contact patch under the guitar and a long
    // soft one thrown toward the viewer by the window behind it.
    // (The cast one is darkest at its far end, under the guitar: the canvas
    // top lies away from the viewer.)
    const contactTexture = blot(64, 64, 64), castTexture = blot(64, 40, 100);
    const shadowGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const contactMaterial = new THREE.MeshBasicMaterial({ map: contactTexture, transparent: true, depthWrite: false, opacity: .9 });
    const castMaterial = new THREE.MeshBasicMaterial({ map: castTexture, transparent: true, depthWrite: false, opacity: .45 });
    const contact = new THREE.Mesh(shadowGeometry, contactMaterial), cast = new THREE.Mesh(shadowGeometry, castMaterial);
    const shadows = new THREE.Group(); shadows.add(cast, contact); scene.add(shadows);

    // Dust floating in the daylight between the window and the viewer; light
    // adds to the colour, never covers it.
    const lightBlend = { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor } as const;
    const dustCount = 220;
    const dustGeometry = new THREE.BufferGeometry();
    const dustSeed = Float32Array.from({ length: dustCount * 4 }, () => Math.random());
    dustGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(dustCount * 3), 3));
    const sprite = document.createElement('canvas'); sprite.width = sprite.height = 64;
    const paint = sprite.getContext('2d')!;
    const glow = paint.createRadialGradient(32, 32, 0, 32, 32, 32);
    glow.addColorStop(0, 'rgba(255,248,236,1)'); glow.addColorStop(.35, 'rgba(255,240,220,.45)'); glow.addColorStop(1, 'rgba(255,240,220,0)');
    paint.fillStyle = glow; paint.fillRect(0, 0, 64, 64);
    const dustTexture = new THREE.CanvasTexture(sprite);
    const dustMaterial = new THREE.PointsMaterial({ size: .04, map: dustTexture, transparent: true, depthWrite: false, opacity: .6, color: 0xfff6ea, ...lightBlend });
    const dust = new THREE.Points(dustGeometry, dustMaterial);
    dust.renderOrder = 3; scene.add(dust);

    // The model's strings already bend (96 segments along their axis); each
    // gets an invisible, finger-wide target so it is easy to catch.
    const strings = model.strings.map(({ mesh, length, index }) => {
      const hit = new THREE.Mesh(new THREE.BoxGeometry(.03, length, .05), new THREE.MeshBasicMaterial({ visible: false }));
      hit.userData.index = index; mesh.add(hit);
      return { mesh, hit, half: length / 2, base: Float32Array.from(mesh.geometry.attributes.position.array as Float32Array) };
    });
    const hits = strings.map((s) => s.hit);
    const plucks = new Map<number, Pluck>();

    // The guitar stands in its place in the room: it only turns about its own
    // upright axis (drag, with inertia), never tilts or drifts.
    let yaw = -.35, yawFrom = yaw;
    const velocity = { x: 0 };
    const turn = (dx: number) => { yaw += dx; };
    const neckPoint = new THREE.Vector3(0, .95, .245);
    const view = { zoom: 0 };

    // Camera: straight ahead, from the room's centre line. It moves in toward
    // the guitar (no closer than `nearest`) and, closer in, up and down along
    // it to the point under the cursor; never sideways or past the room.
    const nearest = 4.5, tanHalf = Math.tan(THREE.MathUtils.degToRad(17));
    const cam = { y: 0, d: home.z }, goal = { y: 0, d: home.z };
    // A slight sway with the mouse, so the room shows its depth.
    const sway = { x: 0, y: 0 }, swayGoal = { x: 0, y: 0 };
    const clampGoal = () => {
      const room = 1 - (goal.d - nearest) / (home.z - nearest);
      goal.y = THREE.MathUtils.clamp(goal.y, (baseY - 2.6 * scale) * room, (baseY + 2.8 * scale) * room);
    };
    const zoomAt = (_nx: number, ny: number, factor: number) => {
      const py = goal.y + ny * tanHalf * goal.d;
      goal.d = THREE.MathUtils.clamp(goal.d * factor, nearest, home.z);
      goal.y = py - ny * tanHalf * goal.d;
      clampGoal();
    };

    let scale = 1, baseY = 0, visibleHeight = 1, floorY = -3;
    const resize = () => {
      const w = container.clientWidth, h = container.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
      visibleHeight = 2 * tanHalf * home.z;
      // Fit the guitar between a small top margin and the controls at the
      // bottom (keycaps, hint, navigation), whose height depends on the width.
      // The guitar is the subject here: it fills all the height the controls
      // leave free (up to 90% of the screen), and most of a narrow screen's width.
      const reserved = w <= 700 ? 196 : w <= 1100 ? 216 : 172, top = h * .03;
      const room = Math.max(h * .5, h - reserved - top);
      scale = Math.min(.9 * visibleHeight / 6.83, room / h * visibleHeight / 6.83, .86 * visibleHeight * camera.aspect / 2.21);
      baseY = (.5 - (top + room / 2) / h) * visibleHeight;
      floorY = baseY - 3.45 * scale;
      // The photo covers the screen from home, its bottom on the screen's
      // bottom edge (so the carpet stays in view), 35% larger than the screen:
      // that lifts the floor line to just under the guitar's foot.
      const halfY = Math.max(tanHalf, tanHalf * camera.aspect / (1671 / 941)) * 1.35;
      roomUniforms.uHalf.value.set(halfY * 1671 / 941, halfY);
      roomUniforms.uOffsetY.value = halfY - tanHalf;
      // The window wall stands behind the guitar; where the photo allows, as
      // far back as its floor line puts it under the guitar's foot.
      const floorLine = roomUniforms.uOffsetY.value + (.135 - .5) * 2 * halfY;
      roomUniforms.uBack.value = Math.max(14.5, floorY / floorLine);
      windowCentre.set((.495 - .5) * 2 * halfY * 1671 / 941, roomUniforms.uOffsetY.value + (.65 - .5) * 2 * halfY, -1).multiplyScalar(roomUniforms.uBack.value);
      windowCentre.z += home.z;
      windowLight.position.copy(windowCentre); windowLight.target.position.set(0, baseY, 0); windowLight.target.updateMatrixWorld();
      contact.scale.set(2.3 * scale, 1, 2.2 * scale); contact.position.set(0, floorY + .003, .15 * scale);
      cast.position.set(0, floorY + .002, 1.2 * scale);
      const pixelRatio = renderer.getPixelRatio();
      mask.setSize(Math.round(w * pixelRatio / 2), Math.round(h * pixelRatio / 2));
    };
    resize(); addEventListener('resize', resize);

    const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
    const toNdc = (x: number, y: number) => {
      const r = renderer.domElement.getBoundingClientRect();
      return { x: (x - r.left) / r.width * 2 - 1, y: -(y - r.top) / r.height * 2 + 1 };
    };
    const aim = (event: PointerEvent | MouseEvent) => {
      const p = toNdc(event.clientX, event.clientY);
      ndc.set(p.x, p.y); raycaster.setFromCamera(ndc, camera);
    };
    const onNeck = (point: THREE.Vector3) => {
      const local = model.group.worldToLocal(point.clone());
      return local.y > -.6 && local.y < 2.45 && Math.abs(local.x) < .17;
    };

    let reported = '', stringMode = false;
    const report = () => {
      const next = { free: goal.d < home.z - .3, strings: stringMode };
      const key = `${next.free}${next.strings}`;
      if (key !== reported) { reported = key; setZoom(next); }
    };
    const enterStrings = () => {
      // Turn back to face the viewer the short way round, still upright.
      yawFrom = yaw; velocity.x = 0;
      yaw -= THREE.MathUtils.euclideanModulo(yaw + .3 + Math.PI, Math.PI * 2) - Math.PI;
      stringMode = true; report();
      gsap.to(view, { zoom: 1, duration: reduced ? 0 : 1.5, ease: 'power3.inOut', overwrite: true });
    };
    const leaveStrings = () => {
      setShownFacts([]);
      stringMode = false; report();
      gsap.to(view, { zoom: 0, duration: reduced ? 0 : 1.2, ease: 'power3.inOut', overwrite: true });
    };
    Object.assign(controls.current, {
      zoomOut: () => {
        if (view.zoom > 0) leaveStrings();
        else { goal.y = 0; goal.d = home.z; report(); }
      },
      zoomBy: (factor: number) => {
        if (view.zoom > 0) { if (factor > 1) leaveStrings(); return; }
        zoomAt(0, 0, factor); report();
      },
    });

    let factIndex = Math.floor(Math.random() * facts.length), factCount = 0, lastCorner: Corner = 'bottom-right';
    const factTimers = new Set<number>();
    const sounds = createStringSounds(() => soundPreference.enabled);
    // Every pluck brings a fact, on the other side from the last one: played
    // fast, facts come and go as fast as the notes.
    const release = (pluck: Pluck) => {
      if (pluck.released) return;
      pluck.released = true; pluck.start = performance.now();
      // A tap still gives the string a visible flick.
      if (Math.abs(pluck.amplitude) < .008) pluck.amplitude = .012 * Math.sign(pluck.amplitude || 1);
      sounds.play(pluck.index, .55 + Math.abs(pluck.amplitude) / .03 * .45);
      factIndex = (factIndex + 1 + Math.floor(Math.random() * (facts.length - 1))) % facts.length;
      // Any corner but the last one, at random.
      const others = corners.filter((corner) => corner !== lastCorner);
      lastCorner = others[Math.floor(Math.random() * others.length)];
      const fact: Fact = { id: ++factCount, text: facts[factIndex], corner: lastCorner };
      // A phone has room for one fact at a time.
      const single = matchMedia('(max-width: 700px)').matches;
      setShownFacts((shown) => [...(single ? [] : shown.filter((f) => f.corner !== fact.corner)), fact]);
      const timer = window.setTimeout(() => { factTimers.delete(timer); setShownFacts((shown) => shown.filter((f) => f.id !== fact.id)); }, factHold);
      factTimers.add(timer);
    };
    // Key or on-screen keycap: pluck the string near the bridge, like a pick.
    let unlight = 0;
    const pluckKey = (index: number) => {
      const string = strings[index];
      const pluck: Pluck = { index, at: string.half * .5, amplitude: .016 * (index % 2 ? 1 : -1), start: performance.now(), released: false, hookX: 0 };
      plucks.set(index, pluck);
      release(pluck);
      setLitKey(index); clearTimeout(unlight); unlight = window.setTimeout(() => setLitKey(-1), 170);
    };
    controls.current.pluck = pluckKey;

    // Pointer: one finger or the mouse turns the guitar, two fingers pinch to
    // zoom; a tap on the neck opens the strings; there, a hooked string bends
    // with the pointer and rings on release.
    const pointers = new Map<number, { x: number; y: number }>();
    let drag: { id: number; x: number; y: number; moved: number } | null = null;
    let pinch = 0;
    let hooked: Pluck | null = null;
    const plane = new THREE.Plane(), planePoint = new THREE.Vector3(), normal = new THREE.Vector3();
    const spread = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    const down = (event: PointerEvent) => {
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      container.setPointerCapture(event.pointerId);
      if (pointers.size === 2 && view.zoom === 0) { drag = null; pinch = spread(); return; }
      aim(event);
      if (view.zoom > .98) {
        const hit = raycaster.intersectObjects(hits, false)[0];
        if (!hit) return;
        const index = hit.object.userData.index as number;
        const string = strings[index], local = string.mesh.worldToLocal(hit.point.clone());
        hooked = { index, at: THREE.MathUtils.clamp(local.y, -string.half * .9, string.half * .9), amplitude: 0, start: performance.now(), released: false, hookX: local.x };
        plucks.set(index, hooked);
        return;
      }
      if (view.zoom > 0) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: 0 };
    };
    const move = (event: PointerEvent) => {
      if (pointers.has(event.pointerId)) pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinch && pointers.size === 2) {
        const now = spread(), [a, b] = [...pointers.values()];
        const mid = toNdc((a.x + b.x) / 2, (a.y + b.y) / 2);
        zoomAt(mid.x, mid.y, pinch / now); pinch = now; report();
        return;
      }
      if (hooked) {
        aim(event);
        normal.set(0, 0, 1).applyQuaternion(holder.quaternion);
        plane.setFromNormalAndCoplanarPoint(normal, strings[hooked.index].mesh.getWorldPosition(planePoint));
        const point = raycaster.ray.intersectPlane(plane, planePoint);
        if (point) {
          const local = strings[hooked.index].mesh.worldToLocal(point.clone());
          hooked.amplitude = THREE.MathUtils.clamp(local.x - hooked.hookX, -.03, .03);
          // Pulled too far, the string slips off the finger.
          if (Math.abs(local.x - hooked.hookX) > .045) { release(hooked); hooked = null; }
        }
        return;
      }
      if (drag && drag.id === event.pointerId) {
        const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
        drag.x = event.clientX; drag.y = event.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
        // Closer in, the same hand movement turns the guitar less.
        velocity.x = dx * .009 * (.3 + .7 * cam.d / home.z);
        turn(velocity.x);
        return;
      }
      if (event.pointerType === 'mouse') {
        const p = toNdc(event.clientX, event.clientY);
        swayGoal.x = p.x * .35; swayGoal.y = Math.max(0, p.y) * .12;
      }
      if (view.zoom === 0 && event.pointerType === 'mouse') {
        aim(event);
        const hit = raycaster.intersectObject(model.group, true).find((h) => h.object.visible);
        container.classList.toggle('is-neck', !!hit && onNeck(hit.point));
      }
    };
    const up = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinch = 0;
      if (hooked) { release(hooked); hooked = null; }
      else if (drag && drag.id === event.pointerId) {
        if (drag.moved < 6) {
          aim(event);
          const hit = raycaster.intersectObject(model.group, true).find((h) => h.object.visible);
          if (hit && onNeck(hit.point)) enterStrings();
        }
        drag = null;
      }
      if (container.hasPointerCapture(event.pointerId)) container.releasePointerCapture(event.pointerId);
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (view.zoom > 0) { if (event.deltaY > 0) leaveStrings(); return; }
      const p = toNdc(event.clientX, event.clientY);
      zoomAt(p.x, p.y, Math.exp(THREE.MathUtils.clamp(event.deltaY, -120, 120) * .0022)); report();
    };
    // Double click / double tap: step closer to exactly that spot.
    const dive = (event: MouseEvent) => {
      if (view.zoom > 0) return;
      const p = toNdc(event.clientX, event.clientY);
      zoomAt(p.x, p.y, goal.d > 4 ? .38 : .6); report();
    };
    container.addEventListener('pointerdown', down);
    container.addEventListener('pointermove', move);
    container.addEventListener('pointerup', up);
    container.addEventListener('pointercancel', up);
    container.addEventListener('wheel', wheel, { passive: false });
    container.addEventListener('dblclick', dive);
    const key = (event: KeyboardEvent) => {
      const string = stringKeys.indexOf(event.code);
      if (string >= 0 && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); pluckKey(string); return; }
      if (event.key === 'Escape') controls.current.zoomOut();
      else if (event.key === '+' || event.key === '=') controls.current.zoomBy(.7);
      else if (event.key === '-') controls.current.zoomBy(1.45);
    };
    addEventListener('keydown', key);

    const bend = (s: typeof strings[number], amplitude: number, at: number) => {
      const position = s.mesh.geometry.attributes.position as THREE.BufferAttribute;
      const array = position.array as Float32Array;
      for (let i = 0; i < position.count; i++) {
        const y = s.base[i * 3 + 1];
        const shape = y < at ? (y + s.half) / (at + s.half) : (s.half - y) / (s.half - at);
        array[i * 3] = s.base[i * 3] + amplitude * shape;
      }
      position.needsUpdate = true;
    };

    const clock = new THREE.Clock(), look = new THREE.Vector3(), target = new THREE.Vector3(), close = new THREE.Vector3(), free = new THREE.Vector3();
    const dustPosition = dustGeometry.attributes.position as THREE.BufferAttribute;
    let frame = 0, last = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      if (document.hidden) return;
      const t = clock.getElapsedTime(), dt = Math.min(.05, t - last); last = t;
      const z = view.zoom, ease = z * z * (3 - 2 * z);
      // Camera eases toward its goal, so wheel steps glide instead of jump.
      const k = reduced ? 1 : 1 - Math.exp(-dt * 7), ks = reduced ? 0 : 1 - Math.exp(-dt * 2.5);
      cam.y += (goal.y - cam.y) * k; cam.d += (goal.d - cam.d) * k;
      sway.x += (swayGoal.x - sway.x) * ks; sway.y += (swayGoal.y - sway.y) * ks;
      const distance = cam.d / home.z;
      // Free spin: inertia after a drag, then a slow idle turn at full view.
      if (!drag && z === 0) {
        velocity.x *= .94;
        if (Math.abs(velocity.x) > .0004) turn(velocity.x);
        else if (!reduced && distance > .95) turn(.0025);
      }
      holder.rotation.set(0, z > 0 ? THREE.MathUtils.lerp(yawFrom, yaw, ease) : yaw, 0);
      holder.scale.setScalar(scale);
      holder.position.set(0, baseY, 0);
      holder.updateMatrixWorld(true);
      // Camera: free view, glides to the strings on the neck in string mode.
      target.copy(neckPoint); model.group.localToWorld(target);
      close.copy(target).add(new THREE.Vector3(0, 0, 1.5));
      free.set(sway.x, cam.y + sway.y, cam.d);
      camera.position.lerpVectors(free, close, ease);
      look.set(sway.x, cam.y + sway.y, 0).lerp(target, ease);
      camera.lookAt(look);
      camera.updateMatrixWorld();
      // Daylight: clouds pass, and everything the window lights follows.
      const light = reduced ? 1 : daylight(t);
      roomUniforms.uLight.value = light;
      // Depth of field: the room softens as the camera closes in.
      roomUniforms.uBlur.value = 5 + (1 - distance) * 14 + ease * 8;
      windowLight.intensity = 4.2 * light * light;
      sky.intensity = .38 * (.8 + .2 * light);
      // The shadow follows the guitar's turn: wide face-on, narrow edge-on.
      const across = .32 + .68 * Math.abs(Math.cos(holder.rotation.y));
      contact.scale.x = 2.4 * scale * across;
      cast.scale.set(2.2 * scale * across, 1, 2.8 * scale);
      contactMaterial.opacity = .9 * (1 - ease * .6);
      castMaterial.opacity = .55 * light * light * (1 - ease * .6);
      // Rays from wherever the window is on screen now.
      lightSource.copy(windowCentre).project(camera);
      rayUniforms.uSource.value.set(lightSource.x * .5 + .5, lightSource.y * .5 + .5);
      rayUniforms.uStrength.value = 2.4 * light * light * (1 - ease * .5);
      dustMaterial.opacity = .6 * light * (.4 + .6 * THREE.MathUtils.smoothstep(distance, .35, .8));
      for (let i = 0; i < dustCount; i++) {
        const a = dustSeed[i * 4], b = dustSeed[i * 4 + 1], c = dustSeed[i * 4 + 2], s = dustSeed[i * 4 + 3];
        const fall = (b + t * (.004 + s * .008)) % 1;
        dustPosition.setXYZ(i, (a - .5) * 4.4 + Math.sin(t * .23 + s * 9) * .18, floorY + 6.8 * (1 - fall), -.8 + c * 5.4 + Math.cos(t * .17 + a * 7) * .15);
      }
      dustPosition.needsUpdate = true;
      // Strings: hooked ones follow the finger, released ones ring and settle.
      const now = performance.now();
      plucks.forEach((pluck, index) => {
        let amplitude = pluck.amplitude;
        if (pluck.released) {
          const age = (now - pluck.start) / 1000;
          amplitude = pluck.amplitude * Math.exp(-3.2 * age) * Math.cos(Math.PI * 2 * 9 * age);
          if (age > 1.8) { amplitude = 0; plucks.delete(index); }
        }
        bend(strings[index], amplitude, pluck.at);
      });
      // Window mask with the guitar in black, for the rays.
      renderer.setRenderTarget(mask); renderer.clear(); renderer.render(windowScene, camera);
      scene.overrideMaterial = black; room.visible = shadows.visible = dust.visible = false;
      renderer.autoClear = false; renderer.clearDepth(); renderer.render(scene, camera);
      scene.overrideMaterial = null; room.visible = shadows.visible = dust.visible = true;
      renderer.setRenderTarget(null); renderer.autoClear = true;
      renderer.render(scene, camera);
      renderer.autoClear = false; renderer.render(raysScene, flatCamera); renderer.autoClear = true;
    };
    draw();
    return () => {
      cancelAnimationFrame(frame); gsap.killTweensOf(view);
      removeEventListener('resize', resize); removeEventListener('keydown', key);
      container.removeEventListener('pointerdown', down); container.removeEventListener('pointermove', move);
      container.removeEventListener('pointerup', up); container.removeEventListener('pointercancel', up);
      container.removeEventListener('wheel', wheel); container.removeEventListener('dblclick', dive);
      strings.forEach((s) => { s.hit.geometry.dispose(); (s.hit.material as THREE.Material).dispose(); });
      dustGeometry.dispose(); dustMaterial.dispose(); dustTexture.dispose();
      roomGeometry.dispose(); roomMaterial.dispose(); windowMaterial.dispose(); photo.dispose(); mask.dispose();
      raysGeometry.dispose(); raysMaterial.dispose(); black.dispose();
      shadowGeometry.dispose(); contactTexture.dispose(); castTexture.dispose(); contactMaterial.dispose(); castMaterial.dispose();
      envParts.forEach(({ geometry, material }) => { geometry.dispose(); material.dispose(); });
      environment.dispose(); pmrem.dispose(); sounds.dispose(); clearTimeout(unlight); factTimers.forEach((timer) => clearTimeout(timer));
      model.dispose(); renderer.dispose(); renderer.domElement.remove();
    };
  }, []);

  const zoomed = zoom.free || zoom.strings;
  return <main className="release">
    <div className={`release-stage${zoom.strings ? ' is-zoomed' : ''}`} ref={host} role="img" aria-label="Гитара Егора Летова. Потяните, чтобы повернуть; колесо или двойной клик приближают; нажмите на гриф, чтобы открыть струны."/>
    <div className="page-nav" role="group" aria-label="Навигация">
      <button onClick={() => { clickSound(); travel('#/final'); }}><ArrowLeft size={18}/><span>Назад</span></button>
      <button onClick={() => { clickSound(); restart(180); }}><RotateCcw size={17}/><span>В начало</span></button>
    </div>
    <p className="release-hint" aria-live="polite">{zoom.strings ? 'Зацепите струну и отпустите' : (touch ? 'Проведите — повернуть · щипок — приблизить · клавиши — сыграть' : 'Потяните — повернуть · колесо или двойной клик — приблизить · Q–Y — сыграть')}</p>
    <div className="string-keys" role="group" aria-label="Струны гитары: клавиши Q, W, E, R, T, Y — от толстой к тонкой">
      {keyLabels.map((label, index) => <button key={label} className={litKey === index ? 'is-lit' : ''} aria-label={`Струна ${6 - index}, клавиша ${label}`}
        onPointerDown={(event) => { event.preventDefault(); controls.current.pluck(index); }}
        onClick={(event) => { if (event.detail === 0) controls.current.pluck(index); }}>
        <span>{label}</span><i style={{ height: `${3.4 - index * .42}px` }}/>
      </button>)}
    </div>
    <div className="release-zoom" role="group" aria-label="Масштаб">
      <button aria-label="Приблизить" onClick={() => { clickSound(); controls.current.zoomBy(.6); }}><Plus size={18}/></button>
      <button aria-label="Отдалить" onClick={() => { clickSound(); controls.current.zoomBy(1.6); }}><Minus size={18}/></button>
    </div>
    {zoomed && <button className="release-zoom-out" onClick={() => { clickSound(); controls.current.zoomOut(); }}><ZoomOut size={18}/><span>{zoom.strings ? 'К гитаре' : 'Отдалить'}</span></button>}
    {/* Facts drift in from their own corner, word by word out of a blur
        (SoftBlurIn), and blur away faster than they came. */}
    <MotionConfig reducedMotion="user"><div role="status" aria-live="polite">
      {corners.map((corner) => {
        const left = corner.endsWith('left'), top = corner.startsWith('top');
        return <div key={corner} className={`release-fact is-${corner}`}>
          <AnimatePresence mode="popLayout">
            {shownFacts.filter((fact) => fact.corner === corner).map((fact) => <motion.p key={fact.id} className="release-fact-item"
              initial={{ x: left ? -36 : 36, y: top ? -24 : 24, opacity: 0 }} animate={{ x: 0, y: 0, opacity: 1, transition: { duration: .7, ease: [0.22, 1, 0.36, 1] } }}
              exit={{ x: left ? -18 : 18, y: top ? -12 : 12, opacity: 0, transition: { duration: .3, ease: [0.4, 0, 1, 1] } }}>
              <span className="eyebrow">Факт о релизе · {String(fact.id).padStart(2, '0')}</span>
              <SoftBlurIn className="fact-text" by="word" stagger={22} duration={.55} exitDuration={.22}>{fact.text}</SoftBlurIn>
            </motion.p>)}
          </AnimatePresence>
        </div>;
      })}
    </div></MotionConfig>
  </main>;
}
