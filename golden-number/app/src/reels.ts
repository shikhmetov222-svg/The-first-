// SIM-карта и барабаны цифр. Тайминги и кривые — как в prototype.html.
// Сначала крутится код оператора, потом номер слева направо; у эпических и легендарных
// последний барабан тормозит дольше и карточка трясётся. Повторное нажатие — «Пропустить».
import type { Country } from '../../supabase/functions/_shared/game/config.ts';
import { haptic } from './tg.ts';

const SKIP_DELAY = 180, SKIP_SNAP = 260;
const $ = (id: string) => document.getElementById(id)!;
const rnd = (n: number) => Math.floor(Math.random() * n);
const dg = () => String(rnd(10));

interface Reel {
  r: HTMLSpanElement;
  st: HTMLSpanElement;
  v: string;
  final?: string;
}

function layout(c: Country, plen: number): string[] {
  // 'P' — цифра кода, 'S' — цифра номера, остальное — разделители
  const t = ['(']; for (let i = 0; i < plen; i++) t.push('P'); t.push(')', ' ');
  for (let i = 0; i < 3; i++) t.push('S');
  c.grp.forEach((g) => { if (typeof g === 'string') t.push(g); else for (let i = 0; i < g; i++) t.push('S'); });
  return t;
}

export class Card {
  private reelsP: Reel[] = [];
  private reelsS: Reel[] = [];
  private timers: number[] = [];
  private country: Country | null = null;
  private plen = 0;
  private ctx: { opName: string; done: () => void; skipping: boolean } | null = null;
  private skipQueued = false;
  readonly el = $('card');

  /** Нарисовать карточку без анимации. */
  build(c: Country, prefix: string, sub: string) {
    this.country = c; this.plen = prefix.length;
    $('cflag').textContent = c.flag; $('ccode').textContent = c.code;
    const num = $('num'); num.innerHTML = ''; this.reelsP = []; this.reelsS = [];
    let pi = 0, si = 0;
    for (const tok of layout(c, prefix.length)) {
      if (tok === 'P' || tok === 'S') {
        const r = document.createElement('span'); r.className = 'reel done';
        const st = document.createElement('span'); st.className = 'strip';
        const v = tok === 'P' ? prefix[pi++] : sub[si++];
        st.innerHTML = `<span>${v}</span>`; r.appendChild(st); num.appendChild(r);
        (tok === 'P' ? this.reelsP : this.reelsS).push({ r, st, v });
      } else {
        const sp = document.createElement('span'); sp.className = 'sep'; sp.textContent = tok; num.appendChild(sp);
      }
    }
  }

  /** Пустая карточка страны: код и номер из нулей. */
  sample(c: Country) {
    this.build(c, c.ops[0].prefixes[0].code.replace(/./g, '0'), '0000000');
    $('opname').textContent = '—';
    this.clearGlow();
  }

  /** Барабаны крутятся, пока сервер не прислал результат. */
  startWaiting(c: Country) {
    if (this.country !== c) this.sample(c);
    this.skipQueued = false;
    this.clearGlow();
    $('opname').textContent = '…';
    for (const o of [...this.reelsP, ...this.reelsS]) {
      o.r.classList.remove('done');
      o.st.style.transition = 'none';
      o.st.style.transform = 'translateY(0)';
      o.st.innerHTML = Array.from({ length: 12 }, dg).map((d) => `<span>${d}</span>`).join('');
      o.st.style.animation = `wait-roll ${260 + rnd(120)}ms linear infinite`;
    }
  }

  /** Сервер не ответил — вернуть карточку в покой. */
  stopWaiting(c: Country) {
    for (const o of [...this.reelsP, ...this.reelsS]) o.st.style.animation = '';
    this.sample(c);
  }

