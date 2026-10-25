import { defineConfig } from 'vite';

export default defineConfig({
  base: '/voto-aberto-2026/',
  root: 'public',
  build: {
    outDir: '../dist',
    emptyOutDir: true
  }
});
