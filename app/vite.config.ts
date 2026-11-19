import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // GitHub Pages serves the app under /<repo-name>/; the deploy workflow sets BASE_PATH.
  base: process.env.BASE_PATH || '/',
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
  // The OpenCascade build is a large Emscripten module: let Vite serve it as-is.
  optimizeDeps: { exclude: ['replicad-opencascadejs'] },
  build: { target: 'es2022' },
});
