import { defineConfig } from 'vite';

export default defineConfig({
  // Общий игровой модуль лежит рядом с Edge Function — разрешаем Vite читать его.
  server: { fs: { allow: ['..'] } },
  build: { target: 'es2020' },
});
