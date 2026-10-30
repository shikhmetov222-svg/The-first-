import './styles.css';
import { BAILOUT_RUB, COUNTRIES, STAKES, countryById, type Country } from '../../supabase/functions/_shared/game/config.ts';
import { incomePerHourKop, kassaTotalKop, spinCostKop, xpToNext } from '../../supabase/functions/_shared/game/logic.ts';
import { serverApi } from './api.ts';
import { esc, fmt, fmtMul, local, rub, tierById, tierVar } from './format.ts';
import { Card } from './reels.ts';
import { shareSim } from './share.ts';
import { backButton, confirmDialog, haptic, initData, setupTelegram } from './tg.ts';
import type { Api, Sim, State } from './types.ts';

const $ = (id: string) => document.getElementById(id)!;
const PREFS_KEY = 'zn-prefs';

// ---------- состояние ----------
// S — последнее состояние с сервера. Клиент его только показывает.
let api: Api = serverApi;
let S: State;
let receivedAt = Date.now();
let country: Country = COUNTRIES[0];
let stake: number = STAKES[0];
let spinning = false;
let busy = false; // идёт запрос «продать/в коллекцию/забрать»
let view: 'play' | 'coll' | 'rating' = 'play';
const card = new Card();

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    if (countryById(p.country)) country = countryById(p.country)!;
    if (STAKES.includes(p.stake)) stake = p.stake;
  } catch { /* нет хранилища — не страшно */ }
}
function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ country: country.id, stake })); } catch { /* */ }
}

function setState(st: State) {
  S = st;
  receivedAt = Date.now();
}

const kassaNow = () => kassaTotalKop(S.kassa_acc, S.collection_value, (Date.now() - receivedAt) / 3.6e6);
const cost = () => spinCostKop(country, stake);

// ---------- отрисовка ----------
function renderTop(balance = S.balance) {
  $('lvl').textContent = String(S.level);
  ($('xpbar') as HTMLElement).style.width = Math.min(100, (S.xp / xpToNext(S.level)) * 100) + '%';
  $('bal').textContent = rub(balance);
  $('ccount').textContent = String(S.collection_count);
  $('rate').textContent = fmt(incomePerHourKop(S.collection_value) / 100);
  const acc = kassaNow();
  $('acc').textContent = rub(acc);
  ($('collect') as HTMLButtonElement).disabled = acc < 100 || busy;
  $('cost').textContent = rub(cost());
}

function renderChips() {
  $('countries').innerHTML = COUNTRIES.map((c) => {
    const lock = S.level < c.lvl;
    return `<button class="chip ${c.id === country.id ? 'on' : ''} ${lock ? 'lock' : ''}" data-c="${c.id}"><span class="f">${c.flag}</span>${c.name} <small>${lock ? '🔒 ур. ' + c.lvl : '×' + c.mul}</small></button>`;
  }).join('');
  $('stakes').innerHTML = STAKES.map((s) => `<button class="chip ${s === stake ? 'on' : ''}" data-s="${s}">×${s}</button>`).join('');
}

function renderResult() {
  const el = $('result');
  const p = S.pending;
  if (!p) { el.innerHTML = '<div class="hint">Жми «Крутить», чтобы получить SIM-карту</div>'; return; }
  const c = countryById(p.country)!;
  el.style.setProperty('--tc', tierVar(p.tier));
  el.innerHTML = `
    <span class="tier">${tierById(p.tier).name} · ×${fmtMul(p.mul)}</span>
    <div class="tags">${p.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('') || '<span class="tag">Ничего особенного</span>'}</div>
    <div class="val"><b>${local(c, p.value)}</b>${c.cur !== '₽' ? `<span>≈ ${rub(p.value)}</span>` : ''}</div>
    <div class="acts">
      <button class="sell" id="b-sell">Продать за ${rub(p.value)}</button>
      <button class="keep" id="b-keep">В коллекцию · +${rub(incomePerHourKop(p.value))}/ч</button>
    </div>
    <div class="acts second"><button class="share" id="b-share">Поделиться картинкой</button></div>`;
  $('b-sell').onclick = () => act(async () => {
    const r = await api.sell(); setState(r.state); card.clearGlow(); toast('Продано: +' + rub(r.sold));
  });
  $('b-keep').onclick = () => act(async () => {
    const r = await api.keep(); setState(r.state); card.clearGlow(); toast('Номер в коллекции 📱');
  });
  $('b-share').onclick = () => shareSim(c, p);
}

