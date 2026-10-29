import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Flame, HardHat, Home, Lock, MapPin, Store, X } from 'lucide-react';
import { api, type BrigadeId, type BusinessType, type GameState } from '../api';
import {
  BEST_DISTRICT, DISTRICTS, STAGE_OF, STREET_KEY, cityPlots, cityStage, districtOf, type CityData, type CityPlot, type DistrictKey,
} from '../city/views';
import type { CityRequest, MapPick } from '../city/City';
import { duration, money } from '../format';
import { useLowGraphics, useSimpleStreet } from '../graphics';
import { BizIcon } from './BizIcon';
import { BrigadePicker, brigadeOffer, buildProgress } from './Builds';
import { useNow } from './useTick';

const City = lazy(() => import('../city/City'));
const REFRESH_MS = 120_000;

interface Props {
  game: GameState;
  active: boolean;
  isAdmin: boolean;
  serverOffset: number;
  /** Наехать на участок (из списка строек в «Империи»). */
  focus: { i: number; j: number; k: number; n: number; zoom?: number; district?: boolean } | null;
  onToast: (text: string) => void;
  onBuy: (type: BusinessType, plot: { i: number; j: number; k: number }, brigade: BrigadeId) => Promise<boolean>;
  onUpgrade: (type: BusinessType) => void;
  onOpenCard: (type: BusinessType) => void;
  onSlow?: () => void;
}

const demandWord = (d: number) => (d > 0.66 ? 'высокий' : d > 0.38 ? 'средний' : 'низкий');

