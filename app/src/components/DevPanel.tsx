import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  BarChart3, Bot, CalendarCheck, CalendarClock, HardHat, Map as MapIcon, Package, ShieldAlert, Clock, Coins, Eye, FastForward, Play, RotateCcw, ScrollText, Store, UserPlus, Users,
  Warehouse, Wrench,
} from 'lucide-react';
import { api, type DevInfo, type GameState } from '../api';
import { BOT_KIND } from '../content';
import { count, duration, money } from '../format';
import { feel, notify } from '../telegram';
import { CompanyLogo } from './CompanyLogo';
import { DevBadge } from './DevBadge';
import { streetDev } from '../street/views';
import { setGraphics, useGraphics } from '../graphics';

interface Props {
  game: GameState;
  onState: (s: GameState) => void;
  onToast: (text: string, error?: boolean) => void;
}

const PRODUCTS = [
  { id: 'coffee', label: 'Кофе' },
  { id: 'bread', label: 'Хлеб (магазин)' },
  { id: 'flour', label: 'Мука' },
  { id: 'baked', label: 'Хлеб (пекарня)' },
];

const FLAG_LABELS: Record<string, string> = {
  friends: 'друзья',
  frequent: 'частые сделки',
  big_share: '>30% капитала',
};

const ACTIONS: Record<string, string> = {
  cash_add: 'Деньги +',
  cash_set: 'Деньги =',
  stock_fill: 'Склады заполнены',
  stock_clear: 'Склады очищены',
  stock_add: 'Товар добавлен',
  open_business: 'Бизнес бесплатно',
  campaigns_add: 'Выданы кампании',
  parcels_add: 'Фоновые посылки',
  finish_repairs: 'Ремонты завершены',
  finish_builds: 'Стройки достроены',
  new_event: 'Событие в городе',
  daily_reset: 'Новые задания дня',
  build_speed: 'Скорость строек',
  set_level: 'Уровень бизнеса',
  ticks: 'Тики рынка',
  new_decision: 'Новое решение дня',
  test_player_create: 'Создан тестовый игрок',
  test_players_delete: 'Тестовые игроки удалены',
  bots: 'Число ботов',
  befriend: 'Друг-тестер',
  badge: 'Значок DEV',
  reset_me: 'Сброс аккаунта',
};