async function renderColl() {
  const el = $('coll');
  el.innerHTML = '<div class="loading">Загрузка…</div>';
  try {
    const list = await api.collection();
    if (view !== 'coll') return;
    if (!list.length) { el.innerHTML = '<div class="empty">Пока пусто. Оставляй красивые номера — они приносят доход в кассу.</div>'; return; }
    el.innerHTML = list.map((x) => {
      const c = countryById(x.country)!, tier = tierById(x.tier);
      return `<div class="ci" style="--tc:${tierVar(x.tier)}"><span class="f">${c.flag}</span>
        <div class="m"><div class="n">${esc(x.label)}</div><div class="s">${esc(x.operator)} · ${tier.name} · ${local(c, x.value)}</div></div>
        <div class="btns"><button class="ico" data-share="${x.id}" aria-label="Поделиться картинкой"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 8l5-5 5 5M5 14v6h14v-6"/></svg></button>
        <button data-sell="${x.id}" data-v="${x.value}">Продать</button></div></div>`;
    }).join('');
    collCache = list;
  } catch (e) {
    el.innerHTML = `<div class="empty">${esc((e as Error).message)}</div>`;
  }
}
let collCache: Sim[] = [];

async function renderRating() {
  const el = $('rating'), me = $('me-rank');
  el.innerHTML = '<div class="loading">Загрузка…</div>'; me.innerHTML = '';
  try {
    const lb = await api.leaderboard();
    if (view !== 'rating') return;
    me.innerHTML = lb.me
      ? `Твоё место: <b>${lb.me.place}</b> · коллекция ${rub(lb.me.value)}`
      : 'Положи номер в коллекцию, чтобы попасть в рейтинг';
    el.innerHTML = lb.top.length
      ? lb.top.map((r) => `<div class="ci ${r.me ? 'me' : ''}" style="--tc:${r.place <= 3 ? 'var(--gold)' : 'var(--line)'}">
          <span class="place ${r.place <= 3 ? 'top' : ''}">${r.place}</span>
          <div class="m"><div class="n">${esc(r.name || 'Игрок')}</div><div class="s">📱 ${r.count} · ${rub(r.value)}</div></div></div>`).join('')
      : '<div class="empty">Рейтинг пока пуст — стань первым!</div>';
  } catch (e) {
    el.innerHTML = `<div class="empty">${esc((e as Error).message)}</div>`;
  }
}

function renderAll() { renderTop(); renderChips(); renderResult(); }

// ---------- действия ----------
async function act(fn: () => Promise<void>) {
  if (busy || spinning) return;
  busy = true;
  try { await fn(); } catch (e) { haptic.error(); toast((e as Error).message); }
  busy = false;
  renderAll();
}

async function spin() {
  if (spinning) { card.skip(); return; }
  if (busy) return;
  const c = country, auto = S.pending?.value ?? 0;
  if (S.balance + auto < cost()) { noMoney(); return; }

  spinning = true;
  card.startWaiting(c);
  renderTop(S.balance + auto - cost());
  $('result').innerHTML = '<div class="hint">Крутим… нажми ещё раз, чтобы пропустить</div>';
  $('spin-t').textContent = 'Пропустить';

  let r;
  try {
    r = await api.spin(c.id, stake);
  } catch (e) {
    spinning = false;
    card.stopWaiting(c);
    $('spin-t').textContent = 'Крутить';
    haptic.error(); toast((e as Error).message);
    renderAll();
    return;
  }
  if (r.auto_sold) toast('Прошлый номер продан: +' + rub(r.auto_sold));
  const prevLevel = S.level;
  // Баланс показываем сразу, остальное (опыт, номер) — после остановки, чтобы не выдать результат.
  renderTop(r.state.balance);

  const sim = r.sim;
  await card.run(c, sim.prefix, sim.sub, sim.operator, sim.mul >= 40);

  spinning = false;
  $('spin-t').textContent = 'Крутить';
  setState(r.state);
  if (sim.mul >= 1.5) {
    card.glow(sim.tier);
    if (sim.mul >= 6) card.burst(sim.tier, sim.mul >= 40 ? 40 : 18);
    if (sim.mul >= 40) { haptic.success(); setTimeout(haptic.heavy, 120); setTimeout(haptic.heavy, 260); }
    else haptic.medium();
  }
  if (S.level > prevLevel) {
    const un = COUNTRIES.filter((x) => x.lvl > prevLevel && x.lvl <= S.level).map((x) => x.flag + ' ' + x.name);
    setTimeout(() => toast(`Уровень ${S.level}!` + (un.length ? ' Открыта страна: ' + un.join(', ') : '')), r.auto_sold ? 2300 : 0);
  }
  renderAll();
  // кнопки «Продать / В коллекцию» не должны прятаться под нижней панелью
  if (view === 'play') window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
}