/** Вкладка «Карта»: город игрока, районы по капиталу, свои бизнесы, конкуренты и свободные участки. */
export function MapTab({ game, active, isAdmin, serverOffset, focus, onToast, onBuy, onUpgrade, onOpenCard, onSlow }: Props) {
  const simple = useSimpleStreet();
  const low = useLowGraphics();
  const [data, setData] = useState<CityData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [pick, setPick] = useState<MapPick | null>(null);
  const [heat, setHeat] = useState(false);
  const [request, setRequest] = useState<CityRequest>({ n: 0 });
  const [buying, setBuying] = useState<CityPlot | null>(null);
  const [whatHere, setWhatHere] = useState(false);
  const mineAt = useRef(0);

  // Конкуренты в городе — с сервера; обновляем, пока вкладка открыта.
  useEffect(() => {
    if (!active) return;
    let alive = true;
    const load = () =>
      api
        .city()
        .then((r) => alive && setData(r.city))
        .catch(() => {})
        .finally(() => alive && setLoaded(true));
    load();
    const id = window.setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [active]);

  const plots = useMemo(() => cityPlots(game, data), [game, data]);

  // Монетки над своими бизнесами — по настоящей выручке на тике (во время стройки их нет).
  const [coin, setCoin] = useState<{ type: string; amount: number; n: number } | undefined>(undefined);
  const lastSale = useRef<Record<string, string | null> | null>(null);
  useEffect(() => {
    const prev = lastSale.current;
    const now: Record<string, string | null> = {};
    game.businesses.forEach((b) => {
      now[b.type] = b.last_sale_at ?? null;
      const building = game.builds?.some((x) => !x.new && x.type === b.type);
      if (prev && b.last_sale_at && b.last_sale_at !== prev[b.type] && (b.last_revenue ?? 0) > 0 && !building)
        setCoin((c) => ({ type: STREET_KEY[b.type], amount: b.last_revenue ?? 0, n: (c?.n ?? 0) + 1 }));
    });
    lastSale.current = now;
  }, [game.businesses, game.builds]);
  const stage = cityStage(game);
  const caps = game.city?.caps ?? [0, 30_000_000, 100_000_000, 250_000_000];
  const me = useMemo(() => ({ name: game.company?.name ?? game.player.first_name, color: '#D4A73A', me: true }), [game.company?.name, game.player.first_name]);
  const names = Object.fromEntries(game.catalog.map((c) => [c.type, c.name])) as Record<string, string>;
  const openDistricts = (Object.keys(DISTRICTS) as Exclude<DistrictKey, 'park'>[]).filter((d) => STAGE_OF[d] <= stage);
  const nextCap = stage < 4 ? caps[stage] : null;

  const onPick = useCallback((p: MapPick | null) => {
    setPick(p);
    setWhatHere(false);
  }, []);

  // «Следить за стройкой» из «Империи».
  useEffect(() => {
    if (focus) setRequest((r) => ({ focus: { i: focus.i, j: focus.j, k: focus.k, zoom: focus.zoom, district: focus.district }, n: r.n + 1 }));
  }, [focus]);

  // Стройка закончилась у тебя на глазах: здание выпрыгивает, конфетти — и тост.
  const names0 = Object.fromEntries(game.catalog.map((c) => [c.type, c.name])) as Record<string, string>;
  const onFinished = useCallback(
    (p: CityPlot, wasLot: boolean) => {
      if (!p.owner?.me) return;
      onToast(`${wasLot ? 'Открыт новый бизнес' : 'Готово'}: ${names0[p.game ?? ''] ?? ''}, ур. ${p.level}`);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onToast],
  );

  // Пока сервер не прислал конкурентов, город не строим: иначе его пришлось бы сразу пересобрать.
  const ready = loaded || !active;
  const now = useNow(serverOffset, 30_000);
  const mapEvents = useMemo(
    () =>
      (game.events ?? [])
        .filter((e) => new Date(e.starts_at).getTime() <= now && new Date(e.ends_at).getTime() > now)
        .map((e) => ({ district: e.district, bad: e.mult < 1, text: `${e.title.split(':')[0].split(' в ')[0]} · ${e.mult < 1 ? '−' : '+'}${Math.round(Math.abs(e.mult - 1) * 100)}%` })),
    [game.events, now],
  );

  if (!game.city) {
    return <p className="hint center">Карта появится после обновления игры. Закрой и открой игру заново.</p>;
  }

  const mine = plots.filter((p) => p.owner?.me);
  const head = (
    <div className="map-head-pill">
      <b>
        Районов: {openDistricts.length} из 6
      </b>
      <span>{nextCap !== null ? `следующий при ${money(nextCap)}` : 'открыт весь город'}</span>
    </div>
  );
  const placeholder = (
    <div className="city-stage street-placeholder">
      <span>Строим твой город…</span>
    </div>
  );

  return (
    <>
      {simple ? (
        <>
          <section className="card map-head">
            <div className="grow">
              <div className="stat-label">Твой город</div>
              <b>Открыто районов: {openDistricts.length} из 6</b>
              <p className="hint small" style={{ margin: 0 }}>
                {nextCap !== null
                  ? `Следующий район откроется при капитале ${money(nextCap)}. Сейчас ${money(game.capital)}.`
                  : 'Открыт весь город.'}
              </p>
            </div>
          </section>
          <MapList game={game} plots={plots} names={names} onPick={onPick} />
        </>
      ) : (
        <div className="map-wrap">
          {!ready ? (
            placeholder
          ) : (
            <Suspense fallback={placeholder}>
              <City
                seed={game.city.seed}
                stage={stage}
                caps={caps}
                plots={plots}
                me={me}
                heat={heat}
                request={request}
                onPick={onPick}
                serverOffset={serverOffset}
                onFinished={onFinished}
                coin={coin}
                low={low}
                active={active}
                showFps={isAdmin}
                onSlow={onSlow}
                events={mapEvents}
              />
            </Suspense>
          )}
          {head}
          <div className="map-tools" role="toolbar" aria-label="Карта">
            <button className="chip" onClick={() => setRequest({ home: true, n: request.n + 1 })}>
              <Home size={16} /> Обзор
            </button>
            <button
              className="chip"
              disabled={!mine.length}
              onClick={() => {
                // Каждое нажатие — к следующему своему бизнесу.
                const p = mine[mineAt.current % mine.length];
                mineAt.current++;
                if (p) setRequest({ focus: { i: p.i, j: p.j, k: p.k, zoom: 0.8 }, n: request.n + 1 });
              }}
            >
              <MapPin size={16} /> Мои{mine.length > 1 ? ` · ${mine.length}` : ''}
            </button>
            <button className={`chip ${heat ? 'chip-active' : ''}`} aria-pressed={heat} onClick={() => setHeat(!heat)}>
              <Flame size={16} /> Спрос
            </button>
          </div>
        </div>
      )}
      {heat && !simple && (
        <p className="hint small center">
          Цвет участка — спрос рядом: синий — низкий, зелёный — средний, оранжевый и красный — высокий.
        </p>
      )}

      {pick && (
        <PickCard
          game={game}
          pick={pick}
          names={names}
          caps={caps}
          serverOffset={serverOffset}
          onFollow={(p) => setRequest({ focus: { i: p.i, j: p.j, k: p.k }, n: request.n + 1 })}
          whatHere={whatHere}
          onWhatHere={() => setWhatHere(!whatHere)}
          onClose={() => setPick(null)}
          onBuy={(p) => setBuying(p)}
          onUpgrade={onUpgrade}
          onOpenCard={onOpenCard}
        />
      )}

      {buying && (
        <BuyPlotSheet
          game={game}
          plot={buying}
          names={names}
          onClose={() => setBuying(null)}
          onConfirm={async (type, brigade) => {
            const ok = await onBuy(type, { i: buying.i, j: buying.j, k: buying.k }, brigade);
            if (ok) {
              setBuying(null);
              setPick(null);
            }
          }}
        />
      )}
    </>
  );
}

function PickCard({
  game, pick, names, caps, serverOffset, onFollow, whatHere, onWhatHere, onClose, onBuy, onUpgrade, onOpenCard,
}: {
  game: GameState;
  pick: MapPick;
  names: Record<string, string>;
  serverOffset: number;
  onFollow: (p: CityPlot) => void;
  caps: number[];
  whatHere: boolean;
  onWhatHere: () => void;
  onClose: () => void;
  onBuy: (p: CityPlot) => void;
  onUpgrade: (type: BusinessType) => void;
  onOpenCard: (type: BusinessType) => void;
}) {
  // Карточка под картой или списком — прокручиваем к ней, чтобы её было видно.
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [pick]);
  const close = (
    <button className="icon-button" aria-label="Закрыть" onClick={onClose}>
      <X size={18} />
    </button>
  );

  if (pick.kind === 'site') {
    const D = DISTRICTS[pick.district];
    const cap = caps[STAGE_OF[pick.district] - 1] ?? 0;
    return (
      <section className="card map-card" ref={ref}>
        <div className="map-card-head">
          <Lock size={20} className="warn" />
          <div className="grow">
            <b>{D.name}</b>
            <div className="stat-label">Район строится · откроется позже</div>
          </div>
          {close}
        </div>
        <p className="hint small">
          Район откроется, когда капитал компании дойдёт до {money(cap)}. Здесь будет спрос: {D.likes.join(', ')}.
        </p>
        <div className="stats-grid">
          <Stat label="Нужно капитала" value={money(cap)} />
          <Stat label="Сейчас" value={money(game.capital)} />
        </div>
      </section>
    );
  }

  if (pick.kind === 'home') {
    const i = pick.info;
    const D = pick.district && pick.district !== 'park' ? DISTRICTS[pick.district] : null;
    const stats: [string, string][] = i.stats ?? (i.residents
      ? [['Жителей', `≈ ${i.residents}`], ['Этажей', String(i.floors ?? 1)]]
      : [['Работников', `≈ ${i.workers ?? 10}`], ['Этажей', String(i.floors ?? 1)]]);
    return (
      <section className="card map-card" ref={ref}>
        <div className="map-card-head">
          <Home size={20} />
          <div className="grow">
            <b>{i.kind}</b>
            <div className="stat-label">{D ? D.name : 'Городской парк'}</div>
          </div>
          {close}
        </div>
        <p className="hint small">
          {i.note ?? (D ? `Спрос в районе: ${D.likes.join(', ')}. Чем больше жителей рядом, тем больше покупателей у бизнесов по соседству.` : '')}
        </p>
        <div className="stats-grid">
          {stats.map(([l, v]) => (
            <Stat key={l} label={l} value={v} />
          ))}
        </div>
      </section>
    );
  }

  const p = pick.plot;
  const D = DISTRICTS[pick.district];
  const best = D.best;
  if (p.srv) {
    return (
      <BuildCard plot={p} names={names} district={D.name} serverOffset={serverOffset} onFollow={onFollow} onClose={onClose} close={close} r={ref} />
    );
  }
  if (p.lot) {
    const left = game.catalog.filter((c) => !game.businesses.some((b) => b.type === c.type));
    return (
      <section className="card map-card" ref={ref}>
        <div className="map-card-head">
          <span className="lot-dot" aria-hidden />
          <div className="grow">
            <b>Свободный участок</b>
            <div className="stat-label">{D.name} · продаётся</div>
          </div>
          {close}
        </div>
        <p className="hint small">Спрос в районе: {D.likes.join(', ')}. Открой бизнес, который здесь нужен.</p>
        <div className="stats-grid">
          <Stat label="Лучше всего здесь" value={names[best] ?? best} />
          <Stat label="Спрос рядом" value={demandWord(pick.demand)} />
        </div>
        {whatHere && (
          <p className="hint small">
            {D.name}: {D.note}. Лучше всего пойдёт {(names[best] ?? best).toLowerCase()}. Бизнес не по профилю района
            продаёт на {Math.round((1 - (game.city?.other_mult ?? 0.9)) * 100)}% меньше.
          </p>
        )}
        <div className="actions">
          <button className="button small" disabled={!left.length} onClick={() => onBuy(p)}>
            Купить и построить
          </button>
          <button className="button small secondary" onClick={onWhatHere} aria-expanded={whatHere}>
            Что здесь открыть
          </button>
        </div>
        {!left.length && <p className="hint small">У тебя уже есть все виды бизнеса.</p>}
      </section>
    );
  }

  const o = p.owner;
  const type = p.game as BusinessType;
  const biz = o?.me ? game.businesses.find((b) => b.type === type) : undefined;
  const maxLevel = game.upgrade?.max_level ?? 5;
  return (
    <section className="card map-card" ref={ref}>
      <div className="map-card-head">
        <BizIcon type={type} />
        <div className="grow">
          <b>
            {names[type] ?? type} · ур. {p.level}
          </b>
          <div className="stat-label">
            {o?.me ? 'Твой бизнес' : `${o?.name ?? 'Конкурент'} · ${o?.bot ? 'NPC-конкурент' : 'конкурент'}`} · {D.name}
          </div>
        </div>
        {close}
      </div>
      <p className="hint small">
        Район: {D.note}.{' '}
        {BEST_DISTRICT[type] === pick.district ? 'Это лучший район для такого бизнеса.' : `Лучший район для него — ${DISTRICTS[BEST_DISTRICT[type]].name}.`}
      </p>
      <div className="stats-grid">
        <Stat label="Спрос рядом" value={demandWord(pick.demand)} />
        <Stat label={o?.me ? 'Выручка в кассе' : 'Владелец'} value={o?.me ? money(biz?.pending_revenue ?? 0) : o?.name ?? '—'} />
      </div>
      {o?.me && (
        <div className="actions">
          <button className="button small" onClick={() => onOpenCard(type)}>
            <Store size={16} /> Открыть бизнес
          </button>
          <button
            className="button small secondary"
            disabled={(p.level ?? 1) >= maxLevel || type === 'repair' || !!biz?.repair}
            onClick={() => onUpgrade(type)}
          >
            {(p.level ?? 1) >= maxLevel ? 'Максимум' : biz?.repair ? 'Идёт стройка' : 'Улучшить'}
          </button>
        </div>
      )}
    </section>
  );
}

