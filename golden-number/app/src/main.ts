import './styles.css';
import {
  BAILOUT_RUB, COUNTRIES, FREE_SPIN_MAX, KASSA_CAP_HOURS, LUCKY_EVERY, LUCKY_LUCK, HAPPY_LUCK, SLOTS_MAX, SLOTS_START,
  STAKES, STAKE_LEVEL, countryById, slotPriceRub, type Country,
  KEEP_RULE_DEFAULT, type KeepRule, VALUE_BASE, PATTERN_INFO, RARITY, QUEST_ALL_RUB, QUEST_ALL_SPINS, WEEK_PRIZES_RUB, WEEK_PRIZES_SPINS,
  TRADE_MAX_RATIO, TIERS as TIER_LIST, ACHIEVEMENTS, MARKET_FEE, REF_AFTER_SPINS, REF_NEW_SPINS, REF_REWARD_RUB, REF_REWARD_SPINS, TIERS, inviteLink,
} from '../../supabase/functions/_shared/game/config.ts';
import {
  microFactor, valueFactor, ruleMatches, achClaimable, achProgress, dailyNow, freeNow, happyNow, incomePerHourKop, kassaTotalKop, lotPriceBounds, priceBreakdown,
  sellBackKop, spinCostKop, xpToNext, type Stats,
  nextTier, patternKind, questKey, questProgress, questsFor, weekStart, type DayStats,
} from '../../supabase/functions/_shared/game/logic.ts';
import { serverApi } from './api.ts';
import { esc, fmt, local, rub, tierById, tierVar } from './format.ts';
import { Card } from './reels.ts';
import { shareSim } from './share.ts';
import { backButton, copyText, haptic, initData, setupTelegram, shareLink } from './tg.ts';
import type { Api, Lot, Sim, State, Trade } from './types.ts';
import { sfx } from './sound.ts';

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
type View = 'play' | 'coll' | 'market' | 'friends' | 'more' | 'rating' | 'ach' | 'hist' | 'feed' | 'admin';
let view: View = 'play';
let collCache: Sim[] = [];
let stats: Stats | null = null;
let marketMine = false;
let marketTier = 'all';
let marketCache: Lot[] = [];
const card = new Card();
let menuOpen = false;
let isAdmin = false;
let day: DayStats | null = null;
let ratingWeek = true;
let mergeMode = false;
const mergeSel = new Set<string>();
let autoOn = false;
let autoLeft = 0;
const AUTO_SPINS = 5;

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
const bonusSpins = () => S.bonus_spins ?? 0;
const useFree = () => freeInfo().charges > 0 || bonusSpins() > 0;
const cost = () => (useFree() ? 0 : spinCostKop(country, stake));
/** Время по Москве «13:00» — счастливые часы общие для всех игроков. */
const mskHm = (d: Date) => { const m = new Date(d.getTime() + 3 * 3600e3); return `${String(m.getUTCHours()).padStart(2, '0')}:${String(m.getUTCMinutes()).padStart(2, '0')}`; };
/** Конец текущего часа по Москве: «14:00». */
const happyEnd = () => mskHm(new Date(Math.floor(now().getTime() / 3.6e6 + 1) * 3.6e6));
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
  const k = Math.min(1, S.xp / xpToNext(S.level));
  ($('xpring') as unknown as SVGCircleElement).style.strokeDashoffset = String(RING * (1 - k));
  $('slots').textContent = `${S.collection_count}/${slotsCap()}`;
  ($('slots-fill') as HTMLElement).style.width = Math.min(100, (S.collection_count / slotsCap()) * 100) + '%';
  const until = LUCKY_EVERY - (S.total_spins % LUCKY_EVERY);
  $('luck-n').textContent = String(until);
  $('luck-pill').classList.toggle('hot', until === 1);
  $('luck-pill').setAttribute('aria-label', until === 1 ? `Следующая прокрутка — удача ×${LUCKY_LUCK}` : `До удачи ×${LUCKY_LUCK}: ${until}`);
  $('menu-dot').classList.toggle('hidden', !menuHasClaims());
  showBalance(balance);
}
const RING = 2 * Math.PI * 22;

/** Есть что забрать: касса за час и больше, бонус дня, достижения. */
const kassaReady = () => kassaNow() >= 100 && kassaNow() >= incomePerHourKop(S.collection_value);
const menuHasClaims = () => kassaReady() || dailyInfo().available || (stats ? achClaimable(stats).length > 0 : false) || questClaimable() > 0 || (S.trades_in ?? 0) > 0;

interface Banner { id: string; icon: string; title: string; sub: string; cta?: string; hot?: boolean; kind: string }
/** Короткие баннеры над карточкой: не больше двух, остальное — в меню ☰. */
function banners(): Banner[] {
  const out: Banner[] = [];
  const h = happyInfo(), d = dailyInfo(), acc = kassaNow();
  if (h.active) out.push({ id: 'happy', kind: 'happy', icon: 'i-sun', title: `Удача ×${HAPPY_LUCK} идёт`, sub: `до ${happyEnd()} МСК`, hot: true });
  if (d.available) out.push({ id: 'daily', kind: 'daily', icon: 'i-gift', title: 'Бонус дня', sub: rub(d.amountKop), cta: 'Забрать' });
  const qc = questClaimable();
  if (qc > 0) out.push({ id: 'quests', kind: 'quests', icon: 'i-target', title: qc > 1 ? `Задания: ${qc} готово` : 'Задание выполнено', sub: 'награда ждёт', cta: 'Забрать' });
  if ((S.trades_in ?? 0) > 0) out.push({ id: 'trades', kind: 'trades', icon: 'i-swap', title: 'Тебе предлагают обмен', sub: `предложений: ${S.trades_in}`, cta: 'Открыть' });
  if (acc >= 100) out.push({ id: 'kassa', kind: 'kassa', icon: 'i-cash', title: `Касса · ${fmt(incomePerHourKop(S.collection_value) / 100)} ₽/ч`, sub: '+' + rub(acc), cta: 'Забрать' });
  if (!h.active) out.push({ id: 'happy', kind: 'happy-next', icon: 'i-sun', title: 'Счастливый час', sub: h.next ? `в ${mskHm(h.next)} МСК` : '—' });
  return out.slice(0, 2);
}

function renderBanners() {
  const list = banners();
  const el = $('banners');
  el.classList.toggle('two', list.length > 1);
  el.innerHTML = list.map((b) => `<button class="banner ${b.hot ? 'hot' : ''} b-${b.kind}" data-b="${b.id}">
      <span class="banner-ico">${icon(b.icon)}</span>
      <span class="banner-t"><b><span class="bi">${icon(b.icon)}</span>${b.title}</b><span class="num-t">${b.sub}${b.cta ? ` · <u>${b.cta}</u>` : ''}</span></span>
      ${icon('i-right')}</button>`).join('');
}

function renderSelectors() {
  $('sel-country').innerHTML = `<span class="f">${country.flag}</span><span class="sel-t">${country.name}</span>${icon('i-chev')}`;
  $('sel-stake').innerHTML = `<span class="sel-t">Ставка ×${stake}</span>${icon('i-chev')}`;
  $('auto').classList.toggle('on', autoOn);
  $('auto').setAttribute('aria-pressed', String(autoOn));
  $('auto').textContent = autoLeft > 0 ? `${autoLeft}×` : '5×';
  $('target').textContent = `Крутишь: ${country.name} · любой оператор${country.mul !== 1 ? ` · ×${country.mul}` : ''}`;
}

function renderSpin() {
  const btn = $('spin');
  const free = useFree(), lucky = nextIsLucky(), fr = freeInfo();
  btn.classList.toggle('free', free && !spinning);
  btn.classList.toggle('lucky', lucky && !free && !spinning);
  btn.classList.toggle('idle', !spinning && !busy);
  const again = !!S.pending || S.total_spins > 0;
  $('spin-l1').textContent = autoLeft > 0 ? `Автоспин · ${autoLeft}` : lucky ? `Удача ×${LUCKY_LUCK}` : free ? 'Бесплатно' : again ? 'Крутить ещё' : 'Крутить';
  $('spin-l1').classList.toggle('on', !spinning);
  $('spin-l2').classList.toggle('on', spinning);
  const price = rub(spinCostKop(country, stake));
  $('cost').innerHTML = free
    ? (fr.charges > 0 ? `${fr.charges} из ${FREE_SPIN_MAX}` : `ещё ${bonusSpins()}`)
    : fr.nextAt ? `${price}<small>Бесплатный через ${left(fr.nextAt)}</small>` : price;
}

/** 9 делений шкалы редкости: чем выше множитель узора, тем больше закрашено. */
const SEG_FROM = [0, 1.5, 3, 6, 12, 40, 100, 250, 500];
const segments = (mul: number) => SEG_FROM.filter((m) => mul >= m).length;

