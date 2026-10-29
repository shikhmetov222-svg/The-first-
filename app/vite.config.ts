import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Версия сборки: зашивается в код и кладётся рядом в version.json. Игра при запуске сверяет их и,
// если на сайте уже новая версия, перезагружается — чтобы Telegram не показывал старую копию сайта.
const BUILD = String(Date.now());

function versionFile(): Plugin {
  return {
    name: 'version-file',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD }) });
    },
  };
}

export default defineConfig({
  plugins: [react(), versionFile()],
  define: { __BUILD__: JSON.stringify(BUILD) },
});
