import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
export default defineConfig({plugins:[tailwindcss()],resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}},build:{rollupOptions:{output:{manualChunks:{three:['three'],motion:['gsap','gsap/ScrollTrigger'],react:['react','react-dom/client']}}}}});
