from pathlib import Path
p=Path('src/App.tsx')
s=p.read_text(encoding='utf-8-sig')
s=s.replace("useEffect, useRef, useState", "useCallback, useEffect, useRef, useState")
s=s.replace("gsap.registerPlugin(ScrollTrigger);", "import LoadingIntro from '@/components/LoadingIntro';\nimport { BlurFade } from '@/components/ui/blur-fade';\ngsap.registerPlugin(ScrollTrigger);")
s=s.replace("const dialog=useRef", "const [loaded,setLoaded]=useState(false);\n  const finishLoading=useCallback(()=>setLoaded(true),[]);\n  const dialog=useRef")
a=s.index('  useEffect(()=>{\n    const el=video.current!;')
b=s.index('  useEffect(()=>{\n    if(menu||about)',a)
s=s[:a]+'''  useEffect(()=>{
    const el=video.current!;
    el.muted=true;el.defaultMuted=true;el.playbackRate=1;el.loop=true;
    const media=matchMedia('(prefers-reduced-motion: reduce)');
    const preference=()=>{
      motion.current.reduced=media.matches;setReduced(media.matches);
      if(media.matches)el.pause();else el.play().catch(()=>{});
    };
    preference();media.addEventListener('change',preference);
    let raf=0;
    const context=gsap.context(()=>{
      const panels=gsap.utils.toArray<HTMLElement>('.action-panel');
      const notes=gsap.utils.toArray<HTMLElement>('.story-note');
      const tl=gsap.timeline({paused:true,defaults:{ease:'none'}});
      tl.to('.brand-lockup',{top:'4%',duration:.20,ease:'power2.inOut'},.01)
        .to('.wordmark',{fontSize:()=>innerWidth<700?'30px':'42px',duration:.20,ease:'power2.inOut'},.01)
        .to('.subtitle',{fontSize:'18px',marginTop:'2px',duration:.20,ease:'power2.inOut'},.01)
        .to('.scroll-cue',{opacity:0,duration:.055},0)
        .fromTo('.white-scene',{yPercent:100},{yPercent:0,duration:.19,ease:'power2.inOut'},.075)
        .to('.brand-lockup',{color:'#191919',textShadow:'0 0 0 transparent',duration:.045},.17)
        .fromTo(notes[0],{opacity:0,y:80,filter:'blur(6px)'},{opacity:1,y:0,filter:'blur(0px)',duration:.10},.30)
        .fromTo(notes[1],{opacity:0,y:80,filter:'blur(6px)'},{opacity:1,y:0,filter:'blur(0px)',duration:.10},.41)
        .to(notes,{opacity:0,y:-100,duration:.10,stagger:.015},.64)
        .to('.white-scene',{yPercent:-100,duration:.17,ease:'power2.inOut'},.70)
        .to('.brand-lockup',{color:'#fff5e8',textShadow:'0 2px 18px #19000855',duration:.06},.77)
        .to('.backdrop',{inset:()=>innerWidth<700?'12px':'28px',duration:.14,ease:'power2.inOut'},.73)
        .fromTo('.arrival-caption',{opacity:0,y:16,filter:'blur(6px)'},{opacity:1,y:0,filter:'blur(0px)',duration:.075},.85)
        .to('.footer-line',{opacity:1,duration:.05},.93).to({},{duration:.001},.999);
      ScrollTrigger.create({trigger:'.scroll-track',start:'top top',end:'bottom bottom',scrub:.6,animation:tl,invalidateOnRefresh:true});
      const tick=()=>{
        raf=requestAnimationFrame(tick);
        const p=motion.current.reduced?1:tl.progress();motion.current.progress=p;
        const done=p>.865;setDocked(prev=>prev===done?prev:done);
        panels.forEach(panel=>{panel.inert=!done;});
        const footer=document.querySelector<HTMLElement>('.footer-line');if(footer)footer.inert=p<.97;
        const hint=document.querySelector<HTMLElement>('.scroll-cue');if(hint)hint.inert=p>.06;
        const menuButton=document.querySelector<HTMLButtonElement>('.menu-trigger');
        if(menuButton){menuButton.style.opacity=String(1-gsap.utils.clamp(0,1,p/.10));menuButton.inert=p>.1;}
        if(motion.current.reduced)tl.progress(1);
      };tick();
    },root);
    return()=>{cancelAnimationFrame(raf);context.revert();media.removeEventListener('change',preference);};
  },[]);
''' +s[b:]
s=s.replace('<video className="intro-film" ref={video}', '<video className="intro-film" loop autoPlay ref={video}')
s=s.replace('<header><button', '<div className="white-scene" aria-hidden="true"/><header><button')
a=s.index('      <h1 className="wordmark">')
b=s.index('      <div className="scroll-cue">',a)
s=s[:a]+'''      <div className="brand-lockup"><h1 className="wordmark">VOTEL-ROGE</h1><p className="subtitle"><i>ЛУДЖИ</i></p></div>
'''+s[b:]
s=s.replace('<section className="action-panel listen-panel" aria-label="Площадки для прослушивания">', '<BlurFade className="action-panel listen-panel" visible={docked} duration={reduced?0:.8} offset={28} direction="up" blur="12px"><section aria-label="Площадки для прослушивания">')
s=s.replace('Релизы добавим позже.</p></section>', 'Релизы добавим позже.</p></section></BlurFade>')
s=s.replace('<section className="action-panel about-panel" aria-label="О проекте">', '<BlurFade className="action-panel about-panel" visible={docked} duration={reduced?0:.8} delay={reduced?0:.14} offset={28} direction="up" blur="12px"><section aria-label="О проекте">')
s=s.replace('ЗВУК ПРОДОЛЖАЕТСЯ</span></section>', 'ЗВУК ПРОДОЛЖАЕТСЯ</span></section></BlurFade>')
s=s.replace('    <dialog ref={dialog}', '    {!loaded&&<LoadingIntro onComplete={finishLoading}/>}\n    <dialog ref={dialog}')
p.write_text(s,encoding='utf-8')