function BuyPlotSheet({
  game, plot, names, onClose, onConfirm,
}: {
  game: GameState;
  plot: CityPlot;
  names: Record<string, string>;
  onClose: () => void;
  onConfirm: (type: BusinessType, brigade: BrigadeId) => void;
}) {
  const d = districtOf(plot.i, plot.j);
  const D = d === 'park' ? null : DISTRICTS[d];
  const owned = new Set(game.businesses.map((b) => b.type));
  const items = game.catalog.filter((c) => !owned.has(c.type));
  const [type, setType] = useState<BusinessType | null>(() => {
    const best = D?.best;
    return items.some((c) => c.type === best) ? (best as BusinessType) : items[0]?.type ?? null;
  });
  const item = items.find((c) => c.type === type);
  const [brigade, setBrigade] = useState<BrigadeId>('standard');
  const offer = item ? brigadeOffer(game, brigade, 1, item.open_cost) : null;
  const full = (game.builds?.length ?? 0) >= (game.build?.max_active ?? 2);
  // Как на сервере: штраф, если лучший район этого бизнеса уже открыт, а ставишь его в другой.
  const offBest = !!type && BEST_DISTRICT[type] !== d && STAGE_OF[BEST_DISTRICT[type]] <= cityStage(game);
  const enough = offer ? game.player.cash >= offer.price : false;

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <h2>Купить и построить</h2>
        <p className="hint small">
          {D?.name}. Лучше всего здесь: <b>{names[D?.best ?? ''] ?? '—'}</b>. Участок бесплатный — платишь только за бизнес.
        </p>
        <div className="catalog-section" role="radiogroup" aria-label="Какой бизнес открыть">
          {items.map((c) => (
            <button
              key={c.type}
              role="radio"
              aria-checked={type === c.type}
              className={`catalog-card pick ${type === c.type ? 'chip-active' : ''}`}
              onClick={() => setType(c.type)}
            >
              <div className="biz-head">
                <BizIcon type={c.type} />
                <div className="grow">
                  <b>{c.name}</b>
                  <div className="stat-label">{D?.best === c.type ? 'Лучше всего здесь' : c.description}</div>
                </div>
                <b className="catalog-price">{money(c.open_cost)}</b>
              </div>
            </button>
          ))}
        </div>
        {offBest && (
          <p className="warning small">
            ▼ Не по профилю района: продажи на {Math.round((1 - (game.city?.other_mult ?? 0.9)) * 100)}% меньше, чем в лучшем районе.
          </p>
        )}
        {item && (
          <>
            <div className="overline">Бригада</div>
            <BrigadePicker game={game} level={1} base={item.open_cost} value={brigade} onChange={setBrigade} />
            <p className="hint small" style={{ margin: 0 }}>
              Деньги списываются сразу. Бизнес заработает, когда бригада закончит: котлован, фундамент, каркас, фасад,
              благоустройство.
            </p>
          </>
        )}
        {full && <p className="warning small">Сейчас идут {game.builds?.length} стройки — это максимум. Дождись, пока одна закончится.</p>}
        {offer && !enough && <p className="warning small">Не хватает денег: нужно {money(offer.price)}, у тебя {money(game.player.cash)}.</p>}
        <button className="button" disabled={!item || !enough || full} onClick={() => type && onConfirm(type, brigade)}>
          {offer ? `Начать стройку за ${money(offer.price)} · ≈ ${duration(offer.minutes * 60000)}` : 'Выбери бизнес'}
        </button>
        <button className="button ghost" onClick={onClose}>
          Закрыть
        </button>
      </div>
    </div>
  );
}

