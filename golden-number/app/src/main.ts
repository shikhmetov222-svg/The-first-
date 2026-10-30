import './styles.css';
import {
  BAILOUT_RUB, COUNTRIES, FREE_SPIN_MAX, KASSA_CAP_HOURS, LUCKY_EVERY, LUCKY_LUCK, HAPPY_LUCK, HAPPY_SPINS, SLOTS_MAX, SLOTS_START,
  STAKES, STAKE_LEVEL, countryById, slotPriceRub, type Country,
} from '../../supabase/functions/_shared/game/config.ts';
import {
  dailyNow, freeNow, happyNow, incomePerHourKop, kassaTotalKop, sellBackKop, spinCostKop, tierRank, xpToNext,
} from '../../supabase/functions/_shared/game/logic.ts';
import { serverApi } from './api.ts';
import { esc, fmt, fmtMul, local, rub, tierById, tierVar } from './format.ts';
import { Card } from './reels.ts';
import { shareSim } from './share.ts';
import { backButton, haptic, initData, setupTelegram } from './tg.ts';
import type { Api, Sim, State } from './types.ts';

const $ = (id: string) => document.getElementById(id)!;
const PREFS_KEY = 'zn-prefs';
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const icon = (id: string) => `<svg aria-hidden="true"><use href="#${id}"/></svg>`;

// ---------- состояние ----------
// S — последнее состояние с сервера. Клиент его только показывает; производные значения
// (бесплатные сейчас, счастливый час, бонус) считает теми же формулами, что и сервер.
let api: Api = serverApi;
let S: State;
let receivedAt = Date.now();
let skew = 0; // часы сервера − часы телефона
let country: Country = COUNTRIES[0];
let stake: number = STAKES[0];
let spinning = false;
let busy = false;
let view: 'play' | 'coll' | 'rating' = 'play';
let collCache: Sim[] = [];
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
  skew = new Date(st.server_now).getTime() - receivedAt;
}

const now = () => new Date(Date.now() + skew);
const kassaNow = () => kassaTotalKop(S.kassa_acc, S.collection_value, (Date.now() - receivedAt) / 3.6e6);
const slotsCap = () => SLOTS_START + S.extra_slots;
const freeInfo = () => freeNow(S.free_charges, new Date(S.free_at), now());
const happyInfo = () => happyNow(S.happy_key, S.happy_used, now());
const dailyInfo = () => dailyNow(S.daily_day, S.daily_streak, now());
const nextIsLucky = () => (S.total_spins + 1) % LUCKY_EVERY === 0;
const useFree = () => freeInfo().charges > 0;
const cost = () => (useFree() ? 0 : spinCostKop(country, stake));
/** Время по Москве «13:00» — счастливые часы общие для всех игроков. */
const mskHm = (d: Date) => { const m = new Date(d.getTime() + 3 * 3600e3); return `${String(m.getUTCHours()).padStart(2, '0')}:${String(m.getUTCMinutes()).padStart(2, '0')}`; };
/** Сколько осталось: «3:57» (часы:минуты). */
const left = (d: Date) => { const m = Math.max(0, Math.ceil((d.getTime() - now().getTime()) / 60e3)); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };

// ---------- плавный баланс ----------
let shownBalance = 0, balAnim = 0;
function showBalance(target: number) {
  cancelAnimationFrame(balAnim);
  const el = $('bal'), from = shownBalance;
  if (reduced || from === target) { shownBalance = target; el.textContent = rub(target); return; }
  const t0 = performance.now(), dur = 450;
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    shownBalance = Math.round(from + (target - from) * e);
    el.textContent = rub(shownBalance);
    if (k < 1) balAnim = requestAnimationFrame(step);
  };
  balAnim = requestAnimationFrame(step);
}

// ---------- отрисовка ----------
function renderHud(balance = S.balance) {
  $('lvl').textContent = String(S.level);
  const k = Math.min(1, S.xp / xpToNext(S.level));
  ($('xpring') as unknown as SVGCircleElement).style.strokeDashoffset = String(106.8 * (1 - k));
  $('slots').textContent = `${S.collection_count}/${slotsCap()}`;
  showBalance(balance);
}

