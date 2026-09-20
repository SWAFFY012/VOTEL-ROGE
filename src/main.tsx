import { createRoot } from 'react-dom/client';
import App from './App';
import './style.css';
history.scrollRestoration='manual';
window.scrollTo({top:0,left:0,behavior:'instant'});
window.addEventListener('pageshow',()=>window.scrollTo({top:0,left:0,behavior:'instant'}));
createRoot(document.getElementById('root')!).render(<App />);
