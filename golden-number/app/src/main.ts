import './styles.css';
import {
  BAILOUT_RUB, COUNTRIES, FREE_SPIN_MAX, KASSA_CAP_HOURS, LUCKY_EVERY, LUCKY_LUCK, HAPPY_LUCK, HAPPY_SPINS, SLOTS_MAX, SLOTS_START,
  STAKES, STAKE_LEVEL, countryById, slotPriceRub, type Country,
  KEEP_RULE_DEFAULT, type KeepRule, ACHIEVEMENTS, MARKET_FEE, REF_AFTER_SPINS, REF_NEW_SPINS, REF_REWARD_RUB, REF_REWARD_SPINS, TIERS, inviteLink,
} from '../../supabase/functions/_shared/game/config.ts';
import {
  ruleMatches, achClaimable, achProgress, dailyNow, freeNow, happyNow, incomePerHourKop, kassaTotalKop, lotPriceBounds, priceBreakdown,
  sellBackKop, spinCostKop, tierRank, xpToNext, type Stats,
} from '../../supabase/functions/_shared/game/logic.ts';
import { serverApi } from './api.ts';
import { esc, fmt, fmtMul, local, rub, tierById, tierVar } from './format.ts';
import { Card } from './reels.ts';
import { shareSim } from './share.ts';
import { backButton, copyText, haptic, initData, setupTelegram, shareLink } from './tg.ts';
import type { Api, Lot, Sim, State } from './types.ts';

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
type View = 'play' | 'coll' | 'market' | 'friends' | 'more' | 'rating' | 'ach';
let view: View = 'play';
let collCache: Sim[] = [];
let stats: Stats | null = null;
let marketMine = false;
let marketTier = 'all';
let marketCache: Lot[] = [];
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
const bonusSpins = () => S.bonus_spins ?? 0;
const useFree = () => freeInfo().charges > 0 || bonusSpins() > 0;
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
  $('daily').classList.toggle('hidden', !d.available || $('daily').classList.contains('off'));
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
  const fr = freeInfo(), total = fr.charges + bonusSpins();
  const free = total > 0
    ? `<span class="pill hot">Бесплатных: ${total}</span>`
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
  $('cost').textContent = free
    ? (bonusSpins() > 0 && freeInfo().charges === 0 ? `ещё ${bonusSpins()}` : `${freeInfo().charges} из ${FREE_SPIN_MAX}`)
    : rub(spinCostKop(country, stake));
}