function renderKassa() {
  const rate = incomePerHourKop(S.collection_value), acc = kassaNow();
  $('rate').textContent = fmt(rate / 100);
  $('acc').textContent = rub(acc);
  ($('kassa-fill') as HTMLElement).style.width = rate > 0 ? Math.min(100, (acc / (rate * KASSA_CAP_HOURS)) * 100) + '%' : '0%';
  ($('collect') as HTMLButtonElement).disabled = acc < 100 || busy;
}

function renderDaily() {
  const d = dailyInfo();
  $('daily').classList.toggle('hidden', !d.available);
  if (d.available) $('daily-sub').textContent = `День ${d.streak + 1} подряд · ${rub(d.amountKop)}`;
}

function renderChips() {
  $('countries').innerHTML = COUNTRIES.map((c) => {
    const lock = S.level < c.lvl;
    return `<button class="chip ${c.id === country.id ? 'on' : ''} ${lock ? 'lock' : ''}" data-c="${c.id}"><span class="f">${c.flag}</span>${c.name}<small>${lock ? icon('i-lock') + 'ур. ' + c.lvl : '×' + c.mul}</small></button>`;
  }).join('');
  $('stakes').innerHTML = STAKES.map((s) => {
    const lock = S.level < STAKE_LEVEL[s];
    return `<button class="chip ${s === stake ? 'on' : ''} ${lock ? 'lock' : ''}" data-s="${s}">×${s}${lock ? `<small>${icon('i-lock')}${STAKE_LEVEL[s]}</small>` : ''}</button>`;
  }).join('');
}

function renderLuck() {
  const h = happyInfo(), until = LUCKY_EVERY - (S.total_spins % LUCKY_EVERY);
  const happy = h.active
    ? `<span class="pill ${h.left ? 'hot' : ''}">${icon('i-sun')}Счастливый час ×${HAPPY_LUCK} · ${h.left} из ${HAPPY_SPINS}</span>`
    : `<span class="pill">${icon('i-sun')}Счастливый час в ${h.next ? mskHm(h.next) : '—'} МСК</span>`;
  const lucky = until === 1
    ? `<span class="pill lucky">${icon('i-star')}Следующая — удача ×${LUCKY_LUCK}</span>`
    : `<span class="pill">${icon('i-star')}До удачи ×${LUCKY_LUCK}: ${until}</span>`;
  const fr = freeInfo();
  const free = fr.charges > 0
    ? `<span class="pill hot">Бесплатных: ${fr.charges}</span>`
    : fr.nextAt ? `<span class="pill">Бесплатная через ${left(fr.nextAt)}</span>` : '';
  $('luck').innerHTML = lucky + happy + free;
}

function renderSpin() {
  const btn = $('spin');
  const free = useFree(), lucky = nextIsLucky();
  btn.classList.toggle('free', free && !spinning);
  btn.classList.toggle('lucky', lucky && !free && !spinning);
  $('spin-l1').textContent = lucky ? `Удача ×${LUCKY_LUCK}` : free ? 'Крутить бесплатно' : 'Крутить';
  $('spin-l1').classList.toggle('on', !spinning);
  $('spin-l2').classList.toggle('on', spinning);
  $('cost').textContent = free ? `${freeInfo().charges} из ${FREE_SPIN_MAX}` : rub(spinCostKop(country, stake));
}

