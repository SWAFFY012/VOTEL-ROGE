import { useEffect, useRef } from 'react';
import * as THREE from 'three';

// Background-only transition behind the guitar: the shader of Demo 6
// ("planetary") from akella/webGLImageTransitions (index6.html / js/demo6.js),
// driven by scroll instead of a click timeline. Texture A is the Letov photo,
// texture B the colour cover with the child; the guitar stays a separate
// foreground canvas.
export default function MeridianTransition({motion}:{motion:React.RefObject<{progress:number}>}) {
  const host=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const container=host.current!;
    let renderer:THREE.WebGLRenderer;
    try {renderer=new THREE.WebGLRenderer({alpha:true,antialias:false});} catch{return;}
    renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
    container.appendChild(renderer.domElement);
    const loader=new THREE.TextureLoader();
    const a=loader.load('/peel/letov-aligned.webp?v=6'),b=loader.load('/peel/cover-final.png'),displacement=loader.load('/peel/disp1.jpg');
    // intensity 1.5 pushes samples past the image edge; mirror instead of
    // stretching the border pixels into streaks (the shader math is untouched).
    for(const texture of [a,b]){texture.wrapS=texture.wrapT=THREE.MirroredRepeatWrapping;}
    const uniforms={texture1:{value:a},texture2:{value:b},displacement:{value:displacement},progress:{value:0},intensity:{value:1.5},uAspect:{value:innerWidth/innerHeight}};
    const material=new THREE.ShaderMaterial({uniforms,vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`,
      fragmentShader:`precision highp float;
      uniform float progress;
      uniform float intensity;
      uniform float uAspect;
      uniform sampler2D texture1;
      uniform sampler2D texture2;
      uniform sampler2D displacement;
      varying vec2 vUv;
      mat2 getRotM(float angle) {
        float s = sin(angle);
        float c = cos(angle);
        return mat2(c, -s, s, c);
      }
      const float PI = 3.1415;
      const float angle1 = PI *0.25;
      const float angle2 = -PI *0.75;
      // Demo's (vUv - 0.5) * resolution.zw + 0.5 cover mapping, per texture.
      vec2 cover(vec2 uv,float aspect){vec2 scale=vec2(min(uAspect/aspect,1.),min(aspect/uAspect,1.));return (uv-.5)*scale+.5;}
      // Pixel-exact copy of the peeled photo layer's CSS: object-fit:cover,
      // object-position:50% 48%, transform:translateY(2vh) scale(1.17).
      vec2 portrait(vec2 uv){
        vec2 screen=vec2(uv.x,1.-uv.y);
        vec2 element=(screen-.5-vec2(0.,.02))/1.17+.5;
        float aspect=1920./1080.;
        vec2 visible=vec2(min(uAspect/aspect,1.),min(aspect/uAspect,1.));
        vec2 image=(1.-visible)*vec2(.5,.48)+element*visible;
        return vec2(image.x,1.-image.y);
      }
      void main() {
        vec2 newUV = cover(vUv, 1672./941.);

        vec4 disp = texture2D(displacement, newUV);
        vec2 dispVec = vec2(disp.r, disp.g);

        vec2 distortedPosition1 = portrait(vUv) + getRotM(angle1) * dispVec * intensity * progress;
        vec4 t1 = texture2D(texture1, distortedPosition1);

        vec2 distortedPosition2 = newUV + getRotM(angle2) * dispVec * intensity * (1.0 - progress);
        vec4 t2 = texture2D(texture2, distortedPosition2);

        gl_FragColor = mix(t1, t2, progress);
      }`});
    const geometry=new THREE.PlaneGeometry(2,2),scene=new THREE.Scene();scene.add(new THREE.Mesh(geometry,material));
    const camera=new THREE.Camera();
    // Measure the stage, not the window: innerWidth includes the scrollbar, the
    // peeled photo layer does not, and the difference skewed the photo sideways.
    const resize=()=>{const width=container.clientWidth||innerWidth,height=container.clientHeight||innerHeight;renderer.setSize(width,height);uniforms.uAspect.value=width/height;};resize();addEventListener('resize',resize);
    const observer=new ResizeObserver(resize);observer.observe(container);
    // The demo tweens progress with Power2.easeInOut; keep that easing on the scroll value.
    const ease=(p:number)=>p<.5?2*p*p:1-2*(1-p)*(1-p);
    let frame=0;const draw=()=>{frame=requestAnimationFrame(draw);if(document.hidden)return;uniforms.progress.value=ease(Math.max(0,Math.min(1,motion.current.progress)));renderer.render(scene,camera);};draw();
    return()=>{cancelAnimationFrame(frame);removeEventListener('resize',resize);observer.disconnect();a.dispose();b.dispose();displacement.dispose();material.dispose();geometry.dispose();renderer.dispose();renderer.domElement.remove();};
  },[motion]);
  return <div className="meridian-scene" ref={host} aria-hidden="true"/>;
}
