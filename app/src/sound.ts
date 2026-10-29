// Звуки игры: короткие мягкие сигналы, синтезируются Web Audio прямо на устройстве — без файлов и загрузки.
// Включаются и выключаются в профиле (хранится на устройстве). Звук начинается только после первого касания:
// так требуют браузеры, а в Telegram на iPhone без этого он не заиграет вовсе.

export type Sound = 'coin' | 'buy' | 'success' | 'bad' | 'error' | 'fanfare' | 'tap';

const KEY = 'capital.sound';
const VOLUME = 0.16;

let enabled = read();
let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function soundEnabled() {
  return enabled;
}

export function setSoundEnabled(on: boolean) {
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // хранилище недоступно — настройка живёт до закрытия игры
  }
  if (on) play('tap');
}

function audio(): AudioContext | null {
  if (ctx) return ctx;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = VOLUME;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
  }
  return ctx;
}

// Первое касание «будит» звук.
if (typeof window !== 'undefined') {
  const unlock = () => {
    const c = audio();
    if (c && c.state === 'suspended') c.resume().catch(() => {});
  };
  window.addEventListener('pointerdown', unlock, { passive: true });
}

/** Одна нота: частота (Гц), начало и длина (с), форма, громкость, скольжение частоты к концу. */
function note(c: AudioContext, f: number, at: number, len: number, type: OscillatorType = 'triangle', vol = 1, slide = 0) {
  const o = c.createOscillator();
  const g = c.createGain();
  const t = c.currentTime + at;
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(f * slide, t + len);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(g).connect(master!);
  o.start(t);
  o.stop(t + len + 0.02);
}

export function play(s: Sound) {
  if (!enabled || document.visibilityState !== 'visible') return;
  const c = audio();
  if (!c || !master) return;
  if (c.state === 'suspended') c.resume().catch(() => {});
  switch (s) {
    case 'coin': // звон монет: две быстрые высокие ноты
      note(c, 988, 0, 0.09, 'square', 0.35);
      note(c, 1319, 0.07, 0.28, 'triangle', 0.9);
      note(c, 2637, 0.07, 0.18, 'sine', 0.25);
      break;
    case 'buy': // мягкий «щелчок» покупки
      note(c, 520, 0, 0.12, 'triangle', 0.9, 1.6);
      note(c, 1040, 0.05, 0.1, 'sine', 0.3);
      break;
    case 'success': // короткое восходящее «до-ми-соль»
      note(c, 523, 0, 0.12, 'triangle', 0.7);
      note(c, 659, 0.08, 0.12, 'triangle', 0.7);
      note(c, 784, 0.16, 0.26, 'triangle', 0.8);
      break;
    case 'bad': // нисходящие две ноты
      note(c, 440, 0, 0.16, 'triangle', 0.7);
      note(c, 330, 0.13, 0.3, 'triangle', 0.7);
      break;
    case 'error': // негромкий низкий сигнал
      note(c, 196, 0, 0.18, 'square', 0.25, 0.85);
      break;
    case 'fanfare': // стройка закончилась
      [523, 659, 784].forEach((f, i) => note(c, f, i * 0.09, 0.14, 'square', 0.3));
      note(c, 1047, 0.27, 0.5, 'triangle', 0.9);
      note(c, 1568, 0.27, 0.4, 'sine', 0.25);
      break;
    case 'tap':
      note(c, 880, 0, 0.05, 'sine', 0.4);
      break;
  }
}