function renderResult(enter = false) {
  const el = $('result');
  const p = S.pending;
  if (!p) {
    el.innerHTML = `<div class="hint">${spinning ? 'Крутим… нажми ещё раз, чтобы пропустить' : 'Жми «Крутить», чтобы получить SIM-карту'}</div>`;
    return;
  }
  const c = countryById(p.country)!;
  const full = S.collection_count >= slotsCap();
  const extra = [
    p.luck > 1 ? `<span class="tag luck-tag">Удача ×${p.luck}</span>` : '',
    p.is_free ? '<span class="tag">Бесплатная прокрутка</span>' : '',
  ].join('');
  el.innerHTML = `
    <div class="res ${enter ? 'enter' : ''}" style="--tc:${tierVar(p.tier)}">
      <div class="res-top">
        <span class="tier">${tierById(p.tier).name} · ×${fmtMul(p.mul)}</span>
        <button class="icon-btn" id="b-share" aria-label="Поделиться картинкой">${icon('i-share')}</button>
      </div>
      <div class="tags">${p.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('') || '<span class="tag">Ничего особенного</span>'}${extra}</div>
      <div class="val"><b>${local(c, p.value)}</b>${c.cur !== '₽' ? `<span>≈ ${rub(p.value)}</span>` : ''}</div>
      <div class="acts">
        <button class="btn btn-secondary btn-l btn-stack" id="b-sell">Продать<span class="sub">+${rub(p.value)}</span></button>
        <button class="btn btn-primary btn-l btn-stack" id="b-keep">В коллекцию<span class="sub">${full ? `витрина ${S.collection_count}/${slotsCap()}` : `+${rub(incomePerHourKop(p.value))}/ч`}</span></button>
      </div>
    </div>`;
  $('b-sell').onclick = (e) => act(e, async () => {
    const r = await api.sell(); setState(r.state); card.clearGlow(); toast('Продано: +' + rub(r.sold));
  });
  $('b-keep').onclick = (e) => act(e, async () => { await keepPending(); });
  $('b-share').onclick = () => shareSim(c, p);
}

async function renderColl() {
  const el = $('coll'), head = $('coll-head');
  const price = slotPriceRub(S.extra_slots) * 100, max = slotsCap() >= SLOTS_MAX;
  head.innerHTML = `<div class="m"><span>Витрина ${S.collection_count}/${slotsCap()} · касса копится ${KASSA_CAP_HOURS} ч</span><b>+${rub(incomePerHourKop(S.collection_value))}/ч</b></div>
    <button class="btn btn-secondary btn-m btn-stack" id="buy-slot" ${max || S.balance < price ? 'disabled' : ''}>${max ? 'Максимум' : 'Ещё место'}${max ? '' : `<span class="sub">${rub(price)}</span>`}</button>`;
  $('buy-slot').onclick = (e) => act(e, async () => {
    const r = await api.buySlot(); setState(r.state); haptic.success(); toast(`Витрина: ${slotsCap()} мест`); renderColl();
  });
  if (!collCache.length) el.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
  try {
    const list = await api.collection();
    if (view !== 'coll') return;
    collCache = list;
    if (!list.length) { el.innerHTML = '<div class="empty">Пока пусто. Оставляй красивые номера — они приносят доход в кассу.</div>'; return; }
    el.innerHTML = list.map((x) => {
      const c = countryById(x.country)!, tier = tierById(x.tier);
      return `<div class="row" style="--tc:${tierVar(x.tier)}">
        <div class="m"><div class="n">${esc(x.label)}</div>
          <div class="s"><span class="dot"></span>${tier.name} · ${c.flag} ${esc(x.operator)} · ${local(c, x.value)}</div></div>
        <div class="btns"><button class="icon-btn" data-share="${x.id}" aria-label="Поделиться картинкой">${icon('i-share')}</button>
        <button class="btn btn-secondary btn-m" data-sell="${x.id}">Продать</button></div></div>`;
    }).join('');
  } catch (e) {
    el.innerHTML = `<div class="empty">${esc((e as Error).message)}</div>`;
  }
}

const plural = (n: number, a: string, b: string, c: string) => {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? b : c;
};