function noMoney() {
  haptic.error();
  if (S.collection_count > 0 || kassaNow() >= 100) {
    toast('Не хватает денег — забери кассу или продай номер из коллекции');
    return;
  }
  toast('Не хватает денег', `Получить ${fmt(BAILOUT_RUB)} ₽`, () => act(async () => {
    const r = await api.bailout(); setState(r.state); toast('+' + rub(r.granted));
  }));
}

// ---------- навигация ----------
function show(v: typeof view) {
  view = v;
  [...$('nav').children].forEach((x) => x.classList.toggle('on', (x as HTMLElement).dataset.v === v));
  $('v-play').classList.toggle('hidden', v !== 'play');
  $('v-coll').classList.toggle('hidden', v !== 'coll');
  $('v-rating').classList.toggle('hidden', v !== 'rating');
  $('spin').classList.toggle('hidden', v !== 'play');
  backButton(v !== 'play', () => show('play'));
  if (v === 'coll') renderColl();
  if (v === 'rating') renderRating();
  window.scrollTo(0, 0);
}

// ---------- тосты ----------
let toastT: number;
function toast(msg: string, btn?: string, fn?: () => void) {
  const t = $('toast');
  t.innerHTML = `<span>${esc(msg)}</span>` + (btn ? `<button>${esc(btn)}</button>` : '');
  if (btn && fn) t.querySelector('button')!.onclick = () => { fn(); t.classList.remove('show'); };
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = window.setTimeout(() => t.classList.remove('show'), btn ? 5000 : 2200);
}

// ---------- события ----------
function bind() {
  $('spin').onclick = spin;
  $('collect').onclick = () => act(async () => {
    const r = await api.collect(); setState(r.state); haptic.success(); toast('Касса: +' + rub(r.collected));
  });
  $('countries').onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-c]');
    if (!b || spinning || busy) return;
    const c = countryById(b.dataset.c!)!;
    if (S.level < c.lvl) { toast(`${c.flag} ${c.name} откроется на уровне ${c.lvl}`); return; }
    if (c === country) return;
    haptic.select();
    const switchTo = () => { country = c; savePrefs(); card.sample(c); renderAll(); };
    if (S.pending) {
      act(async () => {
        const r = await api.sell(); setState(r.state); toast('Прошлый номер продан: +' + rub(r.sold)); switchTo();
      });
    } else switchTo();
  };
  $('stakes').onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-s]');
    if (!b || spinning) return;
    stake = Number(b.dataset.s); haptic.select(); savePrefs(); renderChips(); renderTop();
  };
  $('coll').onclick = async (e) => {
    const t = e.target as HTMLElement;
    const sh = t.closest<HTMLElement>('[data-share]');
    if (sh) {
      const x = collCache.find((s) => s.id === sh.dataset.share);
      if (x) shareSim(countryById(x.country)!, x);
      return;
    }
    const b = t.closest<HTMLElement>('[data-sell]');
    if (!b || busy) return;
    if (!(await confirmDialog(`Продать номер за ${rub(Number(b.dataset.v))}?`))) return;
    await act(async () => {
      const r = await api.sellNumber(b.dataset.sell!); setState(r.state); toast('Продано: +' + rub(r.sold));
    });
    renderColl();
  };
  $('nav').onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b) return;
    if (b.dataset.soon) { toast(b.dataset.soon); return; }
    haptic.select();
    show(b.dataset.v as typeof view);
  };
  $('share-close').onclick = () => $('share-sheet').classList.add('hidden');
  // ни один номер не выделяется и не копируется
  document.addEventListener('copy', (e) => e.preventDefault());
  document.addEventListener('contextmenu', (e) => {
    if (!(e.target as HTMLElement).closest('#share-img')) e.preventDefault();
  });
}

// ---------- запуск ----------
async function start() {
  setupTelegram('#0c0912');
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('mock')) {
    api = (await import('./mock.ts')).mockApi;
  } else if (!initData()) {
    $('splash-t').textContent = 'Открой игру в Telegram через бота';
    return;
  }
  loadPrefs();
  try {
    setState(await api.login());
  } catch (e) {
    $('splash-t').textContent = (e as Error).message;
    return;
  }
  if (S.level < country.lvl) country = COUNTRIES[0];
  const p = S.pending;
  if (p && countryById(p.country)) {
    country = countryById(p.country)!;
    card.build(country, p.prefix, p.sub);
    $('opname').textContent = p.operator;
    if (p.mul >= 1.5) card.glow(p.tier);
  } else card.sample(country);
  bind();
  renderAll();
  setInterval(() => { if (!spinning) renderTop(); }, 1000);
  $('splash').classList.add('gone');
}

start();
