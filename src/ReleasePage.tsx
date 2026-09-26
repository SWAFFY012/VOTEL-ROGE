import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import gsap from 'gsap';
import { ArrowLeft, Minus, Plus, RotateCcw, ZoomOut } from 'lucide-react';
import { createGuitar } from '@/lib/guitarModel';
import { clickSound, restart, soundPreference, travel } from '@/lib/navigation';
import GlassCard from '@/components/ui/glass-card';
import { darkGlass } from '@/lib/glass';
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

type Pluck = { index: number; at: number; amplitude: number; start: number; released: boolean; hookX: number };
type Controls = { zoomOut: () => void; zoomBy: (factor: number) => void; pluck: (index: number) => void };

// Volumetric beam: a cone lit by facing ratio and fading with distance from
// the lamp, with slow streaks like the rays on the stage photograph. It is
// depth-tested, so the half in front of the guitar lays light over it.
const beamVertex = `
  varying vec3 vNormalView; varying vec3 vLocal;
  void main(){
    vLocal = position;
    vNormalView = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const beamFragment = `
  uniform float uTime, uOpacity, uHeight;
  varying vec3 vNormalView; varying vec3 vLocal;
  void main(){
    float facing = pow(abs(vNormalView.z), 2.2);
    float along = clamp(.5 - vLocal.y / uHeight, 0., 1.);
    float fade = smoothstep(0., .12, along) * (1. - smoothstep(.62, 1., along));
    float angle = atan(vLocal.x, vLocal.z);
    float streaks = .72 + .28 * sin(angle * 13. + uTime * .35) * sin(angle * 5. - uTime * .2);
    gl_FragColor = vec4(vec3(1., .95, .88) * facing * fade * streaks * uOpacity, 1.);
  }`;

export default function ReleasePage() {
  const host = useRef<HTMLDivElement>(null), shadow = useRef<HTMLDivElement>(null), backdrop = useRef<HTMLImageElement>(null);
  const factBox = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState({ free: false, strings: false });
  const [fact, setFact] = useState<{ text: string; side: 'left' | 'right'; number: number } | null>(null);
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
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); } catch { return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, .05, 60);
    const home = new THREE.Vector3(0, 0, 12);
    camera.position.copy(home);

    // Light: a real spotlight from above and in front, so the lacquer on the
    // guitar catches it and the highlights move as the guitar turns.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const environment = pmrem.fromScene(new RoomEnvironment(), .04).texture;
    scene.environment = environment; scene.environmentIntensity = .22;
    scene.add(new THREE.HemisphereLight(0xb9c0cc, 0x140c0a, .5));
    const lampTarget = new THREE.Object3D(); scene.add(lampTarget);
    const lamp = new THREE.SpotLight(0xfff0dc, 7.5, 0, .36, .8, 0);
    lamp.position.set(0, 7.6, 5.2); lamp.target = lampTarget; scene.add(lamp);
    const rim = new THREE.DirectionalLight(0xdfe7ff, 1.4); rim.position.set(0, 5, -6); scene.add(rim);
    const fill = new THREE.DirectionalLight(0xffe7d4, .3); fill.position.set(0, -1, 8); scene.add(fill);

    const model = createGuitar(renderer, undefined, { lit: true });
    const holder = new THREE.Group();
    holder.add(model.group); scene.add(holder);

    // Beam and dust live in the room, not on the guitar: they stay put while
    // it turns, and the dust drifts both in front of and behind it.
    // Light adds to the colour but never to the canvas alpha, so it brightens
    // the stage photo behind the transparent canvas instead of covering it.
    const lightBlend = { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor } as const;
    const beamHeight = 8.4;
    const beamMaterial = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uOpacity: { value: .16 }, uHeight: { value: beamHeight } },
      vertexShader: beamVertex, fragmentShader: beamFragment,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, ...lightBlend,
    });
    const beamGeometry = new THREE.CylinderGeometry(.06, 1.9, beamHeight, 64, 1, true);
    const beam = new THREE.Mesh(beamGeometry, beamMaterial);
    beam.renderOrder = 2; scene.add(beam);
    const dustCount = 260;
    const dustGeometry = new THREE.BufferGeometry();
    const dustSeed = Float32Array.from({ length: dustCount * 4 }, () => Math.random());
    dustGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(dustCount * 3), 3));
    const sprite = document.createElement('canvas'); sprite.width = sprite.height = 64;
    const paint = sprite.getContext('2d')!;
    const glow = paint.createRadialGradient(32, 32, 0, 32, 32, 32);
    glow.addColorStop(0, 'rgba(255,248,236,1)'); glow.addColorStop(.35, 'rgba(255,240,220,.45)'); glow.addColorStop(1, 'rgba(255,240,220,0)');
    paint.fillStyle = glow; paint.fillRect(0, 0, 64, 64);
    const dustTexture = new THREE.CanvasTexture(sprite);
    const dustMaterial = new THREE.PointsMaterial({ size: .045, map: dustTexture, transparent: true, depthWrite: false, opacity: .7, color: 0xfff1de, ...lightBlend });
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

    // Rotation: drag spins the guitar around the screen axes, with inertia.
    const spin = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -.35, 0));
    const velocity = { x: 0, y: 0 };
    const axisX = new THREE.Vector3(1, 0, 0), axisY = new THREE.Vector3(0, 1, 0), step = new THREE.Quaternion();
    const turn = (dx: number, dy: number) => {
      spin.premultiply(step.setFromAxisAngle(axisY, dx));
      spin.premultiply(step.setFromAxisAngle(axisX, dy));
    };
    // String close-up: neck turned to a slight diagonal so the strings read in depth.
    const closeUp = new THREE.Quaternion().setFromEuler(new THREE.Euler(.18, -.3, -.55));
    const neckPoint = new THREE.Vector3(-.04, .95, .14);
    const view = { zoom: 0 };
    let zoomFrom = new THREE.Quaternion();

    // Free camera: distance d along z, looking straight ahead at (x, y).
    // Zooming keeps the point under the cursor fixed; zooming all the way out
    // recentres on the stage.
    const nearest = 1.3, tanHalf = Math.tan(THREE.MathUtils.degToRad(17));
    const cam = { x: 0, y: 0, d: home.z }, goal = { x: 0, y: 0, d: home.z };
    const clampGoal = () => {
      const room = 1 - (goal.d - nearest) / (home.z - nearest), reach = 3.1 * room;
      goal.x = THREE.MathUtils.clamp(goal.x, -reach * 1.3, reach * 1.3);
      goal.y = THREE.MathUtils.clamp(goal.y, -reach, reach);
    };
    const zoomAt = (nx: number, ny: number, factor: number) => {
      const px = goal.x + nx * tanHalf * camera.aspect * goal.d, py = goal.y + ny * tanHalf * goal.d;
      goal.d = THREE.MathUtils.clamp(goal.d * factor, nearest, home.z);
      goal.x = px - nx * tanHalf * camera.aspect * goal.d; goal.y = py - ny * tanHalf * goal.d;
      clampGoal();
    };

    let scale = 1, baseY = 0, visibleHeight = 1;
    const resize = () => {
      const w = container.clientWidth, h = container.clientHeight;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
      visibleHeight = 2 * tanHalf * home.z;
      // Fit the guitar between a small top margin and the controls at the
      // bottom (keycaps, hint, navigation), whose height depends on the width.
      const reserved = w <= 700 ? 176 : w <= 1100 ? 196 : 146, top = h * .06;
      const room = Math.max(h * .4, h - reserved - top);
      scale = Math.min(.6 * visibleHeight / 6.83, room / h * visibleHeight / 6.83, .62 * visibleHeight * camera.aspect / 2.21);
      baseY = (.5 - (top + room / 2) / h) * visibleHeight;
      if (shadow.current) shadow.current.style.top = `${((.5 - (baseY - 3.45 * scale) / visibleHeight) * 100 + 1.2).toFixed(2)}%`;
      beam.position.set(0, baseY + visibleHeight * .5 + .6 - beamHeight / 2, -.2);
      lampTarget.position.set(0, baseY, 0);
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
      return local.y > -.6 && local.y < 2.5 && Math.abs(local.x + .04) < .17;
    };

    let reported = '', stringMode = false;
    const report = () => {
      const next = { free: goal.d < home.z - .3, strings: stringMode };
      const key = `${next.free}${next.strings}`;
      if (key !== reported) { reported = key; setZoom(next); }
    };
    const enterStrings = () => {
      zoomFrom = spin.clone(); velocity.x = velocity.y = 0;
      stringMode = true; report();
      gsap.to(view, { zoom: 1, duration: reduced ? 0 : 1.5, ease: 'power3.inOut', overwrite: true });
    };
    const leaveStrings = () => {
      setFact(null);
      stringMode = false; report();
      gsap.to(view, { zoom: 0, duration: reduced ? 0 : 1.2, ease: 'power3.inOut', overwrite: true });
    };
    Object.assign(controls.current, {
      zoomOut: () => {
        if (view.zoom > 0) leaveStrings();
        else { goal.x = goal.y = 0; goal.d = home.z; report(); }
      },
      zoomBy: (factor: number) => {
        if (view.zoom > 0) { if (factor > 1) leaveStrings(); return; }
        zoomAt(0, 0, factor); report();
      },
    });

    let factIndex = Math.floor(Math.random() * facts.length), factCount = 0, lastSide: 'left' | 'right' = 'right', lastFact = -1e9;
    const sounds = createStringSounds(() => soundPreference.enabled);
    // fromKey: while a melody is played, facts appear at most every 4 s.
    const release = (pluck: Pluck, fromKey = false) => {
      if (pluck.released) return;
      pluck.released = true; pluck.start = performance.now();
      // A tap still gives the string a visible flick.
      if (Math.abs(pluck.amplitude) < .008) pluck.amplitude = .012 * Math.sign(pluck.amplitude || 1);
      sounds.play(pluck.index, .55 + Math.abs(pluck.amplitude) / .03 * .45);
      if (fromKey && pluck.start - lastFact < 4000) return;
      lastFact = pluck.start;
      factIndex = (factIndex + 1 + Math.floor(Math.random() * (facts.length - 1))) % facts.length;
      lastSide = Math.random() < .7 ? (lastSide === 'left' ? 'right' : 'left') : lastSide;
      setFact({ text: facts[factIndex], side: lastSide, number: ++factCount });
    };
    // Key or on-screen keycap: pluck the string near the bridge, like a pick.
    let unlight = 0;
    const pluckKey = (index: number) => {
      const string = strings[index];
      const pluck: Pluck = { index, at: string.half * .5, amplitude: .016 * (index % 2 ? 1 : -1), start: performance.now(), released: false, hookX: 0 };
      plucks.set(index, pluck);
      release(pluck, true);
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
        const gain = .009 * (.3 + .7 * cam.d / home.z);
        velocity.x = dx * gain; velocity.y = dy * gain;
        turn(velocity.x, velocity.y);
        return;
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
      const k = reduced ? 1 : 1 - Math.exp(-dt * 7);
      cam.x += (goal.x - cam.x) * k; cam.y += (goal.y - cam.y) * k; cam.d += (goal.d - cam.d) * k;
      const distance = cam.d / home.z;
      // Free spin: inertia after a drag, then a slow idle turn at full view.
      if (!drag && z === 0) {
        velocity.x *= .94; velocity.y *= .94;
        if (Math.abs(velocity.x) + Math.abs(velocity.y) > .0004) turn(velocity.x, velocity.y);
        else if (!reduced && distance > .95) turn(.0025, 0);
      }
      holder.quaternion.copy(z > 0 ? zoomFrom.clone().slerp(closeUp, ease) : spin);
      holder.scale.setScalar(scale);
      const float = reduced ? 0 : Math.sin(t * 1.1) * .09 * (1 - ease) * distance;
      holder.position.set(0, baseY + float, 0);
      holder.updateMatrixWorld(true);
      // Camera: free view, glides to the strings on the neck in string mode.
      target.copy(neckPoint); model.group.localToWorld(target);
      close.copy(target).add(new THREE.Vector3(0, 0, .95));
      free.set(cam.x, cam.y, cam.d);
      camera.position.lerpVectors(free, close, ease);
      look.set(cam.x, cam.y, 0).lerp(target, ease);
      camera.lookAt(look);
      // The stage photo moves a little with the camera, so zoom reads as depth.
      const depth = 1 - Math.min(distance, 1 - ease * .6);
      if (backdrop.current) backdrop.current.style.transform = `translate3d(${-cam.x * 6}px, ${cam.y * 6}px, 0) scale(${1 + depth * .22})`;
      if (shadow.current) {
        shadow.current.style.opacity = String(Math.max(0, (1 - ease) * (.55 - float * 1.4) * THREE.MathUtils.clamp((distance - .55) / .4, 0, 1)));
        shadow.current.style.transform = `translateX(-50%) scale(${1 - float * 1.6})`;
      }
      // Light: the lamp breathes a little, the beam softens up close.
      lamp.intensity = 7.5 * (1 + (reduced ? 0 : Math.sin(t * 2.3) * .025 + Math.sin(t * 7.1) * .01));
      beamMaterial.uniforms.uTime.value = t;
      // Up close the camera is inside the beam; thin it out so it never fogs the view.
      beamMaterial.uniforms.uOpacity.value = .16 * THREE.MathUtils.smoothstep(distance, .25, .8) * (1 - ease * .85);
      dustMaterial.opacity = .7 * (.35 + .65 * THREE.MathUtils.smoothstep(distance, .2, .7));
      for (let i = 0; i < dustCount; i++) {
        const a = dustSeed[i * 4], b = dustSeed[i * 4 + 1], c = dustSeed[i * 4 + 2], s = dustSeed[i * 4 + 3];
        const rise = ((b + t * (.012 + s * .02)) % 1);
        const radius = Math.sqrt(a) * (.35 + rise * 1.1);
        const angle = c * Math.PI * 2 + Math.sin(t * .3 + s * 9) * .4;
        dustPosition.setXYZ(i, Math.cos(angle) * radius, baseY + 2.9 - rise * 5.6, Math.sin(angle) * radius * .8 + .2);
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
      renderer.render(scene, camera);
    };
    draw();
    return () => {
      cancelAnimationFrame(frame); gsap.killTweensOf(view);
      removeEventListener('resize', resize); removeEventListener('keydown', key);
      container.removeEventListener('pointerdown', down); container.removeEventListener('pointermove', move);
      container.removeEventListener('pointerup', up); container.removeEventListener('pointercancel', up);
      container.removeEventListener('wheel', wheel); container.removeEventListener('dblclick', dive);
      strings.forEach((s) => { s.hit.geometry.dispose(); (s.hit.material as THREE.Material).dispose(); });
      beamGeometry.dispose(); beamMaterial.dispose(); dustGeometry.dispose(); dustMaterial.dispose(); dustTexture.dispose();
      environment.dispose(); pmrem.dispose(); sounds.dispose(); clearTimeout(unlight);
      model.dispose(); renderer.dispose(); renderer.domElement.remove();
    };
  }, []);

  // Facts float in on the side they belong to and dissolve after a while.
  useEffect(() => {
    const box = factBox.current;
    if (!box) return;
    if (!fact) { gsap.to(box, { autoAlpha: 0, duration: .3, overwrite: true }); return; }
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const tl = gsap.timeline()
      .fromTo(box, { autoAlpha: 0, y: 40, filter: 'blur(12px)' }, { autoAlpha: 1, y: 0, filter: 'blur(0px)', duration: reduced ? 0 : .9, ease: 'power3.out', clearProps: 'filter' })
      .to(box, { autoAlpha: 0, y: -20, filter: 'blur(8px)', duration: reduced ? 0 : .6, ease: 'power2.in' }, '+=6');
    return () => { tl.kill(); };
  }, [fact]);

  const zoomed = zoom.free || zoom.strings;
  return <main className="release">
    <img className="release-bg" ref={backdrop} src="/release/stage.webp" alt=""/>
    <div className="release-shadow" ref={shadow} aria-hidden="true"/>
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
    <div ref={factBox} className={`release-fact is-${fact?.side ?? 'right'}`} role="status" aria-live="polite">
      {fact && <GlassCard {...darkGlass} radius={22} padding={24} interactive={false}><span className="eyebrow">Факт о релизе · {String(fact.number).padStart(2, '0')}</span><p>{fact.text}</p></GlassCard>}
    </div>
  </main>;
}