async function renderRating() {
  const el = $('rating'), me = $('me-rank');
  el.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>'; me.innerHTML = 'Загрузка…';
  try {
    const lb = await api.leaderboard();
    if (view !== 'rating') return;
    me.innerHTML = lb.me
      ? `Твоё место: <b>${lb.me.place}</b> · коллекция <b>${rub(lb.me.value)}</b>`
      : 'Положи номер в коллекцию, чтобы попасть в рейтинг';
    el.innerHTML = lb.top.length
      ? lb.top.map((r) => `<div class="row ${r.me ? 'me' : ''}">
          <span class="place ${r.place <= 3 ? 'p' + r.place : ''}">${r.place}</span>
          <span class="avatar">${esc((r.name || 'И').slice(0, 1).toUpperCase())}</span>
          <div class="m"><div class="n" style="font-family:var(--font)">${esc(r.name || 'Игрок')}</div><div class="s">${r.count} ${plural(r.count, 'номер', 'номера', 'номеров')} · ${rub(r.value)}</div></div></div>`).join('')
      : '<div class="empty">Рейтинг пока пуст — стань первым!</div>';
  } catch (e) {
    el.innerHTML = `<div class="empty">${esc((e as Error).message)}</div>`;
  }
}

function renderAll(enterResult = false) {
  renderHud(); renderKassa(); renderDaily(); renderChips(); renderLuck(); renderSpin(); renderResult(enterResult);
}

// ---------- лист-подтверждение ----------
interface SheetBtn { id: string; label: string; kind: 'primary' | 'secondary' | 'ghost'; sub?: string; disabled?: boolean }
function ask(title: string, text: string, buttons: SheetBtn[]): Promise<string | null> {
  const sheet = $('sheet');
  $('sheet-in').innerHTML = `<h3>${esc(title)}</h3><p>${esc(text)}</p><div class="sheet-btns">${buttons.map((b) =>
    `<button class="btn btn-${b.kind} btn-l ${b.sub ? 'btn-stack' : ''}" data-id="${b.id}" ${b.disabled ? 'disabled' : ''}>${esc(b.label)}${b.sub ? `<span class="sub">${esc(b.sub)}</span>` : ''}</button>`).join('')}</div>`;
  sheet.classList.remove('hidden');
  haptic.medium();
  return new Promise((res) => {
    sheet.onclick = (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
      if (!b && e.target !== sheet) return;
      sheet.classList.add('hidden');
      sheet.onclick = null;
      res(b && b.dataset.id !== 'cancel' ? b.dataset.id! : null);
    };
  });
}

// ---------- действия ----------
async function act(e: Event | null, fn: () => Promise<void>) {
  if (busy || spinning) return;
  const btn = (e?.currentTarget ?? null) as HTMLElement | null;
  busy = true;
  btn?.classList.add('loading');
  try { await fn(); } catch (err) { haptic.error(); toast((err as Error).message); }
  btn?.classList.remove('loading');
  busy = false;
  renderAll();
}

/** Оставить текущий номер; если витрина полна — предложить купить место или заменить самый дешёвый. */
async function keepPending(): Promise<boolean> {
  if (S.collection_count < slotsCap()) {
    const r = await api.keep(); setState(r.state); card.clearGlow(); haptic.success(); toast('Номер в коллекции');
    return true;
  }
  const list = await api.collection();
  const cheapest = list[list.length - 1];
  const price = slotPriceRub(S.extra_slots) * 100, canGrow = slotsCap() < SLOTS_MAX;
  const a = await ask(`Витрина заполнена · ${S.collection_count}/${slotsCap()}`,
    'Купи ещё место или замени самый дешёвый номер — он продастся за 70% цены.', [
      ...(canGrow ? [{ id: 'buy', label: 'Ещё место на витрине', sub: rub(price), kind: 'primary' as const, disabled: S.balance < price }] : []),
      ...(cheapest ? [{ id: 'replace', label: `Заменить ${cheapest.label}`, sub: `продать за ${rub(sellBackKop(cheapest.value))}`, kind: 'secondary' as const }] : []),
      { id: 'cancel', label: 'Отмена', kind: 'ghost' },
    ]);
  if (a === 'buy') {
    const b = await api.buySlot(); setState(b.state);
    const r = await api.keep(); setState(r.state);
  } else if (a === 'replace' && cheapest) {
    const r = await api.keep(cheapest.id); setState(r.state);
    toast(`Заменён, продан за ${rub(r.replaced_sold)}`);
  } else return false;
  card.clearGlow(); haptic.success();
  return true;
}