/** Простая графика: вместо 3D — список районов и участков. */
function MapList({ game, plots, names, onPick }: { game: GameState; plots: CityPlot[]; names: Record<string, string>; onPick: (p: MapPick | null) => void }) {
  const stage = cityStage(game);
  return (
    <section className="card map-list">
      <p className="hint small">Простая графика: город списком. 3D-карту можно включить в профиле.</p>
      {(Object.keys(DISTRICTS) as Exclude<DistrictKey, 'park'>[]).map((d) => {
        const D = DISTRICTS[d];
        const open = STAGE_OF[d] <= stage;
        const here = plots.filter((p) => districtOf(p.i, p.j) === d);
        return (
          <div key={d} className="map-district">
            <div className="map-district-head">
              {open ? <MapPin size={16} /> : <Lock size={16} />}
              <b>{D.name}</b>
              <span className="stat-label">{open ? `спрос: ${D.likes.slice(0, 2).join(', ')}` : 'откроется позже'}</span>
            </div>
            {open && (
              <div className="map-district-plots">
                {here.map((p) => (
                  <button
                    key={`${p.i}:${p.j}:${p.k}`}
                    className={`chip ${p.owner?.me ? 'chip-active' : ''}`}
                    onClick={() => onPick({ kind: 'plot', plot: p, district: d, demand: 0.5 })}
                  >
                    {p.srv
                      ? `Стройка: ${names[p.srv.game] ?? p.srv.game}, ур. ${p.srv.level}${p.srv.owner ? '' : ' · твоя'}`
                      : p.lot
                        ? 'Свободный участок'
                        : `${names[p.game ?? ''] ?? p.game} · ур. ${p.level}${p.owner?.me ? ' · твой' : ''}`}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-tile">
      <span className="stat-label">{label}</span>
      <b>{value}</b>
    </div>
  );
}

/** Карточка стройки: что строится, бригада, этап и процент (живьём). Чужая — без кнопок. */
function BuildCard({
  plot, names, district, serverOffset, onFollow, onClose, close, r,
}: {
  plot: CityPlot;
  names: Record<string, string>;
  district: string;
  serverOffset: number;
  onFollow: (p: CityPlot) => void;
  onClose: () => void;
  close: React.ReactNode;
  r: React.RefObject<HTMLElement>;
}) {
  const now = useNow(serverOffset, 1000);
  const b = plot.srv!;
  const pr = buildProgress({ started_at: b.started_at, ends_at: b.ends_at, queued: !!b.queued }, now);
  const mine = !b.owner;
  return (
    <section className="card map-card" ref={r}>
      <div className="map-card-head">
        <HardHat size={20} className="build-icon" />
        <div className="grow">
          <b>
            Стройка: {names[b.game] ?? b.game}, ур. {b.level}
          </b>
          <div className="stat-label">
            {mine ? `Бригада «${b.brigade}»` : `${b.owner?.name} · конкурент`} · {district}
          </div>
        </div>
        {close}
      </div>
      <div className="stats-grid">
        <Stat label="Этап" value={b.queued ? 'в очереди' : pr.stageName} />
        <Stat label="Готово" value={`${Math.round(pr.pct * 100)}%`} />
      </div>
      <div className="bar-track" aria-hidden>
        <div className="bar-fill build" style={{ width: `${Math.round(pr.pct * 100)}%` }} />
      </div>
      <p className="hint small">
        {pr.left > 0 ? `До конца ≈ ${duration(pr.left)}.` : 'Почти готово.'} Этапы: котлован, фундамент, каркас, фасад,
        благоустройство.
      </p>
      {mine && (
        <div className="actions">
          <button className="button small" onClick={() => onFollow(plot)}>
            Следить за стройкой
          </button>
          <button className="button small secondary" onClick={onClose}>
            Закрыть
          </button>
        </div>
      )}
    </section>
  );
}
