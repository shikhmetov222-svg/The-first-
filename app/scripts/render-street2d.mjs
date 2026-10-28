// Рендерит PNG каждого бизнеса на каждом уровне для простой графики (2D-режима улицы).
// Те же строители, свет и ракурс, что у 3D-улицы. Запуск из app/: node scripts/render-street2d.mjs
// Нужен Playwright с Chromium (в облачной среде Claude уже установлен).
import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const APP = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const OUT = path.join(APP, 'public', 'street2d');
let playwright;
try {
  playwright = await import('playwright');
} catch {
  const req = createRequire(path.join(execSync('npm root -g').toString().trim(), 'noop.js'));
  playwright = req('playwright');
}

const server = await createServer({ root: APP, server: { port: 5198, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await playwright.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('Ошибка страницы:', e.message));
  await page.goto('http://localhost:5198/scripts/street2d/index.html');
  await page.waitForFunction(() => window.ready, null, { timeout: 120000 });
  // Шрифты вывесок — как в игре.
  await page.addStyleTag({ url: 'https://fonts.googleapis.com/css2?family=Manrope:wght@700;800&family=Unbounded:wght@700&display=block' }).catch(() => {});
  await page.evaluate(() => Promise.all([document.fonts.load('700 40px Unbounded'), document.fonts.load('800 40px Manrope')]).catch(() => {}));
  const res = await page.evaluate(() => window.render2d());
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const meta = {};
  for (const [name, v] of Object.entries(res)) {
    if (name.includes(':')) {
      const [n, key] = name.split(':');
      (meta[n] ??= {})[key] = Math.round(Number(v) * 1000) / 1000;
      continue;
    }
    fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(v.split(',')[1], 'base64'));
  }
  fs.writeFileSync(path.join(APP, 'src', 'street', 'street2d.json'), JSON.stringify(meta, null, 1) + '\n');
  console.log('Готово:', Object.keys(meta).length, 'картинок в public/street2d');
} finally {
  await browser.close();
  await server.close();
}
