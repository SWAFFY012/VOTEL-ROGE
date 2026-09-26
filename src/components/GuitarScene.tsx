import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createGuitar } from '@/lib/guitarModel';

export interface GuitarMotion { progress: number; reduced: boolean; pulse: number }

export default function GuitarScene({ motion }: { motion: React.RefObject<GuitarMotion> }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = host.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
    catch { container.classList.add('no-webgl'); return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-hidden', 'true');
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, .1, 60);
    camera.position.z = 12;
    // Soft studio reflections so chrome pickups, frets and strings read as metal.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const environment = pmrem.fromScene(new RoomEnvironment(), .04).texture;
    scene.environment = environment; scene.environmentIntensity = .45;
    const model = createGuitar(renderer, () => container.classList.add('loaded'));
    const guitar = model.group;
    scene.add(guitar);
    scene.add(new THREE.HemisphereLight(0xfff3dc, 0x29121c, 2.5));
    const key = new THREE.DirectionalLight(0xffecd2, 3.5);
    key.position.set(-4, 5, 7); scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 3);
    rim.position.set(4, 2, -5); scene.add(rim);
    let height = innerHeight;
    const resize = () => {
      height = container.clientHeight;
      camera.aspect = container.clientWidth / height; camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, height);
    };
    resize(); window.addEventListener('resize',resize);
    const target={x:0,y:0},pointer={x:0,y:0};
    const move=(event:PointerEvent)=>{target.x=event.clientX/innerWidth*2-1;target.y=event.clientY/innerHeight*2-1;};
    const leave=()=>{target.x=0;target.y=0;};
    window.addEventListener('pointermove',move);document.documentElement.addEventListener('pointerleave',leave);
    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      if(document.hidden) return;
      const {progress:p,reduced,pulse} = motion.current;
      const rise = THREE.MathUtils.clamp((p-.21)/.55,0,1);
      const turn = THREE.MathUtils.clamp((p-.22)/.485,0,1);
      const viewportHeight = 2*Math.tan(THREE.MathUtils.degToRad(17))*12;
      const base = Math.min(1,camera.aspect/.52)*1.82;
      // One pass through the scene: in from below, out past the top, gone for
      // the rest of the page (reduced motion skips the flight entirely).
      guitar.visible = p>.205 && rise<1 && !reduced;
      // Fixed-size model rises from entirely BELOW the viewport. No scale-in.
      guitar.scale.setScalar(base*pulse);
      pointer.x+=(target.x-pointer.x)*.045;pointer.y+=(target.y-pointer.y)*.045;
      guitar.rotation.set(Math.sin(turn*Math.PI)*.10-pointer.y*.22,turn*Math.PI*2+pointer.x*.34,Math.sin(turn*Math.PI*2)*.055+pointer.x*.025);
      const fromBelow=-(viewportHeight*.5+3.9*base);
      const beyondTop=viewportHeight*.5+3.9*base;
      guitar.position.y=THREE.MathUtils.lerp(fromBelow,beyondTop,rise);
      renderer.render(scene,camera);
    };
    draw();
    return () => {
      cancelAnimationFrame(frame); window.removeEventListener('resize',resize);window.removeEventListener('pointermove',move);document.documentElement.removeEventListener('pointerleave',leave);
      environment.dispose(); pmrem.dispose(); renderer.dispose(); model.dispose();
      renderer.domElement.remove();
    };
  },[motion]);
  return <div className="guitar-canvas" ref={host}><span className="guitar-fallback" aria-hidden="true" /></div>;
}
