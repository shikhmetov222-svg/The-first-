import { defineConfig } from 'vite';

export default defineConfig({
  // относительные пути: сайт работает и в корне домена, и в подпапке (GitHub Pages)
  base: './',
  // Общий игровой модуль лежит рядом с Edge Function — разрешаем Vite читать его.
  server: { fs: { allow: ['..'] } },
  build: { target: 'es2020' },
});
