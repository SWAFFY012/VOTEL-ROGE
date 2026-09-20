import { useEffect, useRef } from 'react';
export default function CursorRing(){
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  if(!matchMedia('(pointer:fine)').matches)return;
  const ring=ref.current!;let frame=0,seen=false;const target={x:0,y:0},pos={x:0,y:0};
  const move=(e:PointerEvent)=>{target.x=e.clientX;target.y=e.clientY;if(!seen){pos.x=target.x;pos.y=target.y;seen=true;}ring.style.opacity='1';ring.classList.toggle('is-active',!!(e.target as Element).closest('a,button'));};
  const hide=()=>{ring.style.opacity='0';seen=false;};
  const draw=()=>{const speed=matchMedia('(prefers-reduced-motion:reduce)').matches?1:.14;pos.x+=(target.x-pos.x)*speed;pos.y+=(target.y-pos.y)*speed;ring.style.transform=`translate3d(${pos.x}px,${pos.y}px,0)`;frame=requestAnimationFrame(draw);};
  window.addEventListener('pointermove',move);document.documentElement.addEventListener('pointerleave',hide);window.addEventListener('blur',hide);draw();
  return()=>{cancelAnimationFrame(frame);window.removeEventListener('pointermove',move);document.documentElement.removeEventListener('pointerleave',hide);window.removeEventListener('blur',hide);};
 },[]);
 return <div ref={ref} className="cursor-ring" aria-hidden="true"><span/></div>;
}
