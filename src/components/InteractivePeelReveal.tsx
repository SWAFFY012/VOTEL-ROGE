import { useEffect, useRef, useState, type PointerEvent } from 'react';
import gsap from 'gsap';

type Point = { x:number; y:number };
type Props = { active:boolean; progress:number; onProgressChange:(progress:number)=>void };
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
const dot=(a:Point,b:Point)=>a.x*b.x+a.y*b.y;
const rectangle:Point[]=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];

// One continuous sheet, reflected across the diagonal crease.
function halfPlane(points:Point[],normal:Point,crease:number){
  const result:Point[]=[];
  points.forEach((a,index)=>{
    const b=points[(index+1)%points.length],da=dot(a,normal)-crease,db=dot(b,normal)-crease;
    if(da>=0)result.push(a);
    if((da>=0)!==(db>=0)){
      const t=da/(da-db);result.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
    }
  });
  return result;
}

export default function InteractivePeelReveal({active,progress,onProgressChange}:Props){
  const drag=useRef<{id:number;start:Point;progress:number;direction:Point;locked:boolean}|null>(null);
  const [direction,setDirection]=useState<Point>({x:Math.SQRT1_2,y:Math.SQRT1_2});
  const [dragging,setDragging]=useState(false);
  const [hovering,setHovering]=useState(false);
  const [size,setSize]=useState({width:innerWidth,height:innerHeight});
  const completion=useRef({value:progress});
  useEffect(()=>{if(progress===0)gsap.killTweensOf(completion.current);},[progress]);
  useEffect(()=>()=>{gsap.killTweensOf(completion.current);},[]);
  const n={x:direction.x*size.width,y:direction.y*size.height};
  const projections=rectangle.map(p=>dot(p,n));
  const minimum=Math.min(...projections),maximum=Math.max(...projections);
  const shown=progress===0&&hovering&&!dragging?.018:progress;
  const crease=minimum+shown*(maximum-minimum+.5);
  const polygon=halfPlane(rectangle,n,crease);
  const clip=polygon.length>=3?`polygon(${polygon.map(p=>`${p.x*100}% ${p.y*100}%`).join(',')})`:'polygon(0 0,0 0,0 0)';
  const {x:nx,y:ny}=direction;
  const reflection=`matrix(${1-2*nx*nx},${-2*nx*ny},${-2*nx*ny},${1-2*ny*ny},${2*crease*nx},${2*crease*ny})`;
  const edge=(p:Point,w:number,h:number)=>Math.min(p.x,w-p.x,p.y,h-p.y)<Math.max(56,Math.min(w,h)*.13);
  const local=(event:PointerEvent<HTMLDivElement>)=>{const r=event.currentTarget.getBoundingClientRect();return {x:event.clientX-r.left,y:event.clientY-r.top};};
  const inward=(p:Point,w:number,h:number)=>{
    const x=p.x<w*.5?1:-1,y=p.y<h*.5?1:-1;
    const dx=Math.min(p.x,w-p.x),dy=Math.min(p.y,h-p.y);
    if(dx<100&&dy<100)return {x:x*Math.SQRT1_2,y:y*Math.SQRT1_2};
    return dx<dy?{x,y:y*.35}:{x:x*.35,y};
  };
  const normalized=(p:Point)=>{const length=Math.hypot(p.x,p.y);return {x:p.x/length,y:p.y/length};};
  const down=(event:PointerEvent<HTMLDivElement>)=>{
    if(!active)return;
    gsap.killTweensOf(completion.current);
    completion.current.value=progress;
    const p=local(event),r=event.currentTarget.getBoundingClientRect();
    if(progress===0&&!edge(p,r.width,r.height))return;
    event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);
    setSize({width:r.width,height:r.height});
    const next=progress===0?normalized(inward(p,r.width,r.height)):direction;
    setDirection(next);setDragging(true);setHovering(false);
    drag.current={id:event.pointerId,start:p,progress,direction:next,locked:progress>0};
  };
  const move=(event:PointerEvent<HTMLDivElement>)=>{
    const p=local(event),r=event.currentTarget.getBoundingClientRect(),session=drag.current;
    if(!session){
      const near=active&&progress===0&&edge(p,r.width,r.height);setHovering(near);
      if(near){setSize({width:r.width,height:r.height});setDirection(normalized(inward(p,r.width,r.height)));}
      return;
    }
    const delta={x:p.x-session.start.x,y:p.y-session.start.y};
    if(!session.locked&&Math.hypot(delta.x,delta.y)>8){
      if(dot(delta,session.direction)>0){session.direction=normalized(delta);setDirection(session.direction);session.locked=true;}
    }
    const span=Math.abs(session.direction.x)*r.width+Math.abs(session.direction.y)*r.height;
    // Full travel is reachable without leaving the physical display.
    const next=clamp(session.progress+.5*dot(delta,session.direction)/span);
    completion.current.value=next;
    onProgressChange(next);
  };
  const up=(event:PointerEvent<HTMLDivElement>)=>{
    if(drag.current?.id!==event.pointerId)return;
    drag.current=null;setDragging(false);
    // Half of a full-screen pull is reachable before the pointer hits the
    // opposite screen edge; the physical crease still follows at half speed.
    if(completion.current.value>=.25&&event.type!=='pointercancel')gsap.to(completion.current,{value:1,duration:1.05,ease:'power2.inOut',onUpdate:()=>onProgressChange(completion.current.value)});
    if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const angle=Math.atan2(ny,nx)*180/Math.PI;
  return <div className={`peel-scene${active?' is-active':''}${dragging?' is-dragging':''}${hovering?' is-edge':''}`} style={{touchAction:progress>=.995?'pan-y':'none'}}
    onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={()=>setHovering(false)}
    aria-hidden={!active} role="slider" tabIndex={active?0:-1} aria-label="Отклеить цветочное полотно" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress*100)}
    onKeyDown={e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();onProgressChange(clamp(progress+(e.key==='ArrowRight'?.05:-.05)));}}}>
    <img className="peel-photo" src="/peel/letov-aligned.webp?v=6" alt="" draggable={false}/>
    <div className="peel-face" style={{clipPath:clip}}><img src="/peel/flowers-cutout.png?v=6" alt="" draggable={false}/></div>
    <div className="peel-reverse" style={{clipPath:clip}}><div className="peel-reflection" style={{transform:reflection}}>
      <img className="peel-backing" src="/peel/flowers-cutout.png?v=6" alt="" draggable={false}/>
      <img className="peel-back-print" src="/peel/flowers-cutout.png?v=6" alt="" draggable={false}/>
    </div></div>
    {shown>0&&shown<1&&<div className="peel-crease-light" style={{left:crease*nx,top:crease*ny,transform:`rotate(${angle}deg)`}}/>}
  </div>;
}
