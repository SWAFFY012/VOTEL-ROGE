import { useCallback, useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ArrowUpRight, Music2, Volume2, VolumeX, X } from 'lucide-react';
import { useSiteAudio } from './useSiteAudio';
import { letovNotes } from './letovNotes';
import { InteractiveHoverButton } from '@/components/ui/interactive-hover-button';
import GuitarScene, { type GuitarMotion } from '@/components/GuitarScene';
import LoadingIntro from '@/components/LoadingIntro';
import CursorRing from '@/components/CursorRing';

gsap.registerPlugin(ScrollTrigger);
const platforms = [
  {name:'Яндекс Музыка',mark:'Я',color:'#ffdf36',url:'https://music.yandex.ru/'},
  {name:'VK Музыка',mark:'VK',color:'#8e79ff',url:'https://music.vk.com/'},
  {name:'Spotify',mark:'S',color:'#36db79',url:'https://open.spotify.com/'},
  {name:'КИОН Музыка',mark:'К',color:'#e93ba3',url:'https://music.kion.ru/'},
  {name:'Apple Music',mark:'A',color:'#f7eee9',url:'https://music.apple.com/'},
  {name:'iTunes',mark:'♪',color:'#e5aacb',url:'https://www.apple.com/itunes/'}
];
export default function App() {
  const root=useRef<HTMLElement>(null), video=useRef<HTMLVideoElement>(null), portalVideo=useRef<HTMLVideoElement>(null);
  const motion=useRef<GuitarMotion>({progress:0,reduced:false,pulse:1});
  const [menu,setMenu]=useState(false),[about,setAbout]=useState(false),[docked,setDocked]=useState(false),[reduced,setReduced]=useState(false);
  const [loaded,setLoaded]=useState(false);
  const {music,hover,click,guitar,toggle,soundEnabled,setSoundEnabled,playEffect}=useSiteAudio();
  const [note,setNote]=useState(-1);
  const noteBox=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const box=noteBox.current;
    if(!box)return;
    const animation=gsap.timeline();
    if(note>=0&&docked){
      animation.fromTo(box,{autoAlpha:0,scale:.9},{autoAlpha:1,scale:1,duration:reduced?0:.2,ease:'power1.out'})
        .to(box,{autoAlpha:0,scale:.9,duration:reduced?0:2.5,ease:'power1.inOut'},'+=3');
    }else animation.to(box,{autoAlpha:0,scale:.9,duration:reduced?0:.6,ease:'power1.inOut'});
    return()=>{animation.kill();};
  },[note,docked,reduced]);
  const finishLoading=useCallback(()=>{
    window.scrollTo({top:0,left:0,behavior:'instant'});
    setLoaded(true);
    requestAnimationFrame(()=>ScrollTrigger.refresh());
  },[]);
  useEffect(()=>{
    if(!loaded)return;
    const context=gsap.context(()=>{
      gsap.to('.hero-glyph',{opacity:1,duration:.7,stagger:.15,ease:'sine.out',delay:.15});
      gsap.to('.glyph-erosion',{attr:{radius:0},duration:.7,stagger:.15,ease:'power2.out',delay:.15,onComplete:()=>{gsap.set('.hero-glyph',{filter:'none'});}});
      gsap.to('.subtitle .hero-word',{opacity:1,duration:.6,ease:'sine.out',delay:.7});
    },root);
    return()=>context.revert();
  },[loaded]);
  const dialog=useRef<HTMLDialogElement>(null),lastFocus=useRef<HTMLElement|null>(null);
  useEffect(()=>{
    const el=video.current!, portal=portalVideo.current!;
    el.muted=true;el.defaultMuted=true;el.playbackRate=1;el.loop=false;
    const media=matchMedia('(prefers-reduced-motion: reduce)');
    const replayFromColor=()=>{
      const colorStart=4.9;
      el.currentTime=Number.isFinite(el.duration)?Math.min(colorStart,Math.max(0,el.duration-.1)):colorStart;
      if(!media.matches)el.play().catch(()=>{});
    };
    el.addEventListener('ended',replayFromColor);
    portal.muted=true;portal.defaultMuted=true;portal.pause();
    const preparePortal=()=>{portal.pause();portal.currentTime=4.9;};
    portal.addEventListener('loadedmetadata',preparePortal);
    if(portal.readyState>=1)preparePortal();
    const freezePortal=()=>{portal.pause();if(Number.isFinite(portal.duration))portal.currentTime=Math.max(0,portal.duration-.06);};
    portal.addEventListener('ended',freezePortal);
    const preference=()=>{
      motion.current.reduced=media.matches;setReduced(media.matches);
      if(media.matches)el.pause();else el.play().catch(()=>{});
    };
    preference();media.addEventListener('change',preference);
    let raf=0;
    const context=gsap.context(()=>{
      const brand=root.current!.querySelector<HTMLElement>('.brand-lockup')!;
      const panels=gsap.utils.toArray<HTMLElement>('.action-panel');
      panels.forEach(panel=>{panel.inert=true;});
      const compactScale=()=>42/parseFloat(getComputedStyle(root.current!.querySelector('.wordmark')!).fontSize);
      gsap.set(brand,{top:0,y:innerHeight*.39,scale:1,force3D:true});
      const portalWindow=root.current!.querySelector<HTMLElement>('.portal-window')!;
      const cardsWindow=root.current!.querySelector<HTMLElement>('.final-field-clip')!;
      const portalCopy=root.current!.querySelector<HTMLElement>('.portal-copy')!;
      const portalMedia=Array.from(portalWindow.querySelectorAll<HTMLElement>('img,video'));
      const setCopyY=gsap.quickSetter(portalCopy,'y','px');
      gsap.set('.action-panel',{autoAlpha:0,y:65,filter:'blur(14px)'});
      gsap.set('.animated-word',{yPercent:115,opacity:0});
      let activeChapter=-2;
      let chapterAnimation:gsap.core.Timeline|undefined;
      const showChapter=(chapter:number)=>{
        if(activeChapter===chapter)return;activeChapter=chapter;
        chapterAnimation?.kill();
        gsap.killTweensOf('.animated-word');
        chapterAnimation=gsap.timeline()
          .to('.animated-word',{yPercent:-115,opacity:0,duration:media.matches?0:.45,stagger:media.matches?0:.025,ease:'power2.in'})
          .set('.sculpture-intro,.sculpture-headline,.portal-copy',{visibility:'hidden'});
        if(chapter>=0){
          const selector=['.sculpture-intro','.sculpture-headline','.portal-copy'][chapter];
          chapterAnimation.set(selector,{visibility:'visible'}).set(selector+' .animated-word',{yPercent:110,opacity:0})
            .to(selector+' .animated-word',{yPercent:0,opacity:1,duration:media.matches?0:1.4,stagger:media.matches?0:.08,ease:'expo.out'});
        }
      };
      const tl=gsap.timeline({paused:true,defaults:{ease:'none'}});
      tl.to('.backdrop',{clipPath:'inset(0% 8% 0% 8%)',duration:.15},.025)
        .to(brand,{y:()=>innerHeight*.63,scale:()=>compactScale()*1.5,duration:.05,ease:'power1.inOut'},0)
        .fromTo('.white-scene',{yPercent:100},{yPercent:0,duration:.15},.05)
        .to(brand,{y:()=>innerHeight*.04,scale:compactScale,duration:.15},.05)
        .to('.subtitle',{scale:1.7,transformOrigin:'50% 0',duration:.15},.05)
        .to('.brand-lockup',{color:'#191919',textShadow:'0 0 0 transparent',duration:.035},.20)
        .to('.brand-lockup',{color:'#fff5e8',textShadow:'0 2px 18px #19000855',duration:.04},.915)
        .to(brand,{y:()=>innerHeight*.01,duration:.05},.91)
        .to({},{duration:.001},.999);
      ScrollTrigger.create({trigger:'.scroll-track',start:'top top',end:'bottom bottom',scrub:.9,animation:tl,invalidateOnRefresh:true});
      let portalStarted=false,lastDocked=false,lastGeometry='';
      const cardsReveal=gsap.timeline({paused:true}).to(panels,{autoAlpha:1,y:0,filter:'blur(0px)',duration:media.matches?0:1.7,stagger:media.matches?0:.16,ease:'power3.out',onComplete:()=>panels.forEach(panel=>{panel.inert=false;})});
      const tick=()=>{
        raf=requestAnimationFrame(tick);
        const p=motion.current.reduced?1:tl.progress();motion.current.progress=p;
        // One numeric geometry calculation: left and right can never diverge,
        // including after fullscreen/resizing and ScrollTrigger refreshes.
        const geometry=`${p}:${innerWidth}:${innerHeight}`;
        if(geometry!==lastGeometry){
          lastGeometry=geometry;
          const w=portalWindow.clientWidth,h=portalWindow.clientHeight;
          const arrival=gsap.utils.clamp(0,1,(p-.60)/.10);
          const raw=gsap.utils.clamp(0,1,(p-.80)/.16);
          const expansion=raw*raw*(3-2*raw);
          const side=Math.min(w*.28,h*.22);
          const offset=(1-arrival)*h*.65;
          const top=(h*.68+offset)*(1-expansion);
          const bottom=(h*.32-side-offset)*(1-expansion);
          const horizontal=(w-side)*.5*(1-expansion);
          portalWindow.style.clipPath=`inset(${top}px ${horizontal}px ${bottom}px ${horizontal}px)`;
          cardsWindow.style.clipPath=portalWindow.style.clipPath;
          const mediaShift=(top-bottom)*.5;
          portalMedia.forEach(item=>{item.style.transform=`translate3d(0,${mediaShift+h*.02}px,0) scale(1.17)`;});
          portalWindow.style.visibility=p<.60?'hidden':'visible';
          setCopyY(offset);
          portalCopy.style.opacity='1';
        }
        const done=p>=.961;if(done!==lastDocked){lastDocked=done;setDocked(done);if(done)cardsReveal.timeScale(1).play();else {cardsReveal.timeScale(8).reverse();panels.forEach(panel=>{panel.inert=true;});}}
        showChapter(p>=.205&&p<.39?0:p>=.405&&p<.61?1:p>=.625&&p<.86?2:-1);
        if(p>=.961&&!portalStarted){portalStarted=true;if(media.matches)freezePortal();else portal.play().catch(()=>{});}
        else if(p<.74&&portalStarted){portalStarted=false;preparePortal();}
        if(motion.current.reduced)tl.progress(1);
      };tick();
    },root);
    return()=>{cancelAnimationFrame(raf);context.revert();media.removeEventListener('change',preference);el.removeEventListener('ended',replayFromColor);portal.removeEventListener('ended',freezePortal);portal.removeEventListener('loadedmetadata',preparePortal);};
  },[]);
  useEffect(()=>{
    if(menu||about){lastFocus.current=document.activeElement as HTMLElement;dialog.current?.showModal();}
    else if(dialog.current?.open){dialog.current.close();lastFocus.current?.focus();}
  },[menu,about]);
  const pulse=()=>{
    if(reduced)return;
    // Published Øneheart pulse: same 1.1 scale, 0.2s timing and back.out easing.
    gsap.killTweensOf(motion.current);
    gsap.timeline().to(motion.current,{pulse:1.1,duration:.2,ease:'back.out'}).to(motion.current,{pulse:1,duration:.2,ease:'back.out'});
  };
  const scrollTo=(p:number)=>{setMenu(false);setAbout(false);const track=document.querySelector<HTMLElement>('.scroll-track')!;window.scrollTo({top:(track.offsetHeight-innerHeight)*p,behavior:reduced?'instant':'smooth'});};
  const close=()=>{setMenu(false);setAbout(false);};
  const showNote=()=>{pulse();playEffect('guitar');setNote(previous=>{const next=Math.floor(Math.random()*(letovNotes.length-1));return next>=previous&&previous>=0?next+1:next;});};
  return <main ref={root} className={reduced?'experience reduced':'experience'}>
    <svg width="0" height="0" aria-hidden="true" style={{position:'absolute'}}><defs>{'VOTEL-ROGE'.split('').map((_,index)=><filter key={index} id={'glyph-'+index} x="-20%" y="-20%" width="140%" height="140%"><feMorphology className="glyph-erosion" operator="erode" radius="3"/></filter>)}</defs></svg>
    <div className="scroll-track" aria-hidden="true"/>
    <div className="stage">
      <div className="backdrop" aria-hidden="true"><img src="/cover.jpg" alt=""/><video className="intro-film" autoPlay ref={video} src="/intro.mp4" muted playsInline preload="auto" onError={e=>{e.currentTarget.style.display='none';}}/></div>
      <div className="white-scene" aria-hidden="true"/>
      <div className="portal-window" aria-hidden="true"><img src="/cover.jpg" alt=""/><video ref={portalVideo} src="/intro.mp4" muted playsInline preload="auto"/></div>
      <div className="portal-copy" aria-hidden="true"><h2><span className="reveal-line"><span><b className="word-mask"><i className="animated-word">где</i></b> <b className="word-mask"><span className="animated-word">ПАМЯТЬ</span></b></span></span><span className="reveal-line"><span><b className="word-mask"><i className="animated-word">становится</i></b> <b className="word-mask"><span className="animated-word">ЗВУКОМ</span></b></span></span></h2></div>
      <div className="brand-lockup"><h1 className="wordmark"><span className="hero-mask"><span aria-label="VOTEL-ROGE">{'VOTEL-ROGE'.split('').map((letter,index)=><span key={index} className="hero-glyph" aria-hidden="true" style={{filter:'url(#glyph-'+index+')'}}>{letter}</span>)}</span></span></h1><p className="subtitle"><span className="hero-mask"><i className="hero-word">ЛУДЖИ</i></span></p></div>
      <div className="sculpture-intro" aria-hidden="true"><h2><span className="reveal-line"><span><b className="word-mask"><span className="animated-word">ТВОЙ</span></b> <b className="word-mask"><span className="animated-word">САМЫЙ</span></b></span></span><span className="reveal-line"><span><b className="word-mask"><i className="animated-word">важный</i></b> <b className="word-mask"><span className="animated-word">ЗВУК</span></b></span></span></h2></div>
      <div className="sculpture-headline" aria-hidden="true"><h2><span className="reveal-line"><span><b className="word-mask"><span className="animated-word">ДОСТОИН</span></b> <b className="word-mask"><span className="animated-word">ЖИТЬ</span></b></span></span><span className="reveal-line"><span><b className="word-mask"><i className="animated-word">вечно.</i></b></span></span></h2></div>
      <GuitarScene motion={motion}/>
      <button className="guitar-touch" aria-label="Оживить гитару и показать заметку о Летове" tabIndex={docked?0:-1} style={{pointerEvents:docked?'auto':'none',visibility:docked?'visible':'hidden'}} onClick={showNote} onPointerEnter={pulse} onFocus={pulse}/>
      <div className="letov-note" ref={noteBox} role="status" aria-live="polite"><p>{note>=0?letovNotes[note]:''}</p></div>
      <div className="final-field-clip" style={{position:'absolute',inset:0,zIndex:7,pointerEvents:'none'}}><div className="final-field">
        {platforms.map((p,index)=><div className={'action-panel platform-card platform-'+index} key={p.name} onPointerEnter={event=>{if(event.pointerType==='mouse')playEffect('hover');}}><a onClick={()=>playEffect('click')} href={p.url} target="_blank" rel="noreferrer" aria-label={p.name+' — открыть площадку'}><span className="platform-monogram" style={{color:p.color}} aria-hidden="true">{p.mark}</span><span>{p.name}</span><ArrowUpRight size={23}/></a></div>)}
        <div className="action-panel about-panel" onPointerEnter={event=>{if(event.pointerType==='mouse')playEffect('hover');}}><section aria-label="О проекте"><span className="eyebrow">VOTEL-ROGE</span><h2>Услышать<br/><i>немного больше.</i></h2><InteractiveHoverButton text="ОЗНАКОМИТЬСЯ ЛУЧШЕ" className="learn-button" onClick={()=>{playEffect('click');setAbout(true);}}/></section></div>
      </div></div>

    </div>
    <CursorRing/>
    <audio ref={guitar} src="/audio/guitar.wav" preload="auto" hidden/>
    <audio ref={toggle} src="/audio/card-click.mp3" preload="auto" hidden/>
    <audio ref={music} src="/audio/background.wav" loop preload="none" hidden/>
    <audio ref={hover} src="/audio/card-hover.mp3" preload="auto" hidden/>
    <audio ref={click} src="/audio/card-click.mp3" preload="auto" hidden/>
    <div className="sound-toggle" data-enabled={soundEnabled} role="group" aria-label="Звук"><button aria-label="Включить звук" aria-pressed={soundEnabled} onClick={()=>setSoundEnabled(true)}><Volume2 size={19}/></button><button aria-label="Выключить звук" aria-pressed={!soundEnabled} onClick={()=>setSoundEnabled(false)}><VolumeX size={19}/></button></div>
    {!loaded&&<LoadingIntro onComplete={finishLoading}/>}
    <dialog ref={dialog} className="project-dialog" aria-label={menu?'Меню ЛУДЖИ':'О проекте VOTEL-ROGE'} onCancel={close} onClick={e=>{if(e.target===e.currentTarget)close();}}><button className="dialog-close" aria-label="Закрыть" onClick={close}><X/></button>
      {menu?<><span className="eyebrow">ЛУДЖИ</span><h2>Куда <i>дальше?</i></h2><nav><button onClick={()=>scrollTo(0)}>Начало <ArrowUpRight/></button><button onClick={()=>scrollTo(.3)}>История гитары <ArrowUpRight/></button><button onClick={()=>scrollTo(1)}>Слушать проект <Music2/></button></nav></>:<><span className="eyebrow">О ПРОЕКТЕ</span><h2>VOTEL-ROGE</h2><p>Инструментальный проект — новый этап творчества. Здесь музыка говорит через тембр, ритм и пространство.</p><p>В центре этой визуальной истории — гитара Егора Летова, следы времени и память о свободе творчества.</p><p className="draft-note">Текст для первого макета. Подробности проекта и ссылки на релизы будут добавлены позже.</p></>}
    </dialog>
  </main>;
}