function renderResult(enter = false) {
  const el = $('result');
  const p = spinning ? null : S.pending;
  renderTierbar(p);
  $('card-foot').textContent = card.isSample && !spinning ? 'Пример номера' : 'Игровой номер · не звоните по нему';
  if (!p) {
    el.innerHTML = `<div class="hint">${spinning ? 'Крутим… нажми ещё раз, чтобы пропустить' : 'Жми «Крутить» — выпадет SIM-карта с игровым номером'}</div>`;
    return;
  }
  const c = countryById(p.country)!;
  const full = S.collection_count >= slotsCap();
  const auto = ruleMatches(keepRule(), p);
  el.innerHTML = `
    <div class="res ${enter ? 'enter' : ''}">
      ${whyHtml(p)}
      <div class="acts">
        <button class="btn btn-pill btn-pill-gold" id="b-keep">В коллекцию</button>
        <button class="btn sq-btn" id="b-share" aria-label="Поделиться картинкой">${icon('i-share')}</button>
      </div>
      <button class="acts-note" id="b-rule">${auto
        ? (full ? `Под правило, но витрина заполнена · ${S.collection_count}/${slotsCap()}` : 'Уйдёт в коллекцию сам, если крутить дальше')
        : `Этот номер продастся за ${rub(p.value)}, если крутить дальше`}</button>
    </div>`;
  $('b-keep').onclick = (e) => act(e, async () => { await keepPending(); });
  $('b-share').onclick = () => shareSim(c, p);
  $('b-rule').onclick = () => ruleSheet();
}

/** Плашка редкости над карточкой: тир, 9 делений и цена; до прокрутки — «Готов к игре». */
function renderTierbar(p: Sim | null) {
  const el = $('tierbar');
  const tier = p?.tier ?? 'none', n = p ? segments(p.mul) : 0;
  el.style.setProperty('--tc', p ? tierVar(p.tier) : 'var(--text-2)');
  el.classList.toggle('empty', !p);
  const c = p ? countryById(p.country)! : null;
  el.innerHTML = `<div class="tb-l"><div class="tb-name">${p ? tierById(p.tier).name : spinning ? 'Крутим…' : 'Готов к игре'}</div>
    <div class="tb-steps" aria-label="Редкость ${n} из 9">${SEG_FROM.map((_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</div></div>
    <b class="num-t">${p && c ? local(c, p.value) + (c.cur !== '₽' ? `<small>≈ ${rub(p.value)}</small>` : '') : '—'}</b>`;
  el.dataset.tier = tier;
}

/** «Почему такая цена»: каждая причина — своей строкой, строки появляются по одной. */
function whyHtml(p: Sim): string {
  const fx = (x: number) => x.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
  const parts = priceBreakdown(p.prefix, p.sub).filter((x) => x.mul !== 1);
  const mic = microFactor(p.sub);
  const bet = Math.round(p.value / (valueFactor(p.mul) * mic.mul));
  const lines: { label: string; mul: string; up: boolean }[] = parts.map((x) => ({ label: x.label, mul: '×' + fx(x.mul), up: x.mul > 1 }));
  if (!parts.length) lines.push({ label: 'Без узора', mul: '×' + fx(VALUE_BASE), up: false });
  if (mic.mul !== 1) lines.push({ label: mic.label, mul: '×' + fx(mic.mul), up: mic.mul > 1 });
  const k = p.value / bet;
  lines.push({ label: `Итого от ставки ${rub(bet)}`, mul: '×' + fx(Math.round(k * 100) / 100), up: k >= 1 });
  if (p.luck > 1) lines.push({ label: 'Удача — узоры чаще', mul: '×' + p.luck, up: true });
  if (p.is_free) lines.push({ label: 'Бесплатная прокрутка', mul: '', up: false });
  return `<ul class="why">${lines.map((l, i) => `<li style="--i:${i}"><span>${esc(l.label)}</span>${l.mul ? `<b class="${l.up ? 'up' : 'dim'}">${l.mul}</b>` : ''}</li>`).join('')}</ul>`;
}

async function renderColl() {
  const el = $('coll'), head = $('coll-head');
  const price = slotPriceRub(S.extra_slots) * 100, max = slotsCap() >= SLOTS_MAX;
  head.innerHTML = `<div class="m"><span>Витрина ${S.collection_count}/${slotsCap()} · доход в кассу</span><b>+${rub(incomePerHourKop(S.collection_value))}/ч</b></div>
    <button class="btn btn-secondary btn-m btn-stack" id="buy-slot" ${max || S.balance < price ? 'disabled' : ''}>${max ? 'Максимум' : 'Ещё место'}${max ? '' : `<span class="sub">${rub(price)}</span>`}</button>`;
  head.insertAdjacentHTML('beforeend', `<button class="rule-row" id="coll-rule">Сами уходят в коллекцию: <b>${ruleText(keepRule())}</b> ›</button>
    <button class="rule-row" id="coll-merge">${icon('i-up')} Улучшить: <b>3 номера одной редкости → 1 редкостью выше</b> ›</button>`);
  $('coll-merge').onclick = () => { mergeMode = !mergeMode; mergeSel.clear(); haptic.select(); renderColl(); };
  $('coll-rule').onclick = () => ruleSheet();
  $('buy-slot').onclick = (e) => act(e, async () => {
    const r = await api.buySlot(); setState(r.state); haptic.success(); toast(`Витрина: ${slotsCap()} мест`); renderColl();
  });
  if (!collCache.length) el.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
  try {
    const list = await api.collection();
    if (view !== 'coll') return;
    collCache = list;
    if (!list.length) { el.innerHTML = '<div class="empty">Пока пусто. Оставляй красивые номера — они приносят доход в кассу. Нажми на номер, чтобы продать, выставить на рынок или похвастаться.</div>'; return; }
    el.innerHTML = list.map((x) => {
      const c = countryById(x.country)!, tier = tierById(x.tier);
      const sel = mergeSel.has(x.id), off = mergeMode && !mergeOk(x);
      return `<div class="row tap ${sel ? 'picked' : ''} ${off ? 'off' : ''}" style="--tc:${tierVar(x.tier)}" data-act="${x.id}">
        ${mergeMode ? `<span class="pick-box">${sel ? '✓' : ''}</span>` : ''}
        <div class="m"><div class="n">${esc(x.label)}</div>
          <div class="s"><span class="dot"></span>${tier.name} · ${c.flag} ${esc(x.operator)}</div>
          ${badgesHtml(x)}</div>
        <div class="price">${rub(x.value)}<small>+${rub(incomePerHourKop(x.value))}/ч</small></div></div>`;
    }).join('');
    renderMergeBar();
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
  [...$('rating-tabs').children].forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.r === (ratingWeek ? 'week' : 'all')));
  el.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>'; me.innerHTML = 'Загрузка…';
  if (ratingWeek) { await renderWeek(); return; }
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
  renderHud(); renderBanners(); renderSelectors(); renderSpin(); renderResult(enterResult);
  if (menuOpen) renderMenu();
}