function renderResult(enter = false) {
  const el = $('result');
  const p = S.pending;
  renderTierbar(spinning ? null : p);
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
        <div class="tags">${p.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('') || '<span class="tag">Ничего особенного</span>'}${extra}</div>
        <button class="icon-btn" id="b-share" aria-label="Поделиться картинкой">${icon('i-share')}</button>
      </div>
      ${whyHtml(p)}
      <div class="acts">
        <button class="btn btn-pill btn-pill-dark" id="b-sell">Продать за ${rub(p.value)}</button>
        <button class="btn btn-pill btn-pill-gold" id="b-keep">В коллекцию</button>
      </div>
      <button class="acts-note" id="b-rule">${ruleMatches(keepRule(), p)
        ? (full ? `Подходит под правило, но витрина заполнена (${S.collection_count}/${slotsCap()})` : `Этот номер уйдёт в коллекцию сам · +${rub(incomePerHourKop(p.value))}/ч`)
        : 'Этот номер продастся, когда крутишь следующий'} · <u>что оставлять</u></button>
    </div>`;
  $('b-sell').onclick = (e) => act(e, async () => {
    const r = await api.sell(); setState(r.state); card.clearGlow(); toast('Продано: +' + rub(r.sold));
  });
  $('b-keep').onclick = (e) => act(e, async () => { await keepPending(); });
  // обе кнопки — в одну строку: если «Продать за …» не помещается, оставляем «Продать» (цена и так крупно выше)
  const sell = $('b-sell'), keep = $('b-keep');
  if (sell.offsetTop !== keep.offsetTop) sell.textContent = 'Продать';
  $('b-share').onclick = () => shareSim(c, p);
  $('b-rule').onclick = () => ruleSheet();
}

/** Шкала редкости над карточкой: тир, ступени и цена — как только барабаны остановились. */
function renderTierbar(p: Sim | null) {
  const el = $('tierbar');
  if (!p) { el.classList.add('hidden'); return; }
  const rank = tierRank(p.tier);
  el.classList.remove('hidden');
  el.style.setProperty('--tc', tierVar(p.tier));
  el.innerHTML = `<div><div class="tb-name">${tierById(p.tier).name} · ×${fmtMul(p.mul)}</div>
    <div class="tb-steps">${TIERS.map((_, i) => `<i class="${i <= rank ? 'on' : ''}"></i>`).join('')}</div></div>
    <b>${local(countryById(p.country)!, p.value)}${countryById(p.country)!.cur !== '₽' ? `<small>≈ ${rub(p.value)}</small>` : ''}</b>`;
}

/** «Почему такая цена»: база × страна × узор × бонусы × ставка. */
function whyHtml(p: Sim): string {
  const c = countryById(p.country)!;
  const parts = priceBreakdown(p.prefix, p.sub).filter((x) => x.mul !== 1 || x.label === 'Без узора');
  const bet = p.value / Math.max(1, p.mul) / 380 / 100 / c.mul; // фактическая ставка (у удачной может быть ниже)
  const stakeTxt = Math.abs(bet - Math.round(bet)) < 0.01 ? `×${Math.round(bet)}` : `×${bet.toFixed(2)}`;
  return `<div class="why">Почему столько: <b>380 ₽</b> · страна <b>×${c.mul}</b> · ${parts.map((x) => `${esc(x.label)} <b>×${fmtMul(x.mul)}</b>`).join(' · ')} · ставка <b>${stakeTxt}</b></div>`;
}

async function renderColl() {
  const el = $('coll'), head = $('coll-head');
  const price = slotPriceRub(S.extra_slots) * 100, max = slotsCap() >= SLOTS_MAX;
  head.innerHTML = `<div class="m"><span>Витрина ${S.collection_count}/${slotsCap()} · касса копится ${KASSA_CAP_HOURS} ч</span><b>+${rub(incomePerHourKop(S.collection_value))}/ч</b></div>
    <button class="btn btn-secondary btn-m btn-stack" id="buy-slot" ${max || S.balance < price ? 'disabled' : ''}>${max ? 'Максимум' : 'Ещё место'}${max ? '' : `<span class="sub">${rub(price)}</span>`}</button>`;
  head.insertAdjacentHTML('beforeend', `<button class="rule-row" id="coll-rule">Сами уходят в коллекцию: <b>${ruleText(keepRule())}</b> ›</button>`);
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
      return `<div class="row tap" style="--tc:${tierVar(x.tier)}" data-act="${x.id}">
        <div class="m"><div class="n">${esc(x.label)}</div>
          <div class="s"><span class="dot"></span>${tier.name} · ${c.flag} ${esc(x.operator)}</div></div>
        <div class="price">${rub(x.value)}<small>+${rub(incomePerHourKop(x.value))}/ч</small></div></div>`;
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

const keepRule = (): KeepRule => S.keep_rule ?? KEEP_RULE_DEFAULT;

/** Прошлый номер подходит под правило «оставлять», а витрина полна — спросить, что делать. go: можно продолжать. */
async function confirmPending(action: string): Promise<{ go: boolean; autosellOk: boolean }> {
  const p = S.pending;
  if (!p || !ruleMatches(keepRule(), p) || S.collection_count < slotsCap()) return { go: true, autosellOk: false };
  const a = await ask('Витрина заполнена', `${p.label} · ${tierById(p.tier).name} · ${rub(p.value)} подходит под правило «оставлять», но ему нет места. ${action}`, [
    { id: 'keep', label: 'Освободить место или купить', kind: 'primary' },
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
    <div class="sheet-btns" style="margin-top:var(--s3)"><button class="btn btn-pill btn-pill-gold btn-l" id="rule-price">Оставлять по цене${r.mode === 'price' ? ' ✓' : ''}</button>
      <button class="btn btn-ghost btn-l" id="rule-close">Закрыть</button></div>`;
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
    { id: 'lot', label: 'Выставить на рынок', sub: 'за свою цену, 5% комиссии', kind: 'secondary' },
    { id: 'sell', label: `Продать игре за ${rub(sellBackKop(x.value))}`, sub: '70% оценки', kind: 'secondary' },
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
    <div class="sheet-btns"><button class="btn btn-primary btn-l" id="lot-ok">Выставить</button><button class="btn btn-ghost btn-l" id="lot-cancel">Отмена</button></div>`;
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
      ${f.list.length ? `<div class="group-title">Твои друзья</div><div class="list">${f.list.map((x) => `<div class="row">
        <span class="avatar">${esc((x.name || 'И').slice(0, 1).toUpperCase())}</span>
        <div class="m"><div class="n" style="font-family:var(--font)">${esc(x.name || 'Игрок')}</div>
          <div class="s">${x.counted ? 'засчитан ✓' : `прокруток ${Math.min(x.spins, REF_AFTER_SPINS)} из ${REF_AFTER_SPINS}`}</div></div></div>`).join('')}</div>` : ''}`;
    bindFriendButtons(link);
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
const TILES = [
  { v: 'rating', title: 'Рейтинг', sub: 'топ коллекций', icon: 'i-cup', bg: 'linear-gradient(135deg,#f6b833,#ff8a12)' },
  { v: 'ach', title: 'Достижения', sub: 'коллекции регионов', icon: 'i-medal', bg: 'linear-gradient(135deg,#4ade80,#16a34a)' },
  { soon: 'Магазин за звёзды Telegram — скоро', title: 'Магазин', sub: 'скоро', icon: 'i-star', bg: 'linear-gradient(135deg,#fbbf24,#f59e0b)' },
  { soon: 'Сезоны с наградами — скоро', title: 'Сезоны', sub: 'скоро', icon: 'i-flag', bg: 'linear-gradient(135deg,#b38cff,#7c5cc4)' },
  { soon: 'Кланы — скоро', title: 'Кланы', sub: 'скоро', icon: 'i-shield', bg: 'linear-gradient(135deg,#38bdf8,#2563eb)' },
];
function renderMore() {
  const n = stats ? achClaimable(stats).length : 0;
  $('more').innerHTML = TILES.map((t) => `<button class="tile ${t.soon ? 'soon' : ''}" ${t.v ? `data-v="${t.v}"` : `data-soon="${t.soon}"`}>
      <span class="ti" style="background:${t.bg}">${icon(t.icon)}</span><b>${t.title}</b><span>${t.v === 'ach' && n ? `можно забрать: ${n}` : t.sub}</span>
      ${t.v === 'ach' && n ? `<i class="badge">${n}</i>` : ''}</button>`).join('');
}

// ---------- достижения ----------
async function refreshStats() {
  try { stats = await api.stats(); } catch { return; }
  const n = achClaimable(stats).length;
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
        ${!claimed && !done ? `<div class="bar"><i style="width:${Math.min(100, (p.have / p.need) * 100)}%"></i></div>` : ''}</div>
      ${done && !claimed ? `<button class="btn btn-ok btn-m" data-claim="${a.id}">Забрать</button>` : ''}</div>`;
  }).join('')).join('');
}

// ---------- навигация ----------
const NAV_OF: Record<View, View> = { play: 'play', coll: 'coll', market: 'market', friends: 'friends', more: 'more', rating: 'more', ach: 'more' };
function show(v: View) {
  view = v;
  [...$('nav').children].forEach((x) => x.classList.toggle('on', (x as HTMLElement).dataset.v === NAV_OF[v]));
  for (const k of ['play', 'coll', 'market', 'friends', 'more', 'rating', 'ach']) $('v-' + k).classList.toggle('hidden', v !== k);
  $('spin').classList.toggle('hidden', v !== 'play');
  // касса и бонус — только там, где играют и копят
  $('kassa').classList.toggle('hidden', v !== 'play' && v !== 'coll');
  $('daily').classList.toggle('off', v !== 'play');
  backButton(v !== 'play', () => show(v === 'rating' || v === 'ach' ? 'more' : 'play'));
  if (v === 'coll') renderColl();
  if (v === 'rating') renderRating();
  if (v === 'market') renderMarket();
  if (v === 'friends') renderFriends();
  if (v === 'more') renderMore();
  if (v === 'ach') renderAch();
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
  $('coll').onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    const x = b && collCache.find((s) => s.id === b.dataset.act);
    if (x && !busy) numberActions(x);
  };
  $('nav').onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b) return;
    haptic.select();
    show(b.dataset.v as View);
  };
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
    if (b.dataset.soon) toast(b.dataset.soon); else show(b.dataset.v as View);
  };
  $('ach').onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-claim]');
    if (!b) return;
    act(b, async () => {
      const r = await api.claim(b.dataset.claim!); setState(r.state); haptic.success();
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
  refreshStats();
  setInterval(() => { if (!spinning) { renderKassa(); renderLuck(); renderDaily(); renderSpin(); } }, 1000);
  $('splash').classList.add('gone');
}

start();
