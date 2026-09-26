import { useCallback, useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ArrowUpRight, FastForward, Music2, RotateCcw, Volume2, VolumeX, X } from 'lucide-react';
import { useSiteAudio } from './useSiteAudio';
import { letovNotes } from './letovNotes';
import { InteractiveHoverButton } from '@/components/ui/interactive-hover-button';
import GlassCard from '@/components/ui/glass-card';
import { darkGlass } from '@/lib/glass';
import GuitarScene, { type GuitarMotion } from '@/components/GuitarScene';
import LoadingIntro from '@/components/LoadingIntro';
import CursorRing from '@/components/CursorRing';
import InteractivePeelReveal from '@/components/InteractivePeelReveal';
import MeridianTransition from '@/components/MeridianTransition';
import EyeBlink, { type BlinkControl } from '@/components/EyeBlink';
import { restart, soundPreference, startsAtFinal, travel } from '@/lib/navigation';
import { createScrollAudio, type ScrollAudio } from '@/lib/scrollAudio';

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
  // #/final (coming back from the release page) opens straight at the cards.
  const atFinal=useRef(startsAtFinal());
  const [loaded,setLoaded]=useState(atFinal.current),[heroReady,setHeroReady]=useState(false),[peelVisible,setPeelVisible]=useState(false),[peelProgress,setPeelProgress]=useState(0);
  const transitionMotion=useRef({progress:0});
  const heroReadyRef=useRef(false),peelProgressRef=useRef(0),frameImage=useRef<HTMLImageElement>(null),faceSwap=useRef<HTMLImageElement>(null);
  const {music,hover,click,guitar,toggle,soundEnabled,needsInteraction,setSoundEnabled,playEffect}=useSiteAudio();
  const [note,setNote]=useState(-1);
  const noteBox=useRef<HTMLDivElement>(null);
  const blink=useRef<BlinkControl|null>(null);
  const controls=useRef<{skip:()=>void}|null>(null);
  // The film's own sound (cutting, paper) scrubbed by the scroll frames.
  const filmSound=useRef<ScrollAudio|null>(null);
  useEffect(()=>{const sound=createScrollAudio('/audio/hero-scroll.m4a');filmSound.current=sound;return()=>{sound.dispose();filmSound.current=null;};},[]);
  useEffect(()=>{soundPreference.enabled=soundEnabled;filmSound.current?.setEnabled(soundEnabled);},[soundEnabled]);
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
  const changePeel=useCallback((progress:number)=>{peelProgressRef.current=progress;setPeelProgress(progress);},[]);
  useEffect(()=>{
    const film=video.current!;
    const colorTime=4.95;
    const finish=()=>{
      if(heroReadyRef.current)return;
      film.pause();
      heroReadyRef.current=true;
      setHeroReady(true);
    };
    const handoff=()=>{if(film.currentTime>=colorTime)finish();};
    let callback=0;
    const nextFrame:VideoFrameRequestCallback=(_now,metadata)=>{
      if(metadata.mediaTime>=colorTime-.001)finish();
      else callback=film.requestVideoFrameCallback(nextFrame);
    };
    if(matchMedia('(prefers-reduced-motion: reduce)').matches)finish();
    else if(typeof film.requestVideoFrameCallback==='function')callback=film.requestVideoFrameCallback(nextFrame);
    else film.addEventListener('timeupdate',handoff);
    film.addEventListener('error',finish);
    const first=new Image();first.src='/peel/frames/frame_0100.webp';
    return()=>{if(callback)film.cancelVideoFrameCallback(callback);film.removeEventListener('timeupdate',handoff);film.removeEventListener('error',finish);};
  },[]);
  useEffect(()=>{
    let lastFrame=100;
    let requestedFrame=100;
    const cache=new Map<number,HTMLImageElement>();
    const prepare=(number:number)=>{
      if(number<100||number>301||cache.has(number))return;
      const image=new Image();image.decoding='async';cache.set(number,image);
      image.src=`/peel/frames/frame_${String(number).padStart(4,'0')}.webp`;
      image.decode().then(()=>{if(requestedFrame===number&&frameImage.current)frameImage.current.src=image.src;}).catch(()=>{});
    };
    for(let i=100;i<=110;i++)prepare(i);
    let lastVisible=false,previousY=0;
    // Scrolling back re-sticks the sheet: the peel plays in reverse along the
    // same crease instead of the flowers popping back in one frame.
    const restick={value:0};let resticking=false;
    const update=()=>{
      if(!heroReadyRef.current){if(scrollY>0)window.scrollTo(0,0);return;}
      const section=2*innerHeight;
      if(peelProgressRef.current<.995&&scrollY>section){window.scrollTo(0,section);}
      if(!resticking&&scrollY<previousY&&previousY>=section-2&&scrollY<=section+80&&peelProgressRef.current>=.995){
        resticking=true;window.scrollTo(0,section);
        restick.value=peelProgressRef.current;
        gsap.to(restick,{value:0,duration:matchMedia('(prefers-reduced-motion: reduce)').matches?0:1.1,ease:'power2.inOut',onUpdate:()=>changePeel(restick.value),onComplete:()=>{changePeel(0);resticking=false;}});
      }
      if(resticking&&scrollY!==section)window.scrollTo(0,section);
      previousY=scrollY;
      // The last frame is reached exactly where the peel sheet takes over.
      const end=section-8;
      const frame=100+Math.min(201,Math.floor(Math.min(scrollY,end)/end*201));
      // Frames were taken at 20 fps from 4.95 s on; the clip starts at 4.95 s.
      filmSound.current?.seek(Math.min(scrollY,end)/end*201/20);
      requestedFrame=frame;
      // Over the static closing frames the photo settles into the opening, so
      // frame 301 already equals the two-layer sheet and the switch is invisible.
      if(faceSwap.current){const t=Math.max(0,Math.min(1,(frame-281)/19));faceSwap.current.style.opacity=String(t*t*(3-2*t));}
      if(frame!==lastFrame&&frameImage.current){
        lastFrame=frame;
        const ready=cache.get(frame);
        if(ready?.complete&&ready.naturalWidth)frameImage.current.src=ready.src;
        else prepare(frame);
        for(let i=frame-7;i<=frame+10;i++)prepare(i);
        for(const key of cache.keys())if(Math.abs(key-frame)>20)cache.delete(key);
      }
      const visible=scrollY>=section-8&&scrollY<=section+2;
      if(visible!==lastVisible){lastVisible=visible;setPeelVisible(visible);}

    };
    const wheel=(event:WheelEvent)=>{
      if(!heroReadyRef.current||resticking||(peelProgressRef.current<.995&&scrollY>=2*innerHeight-3&&event.deltaY>0))event.preventDefault();
    };
    addEventListener('scroll',update,{passive:true});
    addEventListener('resize',update);
    addEventListener('wheel',wheel,{passive:false});
    update();
    return()=>{gsap.killTweensOf(restick);removeEventListener('scroll',update);removeEventListener('resize',update);removeEventListener('wheel',wheel);};
  },[heroReady]);
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
    portal.muted=true;portal.defaultMuted=true;portal.pause();
    const preparePortal=()=>{portal.pause();portal.currentTime=4.9;};
    portal.addEventListener('loadedmetadata',preparePortal);
    if(portal.readyState>=1)preparePortal();
    const freezePortal=()=>{portal.pause();if(Number.isFinite(portal.duration))portal.currentTime=Math.max(0,portal.duration-.06);};
    portal.addEventListener('ended',freezePortal);
    const preference=()=>{
      motion.current.reduced=media.matches;setReduced(media.matches);
      if(media.matches)el.pause();else if(!heroReadyRef.current)el.play().catch(()=>{});
    };
    preference();media.addEventListener('change',preference);
    let raf=0,hurry:(event?:Event)=>void=()=>{};
    const context=gsap.context(()=>{
      const brand=root.current!.querySelector<HTMLElement>('.brand-lockup')!;
      const panels=gsap.utils.toArray<HTMLElement>('.action-panel');
      panels.forEach(panel=>{panel.inert=true;});
      const compactScale=()=>42/parseFloat(getComputedStyle(root.current!.querySelector('.wordmark')!).fontSize);
      gsap.set(brand,{top:0,y:innerHeight*.39,scale:1,force3D:true});
      const portalWindow=root.current!.querySelector<HTMLElement>('.portal-window')!;
      const cardsWindow=root.current!.querySelector<HTMLElement>('.final-field-clip')!;
      const portalCopy=root.current!.querySelector<HTMLElement>('.portal-copy')!;
      gsap.set('.action-panel',{autoAlpha:0,y:65,filter:'blur(14px)'});
      gsap.set('.animated-word',{yPercent:115,opacity:0});
      let activeChapter=-2;
      let chapterAnimation:gsap.core.Timeline|undefined;
      // 0–1: phrases over the guitar; 3–5: inspiration phrases on the child cover.
      const chapters=['.sculpture-intro','.sculpture-headline','.portal-copy','.inspire-0','.inspire-1','.inspire-2'];
      const showChapter=(chapter:number)=>{
        if(activeChapter===chapter)return;activeChapter=chapter;
        chapterAnimation?.kill();
        gsap.killTweensOf('.animated-word');
        const instant=media.matches;
        chapterAnimation=gsap.timeline()
          .to('.animated-word',{yPercent:-115,opacity:0,duration:instant?0:.45,stagger:instant?0:.025,ease:'power2.in'})
          .set('.sculpture-intro,.sculpture-headline,.portal-copy,.inspire-copy',{visibility:'hidden'});
        if(chapter>=0){
          const selector=chapters[chapter];
          chapterAnimation.set(selector,{visibility:'visible'}).set(selector+' .animated-word',{yPercent:110,opacity:0})
            .to(selector+' .animated-word',{yPercent:0,opacity:1,duration:instant?0:1.4,stagger:instant?0:.08,ease:'expo.out'});
        }
      };
      const tl=gsap.timeline({paused:true,defaults:{ease:'none'}});
      tl.to(brand,{y:()=>innerHeight*.04,scale:compactScale,duration:.12},0)
        .to('.subtitle',{scale:1.7,transformOrigin:'50% 0',duration:.12},0)
        .to({},{duration:.001},.999);
      const trigger=ScrollTrigger.create({trigger:'.scroll-track',start:()=>innerHeight*2,end:'bottom bottom',scrub:.6,animation:tl,invalidateOnRefresh:true});
      let lastGeometry='';
      const cardsReveal=gsap.timeline({paused:true}).to(panels,{autoAlpha:1,y:0,filter:'blur(0px)',duration:media.matches?0:1.2,stagger:media.matches?0:.1,ease:'power3.out',onComplete:()=>{gsap.set(panels,{clearProps:'filter'});panels.forEach(panel=>{panel.inert=false;});}});
      // Finale: once the last plate has left, the page stops following the
      // wheel, the eye blinks child cover → flower cover on its own, and the
      // platform cards float in. Scrolling well back blinks back again.
      const finalCover=root.current!.querySelector<HTMLElement>('.final-cover')!;
      const childCover=root.current!.querySelector<HTMLElement>('.meridian-scene')!;
      // settling: after a jump the scroll scrub still glides 0 → 1; that glide is
      // not the visitor scrolling back, so it must not blink back to the child.
      let settleUntil=0;
      let finale:'idle'|'playing'|'done'='idle',cardsDelay:gsap.core.Tween|undefined,eyeDelay:gsap.core.Tween|undefined;
      const runFinale=(forward:boolean)=>{
        finale='playing';
        if(forward)showChapter(-1);
        else {cardsDelay?.kill();setDocked(false);cardsReveal.timeScale(4).reverse();panels.forEach(panel=>{panel.inert=true;});}
        // The eye only starts once the last phrase has fully left the screen.
        const exit=forward&&chapterAnimation?Math.max(0,chapterAnimation.duration()-chapterAnimation.time()):0;
        eyeDelay=gsap.delayedCall(media.matches?0:forward?exit+.35:0,()=>{
          const eye=blink.current;
          const swap=()=>{finalCover.classList.toggle('is-shown',forward);};
          (eye?eye.play({from:forward?childCover:finalCover,onClosed:swap,reduced:media.matches}):Promise.resolve(swap())).then(()=>{
            finale=forward?'done':'idle';
            // Let the flower cover stand alone for a moment before the cards.
            if(forward)cardsDelay=gsap.delayedCall(media.matches?0:.8,()=>{setDocked(true);cardsReveal.timeScale(1).play();});
          });
        });
      };
      // Scrolling back during the blink never holds the page: the blink rushes
      // to its end and the scroll position decides what shows next. Only
      // upward input counts, so momentum from reaching the end cannot skip it.
      let lastY=scrollY;
      hurry=(event?:Event)=>{
        const back=event?.type==='wheel'?(event as WheelEvent).deltaY<0:scrollY<lastY-4;
        lastY=scrollY;
        if(finale!=='playing'||!back)return;
        if(eyeDelay?.isActive())eyeDelay.progress(1);
        blink.current?.skip();
      };
      addEventListener('wheel',hurry,{passive:true});addEventListener('scroll',hurry,{passive:true});
      const flowers=new Image();flowers.src='/peel/cover-flowers.jpg';flowers.decode().catch(()=>{});
      const wakeHero=()=>{if(heroReadyRef.current)return;video.current?.pause();heroReadyRef.current=true;setHeroReady(true);};
      // Straight to the last section: flower cover and cards, no animation.
      const jumpToFinal=()=>{
        wakeHero();changePeel(1);
        finale='done';settleUntil=performance.now()+1200;eyeDelay?.kill();cardsDelay?.kill();showChapter(-1);
        finalCover.classList.add('is-shown');
        ScrollTrigger.refresh();
        window.scrollTo({top:document.documentElement.scrollHeight-innerHeight,behavior:'instant'});
        trigger.update();trigger.getTween()?.progress(1);tl.progress(1);
        cardsReveal.timeScale(1).progress(1);panels.forEach(panel=>{panel.inert=false;});setDocked(true);
      };
      // "Пропустить анимации": the whole story plays through at 2.5× speed —
      // hero frames, the peel, the guitar, both covers, the blink — and stops
      // at the cards. Every GSAP animation, the scroll scrub included, speeds up.
      let fastForward=false;
      const skipAll=()=>{
        if(fastForward||finale!=='idle')return;
        if(media.matches){jumpToFinal();return;}
        fastForward=true;wakeHero();
        gsap.globalTimeline.timeScale(2.5);
        const section=2*innerHeight,end=document.documentElement.scrollHeight-innerHeight;
        const position={y:scrollY},peel={value:peelProgressRef.current};
        const scroll=()=>window.scrollTo(0,position.y);
        const run=gsap.timeline();
        if(position.y<section)run.to(position,{y:section,duration:2.5,ease:'power1.inOut',onUpdate:scroll});
        if(peel.value<.995)run.to(peel,{value:1,duration:1.6,ease:'power2.inOut',onUpdate:()=>changePeel(peel.value)});
        run.to(position,{y:end,duration:10,ease:'sine.inOut',onUpdate:scroll});
      };
      controls.current={skip:skipAll};
      if(atFinal.current)requestAnimationFrame(jumpToFinal);
      const tick=()=>{
        raf=requestAnimationFrame(tick);
        // Right after a jump, snap the scrub straight to the scroll position.
        if(performance.now()<settleUntil)trigger.getTween()?.progress(1);
        const p=motion.current.reduced?1:tl.progress();motion.current.progress=p;
        // One numeric geometry calculation: left and right can never diverge,
        // including after fullscreen/resizing and ScrollTrigger refreshes.
        const geometry=`${p}:${innerWidth}:${innerHeight}`;
        if(geometry!==lastGeometry){
          lastGeometry=geometry;
          portalWindow.style.visibility='hidden';
          cardsWindow.style.clipPath='none';
          portalCopy.style.visibility='hidden';
        }
        const sceneActive=scrollY>innerHeight*2||peelProgressRef.current>=.995;
        root.current!.classList.toggle('in-narrative',sceneActive);
        // The guitar/Letov story keeps its original pace (800vh of travel); the
        // track is longer only to make room for the plates after it.
        const story=p*1050/800;
        const guitarP=sceneActive?gsap.utils.clamp(.205,1,.205+story*.795):0;
        motion.current.progress=guitarP;
        transitionMotion.current.progress=gsap.utils.clamp(0,1,(guitarP-.60)/.15);

        if(finale==='idle'){
          // Phrases start with the guitar's first appearance from below (.235),
          // never while the finished sheet is still covering the scene; plates
          // follow once the child cover has fully arrived (p ≈ .52). After the
          // third one the screen is empty for a short stretch of scroll.
          showChapter(!sceneActive?-1:guitarP>=.235&&guitarP<.40?0:guitarP>=.40&&guitarP<.62?1:p>=.555&&p<.67?3:p>=.67&&p<.785?4:p>=.785&&p<.90?5:-1);
          if(sceneActive&&p>=.93)runFinale(true);
        }else if(finale==='done'&&performance.now()>settleUntil&&p<.87)runFinale(false);
        if(fastForward&&finale==='done'&&cardsReveal.progress()===1){fastForward=false;gsap.globalTimeline.timeScale(1);}
        if(motion.current.reduced)tl.progress(1);
      };tick();
    },root);
    return()=>{cancelAnimationFrame(raf);context.revert();gsap.globalTimeline.timeScale(1);controls.current=null;removeEventListener('wheel',hurry);removeEventListener('scroll',hurry);media.removeEventListener('change',preference);portal.removeEventListener('ended',freezePortal);portal.removeEventListener('loadedmetadata',preparePortal);};
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
  return <main ref={root} className={`${reduced?'experience reduced':'experience'}${peelVisible?' in-peel':''}`}>
    <svg width="0" height="0" aria-hidden="true" style={{position:'absolute'}}><defs>{'VOTEL-ROGE'.split('').map((_,index)=><filter key={index} id={'glyph-'+index} x="-20%" y="-20%" width="140%" height="140%"><feMorphology className="glyph-erosion" operator="erode" radius="3"/></filter>)}</defs></svg>
    <div className="scroll-track" aria-hidden="true"/>
    <div className="stage">
      <div className="backdrop" aria-hidden="true"><img src="/cover.jpg" alt=""/><video className="intro-film" autoPlay ref={video} src="/intro.mp4" muted playsInline preload="auto" onError={e=>{e.currentTarget.style.display='none';}}/><img ref={frameImage} className={`hero-scroll-frame${heroReady?' is-ready':''}`} src="/peel/frames/frame_0100.webp" alt=""/><img ref={faceSwap} className={`hero-face-swap${heroReady?' is-ready':''}`} src="/peel/letov-hole.webp?v=6" alt=""/></div>
      <MeridianTransition motion={transitionMotion}/>
      <div className="final-cover" aria-hidden="true"><img src="/peel/cover-flowers.jpg" alt=""/></div>
      <InteractivePeelReveal active={peelVisible} progress={peelProgress} onProgressChange={changePeel}/>
      <div className="portal-window" aria-hidden="true"><img src="/cover.jpg" alt=""/><video ref={portalVideo} src="/intro.mp4" muted playsInline preload="auto"/></div>
      <div className="portal-copy" aria-hidden="true"><h2><span className="reveal-line"><span><b className="word-mask"><i className="animated-word">где</i></b> <b className="word-mask"><span className="animated-word">ПАМЯТЬ</span></b></span></span><span className="reveal-line"><span><b className="word-mask"><i className="animated-word">становится</i></b> <b className="word-mask"><span className="animated-word">ЗВУКОМ</span></b></span></span></h2></div>
      <div className="brand-lockup"><h1 className="wordmark"><span className="hero-mask"><span aria-label="VOTEL-ROGE">{'VOTEL-ROGE'.split('').map((letter,index)=><span key={index} className="hero-glyph" aria-hidden="true" style={{filter:'url(#glyph-'+index+')'}}>{letter}</span>)}</span></span></h1><p className="subtitle"><span className="hero-mask"><i className="hero-word">Павел Лугинин</i></span></p></div>
      <div className="sculpture-intro" aria-hidden="true"><h2><span className="reveal-line"><span><b className="word-mask"><span className="animated-word">ПАМЯТЬ</span></b> <b className="word-mask"><span className="animated-word">ХРАНИТ</span></b></span></span><span className="reveal-line"><span><b className="word-mask"><i className="animated-word">не только</i></b> <b className="word-mask"><span className="animated-word">ЗВУК</span></b></span></span></h2></div>
      <div className="sculpture-headline" aria-hidden="true"><h2><span className="reveal-line"><span><b className="word-mask"><span className="animated-word">ДОСТОИН</span></b> <b className="word-mask"><span className="animated-word">ЖИТЬ</span></b></span></span><span className="reveal-line"><span><b className="word-mask"><i className="animated-word">вечно.</i></b></span></span></h2></div>
      <div className="inspire-copy inspire-0 inspire-left" aria-hidden="true"><h2><span className="reveal-line"><span><b className="word-mask"><span className="animated-word">ВДОХНОВЕНИЕ</span></b></span></span><span className="reveal-line"><span><b className="word-mask"><i className="animated-word">не приходит</i></b> <b className="word-mask"><i className="animated-word">из тишины</i></b></span></span></h2></div>
      <div className="inspire-copy inspire-1 inspire-right" aria-hidden="true"><h2><span className="reveal-line"><span><b className="word-mask"><span className="animated-word">ЧУЖОЙ</span></b> <b className="word-mask"><span className="animated-word">АККОРД</span></b></span></span><span className="reveal-line"><span><b className="word-mask"><i className="animated-word">становится</i></b> <b className="word-mask"><i className="animated-word">своим</i></b></span></span></h2></div>
      <div className="inspire-copy inspire-2 inspire-left" aria-hidden="true"><h2><span className="reveal-line"><span><b className="word-mask"><span className="animated-word">ПРОДОЛЖИТЬ</span></b> <b className="word-mask"><span className="animated-word">—</span></b></span></span><span className="reveal-line"><span><b className="word-mask"><i className="animated-word">значит</i></b> <b className="word-mask"><i className="animated-word">услышать</i></b></span></span></h2></div>
      <GuitarScene motion={motion}/>
      <div className="letov-note" ref={noteBox} role="status" aria-live="polite"><p>{note>=0?letovNotes[note]:''}</p></div>
      <div className="final-field-clip" style={{position:'absolute',inset:0,zIndex:7,pointerEvents:'none'}}><div className="final-field">
        {platforms.map((p,index)=><div className={'action-panel platform-card platform-'+index} key={p.name} onPointerEnter={event=>{if(event.pointerType==='mouse')playEffect('hover');}}><GlassCard {...darkGlass} className="glass-shell" radius={20} padding={0}><a onClick={()=>playEffect('click')} href={p.url} target="_blank" rel="noreferrer" aria-label={p.name+' — открыть площадку'}><span className="platform-monogram" style={{color:p.color}} aria-hidden="true">{p.mark}</span><span>{p.name}</span><ArrowUpRight size={23}/></a></GlassCard></div>)}
        <div className="action-panel about-panel" onPointerEnter={event=>{if(event.pointerType==='mouse')playEffect('hover');}}><GlassCard {...darkGlass} className="glass-shell" radius={20} padding={18}><section aria-label="О проекте"><span className="eyebrow">VOTEL-ROGE</span><h2>Услышать<br/><i>немного больше.</i></h2><InteractiveHoverButton text="ОЗНАКОМИТЬСЯ ЛУЧШЕ" className="learn-button" onClick={()=>{playEffect('click');travel('#/release');}}/></section></GlassCard></div>
      </div></div>

      <EyeBlink control={blink}/>
    </div>
    <CursorRing/>
    <audio ref={guitar} src="/audio/guitar.wav" preload="auto" hidden/>
    <audio ref={toggle} src="/audio/card-click.mp3" preload="auto" hidden/>
    <audio ref={music} src="/audio/background.wav" loop preload="auto" hidden/>
    <audio ref={hover} src="/audio/card-hover.mp3" preload="auto" hidden/>
    <audio ref={click} src="/audio/card-click.mp3" preload="auto" hidden/>
    {needsInteraction&&soundEnabled&&<div className="sound-hint" role="status">Нажмите, чтобы включить музыку</div>}
    <div className={`peel-hint${peelVisible&&peelProgress<.995?' is-shown':''}`} aria-hidden="true"><GlassCard {...darkGlass} radius={30} padding={0} interactive={false}><span>Потяните за любой край или угол</span></GlassCard></div>
    {loaded&&<div className="page-nav" role="group" aria-label="Навигация"><button onClick={()=>{playEffect('click');restart(180);}}><RotateCcw size={17}/><span>В начало</span></button><button onClick={()=>{playEffect('click');controls.current?.skip();}}><FastForward size={18}/><span>Пропустить анимации</span></button></div>}
    <div className="sound-toggle" data-enabled={soundEnabled} role="group" aria-label="Звук"><button aria-label="Включить звук" aria-pressed={soundEnabled} onClick={()=>setSoundEnabled(true)}><Volume2 size={19}/></button><button aria-label="Выключить звук" aria-pressed={!soundEnabled} onClick={()=>setSoundEnabled(false)}><VolumeX size={19}/></button></div>
    {!loaded&&<LoadingIntro onComplete={finishLoading}/>}
    <dialog ref={dialog} className="project-dialog" aria-label={menu?'Меню Павла Лугинина':'О проекте VOTEL-ROGE'} onCancel={close} onClick={e=>{if(e.target===e.currentTarget)close();}}><button className="dialog-close" aria-label="Закрыть" onClick={close}><X/></button>
      {menu?<><span className="eyebrow">Павел Лугинин</span><h2>Куда <i>дальше?</i></h2><nav><button onClick={()=>scrollTo(0)}>Начало <ArrowUpRight/></button><button onClick={()=>scrollTo(.3)}>История гитары <ArrowUpRight/></button><button onClick={()=>scrollTo(1)}>Слушать проект <Music2/></button></nav></>:<><span className="eyebrow">О ПРОЕКТЕ</span><h2>VOTEL-ROGE</h2><p>Инструментальный проект — новый этап творчества. Здесь музыка говорит через тембр, ритм и пространство.</p><p>В центре этой визуальной истории — гитара Егора Летова, следы времени и память о свободе творчества.</p><p className="draft-note">Текст для первого макета. Подробности проекта и ссылки на релизы будут добавлены позже.</p></>}
    </dialog>
  </main>;
}