/** Перед автопродажей редкого и выше — спросить. go: можно продолжать. */
async function confirmPending(action: string): Promise<{ go: boolean; autosellOk: boolean }> {
  const p = S.pending;
  if (!p || tierRank(p.tier) < 2) return { go: true, autosellOk: false };
  const a = await ask(`${tierById(p.tier).name} номер ещё не решён`, `${p.label} · ${rub(p.value)}. ${action}`, [
    { id: 'keep', label: 'Сначала в коллекцию', kind: 'primary' },
    { id: 'sell', label: `Продать за ${rub(p.value)}`, kind: 'secondary' },
    { id: 'cancel', label: 'Отмена', kind: 'ghost' },
  ]);
  if (a === 'keep') {
    busy = true;
    try { const ok = await keepPending(); busy = false; renderAll(); return { go: ok, autosellOk: false }; }
    catch (e) { busy = false; toast((e as Error).message); renderAll(); return { go: false, autosellOk: false }; }
  }
  return { go: a === 'sell', autosellOk: a === 'sell' };
}

function setSpinning(on: boolean) {
  spinning = on;
  renderSpin();
}

async function spin() {
  if (spinning) { card.skip(); haptic.tick(); return; }
  if (busy) return;
  const conf = await confirmPending('Если крутить дальше, он продастся.');
  if (!conf.go) return;
  const c = country, free = useFree(), auto = S.pending?.value ?? 0, price = cost();
  if (S.balance + auto < price) { noMoney(); return; }

  setSpinning(true);
  card.startWaiting(c);
  renderHud(S.balance + auto - price);
  renderResult();

  let r;
  try {
    r = await api.spin(c.id, stake, { free, autosellOk: conf.autosellOk });
  } catch (e) {
    setSpinning(false);
    card.stopWaiting(c);
    haptic.error(); toast((e as Error).message);
    renderAll();
    return;
  }
  if (r.auto_sold) toast('Прошлый номер продан: +' + rub(r.auto_sold));
  const prevLevel = S.level;
  // Баланс показываем сразу, остальное (опыт, номер) — после остановки, чтобы не выдать результат.
  renderHud(r.state.balance);

  const sim = r.sim;
  const run = card.run(c, sim.prefix, sim.sub, sim.operator, sim.mul >= 40);
  if (reduced) card.skip();
  await run;

  setState(r.state);
  setSpinning(false);
  if (sim.mul >= 1.5) {
    card.glow(sim.tier);
    if (sim.mul >= 6 && !reduced) card.burst(sim.tier, sim.mul >= 40 ? 40 : 18);
    if (sim.mul >= 40) { haptic.success(); setTimeout(haptic.heavy, 120); setTimeout(haptic.heavy, 260); }
    else haptic.medium();
  }
  if (S.level > prevLevel) {
    const un = [
      ...COUNTRIES.filter((x) => x.lvl > prevLevel && x.lvl <= S.level).map((x) => x.flag + ' ' + x.name),
      ...STAKES.filter((s) => STAKE_LEVEL[s] > prevLevel && STAKE_LEVEL[s] <= S.level).map((s) => 'ставка ×' + s),
    ];
    setTimeout(() => toast(`Уровень ${S.level}!` + (un.length ? ' Открыто: ' + un.join(', ') : '')), r.auto_sold ? 2300 : 0);
  }
  renderAll(true);
  // кнопки результата не должны прятаться под нижней панелью
  if (view === 'play') {
    const res = $('result').getBoundingClientRect(), dockTop = document.querySelector('.dock')!.getBoundingClientRect().top;
    if (res.bottom > dockTop - 8) window.scrollBy({ top: res.bottom - dockTop + 16, behavior: reduced ? 'auto' : 'smooth' });
  }
}