  /** Докрутить до результата сервера. Промис завершается, когда барабаны остановились. */
  run(c: Country, prefix: string, sub: string, opName: string, big: boolean): Promise<void> {
    if (this.country !== c || this.plen !== prefix.length) {
      this.build(c, prefix.replace(/./g, '0'), '0000000');
      for (const o of [...this.reelsP, ...this.reelsS]) o.v = dg();
    }
    this.timers = [];
    return new Promise((resolve) => {
      this.ctx = { opName, skipping: false, done: resolve };
      let end = 0;
      this.reelsP.forEach((o, i) => (end = Math.max(end, this.spinReel(o, prefix[i], 0, 650 + i * 120))));
      this.later(() => ($('opname').textContent = opName), end);
      this.reelsS.forEach((o, i) => {
        let dur = 1000 + i * 210;
        if (big && i === this.reelsS.length - 1) dur += 900;
        end = Math.max(end, this.spinReel(o, sub[i], 250, dur));
      });
      if (big) this.later(() => { this.el.classList.add('shake'); haptic.medium(); }, 250 + 1000 + 5 * 210);
      this.later(() => this.finish(), end + 60);
      if (this.skipQueued) this.skip();
    });
  }

  /** «Пропустить»: через ~180 мс все барабаны за ~260 мс встают на итоговые цифры. */
  skip() {
    const k = this.ctx;
    if (!k) { this.skipQueued = true; return; } // ответ сервера ещё не пришёл
    if (k.skipping) return;
    k.skipping = true;
    this.timers.forEach(clearTimeout); this.timers = [];
    setTimeout(() => {
      this.el.classList.remove('shake');
      $('opname').textContent = k.opName;
      for (const o of [...this.reelsP, ...this.reelsS]) {
        if (o.r.classList.contains('done')) continue;
        const cur = getComputedStyle(o.st).transform;
        o.st.style.transition = 'none'; o.st.style.transform = cur === 'none' ? 'translateY(0)' : cur;
        void o.st.offsetHeight;
        o.st.style.transition = `transform ${SKIP_SNAP}ms cubic-bezier(.2,.9,.3,1)`;
        o.st.style.transform = o.final!;
      }
      haptic.tick();
      setTimeout(() => { [...this.reelsP, ...this.reelsS].forEach((o) => this.finishReel(o)); this.finish(); }, SKIP_SNAP + 20);
    }, SKIP_DELAY);
  }

  glow(tier: string) {
    this.el.style.setProperty('--tc', `var(--t-${tier})`);
    this.el.classList.add('glow');
  }

  clearGlow() { this.el.classList.remove('glow'); }

  burst(tier: string, n: number) {
    const p = $('particles'); p.style.setProperty('--tc', `var(--t-${tier})`); p.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, d = 90 + Math.random() * 140, e = document.createElement('i');
      e.style.setProperty('--dx', Math.cos(a) * d + 'px'); e.style.setProperty('--dy', Math.sin(a) * d + 'px');
      e.style.animationDelay = Math.random() * 120 + 'ms'; p.appendChild(e);
    }
    setTimeout(() => (p.innerHTML = ''), 1400);
  }

  private finish() {
    const k = this.ctx; if (!k) return;
    this.ctx = null; this.skipQueued = false;
    this.el.classList.remove('shake');
    k.done();
  }

  private later(fn: () => void, ms: number) { this.timers.push(window.setTimeout(fn, ms)); }

  private finishReel(o: Reel) {
    o.st.style.animation = '';
    o.st.style.transition = 'none'; o.st.style.transform = 'translateY(0)';
    o.st.innerHTML = `<span>${o.v}</span>`; o.r.classList.add('done');
  }

  private spinReel(o: Reel, target: string, delay: number, dur: number) {
    const n = 16 + rnd(6);
    const digits = [o.v]; for (let i = 0; i < n - 1; i++) digits.push(dg()); digits.push(target);
    o.r.classList.remove('done', 'hit');
    o.st.style.animation = '';
    o.st.style.transition = 'none'; o.st.style.transform = 'translateY(0)';
    o.st.innerHTML = digits.map((d) => `<span>${d}</span>`).join('');
    void o.st.offsetHeight; // reflow
    o.final = `translateY(calc(var(--h) * -${n}))`;
    o.st.style.transition = `transform ${dur}ms cubic-bezier(.12,.8,.22,1.04) ${delay}ms`;
    o.st.style.transform = o.final;
    o.v = target;
    this.later(() => { this.finishReel(o); haptic.tick(); }, delay + dur + 20);
    return delay + dur;
  }
}
