import { defineConfig } from 'vite';

export default defineConfig({
  base: '/voto-aberto-2026/',
  root: 'public',
  publicDir: '../static',
  build: {
    outDir: '../dist',
    emptyOutDir: true
  }
});