function noMoney() {
  haptic.error();
  if (country.mul > 1 && S.balance >= spinCostKop(COUNTRIES[0], 1)) {
    toast('Не хватает денег — в России прокрутка дешевле', 'В Россию', () => switchCountry(COUNTRIES[0]));
    return;
  }
  if (stake > 1 && S.balance >= spinCostKop(country, 1)) {
    toast('Не хватает денег — уменьши ставку', '×1', () => { stake = 1; savePrefs(); renderAll(); });
    return;
  }
  if (S.collection_count > 0 || kassaNow() >= 100) {
    toast('Не хватает денег — забери кассу или продай номер из коллекции');
    return;
  }
  toast('Не хватает денег', `Получить ${fmt(BAILOUT_RUB)} ₽`, () => act(null, async () => {
    const r = await api.bailout(); setState(r.state); toast('+' + rub(r.granted));
  }));
}

async function switchCountry(c: Country) {
  if (c === country) return;
  if (S.level < c.lvl) { toast(`${c.flag} ${c.name} откроется на уровне ${c.lvl}`); return; }
  if (S.pending) {
    const conf = await confirmPending('При смене страны он продастся.');
    if (!conf.go) return;
    if (S.pending) {
      await act(null, async () => { const r = await api.sell(); setState(r.state); toast('Прошлый номер продан: +' + rub(r.sold)); });
      if (S.pending) return;
    }
  }
  haptic.select();
  country = c; savePrefs(); card.sample(c); renderAll();
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
  t.innerHTML = `<span>${esc(msg)}</span>` + (btn ? `<button class="btn btn-primary">${esc(btn)}</button>` : '');
  if (btn && fn) t.querySelector('button')!.onclick = () => { t.classList.remove('show'); fn(); };
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = window.setTimeout(() => t.classList.remove('show'), btn ? 5000 : 2400);
}

// ---------- события ----------
function bind() {
  $('spin').onclick = spin;
  $('collect').onclick = (e) => act(e, async () => {
    const r = await api.collect(); setState(r.state); haptic.success(); toast('Касса: +' + rub(r.collected));
  });
  $('daily-btn').onclick = (e) => act(e, async () => {
    const r = await api.daily(); setState(r.state); haptic.success(); toast(`Бонус: +${rub(r.amount)}`);
  });
  $('countries').onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-c]');
    if (!b || spinning || busy) return;
    switchCountry(countryById(b.dataset.c!)!);
  };
  $('stakes').onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-s]');
    if (!b || spinning) return;
    const s = Number(b.dataset.s);
    if (S.level < STAKE_LEVEL[s]) { toast(`Ставка ×${s} откроется на уровне ${STAKE_LEVEL[s]}`); return; }
    stake = s; haptic.select(); savePrefs(); renderChips(); renderSpin();
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
    const x = collCache.find((s) => s.id === b.dataset.sell);
    if (!x) return;
    const a = await ask('Продать номер?', `${x.label} стоит ${rub(x.value)}. Из коллекции номер продаётся за 70% цены.`, [
      { id: 'sell', label: `Продать за ${rub(sellBackKop(x.value))}`, kind: 'primary' },
      { id: 'cancel', label: 'Оставить', kind: 'ghost' },
    ]);
    if (a !== 'sell') return;
    await act(null, async () => {
      const r = await api.sellNumber(x.id); setState(r.state); toast('Продано: +' + rub(r.sold));
    });
    renderColl();
  };
  $('nav').onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b) return;
    haptic.select();
    if (b.dataset.soon) { toast(b.dataset.soon); return; }
    show(b.dataset.v as typeof view);
  };
  $('share-close').onclick = () => $('share-sheet').classList.add('hidden');
  // лёгкая вибрация на любое нажатие кнопки
  document.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('.btn:not(:disabled), .icon-btn')) haptic.tick();
  });
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
  if (S.level < STAKE_LEVEL[stake]) stake = 1;
  shownBalance = S.balance;
  const p = S.pending;
  if (p && countryById(p.country)) {
    country = countryById(p.country)!;
    card.build(country, p.prefix, p.sub);
    $('opname').textContent = p.operator;
    if (p.mul >= 1.5) card.glow(p.tier);
  } else card.sample(country);
  bind();
  renderAll();
  setInterval(() => { if (!spinning) { renderKassa(); renderLuck(); renderDaily(); renderSpin(); } }, 1000);
  $('splash').classList.add('gone');
}

start();