/** Панель разработчика. Видна только администраторам; каждое действие проверяет сервер. */
export function DevPanel({ game, onState, onToast }: Props) {
  const [info, setInfo] = useState<DevInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [product, setProduct] = useState('coffee');
  const [qty, setQty] = useState('100');
  const [ticks, setTicks] = useState('12');
  const [parcels, setParcels] = useState('50');
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    api
      .devInfo()
      .then((r) => setInfo(r.dev))
      .catch((e) => setError((e as Error).message));
  }, []);

  const run = useCallback(
    async (op: string, params: Record<string, unknown> = {}) => {
      if (busy) return;
      setBusy(true);
      try {
        const res = await api.dev(op, params);
        onState(res);
        setInfo(res.dev);
        feel(op.startsWith('cash') ? 'collect' : 'purchase');
        if (res.result) onToast(res.result);
      } catch (e) {
        notify('error');
        onToast((e as Error).message, true);
      } finally {
        setBusy(false);
      }
    },
    [busy, onState, onToast],
  );

  if (error) return <p className="warning">{error}</p>;
  if (!info) return <p className="hint center">Загружаем панель…</p>;

  const rub = Math.round(Number(amount.replace(/\s/g, '').replace(',', '.')) * 100);
  const amountOk = Number.isFinite(rub) && amount.trim() !== '';
  const owned = new Set(game.businesses.map((b) => b.type));
  const seasonLeft = info.season ? new Date(info.season.ends_at).getTime() - Date.now() : 0;

  return (
    <>
      <section className="card dev-hero">
        <div className="dev-hero-head">
          <Wrench size={22} />
          <h2>Режим разработчика</h2>
          <DevBadge />
        </div>
        <p className="hint small">
          Каждое действие проверяется сервером и пишется в журнал. Выдано из панели:{' '}
          <b>{money(info.me.dev_cash_total)}</b>
        </p>
      </section>

      <DevSection icon={<Coins size={18} />} title="Деньги">
        <div className="dev-row">
          {[1_000_000, 10_000_000, 100_000_000].map((k) => (
            <button key={k} className="chip" disabled={busy} onClick={() => run('cash_add', { amount: k })}>
              +{money(k)}
            </button>
          ))}
        </div>
        <input
          className="input"
          inputMode="decimal"
          placeholder="Сумма в рублях"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <div className="actions">
          <button className="button small" disabled={busy || !amountOk} onClick={() => run('cash_add', { amount: rub })}>
            Добавить
          </button>
          <button
            className="button small secondary"
            disabled={busy || !amountOk || rub < 0}
            onClick={() => run('cash_set', { amount: rub })}
          >
            Установить точно
          </button>
        </div>
      </DevSection>

      <DevSection icon={<Warehouse size={18} />} title="Склады">
        <div className="actions">
          <button className="button small secondary" disabled={busy} onClick={() => run('stock_fill')}>
            Заполнить все
          </button>
          <button className="button small secondary" disabled={busy} onClick={() => run('stock_clear')}>
            Очистить все
          </button>
        </div>
        <div className="dev-row">
          {PRODUCTS.map((p) => (
            <button
              key={p.id}
              className={`chip ${product === p.id ? 'chip-active' : ''}`}
              onClick={() => setProduct(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="actions">
          <input className="input" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
          <button
            className="button small"
            disabled={busy || !(Number(qty) > 0)}
            onClick={() => run('stock_add', { product, qty: Math.floor(Number(qty)) })}
          >
            Добавить
          </button>
        </div>
      </DevSection>

      <DevSection icon={<Store size={18} />} title="Бизнесы">
        <div className="dev-row">
          {game.catalog.map((c) => (
            <button
              key={c.type}
              className="chip"
              disabled={busy || owned.has(c.type)}
              onClick={() => run('open_business', { type: c.type })}
            >
              {owned.has(c.type) ? `${c.name} ✓` : `Открыть: ${c.name}`}
            </button>
          ))}
        </div>
        {owned.has('agency') && (
          <button className="button small secondary" disabled={busy} onClick={() => run('campaigns', { n: 10 })}>
            Выдать 10 кампаний в агентство
          </button>
        )}
        <button className="button small secondary" disabled={busy} onClick={() => run('finish_repairs')}>
          Мгновенно завершить мои ремонты
        </button>
        {game.businesses
          .filter((b) => b.type !== 'repair' && b.level !== undefined)
          .map((b) => (
            <div key={b.type} className="dev-row">
              <span className="stat-label" style={{ minWidth: 110 }}>
                {game.catalog.find((c) => c.type === b.type)?.name}
              </span>
              {Array.from({ length: game.upgrade?.max_level ?? 5 }, (_, i) => i + 1).map((lvl) => (
                <button
                  key={lvl}
                  className={`chip ${b.level === lvl ? 'chip-active' : ''}`}
                  disabled={busy || b.level === lvl}
                  onClick={() => run('set_level', { type: b.type, level: lvl })}
                >
                  ур. {lvl}
                </button>
              ))}
            </div>
          ))}
      </DevSection>

      <DevSection icon={<HardHat size={18} />} title="Стройки">
        <p className="hint small">
          Идёт строек: {(game.builds ?? []).length} из {game.build?.max_active ?? 2}. Скорость твоих новых строек: ×
          {game.build?.speed ?? 1}.
        </p>
        <div className="actions">
          <button className="button small" disabled={busy || !(game.builds ?? []).length} onClick={() => run('finish_builds')}>
            Достроить сейчас
          </button>
          <button
            className="button small secondary"
            disabled={busy}
            onClick={() => run('build_speed', { fast: (game.build?.speed ?? 1) === 1 })}
          >
            {(game.build?.speed ?? 1) === 1 ? 'Стройки ×60' : 'Обычная скорость'}
          </button>
        </div>
      </DevSection>

      <DevSection icon={<CalendarCheck size={18} />} title="Задания и события">
        <p className="hint small">
          Событие: {(game.events ?? [])[0]?.title ?? 'нет'}. Заданий сегодня: {game.daily?.items.length ?? 0}.
        </p>
        <div className="actions">
          <button className="button small" disabled={busy} onClick={() => run('new_event')}>
            Событие сейчас
          </button>
          <button className="button small secondary" disabled={busy} onClick={() => run('daily_reset')}>
            Новые задания
          </button>
        </div>
      </DevSection>

      <DevStreet />

      <DevSection icon={<Clock size={18} />} title="Время">
        <div className="actions">
          <button className="button small secondary" disabled={busy} onClick={() => run('ticks', { n: 1 })}>
            <Play size={16} /> Тик сейчас
          </button>
          <button className="button small secondary" disabled={busy} onClick={() => run('new_decision')}>
            <CalendarClock size={16} /> Новое решение
          </button>
        </div>
        <div className="actions">
          <input className="input" inputMode="numeric" value={ticks} onChange={(e) => setTicks(e.target.value)} />
          <button
            className="button small"
            disabled={busy || !(Number(ticks) >= 1 && Number(ticks) <= 100)}
            onClick={() => run('ticks', { n: Math.floor(Number(ticks)) })}
          >
            <FastForward size={16} /> Промотать
          </button>
        </div>
        <p className="hint small">Тики идут для всего города: продажи получат все игроки. До 100 за раз.</p>
      </DevSection>

      <DevSection icon={<CalendarClock size={18} />} title="Сезон">
        {info.season ? (
          <p className="dev-line">
            Сезон {info.season.number}
            {info.season.theme === 'crisis' && ' · Кризис'} · до конца <b>{seasonLeft > 0 ? duration(seasonLeft) : 'итоги'}</b>
          </p>
        ) : (
          <p className="hint small">Активного сезона нет</p>
        )}
      </DevSection>

      <DevSection icon={<Users size={18} />} title={`Тестовые игроки · ${info.test_players.length} из 5`}>
        {info.test_players.length > 0 && (
          <ul className="list">
            {info.test_players.map((p) => (
              <li key={p.id}>
                <span className="dev-player">
                  <CompanyLogo icon={p.icon} color={p.color} size={32} />
                  <span>
                    <b>{p.name}</b>
                    <span className="stat-label"> · {money(p.cash)}</span>
                  </span>
                </span>
                {p.friend ? (
                  <span className="tag gold">Мой друг</span>
                ) : (
                  <button
                    className="icon-button"
                    aria-label="Засчитать как приглашённого друга"
                    disabled={busy}
                    onClick={() => run('befriend', { player: p.id })}
                  >
                    <UserPlus size={18} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="actions">
          <button
            className="button small"
            disabled={busy || info.test_players.length >= 5}
            onClick={() => run('test_create')}
          >
            Создать
          </button>
          <button
            className="button small secondary"
            disabled={busy || info.test_players.length === 0}
            onClick={() => run('test_delete_all')}
          >
            Удалить всех
          </button>
        </div>
        <p className="hint small">
          Не видны в рейтингах и не забирают покупателей у настоящих игроков. Торговать на рынке игроков они начнут на
          следующем этапе.
        </p>
      </DevSection>

      <DevSection icon={<Package size={18} />} title="Посылки и NPC в новых нишах">
        <div className="actions">
          <input className="input" inputMode="numeric" value={parcels} onChange={(e) => setParcels(e.target.value)} />
          <button
            className="button small"
            disabled={busy || !(Number(parcels) >= 1 && Number(parcels) <= 10000)}
            onClick={() => run('parcels', { n: Math.floor(Number(parcels)) })}
          >
            Добавить посылки
          </button>
        </div>
        <p className="hint small">Фоновые посылки сразу раскладываются по ПВЗ игроков, пропорционально полкам.</p>
        {info.npc_niches && (
          <ul className="list">
            {info.npc_niches.map((n) => (
              <li key={n.name} className={n.active ? '' : 'dim'}>
                <span>
                  {n.name}{' '}
                  <span className="stat-label">
                    · {n.kind === 'marketplace' ? 'маркетплейс' : n.kind === 'pvz' ? 'ПВЗ' : 'агентство'}
                  </span>
                </span>
                <span>
                  {n.active
                    ? n.kind === 'agency'
                      ? 'работает'
                      : `${n.last_count} ${n.kind === 'pvz' ? 'посылок' : 'продаж'} за тик`
                    : `ушёл (игроков ≥ ${n.max_players})`}
                </span>
              </li>
            ))}
          </ul>
        )}
        {info.live_players !== undefined && (
          <p className="hint small">Живых игроков за сутки: {info.live_players}. NPC уходят, когда игроков становится больше их порога.</p>
        )}
      </DevSection>

      {info.analytics && (
        <DevSection icon={<BarChart3 size={18} />} title="Аналитика бизнесов">
          <ul className="list">
            {info.analytics.map((a) => (
              <li key={a.type}>
                <span>
                  <b>{a.name}</b>
                  <div className="stat-label">
                    открыто {count(a.opened)} (за 7 дн. {count(a.opened_7d)}) · сейчас у {count(a.owners)}
                  </div>
                </span>
                <span className="right">
                  <b>{money(a.revenue_7d)}</b>
                  <div className="stat-label">7 дн. · сегодня {money(a.revenue_1d)}</div>
                </span>
              </li>
            ))}
          </ul>
          <p className="hint small">Выручка всех игроков, кроме тестовых: продажи, посылки, кампании, заказы бригад.</p>
        </DevSection>
      )}

      <DevSection icon={<Bot size={18} />} title="Рынок и боты">
        {info.markets.map((m) => (
          <div key={m.market} className="dev-market">
            <div className="dev-line">
              <b>Рынок: {m.name}</b> · цена {money(m.market_price)} · спрос ×{String(m.demand_level).replace('.', ',')} ·
              покупателей {count(m.last_demand)}
            </div>
            <div className="dev-row">
              {[null, 0, 1, 2, 3].map((n) => (
                <button
                  key={String(n)}
                  className={`chip ${m.bot_override === n ? 'chip-active' : ''}`}
                  disabled={busy}
                  onClick={() => run('bots', { market: m.market, count: n })}
                >
                  {n === null ? 'Авто' : `${n} бот.`}
                </button>
              ))}
            </div>
            <ul className="list">
              {m.bots.map((b) => (
                <li key={b.name} className={b.active ? '' : 'dim'}>
                  <span>
                    {b.name} <span className="stat-label">· {BOT_KIND[b.kind as keyof typeof BOT_KIND]}</span>
                  </span>
                  <span>
                    {b.active ? `${money(b.price)} · ${b.last_sold} шт.` : 'не работает'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </DevSection>

      <DevSection icon={<Eye size={18} />} title="Значок DEV">
        <label className="toggle-row">
          <span className="grow">
            <b>Показывать значок DEV</b>
            <span className="stat-label">В рейтинге, карточке компании и на рынке</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            className="switch"
            checked={info.me.show_dev_badge}
            disabled={busy}
            onChange={(e) => run('badge', { show: e.target.checked })}
          />
        </label>
      </DevSection>

      <DevSection icon={<RotateCcw size={18} />} title="Сброс">
        <p className="hint small">
          Аккаунт станет как у нового игрока: 100 000 ₽, без бизнесов, достижений и компании (её нужно будет создать
          заново).
        </p>
        <button
          className={`button small ${confirmReset ? 'danger' : 'secondary'}`}
          disabled={busy}
          onClick={() => {
            if (!confirmReset) {
              setConfirmReset(true);
              window.setTimeout(() => setConfirmReset(false), 5000);
              return;
            }
            setConfirmReset(false);
            run('reset_me');
          }}
        >
          {confirmReset ? 'Точно сбросить? Нажми ещё раз' : 'Сбросить мой аккаунт'}
        </button>
      </DevSection>

      <DevSection icon={<ScrollText size={18} />} title="Журнал разработчика">
        {info.log.length === 0 ? (
          <p className="hint small">Пока пусто.</p>
        ) : (
          <ul className="list dev-log">
            {info.log.map((l, i) => (
              <li key={i}>
                <span>
                  <b>{ACTIONS[l.action] ?? l.action}</b>
                  <span className="stat-label"> {describe(l.details)}</span>
                  <div className="stat-label">
                    {new Date(l.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}{' '}
                    · {l.admin}
                  </div>
                </span>
                {l.amount !== null && (
                  <b className={l.amount >= 0 ? 'up' : 'down'}>
                    {l.amount >= 0 ? '+' : '−'}
                    {money(Math.abs(l.amount))}
                  </b>
                )}
              </li>
            ))}
          </ul>
        )}
      </DevSection>

      <DevSection icon={<ShieldAlert size={18} />} title={`Сделки рынка · на проверку за сутки: ${info.flagged_24h ?? 0}`}>
        {!info.trades || info.trades.length === 0 ? (
          <p className="hint small">Сделок пока не было.</p>
        ) : (
          <ul className="list dev-log">
            {info.trades.map((t, i) => (
              <li key={i}>
                <span>
                  <b>
                    {t.seller} → {t.buyer}
                  </b>
                  <span className="stat-label">
                    {' '}
                    · {t.product} × {t.qty} по {money(t.price)}
                  </span>
                  {t.flags.length > 0 && (
                    <div className="flags">
                      {t.flags.map((f) => (
                        <span key={f} className="tag warn small-tag">
                          {FLAG_LABELS[f] ?? f}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="stat-label">
                    {new Date(t.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    {t.fee > 0 && ` · комиссия ${money(t.fee)}`}
                  </div>
                </span>
                <b>{money(t.total)}</b>
              </li>
            ))}
          </ul>
        )}
      </DevSection>
    </>
  );
}

/** Вид: только на этом телефоне — сервер и игра не меняются. */
function DevStreet() {
  const dev = useSyncExternalStore(streetDev.subscribe, streetDev.get);
  const graphics = useGraphics();
  const choice = (value: boolean | undefined, label: string) => (
    <button
      key={label}
      className={`chip ${dev.day === value ? 'chip-active' : ''}`}
      onClick={() => streetDev.set({ day: value })}
    >
      {label}
    </button>
  );

  return (
    <DevSection icon={<MapIcon size={18} />} title="Вид">
      <p className="hint small">
        Только вид на этом телефоне: игра и сервер не меняются. Счётчик FPS и вызовов отрисовки — в углу карты.
      </p>
      <span className="stat-label">Время суток на карте</span>
      <div className="dev-row">
        {choice(undefined, 'По часам')}
        {choice(true, 'День')}
        {choice(false, 'Ночь')}
      </div>
      <label className="toggle-row">
        <span className="grow">
          <b>Простая графика (2D)</b>
          <span className="stat-label">Принудительно, как на слабом телефоне</span>
        </span>
        <input
          type="checkbox"
          role="switch"
          className="switch"
          checked={graphics === '2d'}
          onChange={(e) => setGraphics(e.target.checked ? '2d' : 'auto')}
        />
      </label>
    </DevSection>
  );
}

function DevSection({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="card dev-section">
      <h3 className="dev-title">
        <span className="dev-icon">{icon}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function describe(d: Record<string, unknown>): string {
  const parts: string[] = [];
  if (d.product) parts.push(String(d.product));
  if (d.added !== undefined) parts.push(`+${d.added} шт.`);
  if (d.type) parts.push(String(d.type));
  if (d.n !== undefined) parts.push(`×${d.n}`);
  if (d.market) parts.push(`${d.market}: ${d.count ?? 'авто'}`);
  if (d.count !== undefined && !d.market) parts.push(String(d.count));
  if (d.show !== undefined) parts.push(d.show ? 'вкл' : 'выкл');
  return parts.join(' · ');
}
