import { defineConfig } from 'vite';

export default defineConfig({
  // Caminhos relativos: funciona em qualquer endereço (ex.: GitHub Pages em /gangbut/).
  base: './',
  server: { host: true, port: 5173 },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
});