// ---------- лист-подтверждение ----------
const PILL = { primary: 'btn-pill-gold', secondary: 'btn-pill-dark', ghost: 'btn-pill-ghost' } as const;
interface SheetBtn { id: string; label: string; kind: 'primary' | 'secondary' | 'ghost'; sub?: string; disabled?: boolean }
function ask(title: string, text: string, buttons: SheetBtn[]): Promise<string | null> {
  const sheet = $('sheet');
  $('sheet-in').innerHTML = `<h3>${esc(title)}</h3><p>${esc(text)}</p><div class="sheet-btns">${buttons.map((b) =>
    `<button class="btn btn-pill ${PILL[b.kind]}" data-id="${b.id}" ${b.disabled ? 'disabled' : ''}>${esc(b.label)}${b.sub ? `<span class="pill-sub">${esc(b.sub)}</span>` : ''}</button>`).join('')}</div>`;
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

// ---------- нижние листы: меню, страна, ставка ----------
/** Открыть лист со своей разметкой; pick получает нажатый элемент с data-*, close закрывает. */
function openSheet(html: string, pick: (el: HTMLElement, close: () => void) => void, onClose?: () => void) {
  const sheet = $('sheet');
  if (!$('coach').classList.contains('hidden')) coachDone();
  $('sheet-in').innerHTML = html;
  sheet.classList.remove('hidden');
  const close = () => { sheet.classList.add('hidden'); sheet.onclick = null; onClose?.(); };
  sheet.onclick = (e) => {
    const t = e.target as HTMLElement;
    if (t === sheet || t.closest('[data-close]')) return close();
    const el = t.closest<HTMLElement>('[data-pick]');
    if (el && !el.hasAttribute('disabled')) pick(el, close);
  };
  return close;
}

function menuHtml(): string {
  const need = xpToNext(S.level), k = Math.min(1, S.xp / need);
  const acc = kassaNow(), rate = incomePerHourKop(S.collection_value), d = dailyInfo(), h = happyInfo(), fr = freeInfo();
  const until = LUCKY_EVERY - (S.total_spins % LUCKY_EVERY), claims = stats ? achClaimable(stats).length : 0;
  const row = (pick: string, ico: string, title: string, sub: string, right: string, hot = false) =>
    `<button class="mrow ${hot ? 'hot' : ''}" data-pick="${pick}"><span class="banner-ico">${icon(ico)}</span><span class="mrow-t"><b>${title}</b><span class="num-t">${sub}</span></span>${right}</button>`;
  const go = icon('i-right');
  const cta = (t: string, on: boolean) => `<span class="mcta ${on ? 'on' : ''}">${t}</span>`;
  const toggle = (on: boolean) => `<span class="tgl ${on ? 'on' : ''}" role="switch" aria-checked="${on}"><i></i></span>`;
  return `<div class="menu-head"><div class="menu-lvl">${S.level}</div><div class="menu-xp"><b>Уровень ${S.level}</b>
      <span class="num-t">${fmt(S.xp)} / ${fmt(need)} опыта</span><div class="bar"><i style="width:${k * 100}%"></i></div></div></div>
    <div class="mlist">
      ${row('kassa', 'i-cash', `Касса · ${fmt(rate / 100)} ₽/ч`, rate > 0 ? `${rub(acc)} · копится до ${KASSA_CAP_HOURS} ч` : 'оставляй номера — они приносят доход', cta('Забрать', acc >= 100), acc >= 100)}
      ${row('daily', 'i-gift', 'Ежедневный бонус', d.available ? `день ${d.streak + 1} подряд · ${rub(d.amountKop)}` : 'уже забран — приходи завтра', d.available ? cta('Забрать', true) : '', d.available)}
      ${row('happy', 'i-sun', h.active ? `Счастливый час ×${HAPPY_LUCK} идёт` : 'Счастливый час', h.active ? `удача ×${HAPPY_LUCK} на все прокрутки до ${happyEnd()} МСК` : `в ${h.next ? mskHm(h.next) : '—'} МСК · целый час удачи ×${HAPPY_LUCK}`, '', h.active)}
      ${row('luck', 'i-star', `Удача ×${LUCKY_LUCK}`, until === 1 ? 'следующая прокрутка!' : `через ${until} ${plural(until, 'прокрутку', 'прокрутки', 'прокруток')}`, '')}
      ${row('free', 'i-play', 'Бесплатные прокрутки', `${fr.charges} из ${FREE_SPIN_MAX}${bonusSpins() ? ` · бонусных ${bonusSpins()}` : ''}${fr.nextAt ? ` · следующая через ${left(fr.nextAt)}` : ''}`, '')}
      ${row('quests', 'i-target', 'Задания дня', questSummary(), questClaimable() ? `<i class="badge static">${questClaimable()}</i>${go}` : go, questClaimable() > 0)}
      ${row('rule', 'i-sim', 'Что оставлять себе', ruleText(keepRule()), go)}
      ${row('ach', 'i-medal', 'Достижения', claims ? `можно забрать: ${claims}` : 'награды за коллекции', claims ? `<i class="badge static">${claims}</i>${go}` : go, claims > 0)}
      ${row('rating', 'i-cup', 'Рейтинг недели', 'лучший номер недели · призы', go)}
      ${row('feed', 'i-fire', 'Только что выпало', 'эпические и легендарные у всех', go)}
      ${row('hist', 'i-clock', 'История прокруток', 'куда делись номера и деньги', go)}
      ${row('rules', 'i-book', 'Как оценивается номер', 'все узоры и множители', go)}
    </div>
    <div class="mlist">
      ${row('sound', 'i-sound', 'Звук', sfx.enabled ? 'барабаны и выигрыши' : 'выключен', toggle(sfx.enabled))}
      ${row('notify', 'i-bell', 'Сообщения от бота', 'касса полна, номер купили, обмен', toggle(S.notify ?? true))}
      ${row('notifyHappy', 'i-sun', 'Напоминать о счастливом часе', 'за 10 минут, в 13:00 и 20:00 МСК', toggle(S.notify_happy ?? false))}
      ${isAdmin ? row('admin', 'i-chart', 'Статистика игры', 'только для владельца', go) : ''}
    </div>
    <div class="sheet-btns"><button class="btn btn-pill btn-pill-ghost" data-close>Закрыть</button></div>`;
}

function renderMenu() {
  if (!menuOpen) return;
  const sc = $('sheet-in').scrollTop;
  $('sheet-in').innerHTML = menuHtml();
  $('sheet-in').scrollTop = sc;
}

function menuSheet() {
  menuOpen = true;
  haptic.select();
  openSheet(menuHtml(), (el, close) => {
    const k = el.dataset.pick;
    if (k === 'kassa') { if (kassaNow() >= 100) act(el, collectKassa); return; }
    if (k === 'daily') { if (dailyInfo().available) act(el, claimDaily); return; }
    if (k === 'rule') { close(); ruleSheet(); return; }
    if (k === 'ach' || k === 'rating' || k === 'hist' || k === 'feed' || k === 'admin') { close(); show(k); return; }
    if (k === 'quests') { close(); questSheet(); return; }
    if (k === 'rules') { close(); rulesSheet(); return; }
    if (k === 'sound') { sfx.set(!sfx.enabled); renderMenu(); return; }
    if (k === 'notify' || k === 'notifyHappy') {
      const n = k === 'notify' ? !(S.notify ?? true) : (S.notify ?? true);
      const h = k === 'notifyHappy' ? !(S.notify_happy ?? false) : (S.notify_happy ?? false);
      act(el, async () => { const r = await api.notifyPrefs(n, h); setState(r.state); haptic.select(); });
      return;
    }
  }, () => { menuOpen = false; });
}

function countrySheet() {
  if (spinning || busy) return;
  openSheet(`<h3>Страна</h3><p>Чем дороже страна, тем дороже прокрутка и номера.</p><div class="opts">${COUNTRIES.map((c) => {
    const lock = S.level < c.lvl;
    return `<button class="opt" data-pick="${c.id}" ${lock ? 'aria-disabled="true"' : ''}><span class="opt-l"><span class="f">${c.flag}</span>${c.name}<small>${lock ? `${icon('i-lock')}уровень ${c.lvl}` : `×${c.mul} · ${rub(spinCostKop(c, stake))}`}</small></span>${c.id === country.id ? '<i class="tick">✓</i>' : ''}</button>`;
  }).join('')}</div><div class="sheet-btns" style="margin-top:var(--s3)"><button class="btn btn-pill btn-pill-ghost" data-close>Закрыть</button></div>`, (el, close) => {
    const c = countryById(el.dataset.pick!)!;
    if (S.level < c.lvl) { haptic.error(); toast(`${c.flag} ${c.name} откроется на уровне ${c.lvl}`); return; }
    close(); switchCountry(c);
  });
}

function stakeSheet() {
  if (spinning) return;
  openSheet(`<h3>Ставка</h3><p>Ставка умножает цену прокрутки и цену номера. Опыта за большие ставки — больше.</p><div class="opts">${STAKES.map((st) => {
    const lock = S.level < STAKE_LEVEL[st];
    return `<button class="opt" data-pick="${st}" ${lock ? 'aria-disabled="true"' : ''}><span class="opt-l">×${st}<small>${lock ? `${icon('i-lock')}уровень ${STAKE_LEVEL[st]}` : `прокрутка ${rub(spinCostKop(country, st))}`}</small></span>${st === stake ? '<i class="tick">✓</i>' : ''}</button>`;
  }).join('')}</div><div class="sheet-btns" style="margin-top:var(--s3)"><button class="btn btn-pill btn-pill-ghost" data-close>Закрыть</button></div>`, (el, close) => {
    const st = Number(el.dataset.pick);
    if (S.level < STAKE_LEVEL[st]) { haptic.error(); toast(`Ставка ×${st} откроется на уровне ${STAKE_LEVEL[st]}`); return; }
    stake = st; haptic.select(); savePrefs(); close(); renderAll();
  });
}

async function collectKassa() {
  const r = await api.collect(); setState(r.state); haptic.success(); sfx.coin(); toast('Касса: +' + rub(r.collected));
}
async function claimDaily() {
  const r = await api.daily(); setState(r.state); haptic.success(); sfx.coin(); toast(`Бонус: +${rub(r.amount)}`);
}

// ---------- действия ----------
/** Действие с сервером: блокирует повторные нажатия и показывает загрузку на кнопке (событие или сама кнопка). */
async function act(e: Event | HTMLElement | null, fn: () => Promise<void>) {
  if (busy || spinning) return;
  const btn = (e instanceof HTMLElement ? e : (e?.currentTarget ?? null)) as HTMLElement | null;
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
    cheapest ? `Купи ещё место или замени самый дешёвый номер ${cheapest.label} — он продастся за ${rub(sellBackKop(cheapest.value))}.` : 'Купи ещё место на витрине.', [
      ...(canGrow ? [{ id: 'buy', label: 'Ещё место', sub: rub(price), kind: 'primary' as const, disabled: S.balance < price }] : []),
      ...(cheapest ? [{ id: 'replace', label: 'Заменить самый дешёвый', kind: 'secondary' as const }] : []),
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

const keepRule = (): KeepRule => S.keep_rule ?? KEEP_RULE_DEFAULT;

/** Прошлый номер подходит под правило «оставлять», а витрина полна — спросить, что делать. go: можно продолжать. */
async function confirmPending(action: string): Promise<{ go: boolean; autosellOk: boolean }> {
  const p = S.pending;
  if (!p || !ruleMatches(keepRule(), p) || S.collection_count < slotsCap()) return { go: true, autosellOk: false };
  const a = await ask('Витрина заполнена', `${p.label} · ${tierById(p.tier).name} · ${rub(p.value)} подходит под правило «оставлять», но ему нет места. ${action}`, [
    { id: 'keep', label: 'Освободить место', kind: 'primary' },
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

const RULE_TIERS: { tier: 'nice' | 'rare' | 'epic' | 'legend'; label: string }[] = [
  { tier: 'nice', label: 'Красивые и дороже' },
  { tier: 'rare', label: 'Редкие и дороже' },
  { tier: 'epic', label: 'Эпические и дороже' },
  { tier: 'legend', label: 'Только легендарные' },
];
const ruleText = (r: KeepRule) => r.mode === 'none' ? 'всё продавать'
  : r.mode === 'tier' ? RULE_TIERS.find((x) => x.tier === r.tier)!.label.toLowerCase()
  : `по цене от ${rub(r.from)}${r.to !== null ? ` до ${rub(r.to)}` : ''}`;

/** Лист «Что оставлять себе»: по цене или по редкости. */
function ruleSheet() {
  const r = keepRule(), sheet = $('sheet');
  $('sheet-in').innerHTML = `<h3>Что оставлять себе</h3>
    <p>Номер, по которому ты ничего не нажал, при следующей прокрутке уйдёт в коллекцию, если подходит, — остальные продаются игре по оценке. Выбери одно: по редкости или по цене.</p>
    <div class="group-title" style="margin-top:0">По редкости</div>
    <div class="opts">${RULE_TIERS.map((t) => `<button class="opt" data-tier="${t.tier}" style="--tc:${tierVar(t.tier)}"><span>${t.label}</span>${r.mode === 'tier' && r.tier === t.tier ? '<i class="tick">✓</i>' : ''}</button>`).join('')}
      <button class="opt" data-none="1"><span>Никакие — всё продавать</span>${r.mode === 'none' ? '<i class="tick">✓</i>' : ''}</button></div>
    <div class="group-title">По цене, в рублях</div>
    <div class="price-row"><input class="field" id="rule-from" type="number" inputmode="numeric" placeholder="Цена от" value="${r.mode === 'price' ? Math.round(r.from / 100) : ''}">
      <input class="field" id="rule-to" type="number" inputmode="numeric" placeholder="до (можно пусто)" value="${r.mode === 'price' && r.to !== null ? Math.round(r.to / 100) : ''}"></div>
    <div class="sheet-btns" style="margin-top:var(--s3)"><button class="btn btn-pill btn-pill-gold" id="rule-price">Оставлять по цене${r.mode === 'price' ? ' ✓' : ''}</button>
      <button class="btn btn-pill btn-pill-ghost" id="rule-close">Закрыть</button></div>`;
  sheet.classList.remove('hidden');
  const close = () => { sheet.classList.add('hidden'); sheet.onclick = null; };
  const save = (rule: KeepRule, btn: HTMLElement) => act(btn, async () => {
    const res = await api.setKeepRule(rule); setState(res.state); haptic.success(); close();
    toast('Оставлять: ' + ruleText(rule));
  });
  sheet.onclick = (e) => {
    const t = e.target as HTMLElement;
    if (t === sheet) return close();
    const o = t.closest<HTMLElement>('.opt');
    if (o) save(o.dataset.none ? { mode: 'none' } : { mode: 'tier', tier: o.dataset.tier as 'rare' }, o);
  };
  $('rule-close').onclick = close;
  $('rule-price').onclick = (e) => {
    const from = Math.round(Number(($('rule-from') as HTMLInputElement).value || 0) * 100);
    const toRaw = ($('rule-to') as HTMLInputElement).value;
    const to = toRaw ? Math.round(Number(toRaw) * 100) : null;
    if (to !== null && to < from) { toast('«До» должно быть больше «от»'); return; }
    save({ mode: 'price', from, to }, e.currentTarget as HTMLElement);
  };
}

function setSpinning(on: boolean) {
  spinning = on;
  renderSpin();
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Кнопка спина: пропустить анимацию, одна прокрутка или автоспин на 5 прокруток. */
async function spin() {
  if (spinning) { card.skip(); haptic.tick(); return; }
  if (autoLeft > 0) { autoLeft = 0; toast('Автоспин остановлен'); renderAll(); return; }
  if (busy) return;
  if (!autoOn) { await spinOnce(); return; }
  autoLeft = AUTO_SPINS;
  while (autoLeft > 0 && view === 'play') {
    renderSelectors(); renderSpin();
    const sim = await spinOnce();
    if (autoLeft > 0) autoLeft--;
    // эпический и легендарный — останавливаемся, чтобы игрок увидел
    if (!sim || sim.mul >= 40) break;
    if (autoLeft > 0) await wait(900);
  }
  autoLeft = 0;
  renderAll();
}

/** Одна прокрутка. Возвращает номер или null, если прокрутки не было. */
async function spinOnce(): Promise<Sim | null> {
  const conf = await confirmPending('Если крутить дальше, он продастся.');
  if (!conf.go) return null;
  const c = country, free = useFree(), auto = S.pending?.value ?? 0, price = cost();
  if (S.balance + auto < price) { noMoney(); return null; }

  setSpinning(true);
  sfx.spin();
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
    return null;
  }
  if (r.auto_kept) toast('Прошлый номер — в коллекции по правилу');
  else if (r.auto_sold) toast('Прошлый номер продан: +' + rub(r.auto_sold));
  const prevLevel = S.level;
  // Баланс показываем сразу, остальное (опыт, номер) — после остановки, чтобы не выдать результат.
  renderHud(r.state.balance);

  const sim = r.sim;
  const run = card.run(c, sim.prefix, sim.sub, sim.operator, sim.mul >= 40);
  if (reduced) card.skip();
  await run;

  setState(r.state);
  setSpinning(false);
  if (sim.mul >= 1.5) sfx.win(sim.tier);
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
  refreshStats();
  coachAfterSpin();
  // кнопки результата не должны прятаться под нижней панелью
  if (view === 'play') {
    const res = $('result').getBoundingClientRect(), dockTop = document.querySelector('.dock')!.getBoundingClientRect().top;
    if (res.bottom > dockTop - 8) window.scrollBy({ top: res.bottom - dockTop + 16, behavior: reduced ? 'auto' : 'smooth' });
  }
  return sim;
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
      const p = S.pending;
      if (ruleMatches(keepRule(), p) && S.collection_count < slotsCap()) {
        await act(null, async () => { const r = await api.keep(); setState(r.state); toast('Прошлый номер — в коллекции по правилу'); });
      } else {
        await act(null, async () => { const r = await api.sell(); setState(r.state); toast('Прошлый номер продан: +' + rub(r.sold)); });
      }
      if (S.pending) return;
    }
  }
  haptic.select();
  country = c; savePrefs(); card.sample(c); renderAll();
}

// ---------- действия с номером из коллекции ----------
async function numberActions(x: Sim) {
  const c = countryById(x.country)!;
  const a = await ask(x.label, `${tierById(x.tier).name} · ${c.flag} ${x.operator} · оценка ${rub(x.value)}`, [
    { id: 'brag', label: 'Похвастаться картинкой', kind: 'primary' },
    { id: 'sell', label: `Продать за ${rub(sellBackKop(x.value))}`, kind: 'secondary' },
    { id: 'lot', label: 'Выставить на рынок', kind: 'secondary' },
    { id: 'cancel', label: 'Закрыть', kind: 'ghost' },
  ]);
  if (a === 'brag') shareSim(c, x);
  if (a === 'sell') {
    await act(null, async () => { const r = await api.sellNumber(x.id); setState(r.state); toast('Продано: +' + rub(r.sold)); });
    renderColl();
  }
  if (a === 'lot') listSheet(x);
}

/** Лист выставления на рынок: цена с быстрыми кнопками и подсказкой, сколько получишь. */
function listSheet(x: Sim) {
  const b = lotPriceBounds(x.value);
  const sheet = $('sheet');
  const quick = [0.8, 1, 1.2, 1.5, 2];
  $('sheet-in').innerHTML = `<h3>Выставить на рынок</h3>
    <p>${esc(x.label)} · оценка ${rub(x.value)}. Цена — от ${rub(b.min)} до ${rub(b.max)}. Пока номер на рынке, он не приносит доход.</p>
    <input class="field" id="lot-price" type="number" inputmode="numeric" min="${Math.ceil(b.min / 100)}" max="${Math.floor(b.max / 100)}" value="${Math.round(x.value * 1.2 / 100)}">
    <div class="quick">${quick.map((k) => `<button data-k="${k}">${k === 1 ? 'оценка' : (k > 1 ? '+' : '−') + Math.round(Math.abs(k - 1) * 100) + '%'}</button>`).join('')}</div>
    <p id="lot-get"></p>
    <div class="sheet-btns"><button class="btn btn-pill btn-pill-gold" id="lot-ok">Выставить</button><button class="btn btn-pill btn-pill-ghost" id="lot-cancel">Отмена</button></div>`;
  sheet.classList.remove('hidden');
  const input = $('lot-price') as HTMLInputElement;
  const upd = () => { $('lot-get').textContent = `Получишь при продаже: ${rub(Math.floor(Number(input.value) * 100 * (1 - MARKET_FEE)))}`; };
  input.oninput = upd; upd();
  $('sheet-in').querySelector('.quick')!.addEventListener('click', (e) => {
    const k = (e.target as HTMLElement).dataset.k;
    if (k) { input.value = String(Math.round(x.value * Number(k) / 100)); upd(); haptic.select(); }
  });
  const close = () => { sheet.classList.add('hidden'); sheet.onclick = null; };
  sheet.onclick = (e) => { if (e.target === sheet) close(); };
  $('lot-cancel').onclick = close;
  $('lot-ok').onclick = (e) => act(e, async () => {
    const r = await api.lotCreate(x.id, Math.round(Number(input.value) * 100));
    setState(r.state); close(); haptic.success(); toast('Номер на рынке'); renderColl();
  });
}

// ---------- рынок ----------
async function renderMarket() {
  [...$('market-tabs').children].forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.m === (marketMine ? 'mine' : 'all')));
  $('market-filter').innerHTML = [{ id: 'all', name: 'Любая редкость' }, ...TIERS.slice().reverse().filter((t) => t.id !== 'common')]
    .map((t) => `<button class="chip ${marketTier === t.id ? 'on' : ''}" data-t="${t.id}">${t.id !== 'all' ? `<span class="dot" style="--tc:${tierVar(t.id)}"></span>` : ''}${t.name}</button>`).join('');
  const el = $('market');
  if (!marketCache.length) el.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
  try {
    marketCache = await api.market(marketMine);
    if (view !== 'market') return;
    const list = marketCache.filter((l) => marketTier === 'all' || l.sim.tier === marketTier);
    el.innerHTML = list.length ? list.map((l) => {
      const c = countryById(l.sim.country)!;
      return `<div class="row tap" style="--tc:${tierVar(l.sim.tier)}" ${l.mine ? `data-cancel="${l.id}"` : `data-buy="${l.id}"`}>
        <div class="m"><div class="n">${esc(l.sim.label)}</div>
          <div class="s"><span class="dot"></span>${tierById(l.sim.tier).name} · ${c.flag} · ${l.mine ? 'твой лот' : esc(l.seller || 'Игрок')}</div></div>
        <div class="price">${rub(l.price)}<small>оценка ${rub(l.sim.value)}</small></div>
      </div>`;
    }).join('') : `<div class="empty">${marketMine ? 'Ты ничего не выставил. Нажми на номер в коллекции → «Выставить на рынок».' : 'Пока никто ничего не продаёт — выставь свой номер первым.'}</div>`;
  } catch (e) {
    el.innerHTML = `<div class="empty">${esc((e as Error).message)}</div>`;
  }
}

async function buyLot(id: string) {
  const l = marketCache.find((x) => x.id === id);
  if (!l) return;
  const a = await ask('Купить номер?', `${l.sim.label} · ${tierById(l.sim.tier).name}. Оценка ${rub(l.sim.value)} — по ней номер приносит доход на витрине.`, [
    { id: 'buy', label: `Купить за ${rub(l.price)}`, kind: 'primary', disabled: S.balance < l.price },
    { id: 'cancel', label: 'Отмена', kind: 'ghost' },
  ]);
  if (a !== 'buy') return;
  await act(null, async () => { const r = await api.lotBuy(id); setState(r.state); haptic.success(); toast('Номер на твоей витрине'); });
  renderMarket();
}

// ---------- друзья ----------
async function renderFriends() {
  const el = $('friends');
  const link = inviteLink(S.telegram_id ?? 0);
  const head = `<div class="hero">
      <div class="eyebrow">Приглашай друзей</div>
      <h2>Зови друзей — получай награды</h2>
      <p>Друг сразу получит <b>${REF_NEW_SPINS} бесплатных прокруток</b>. Ты — <b>${rub(REF_REWARD_RUB * 100)}</b> и ${REF_REWARD_SPINS} прокрутки, когда он сделает ${REF_AFTER_SPINS} прокруток.</p>
      <button class="btn btn-primary btn-l" style="width:100%" id="f-share">Отправить другу</button>
      <div class="btn-row"><button class="btn btn-secondary btn-m" id="f-copy">${icon('i-link')}Копировать</button><button class="btn btn-secondary btn-m" id="f-ach">Награды</button></div>
      <div class="link">${esc(link)}</div>
    </div>`;
  el.innerHTML = head + '<div class="stats"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>';
  bindFriendButtons(link);
  try {
    const f = await api.friends();
    if (view !== 'friends') return;
    const next = [1, 3, 10].find((n) => n > f.active) ?? 10;
    el.innerHTML = head + `
      <div class="stats">
        <div class="stat"><b>${f.invited}</b><span>пришло</span></div>
        <div class="stat"><b>${f.active}</b><span>засчитано</span></div>
        <div class="stat"><b>${rub(f.earned)}</b><span>принесли тебе</span></div>
      </div>
      <div class="panel" style="margin-top:var(--s3)"><b>До следующей награды · ${f.active}/${next}</b>
        <div class="bar"><i style="width:${Math.min(100, (f.active / next) * 100)}%"></i></div>
        <p class="note" style="text-align:left;margin:var(--s2) 0 0">Друг засчитывается после ${REF_AFTER_SPINS} прокруток — так награды не получить ботами.</p></div>
      <div id="trades"></div>
      ${f.list.length || f.inviter ? `<div class="group-title">Твои друзья · нажми, чтобы меняться номерами</div><div class="list" id="friend-list">${
        (f.inviter ? [{ id: f.inviter.id, name: f.inviter.name, sub: `пригласил тебя · номеров: ${f.inviter.count}` }] : [])
          .concat(f.list.map((x) => ({ id: x.id ?? '', name: x.name, sub: (x.counted ? 'засчитан ✓' : `прокруток ${Math.min(x.spins, REF_AFTER_SPINS)} из ${REF_AFTER_SPINS}`) + (x.count !== undefined ? ` · номеров: ${x.count}` : '') })))
          .map((x) => `<div class="row ${x.id ? 'tap' : ''}" ${x.id ? `data-friend="${x.id}" data-name="${esc(x.name || 'Игрок')}"` : ''}>
        <span class="avatar">${esc((x.name || 'И').slice(0, 1).toUpperCase())}</span>
        <div class="m"><div class="n" style="font-family:var(--font)">${esc(x.name || 'Игрок')}</div>
          <div class="s">${x.sub}</div></div>${x.id ? icon('i-swap') : ''}</div>`).join('')}</div>` : ''}`;
    bindFriendButtons(link);
    const fl = document.getElementById('friend-list');
    if (fl) fl.onclick = (e) => {
      const r = (e.target as HTMLElement).closest<HTMLElement>('[data-friend]');
      if (r) tradeStart(r.dataset.friend!, r.dataset.name!);
    };
    renderTrades();
  } catch (e) {
    toast((e as Error).message);
  }
}

function bindFriendButtons(link: string) {
  $('f-share').onclick = () => shareLink(link, 'Крути барабаны и собирай красивые номера в «Золотом номере» — держи 10 бесплатных прокруток!');
  $('f-copy').onclick = async () => { toast((await copyText(link)) ? 'Ссылка скопирована' : link); };
  $('f-ach').onclick = () => show('ach');
}

// ---------- ещё ----------
const TILES: { v?: string; soon?: string; title: string; sub: string; icon: string; bg: string; admin?: boolean }[] = [
  { v: 'quests', title: 'Задания дня', sub: 'три цели на сегодня', icon: 'i-target', bg: 'linear-gradient(135deg,#ff7a7a,#e5484d)' },
  { v: 'rating', title: 'Рейтинг', sub: 'неделя с призами', icon: 'i-cup', bg: 'linear-gradient(135deg,#f6b833,#ff8a12)' },
  { v: 'ach', title: 'Достижения', sub: 'альбомы и коллекции', icon: 'i-medal', bg: 'linear-gradient(135deg,#4ade80,#16a34a)' },
  { v: 'feed', title: 'Только что выпало', sub: 'находки игроков', icon: 'i-fire', bg: 'linear-gradient(135deg,#b38cff,#7c5cc4)' },
  { v: 'hist', title: 'История', sub: 'последние 50 номеров', icon: 'i-clock', bg: 'linear-gradient(135deg,#38bdf8,#2563eb)' },
  { v: 'rules', title: 'Как оценивается', sub: 'узоры и цены', icon: 'i-book', bg: 'linear-gradient(135deg,#94a3b8,#64748b)' },
  { v: 'admin', title: 'Статистика', sub: 'для владельца', icon: 'i-chart', bg: 'linear-gradient(135deg,#2dd4bf,#0f766e)', admin: true },
  { soon: 'Магазин за звёзды Telegram — скоро', title: 'Магазин', sub: 'скоро', icon: 'i-star', bg: 'linear-gradient(135deg,#fbbf24,#f59e0b)' },
];
function renderMore() {
  const n = stats ? achClaimable(stats).length : 0, qn = questClaimable();
  const cnt = (v?: string) => (v === 'ach' ? n : v === 'quests' ? qn : 0);
  $('more').innerHTML = TILES.filter((t) => !t.admin || isAdmin).map((t) => `<button class="tile ${t.soon ? 'soon' : ''}" ${t.v ? `data-v="${t.v}"` : `data-soon="${t.soon}"`}>
      <span class="ti" style="background:${t.bg}">${icon(t.icon)}</span><b>${t.title}</b><span>${cnt(t.v) ? `можно забрать: ${cnt(t.v)}` : t.sub}</span>
      ${cnt(t.v) ? `<i class="badge">${cnt(t.v)}</i>` : ''}</button>`).join('');
}

// ---------- достижения ----------
async function refreshStats() {
  try { stats = await api.stats(); } catch { return; }
  try { day = await api.day(); } catch { /* старый сервер без заданий */ }
  const n = achClaimable(stats).length + questClaimable();
  $('more-badge').textContent = String(n);
  $('more-badge').classList.toggle('hidden', n === 0);
  if (view === 'more') renderMore();
  if (view === 'ach') renderAch(false);
}

async function renderAch(fetch = true) {
  const el = $('ach');
  if (fetch || !stats) {
    if (!stats) el.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
    try { stats = await api.stats(); } catch (e) { el.innerHTML = `<div class="empty">${esc((e as Error).message)}</div>`; return; }
    if (view !== 'ach') return;
  }
  const st = stats!;
  const groups = [...new Set(ACHIEVEMENTS.map((a) => a.group))];
  // в каждом разделе: сначала то, что можно забрать, потом в процессе, полученные — в конце
  const order = (a: (typeof ACHIEVEMENTS)[0]) => (st.claimed.includes(a.id) ? 2 : achProgress(a, st).have >= achProgress(a, st).need ? 0 : 1);
  el.innerHTML = groups.map((g) => `<div class="group-title">${g}</div>` + ACHIEVEMENTS.filter((a) => a.group === g).sort((a, b) => order(a) - order(b)).map((a) => {
    const p = achProgress(a, st), done = p.have >= p.need, claimed = st.claimed.includes(a.id);
    const reward = rub(a.rewardRub * 100) + (a.rewardSpins ? ` + ${a.rewardSpins} прокр.` : '');
    const prog = a.kind.t === 'value' ? `${rub(Math.min(p.have, p.need) * 100)} из ${rub(p.need * 100)}` : `${Math.min(p.have, p.need)} из ${p.need}`;
    return `<div class="ach ${claimed ? 'claimed' : done ? 'done' : ''}">
      <div class="m"><b>${a.title}</b><div class="s">${claimed ? 'получено' : prog} · ${reward}</div>
        ${a.kind.t === 'set' ? setChips(a.kind.kinds, st) : ''}
        ${!claimed && !done ? `<div class="bar"><i style="width:${Math.min(100, (p.have / p.need) * 100)}%"></i></div>` : ''}</div>
      ${done && !claimed ? `<button class="btn btn-ok btn-m" data-claim="${a.id}">Забрать</button>` : ''}</div>`;
  }).join('')).join('');
}

// ---------- задания дня ----------
const questsToday = () => (day && S.telegram_id ? questsFor(day.day, S.telegram_id, S.level) : []);
const questClaimed = (id: string) => !!day && day.claimed.includes(questKey(day.day, id));
function questClaimable(): number {
  if (!day) return 0;
  const qs = questsToday();
  const n = qs.filter((q) => !questClaimed(q.id) && (() => { const p = questProgress(q, day!); return p.have >= p.need; })()).length;
  const all = qs.length > 0 && qs.every((q) => questClaimed(q.id)) && !questClaimed('all') ? 1 : 0;
  return n + all;
}
function questSummary(): string {
  if (!day) return 'три цели на сегодня';
  const qs = questsToday(), done = qs.filter((q) => questClaimed(q.id)).length;
  return `выполнено ${done} из ${qs.length}${questClaimable() ? ' · есть награда' : ''}`;
}
function questHtml(): string {
  if (!day) return '<p>Задания загружаются…</p>';
  const qs = questsToday();
  const rows = qs.map((q) => {
    const p = questProgress(q, day!), done = p.have >= p.need, got = questClaimed(q.id);
    const reward = rub(q.rewardRub * 100) + (q.rewardSpins ? ` + ${q.rewardSpins} прокр.` : '');
    return `<div class="quest ${got ? 'got' : done ? 'done' : ''}"><div class="m"><b>${q.title}</b>
      <div class="s num-t">${got ? 'получено ✓' : `${Math.min(p.have, p.need)} из ${p.need}`} · ${reward}</div>
      ${!got ? `<div class="bar"><i style="width:${Math.min(100, (p.have / p.need) * 100)}%"></i></div>` : ''}</div>
      ${done && !got ? `<button class="btn btn-ok btn-m" data-pick="${q.id}">Забрать</button>` : ''}</div>`;
  }).join('');
  const allDone = qs.every((q) => questClaimed(q.id)), allGot = questClaimed('all');
  return `<h3>Задания дня</h3><p>Новые — каждый день в 00:00 по Москве.</p>${rows}
    <div class="quest bonus ${allGot ? 'got' : allDone ? 'done' : ''}"><div class="m"><b>Все три задания</b>
      <div class="s">${allGot ? 'получено ✓' : `ещё ${rub(QUEST_ALL_RUB * 100)} и ${QUEST_ALL_SPINS} прокрутки`}</div></div>
      ${allDone && !allGot ? '<button class="btn btn-ok btn-m" data-pick="all">Забрать</button>' : ''}</div>
    <div class="sheet-btns" style="margin-top:var(--s3)"><button class="btn btn-pill btn-pill-ghost" data-close>Закрыть</button></div>`;
}
async function questSheet() {
  haptic.select();
  if (!day) { try { day = await api.day(); } catch (e) { toast((e as Error).message); return; } }
  openSheet(questHtml(), (el) => {
    act(el, async () => {
      const r = await api.questClaim(el.dataset.pick!); setState(r.state); haptic.success(); sfx.coin();
      toast(`Награда: +${rub(r.reward)}` + (r.spins ? ` и ${r.spins} прокр.` : ''));
      day = await api.day();
      $('sheet-in').innerHTML = questHtml();
    });
  });
}

// ---------- как оценивается номер ----------
function rulesSheet() {
  haptic.select();
  const rows = PATTERN_INFO.map((x) => {
    const m = RARITY[x.kind as keyof typeof RARITY] as number;
    const t = TIER_LIST.find((y) => m >= y.min)!;
    return `<div class="rule-line" style="--tc:${tierVar(t.id)}"><span><b>${x.name}</b><small>${x.example}</small></span><i class="num-t">×${fmtNum(m)}</i></div>`;
  }).join('');
  openSheet(`<h3>Как оценивается номер</h3>
    <p>Цена = ставка × доля по редкости × особенности цифр. Берётся самый дорогой узор, T9-слово и красивый код умножают сверху.</p>
    <div class="rules">${rows}
      <div class="rule-line"><span><b>T9-слово</b><small>КОТИК = 45644, ДЕНЬГИ = 336544</small></span><i>×2 / ×3</i></div>
      <div class="rule-line"><span><b>Красивый код</b><small>(999), (777), (44)</small></span><i>×2</i></div></div>
    <div class="group-title">Редкость по множителю</div>
    <div class="rules">${TIER_LIST.slice().reverse().map((t) => `<div class="rule-line" style="--tc:${tierVar(t.id)}"><span><b style="color:var(--tc)">${t.name}</b></span><i class="num-t">от ×${fmtNum(t.min)}</i></div>`).join('')}</div>
    <div class="group-title">Цена от ставки</div>
    <p style="text-align:left">Обычный номер — ${fmtNum(VALUE_BASE * 100)}% ставки, каждый «×» узора добавляет ещё 13%: Редкий ×12 ≈ 2,4 ставки, Легендарный ×500 ≈ 66.
      Цифры меняют цену ещё на −12…+30%: меньше разных цифр, одинаковые рядом и семёрки — дороже.</p>
    <div class="sheet-btns"><button class="btn btn-pill btn-pill-ghost" data-close>Закрыть</button></div>`, () => {});
}
const fmtNum = (x: number) => x.toLocaleString('ru-RU', { maximumFractionDigits: 2 });

// ---------- история ----------
const STATUS_TEXT: Record<string, string> = {
  pending: 'на экране', sold: 'продан', auto_sold: 'продан', kept: 'в коллекции',
  sold_from_collection: 'продан из витрины', listed: 'на рынке', merged: 'улучшен',
};
function ago(iso: string): string {
  const m = Math.max(0, Math.round((now().getTime() - new Date(iso).getTime()) / 60e3));
  if (m < 1) return 'только что';
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч назад`;
  return `${Math.floor(h / 24)} дн назад`;
}
async function renderHist() {
  const el = $('hist');
  el.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
  try {
    const list = await api.history();
    if (view !== 'hist') return;
    el.innerHTML = list.length ? list.map((x) => {
      const c = countryById(x.country), diff = x.value - (x.cost ?? 0);
      return `<div class="row" style="--tc:${tierVar(x.tier)}"><div class="m"><div class="n">${esc(x.label)}</div>
        <div class="s"><span class="dot"></span>${c?.flag ?? ''} ${STATUS_TEXT[x.status ?? ''] ?? ''} · ${ago(x.created_at)}</div></div>
        <div class="price">${rub(x.value)}<small class="${diff >= 0 ? 'up' : ''}">${x.cost ? `${diff >= 0 ? '▲ +' : '▼ −'}${rub(Math.abs(diff))}` : 'бесплатно'}</small></div></div>`;
    }).join('') : '<div class="empty">Пока ни одной прокрутки</div>';
  } catch (e) { el.innerHTML = `<div class="empty">${esc((e as Error).message)}</div>`; }
}

// ---------- лента ----------
async function renderFeed() {
  const el = $('feed');
  el.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
  try {
    const list = await api.feed();
    if (view !== 'feed') return;
    el.innerHTML = list.length ? list.map((x) => `<div class="row ${x.me ? 'me' : ''}" style="--tc:${tierVar(x.tier)}">
        <span class="avatar">${esc((x.name || 'И').slice(0, 1).toUpperCase())}</span>
        <div class="m"><div class="n">${esc(x.label)}</div>
          <div class="s"><span class="dot"></span>${esc(x.me ? 'Ты' : x.name || 'Игрок')} · ${tierById(x.tier).name}${x.tag ? ' · ' + esc(x.tag) : ''} · ${ago(x.created_at)}</div></div>
        <div class="price">${rub(x.value)}</div></div>`).join('')
      : '<div class="empty">За неделю никто не выбил эпический номер — будь первым!</div>';
  } catch (e) { el.innerHTML = `<div class="empty">${esc((e as Error).message)}</div>`; }
}

// ---------- рейтинг недели ----------
async function renderWeek() {
  const el = $('rating'), me = $('me-rank');
  try {
    const w = await api.week(false);
    if (view !== 'rating' || !ratingWeek) return;
    const end = new Date(weekStart(now()).getTime() + 7 * 86400e3), msLeft = end.getTime() - now().getTime();
    const dLeft = Math.floor(msLeft / 86400e3), hLeft = Math.floor((msLeft % 86400e3) / 3600e3);
    const prizes = WEEK_PRIZES_RUB.map((r, i) => `${i + 1} место — ${rub(r * 100)} + ${WEEK_PRIZES_SPINS[i]} прокр.`).join(' · ');
    me.innerHTML = `<b>Лучший номер недели</b> · до конца ${dLeft ? `${dLeft} дн ` : ''}${hLeft} ч<br><small>${prizes}<br>Приз приходит при входе после конца недели.</small>`
      + (w.me ? `<br>Твоё место: <b>${w.me.place}</b> · номер на <b>${rub(w.me.value)}</b>` : '<br>Крути — твой лучший номер попадёт в рейтинг');
    el.innerHTML = w.top.length ? w.top.map((r) => `<div class="row ${r.me ? 'me' : ''}">
        <span class="place ${r.place <= 3 ? 'p' + r.place : ''}">${r.place}</span>
        <span class="avatar">${esc((r.name || 'И').slice(0, 1).toUpperCase())}</span>
        <div class="m"><div class="n" style="font-family:var(--font)">${esc(r.name || 'Игрок')}</div><div class="s">лучший номер · ${rub(r.value)}</div></div>
        ${r.place <= WEEK_PRIZES_RUB.length ? `<span class="prize num-t">${rub(WEEK_PRIZES_RUB[r.place - 1] * 100)}</span>` : ''}</div>`).join('')
      : '<div class="empty">На этой неделе ещё никто не крутил</div>';
  } catch (e) { el.innerHTML = `<div class="empty">${esc((e as Error).message)}</div>`; }
}

// ---------- альбомы и значки ----------
function setChips(kinds: string[], st: Stats): string {
  const got = new Set((st.tags ?? []).map(patternKind));
  return `<div class="chips-set">${kinds.map((k) => {
    const info = PATTERN_INFO.find((x) => x.kind === k);
    return `<span class="kchip ${got.has(k as never) ? 'on' : ''}">${got.has(k as never) ? '✓ ' : ''}${info?.name ?? k}</span>`;
  }).join('')}</div>`;
}
function badgesHtml(x: Sim): string {
  const b: string[] = [];
  if (x.first) b.push('<span class="nb gold">Первый в игре</span>');
  if (x.luck >= 10) b.push('<span class="nb">Удача ×10</span>');
  else if (x.luck === 2) b.push('<span class="nb">Счастливый час</span>');
  if (x.is_free) b.push('<span class="nb">Бесплатный</span>');
  return b.length ? `<div class="nbs">${b.join('')}</div>` : '';
}

// ---------- улучшение 3 → 1 ----------
function mergeOk(x: Sim): boolean {
  if (!nextTier(x.tier)) return false;
  const first = collCache.find((y) => mergeSel.has(y.id));
  return !first || first.tier === x.tier;
}
function toggleMergePick(x: Sim) {
  if (mergeSel.has(x.id)) mergeSel.delete(x.id);
  else if (!nextTier(x.tier)) { toast('Легендарный — уже высшая редкость'); return; }
  else if (!mergeOk(x)) { toast('Нужны три номера одной редкости'); return; }
  else if (mergeSel.size < 3) mergeSel.add(x.id);
  haptic.select();
  renderColl();
}
function renderMergeBar() {
  const bar = $('merge-bar');
  bar.classList.toggle('hidden', !mergeMode);
  if (!mergeMode) return;
  const first = collCache.find((y) => mergeSel.has(y.id)), to = first ? nextTier(first.tier) : null;
  const sum = collCache.filter((y) => mergeSel.has(y.id)).reduce((a, y) => a + y.value, 0);
  bar.innerHTML = `<div class="m"><b>Выбрано ${mergeSel.size} из 3</b><span>${to ? `${tierById(first!.tier).name} → ${tierById(to).name} · отдаёшь ${rub(sum)}` : 'выбери три номера одной редкости'}</span></div>
    <button class="btn btn-pill btn-pill-ghost" id="merge-cancel">Отмена</button>
    <button class="btn btn-pill btn-pill-gold" id="merge-go" ${mergeSel.size === 3 ? '' : 'disabled'}>Улучшить</button>`;
  $('merge-cancel').onclick = () => { mergeMode = false; mergeSel.clear(); renderColl(); };
  $('merge-go').onclick = (e) => act(e, async () => {
    const r = await api.merge([...mergeSel]); setState(r.state);
    mergeMode = false; mergeSel.clear(); haptic.success(); sfx.win(r.sim.tier);
    toast(`Новый номер: ${r.sim.label} · ${tierById(r.sim.tier).name} · ${rub(r.sim.value)}`);
    renderColl();
  });
}

// ---------- обмен с друзьями ----------
async function renderTrades() {
  const el = document.getElementById('trades');
  if (!el) return;
  let list: Trade[] = [];
  try { list = await api.trades(); } catch { return; }
  if (view !== 'friends') return;
  el.innerHTML = list.length ? `<div class="group-title">Обмены</div><div class="list">${list.map((t) => `<div class="trade">
      <div class="trade-t">${t.incoming ? `<b>${esc(t.from_name)}</b> предлагает обмен` : `Ты предложил <b>${esc(t.to_name)}</b>`}</div>
      <div class="trade-row"><span>Отдаёшь</span><b>${esc(t.give.label)}</b><i class="num-t">${rub(t.give.value)}</i></div>
      <div class="trade-row"><span>Получаешь</span><b>${esc(t.get.label)}</b><i class="num-t">${rub(t.get.value)}</i></div>
      <div class="acts">${t.incoming
        ? `<button class="btn btn-pill btn-pill-dark" data-tr="${t.id}" data-ok="0">Отказать</button><button class="btn btn-pill btn-pill-gold" data-tr="${t.id}" data-ok="1">Поменяться</button>`
        : `<button class="btn btn-pill btn-pill-dark" data-tr="${t.id}" data-ok="0">Отменить</button>`}</div></div>`).join('')}</div>` : '';
  el.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tr]');
    if (!b) return;
    act(b, async () => {
      const r = await api.tradeAnswer(b.dataset.tr!, b.dataset.ok === '1'); setState(r.state);
      if (r.status === 'accepted') { haptic.success(); sfx.coin(); toast('Обмен состоялся — номер в твоей коллекции'); }
      else toast(r.status === 'declined' ? 'Предложение отклонено' : 'Предложение отменено');
      renderTrades();
    });
  };
}
async function tradeStart(friendId: string, name: string) {
  haptic.select();
  let theirs: Sim[];
  try { theirs = (await api.friendCollection(friendId)).list; } catch (e) { toast((e as Error).message); return; }
  if (!theirs.length) { toast(`У ${name} пока пустая коллекция`); return; }
  const row = (x: Sim) => `<button class="opt" data-pick="${x.id}" style="--tc:${tierVar(x.tier)}"><span class="opt-l"><span class="dot"></span><span class="mono">${esc(x.label)}</span></span><small class="num-t">${rub(x.value)}</small></button>`;
  openSheet(`<h3>Коллекция: ${esc(name)}</h3><p>Выбери номер, который хочешь получить.</p><div class="opts">${theirs.map(row).join('')}</div>
    <div class="sheet-btns" style="margin-top:var(--s3)"><button class="btn btn-pill btn-pill-ghost" data-close>Закрыть</button></div>`, async (el, close) => {
    const want = theirs.find((x) => x.id === el.dataset.pick)!;
    close();
    const mine = (await api.collection()).filter((x) => Math.max(x.value, want.value) <= TRADE_MAX_RATIO * Math.min(x.value, want.value));
    if (!mine.length) { toast(`Нет номера в похожую цену: меняться можно, если цены отличаются не больше чем в ${TRADE_MAX_RATIO} раза`); return; }
    openSheet(`<h3>Что отдашь за ${esc(want.label)}?</h3><p>Номер ${esc(name)} стоит ${rub(want.value)}. Показаны твои номера в похожую цену.</p>
      <div class="opts">${mine.map(row).join('')}</div>
      <div class="sheet-btns" style="margin-top:var(--s3)"><button class="btn btn-pill btn-pill-ghost" data-close>Отмена</button></div>`, (el2, close2) => {
      act(el2, async () => {
        const r = await api.tradeOffer(el2.dataset.pick!, friendId, want.id); setState(r.state);
        close2(); haptic.success(); toast(`Предложение отправлено — ${name} получит сообщение`);
        renderTrades();
      });
    });
  });
}

// ---------- статистика для владельца ----------
async function renderAdmin() {
  const el = $('admin');
  el.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
  try {
    const a = await api.adminStats() as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (view !== 'admin') return;
    const tile = (v: unknown, t: string) => `<div class="stat"><b class="num-t">${v ?? '—'}</b><span>${t}</span></div>`;
    const kv = (o: Record<string, number>) => Object.entries(o ?? {}).map(([k, v]) => `<div class="rule-line"><span>${esc(k)}</span><i class="num-t">${v}</i></div>`).join('');
    el.innerHTML = `<div class="stats">${tile(a.players, 'всего игроков')}${tile(a.active_today, 'зашли сегодня')}${tile(a.new_today, 'новых сегодня')}</div>
      <div class="stats" style="margin-top:var(--s2)">${tile(a.active_7d, 'за 7 дней')}${tile(a.returned_next_day != null ? a.returned_next_day + '%' : '—', 'вернулись на 2-й день')}${tile(a.rtp_7d != null ? a.rtp_7d + '%' : '—', 'отдача прокруток')}</div>
      <div class="stats" style="margin-top:var(--s2)">${tile(a.spins_today, 'прокруток сегодня')}${tile(a.market_7d, 'продаж на рынке')}${tile(a.trades_7d, 'обменов')}</div>
      <div class="group-title">Сколько прокруток сделали игроки</div><div class="rules">${kv(a.spins_buckets)}</div>
      <p class="note" style="text-align:left">Застряли на старте (меньше 10 прокруток): <b>${a.stuck_under_10}</b>. Если их много — новичкам непонятно, что делать.</p>
      <div class="group-title">Редкость за 7 дней</div><div class="rules">${kv(a.tiers_7d)}</div>
      <div class="group-title">По дням</div><div class="rules">${(a.by_day ?? []).map((d: { day: string; spins: number; players: number }) =>
        `<div class="rule-line"><span>${d.day}</span><i class="num-t">${d.players} игр. · ${d.spins} прокр.</i></div>`).join('')}</div>`;
  } catch (e) { el.innerHTML = `<div class="empty">${esc((e as Error).message)}</div>`; }
}

// ---------- обучение новичка: три подсказки ----------
const COACH_KEY = 'zn-coach';
let coachStep = 0;
function coachShow(text: string, target: string) {
  const el = $('coach'), t = document.querySelector(target) as HTMLElement | null;
  $('coach-t').textContent = text;
  el.classList.remove('hidden');
  const r = t?.getBoundingClientRect();
  const below = !!r && r.top < 200; // цель наверху — пузырь под ней
  el.classList.toggle('below', below);
  el.style.setProperty('--y', r ? `${below ? r.bottom + 12 : r.top - 12}px` : '40%');
  document.querySelectorAll('.coach-target').forEach((x) => x.classList.remove('coach-target'));
  t?.classList.add('coach-target');
}
function coachDone() {
  $('coach').classList.add('hidden');
  document.querySelectorAll('.coach-target').forEach((x) => x.classList.remove('coach-target'));
  if (coachStep >= 3) try { localStorage.setItem(COACH_KEY, '1'); } catch { /* */ }
}
function coachStart() {
  let seen = false;
  try { seen = localStorage.getItem(COACH_KEY) === '1'; } catch { /* */ }
  if (seen || S.total_spins > 0) { coachStep = 9; return; }
  coachStep = 1;
  setTimeout(() => coachShow('Жми «Крутить» — выпадет SIM-карта с игровым номером. Первые прокрутки бесплатные.', '#spin'), 700);
}
function coachAfterSpin() {
  if (coachStep === 1) { coachStep = 2; setTimeout(() => coachShow('Красивый номер оставь себе — «В коллекцию». Остальные продаются сами, когда крутишь дальше.', '#b-keep'), 400); }
  else if (coachStep === 2) { coachStep = 3; setTimeout(() => coachShow('Номера в коллекции приносят доход в кассу. Забирай её в меню ☰ — там же бонусы и задания дня.', '#menu'), 400); }
}

// ---------- навигация ----------
const NAV_OF: Record<View, View> = { play: 'play', coll: 'coll', market: 'market', friends: 'friends', more: 'more', rating: 'more', ach: 'more', hist: 'more', feed: 'more', admin: 'more' };
const SUB_VIEWS: View[] = ['rating', 'ach', 'hist', 'feed', 'admin'];
function show(v: View) {
  view = v;
  [...$('nav').children].forEach((x) => x.classList.toggle('on', (x as HTMLElement).dataset.v === NAV_OF[v]));
  for (const k of ['play', 'coll', 'market', 'friends', 'more', 'rating', 'ach', 'hist', 'feed', 'admin']) $('v-' + k).classList.toggle('hidden', v !== k);
  if (v !== 'coll') { mergeMode = false; mergeSel.clear(); }
  if (v !== 'play') coachDone();
  $('dock-play').classList.toggle('hidden', v !== 'play');
  document.body.classList.toggle('on-play', v === 'play');
  if (v !== 'play') autoLeft = 0;
  backButton(v !== 'play', () => show(SUB_VIEWS.includes(v) ? 'more' : 'play'));
  if (v === 'coll') renderColl();
  if (v === 'rating') renderRating();
  if (v === 'market') renderMarket();
  if (v === 'friends') renderFriends();
  if (v === 'more') renderMore();
  if (v === 'ach') renderAch();
  if (v === 'hist') renderHist();
  if (v === 'feed') renderFeed();
  if (v === 'admin') renderAdmin();
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
  $('menu').onclick = () => menuSheet();
  $('slots-pill').onclick = () => { haptic.select(); show('coll'); };
  $('luck-pill').onclick = () => {
    const until = LUCKY_EVERY - (S.total_spins % LUCKY_EVERY);
    toast(until === 1 ? `Следующая прокрутка — удача ×${LUCKY_LUCK}: узоры выпадают в ${LUCKY_LUCK} раз чаще` : `Каждая ${LUCKY_EVERY}-я прокрутка — удача ×${LUCKY_LUCK}. До неё: ${until}`);
  };
  $('banners').onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-b]');
    if (!b) return;
    const k = b.dataset.b;
    if (k === 'kassa') act(b, collectKassa);
    else if (k === 'daily') act(b, claimDaily);
    else if (k === 'quests') questSheet();
    else if (k === 'trades') show('friends');
    else if (k === 'happy') {
      const h = happyInfo();
      toast(h.active ? `Счастливый час: удача ×${HAPPY_LUCK} на все прокрутки до ${happyEnd()} МСК` : `Счастливые часы — 13:00 и 20:00 МСК: целый час удачи ×${HAPPY_LUCK}`);
    }
  };
  $('sel-country').onclick = () => countrySheet();
  $('sel-stake').onclick = () => stakeSheet();
  $('auto').onclick = () => {
    haptic.select();
    if (autoLeft > 0) { autoLeft = 0; autoOn = false; toast('Автоспин остановлен'); }
    else { autoOn = !autoOn; toast(autoOn ? `Автоспин: кнопка крутит ${AUTO_SPINS} раз подряд` : 'Автоспин выключен'); }
    renderSelectors(); renderSpin();
  };
  $('coll').onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    const x = b && collCache.find((s) => s.id === b.dataset.act);
    if (!x || busy) return;
    if (mergeMode) { toggleMergePick(x); return; }
    numberActions(x);
  };
  $('nav').onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b) return;
    haptic.select();
    show(b.dataset.v as View);
  };
  $('rating-tabs').onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-r]');
    if (!b) return;
    ratingWeek = b.dataset.r === 'week'; haptic.select(); renderRating();
  };
  $('coach-ok').onclick = () => coachDone();
  $('market-tabs').onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-m]');
    if (!b) return;
    marketMine = b.dataset.m === 'mine'; marketCache = []; haptic.select(); renderMarket();
  };
  $('market-filter').onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-t]');
    if (!b) return;
    marketTier = b.dataset.t!; haptic.select(); renderMarket();
  };
  $('market').onclick = async (e) => {
    const t = e.target as HTMLElement;
    const buy = t.closest<HTMLElement>('[data-buy]'), cancel = t.closest<HTMLElement>('[data-cancel]');
    if (buy) buyLot(buy.dataset.buy!);
    if (cancel) {
      const l = marketCache.find((x) => x.id === cancel.dataset.cancel);
      const a = await ask('Снять с продажи?', `${l?.sim.label ?? ''} вернётся на витрину и снова будет приносить доход.`, [
        { id: 'ok', label: 'Снять с продажи', kind: 'primary' }, { id: 'cancel', label: 'Оставить на рынке', kind: 'ghost' },
      ]);
      if (a !== 'ok') return;
      await act(null, async () => { const r = await api.lotCancel(cancel.dataset.cancel!); setState(r.state); toast('Номер вернулся на витрину'); });
      renderMarket();
    }
  };
  $('more').onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.tile');
    if (!b) return;
    haptic.select();
    if (b.dataset.soon) toast(b.dataset.soon);
    else if (b.dataset.v === 'quests') questSheet();
    else if (b.dataset.v === 'rules') rulesSheet();
    else show(b.dataset.v as View);
  };
  $('ach').onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-claim]');
    if (!b) return;
    act(b, async () => {
      const r = await api.claim(b.dataset.claim!); setState(r.state); haptic.success(); sfx.coin();
      toast(`Награда: +${rub(r.reward)}` + (r.spins ? ` и ${r.spins} прокр.` : ''));
      await refreshStats();
    });
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
    const st = await api.login();
    isAdmin = !!st.is_admin;
    setState(st);
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
  refreshStats();
  const wp = S.week_prize;
  if (wp) setTimeout(() => { haptic.success(); sfx.win('epic'); toast(`Приз недели: ${wp.place} место! +${rub(wp.prize)}${wp.spins ? ` и ${wp.spins} прокр.` : ''}`); }, 600);
  coachStart();
  setInterval(() => { if (!spinning) { renderBanners(); renderSpin(); renderHud(); if (menuOpen && !busy) renderMenu(); } }, 1000);
  $('splash').classList.add('gone');
}

start();
