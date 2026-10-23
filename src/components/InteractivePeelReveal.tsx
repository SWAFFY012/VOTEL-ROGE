import { useEffect, useRef, useState, type PointerEvent } from 'react';
import gsap from 'gsap';
import { createPeelCurl, type CurlState } from './peelCurl';

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
  const shown=progress===0&&hovering&&!dragging?.045:progress;
  // WebGL sheet that really curls; the flat-fold layers below stay as the
  // fallback until it is ready (or when WebGL is unavailable).
  const host=useRef<HTMLDivElement>(null);
  const curl=useRef<CurlState>({shown,direction,active});
  const [curled,setCurled]=useState(false);
  const idle=useRef(true);
  idle.current=progress===0&&!hovering&&!dragging;
  curl.current.active=active;
  if(!idle.current){curl.current.shown=shown;curl.current.direction=direction;}else curl.current.shown=0;
  useEffect(()=>host.current?createPeelCurl(host.current,curl,()=>setCurled(true))??undefined:undefined,[]);
  // While nobody touches it, the top right corner (the one no button covers)
  // lifts a little now and then: the sheet shows it can be peeled.
  useEffect(()=>{
    if(!active||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    const corner={x:-Math.SQRT1_2,y:Math.SQRT1_2},lift={value:0};
    const tease=gsap.timeline({repeat:-1,repeatDelay:2.2,delay:1.4})
      .to(lift,{value:.075,duration:.9,ease:'sine.out'})
      .to(lift,{value:0,duration:.8,ease:'sine.inOut'},'+=.35');
    const follow=()=>{if(idle.current){curl.current.shown=lift.value;curl.current.direction=corner;}};
    gsap.ticker.add(follow);
    return()=>{tease.kill();gsap.ticker.remove(follow);};
  },[active]);
  const crease=minimum+shown*(maximum-minimum+.5);
  const polygon=halfPlane(rectangle,n,crease);
  const clip=polygon.length>=3?`polygon(${polygon.map(p=>`${p.x*100}% ${p.y*100}%`).join(',')})`:'polygon(0 0,0 0,0 0)';
  const {x:nx,y:ny}=direction;
  const reflection=`matrix(${1-2*nx*nx},${-2*nx*ny},${-2*nx*ny},${1-2*ny*ny},${2*crease*nx},${2*crease*ny})`;
  // Only the four corners catch the sheet; the middle of an edge does nothing.
  const edge=(p:Point,w:number,h:number)=>{const reach=Math.max(70,Math.min(w,h)*.15);return Math.min(p.x,w-p.x)<reach&&Math.min(p.y,h-p.y)<reach;};
  const local=(event:PointerEvent<HTMLDivElement>)=>{const r=event.currentTarget.getBoundingClientRect();return {x:event.clientX-r.left,y:event.clientY-r.top};};
  const inward=(p:Point,w:number,h:number)=>{
    const x=p.x<w*.5?1:-1,y=p.y<h*.5?1:-1;
    return {x:x*Math.SQRT1_2,y:y*Math.SQRT1_2};
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
  return <div className={`peel-scene${active?' is-active':''}${dragging?' is-dragging':''}${hovering?' is-edge':''}${curled?' is-curled':''}`} style={{touchAction:progress>=.995?'pan-y':'none'}}
    onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={()=>setHovering(false)}
    aria-hidden={!active} role="slider" tabIndex={active?0:-1} aria-label="Отклеить цветочное полотно" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress*100)}
    onKeyDown={e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();onProgressChange(clamp(progress+(e.key==='ArrowRight'?.05:-.05)));}}}>
    <img className="peel-photo" src="/peel/letov-aligned.webp?v=7" alt="" draggable={false}/>
    {/* The film's own face lives on the part of the sheet still stuck down, so
        it turns into the photograph exactly along the crease, under the
        folded-back flap, and never fades in plain sight. */}
    <div className="peel-face peel-film-face" style={{clipPath:clip}}><img src="/peel/film-face.webp?v=7" alt="" draggable={false}/></div>
    <div className="peel-face" style={{clipPath:clip}}><img src="/peel/flowers-cutout.png?v=7" alt="" draggable={false}/></div>
    <div className="peel-reverse" style={{clipPath:clip}}><div className="peel-reflection" style={{transform:reflection}}>
      {/* Through the cut-out the photograph shows, as if the hole went right
          through: the same reflection applied twice puts it back in place. */}
      <div className="peel-through" style={{transform:reflection}}><img src="/peel/letov-aligned.webp?v=7" alt="" draggable={false}/></div>
      {/* Paper back of the sheet, with the face cut-out; no printed flowers. */}
      <div className="peel-backing-paper"/>
    </div></div>
    {shown>0&&shown<1&&<div className="peel-crease-light" style={{left:crease*nx,top:crease*ny,transform:`rotate(${angle}deg)`}}/>}
    <div className="peel-curl" ref={host}/>
  </div>;
}
