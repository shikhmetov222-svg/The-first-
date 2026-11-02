// Звуки игры: синтез через Web Audio, без файлов. Включаются и выключаются в меню ☰ (хранится на устройстве).
const KEY = 'zn-sound';
let ctx: AudioContext | null = null;
let on = true;
try { on = localStorage.getItem(KEY) !== '0'; } catch { /* нет хранилища */ }

function ac(): AudioContext | null {
  if (!on) return null;
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch { return null; }
}

function tone(freq: number, at: number, dur: number, type: OscillatorType = 'sine', vol = 0.12) {
  const c = ac(); if (!c) return;
  const o = c.createOscillator(), g = c.createGain(), t = c.currentTime + at;
  o.type = type; o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t); o.stop(t + dur + 0.02);
}

export const sfx = {
  get enabled() { return on; },
  set(v: boolean) { on = v; try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* */ } if (v) this.tick(); },
  /** Барабан встал. */
  tick() { tone(1400, 0, 0.04, 'square', 0.03); },
  /** Нажатие «Крутить». */
  spin() { tone(320, 0, 0.08, 'triangle', 0.08); tone(480, 0.05, 0.08, 'triangle', 0.06); },
  /** Деньги: продажа, касса, награда. */
  coin() { tone(1046, 0, 0.09, 'triangle', 0.09); tone(1568, 0.07, 0.16, 'triangle', 0.08); },
  /** Выигрыш по редкости: чем выше, тем длиннее мелодия. */
  win(tier: string) {
    const n = { nice: 2, rare: 3, epic: 5, legend: 7 }[tier] ?? 0;
    const notes = [523, 659, 784, 1046, 1318, 1568, 2093];
    for (let i = 0; i < n; i++) tone(notes[i], i * 0.09, 0.22, 'triangle', 0.1);
  },
};
