import { useEffect, useRef } from 'react';
import gsap from 'gsap';

export default function LoadingIntro({ onComplete }: { onComplete: () => void }) {
  const host=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const element=host.current!;
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    let disposed=false,ready=0,frame=0,exit:gsap.core.Timeline|undefined;
    const images=['/cover.jpg','/guitar-atlas-restored.png','/guitar-back.png','/guitar-side.png'];
    images.forEach(src=>{const img=new Image();img.onload=img.onerror=()=>{ready++;};img.src=src;});
    document.fonts.ready.finally(()=>{ready++;});
    const started=performance.now();
    const state={value:0};
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    const tick=(now:number)=>{
      if(disposed)return;
      const elapsed=now-started;
      const allReady=ready===5||elapsed>9000;
      const duration=reduced?100:2300;
      const t=Math.min(1,elapsed/duration);
      const timeProgress=(t*t*(3-2*t))*100;
      const next=Math.min(allReady?100:94,timeProgress);
      state.value=Math.max(state.value,next);
      element.style.setProperty('--progress',String(state.value/100));
      element.querySelector('.loading-percent')!.textContent=`${Math.floor(state.value)}%`;
      if(state.value>=100){
        exit=gsap.timeline({onComplete:()=>{document.body.style.overflow=previousOverflow;onComplete();}});
        exit.to('.loading-top',{yPercent:-115,duration:reduced?0:1.4,ease:'power3.inOut'},0)
          .to('.loading-bottom',{yPercent:115,duration:reduced?0:1.4,ease:'power3.inOut'},0)
          .to(element,{'--hole-width':'18vmin','--hole-height':'18vmin',duration:reduced?0:.65,ease:'power3.out'},.15)
          .to('.loading-copy, .loading-meter',{opacity:0,duration:reduced?0:.5},.65)
          .to(element,{'--hole-width':'100vw','--hole-height':'100vh',duration:reduced?0:1.5,ease:'power3.inOut'},.8)
          .set(element,{visibility:'hidden'});
      }else frame=requestAnimationFrame(tick);
    };
    frame=requestAnimationFrame(tick);
    return()=>{disposed=true;cancelAnimationFrame(frame);exit?.kill();document.body.style.overflow=previousOverflow;};
  },[onComplete]);
  return <div className="loading-intro" ref={host} aria-label="Загрузка сайта">
    <div className="loading-shutter shutter-top"/><div className="loading-shutter shutter-bottom"/><div className="loading-shutter shutter-left"/><div className="loading-shutter shutter-right"/>
    <div className="loading-copy loading-top">ТАМ, ГДЕ<br/><i>музыка</i></div>
    <div className="loading-copy loading-bottom">СТАНОВИТСЯ<br/><i>свободой.</i></div>
    <div className="loading-meter"><span className="loading-percent">0%</span><div className="loading-line"/></div>
  </div>;
}
