import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
// PORT lets the desktop preview start a second copy next to a terminal-run server.
export default defineConfig({server:process.env.PORT?{port:Number(process.env.PORT),strictPort:true}:{},plugins:[tailwindcss()],resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}},build:{rollupOptions:{output:{manualChunks:{three:['three'],motion:['gsap','gsap/ScrollTrigger'],react:['react','react-dom/client']}}}}});
