import { useEffect, useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import ReleasePage from './ReleasePage';
import { startsAtFinal, viewFromHash } from './lib/navigation';
import './style.css';
history.scrollRestoration='manual';
// #/final opens the landing page at its last section; everything else starts at the top.
if(!startsAtFinal())window.scrollTo({top:0,left:0,behavior:'instant'});
window.addEventListener('pageshow',()=>{if(!startsAtFinal())window.scrollTo({top:0,left:0,behavior:'instant'});});

function Root(){
  const [view,setView]=useState(viewFromHash);
  useEffect(()=>{
    const change=()=>setView(viewFromHash());
    addEventListener('hashchange',change);
    return()=>removeEventListener('hashchange',change);
  },[]);
  // The veil covered the old view; lift it once the new one is on screen.
  useLayoutEffect(()=>{
    const veil=document.querySelector<HTMLElement>('.route-veil');
    if(!veil?.classList.contains('is-covering'))return;
    requestAnimationFrame(()=>requestAnimationFrame(()=>veil.classList.remove('is-covering')));
  },[view]);
  return <>
    {view==='release'?<ReleasePage/>:<App/>}
    <div className="route-veil" aria-hidden="true"/>
  </>;
}
createRoot(document.getElementById('root')!).render(<Root />);
