import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Flame, Home, Lock, MapPin, Store, X } from 'lucide-react';
import { api, type BusinessType, type GameState } from '../api';
import {
  BEST_DISTRICT, DISTRICTS, STAGE_OF, cityPlots, cityStage, districtOf, type CityData, type CityPlot, type DistrictKey,
} from '../city/views';
import type { CityRequest, MapPick } from '../city/City';
import { money } from '../format';
import { useSimpleStreet } from '../graphics';
import { BizIcon } from './BizIcon';

const City = lazy(() => import('../city/City'));
const REFRESH_MS = 120_000;

interface Props {
  game: GameState;
  active: boolean;
  isAdmin: boolean;
  onBuy: (type: BusinessType, plot: { i: number; j: number; k: number }) => Promise<boolean>;
  onUpgrade: (type: BusinessType) => void;
  onOpenCard: (type: BusinessType) => void;
  onSlow: () => void;
}

const demandWord = (d: number) => (d > 0.66 ? 'высокий' : d > 0.38 ? 'средний' : 'низкий');

/** Вкладка «Карта»: город игрока, районы по капиталу, свои бизнесы, конкуренты и свободные участки. */
export function MapTab({ game, active, isAdmin, onBuy, onUpgrade, onOpenCard, onSlow }: Props) {
  const simple = useSimpleStreet();
  const [data, setData] = useState<CityData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [pick, setPick] = useState<MapPick | null>(null);
  const [heat, setHeat] = useState(false);
  const [request, setRequest] = useState<CityRequest>({ n: 0 });
  const [buying, setBuying] = useState<CityPlot | null>(null);
  const [whatHere, setWhatHere] = useState(false);

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

  // Пока сервер не прислал конкурентов, город не строим: иначе его пришлось бы сразу пересобрать.
  const ready = loaded || !active;

  if (!game.city) {
    return <p className="hint center">Карта появится после обновления игры. Закрой и открой игру заново.</p>;
  }

  return (
    <>
      <section className="card map-head">
        <div className="grow">
          <div className="stat-label">Твой город</div>
          <b>
            Открыто районов: {openDistricts.length} из 6
          </b>
          <p className="hint small" style={{ margin: 0 }}>
            {nextCap !== null
              ? `Следующий район откроется при капитале ${money(nextCap)}. Сейчас ${money(game.capital)}.`
              : 'Открыт весь город.'}
          </p>
        </div>
      </section>

      {simple ? (
        <MapList game={game} plots={plots} names={names} onPick={onPick} />
      ) : !ready ? (
        <div className="city-stage street-placeholder">
          <span>Строим твой город…</span>
        </div>
      ) : (
        <Suspense
          fallback={
            <div className="city-stage street-placeholder">
              <span>Строим твой город…</span>
            </div>
          }
        >
          <City
            seed={game.city.seed}
            stage={stage}
            caps={caps}
            plots={plots}
            me={me}
            heat={heat}
            request={request}
            onPick={onPick}
            active={active}
            showFps={isAdmin}
            onSlow={onSlow}
          />
        </Suspense>
      )}

      {!simple && (
        <div className="chips-row" role="toolbar" aria-label="Карта">
          <button className="chip" onClick={() => setRequest({ home: true, n: request.n + 1 })}>
            <Home size={16} /> Обзор
          </button>
          <button
            className="chip"
            onClick={() => {
              const mine = plots.find((p) => p.owner?.me);
              if (mine) setRequest({ focus: { i: mine.i, j: mine.j, k: mine.k, zoom: 0.8 }, n: request.n + 1 });
            }}
          >
            <MapPin size={16} /> Мои
          </button>
          <button className={`chip ${heat ? 'chip-active' : ''}`} aria-pressed={heat} onClick={() => setHeat(!heat)}>
            <Flame size={16} /> Спрос
          </button>
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
          onConfirm={async (type) => {
            const ok = await onBuy(type, { i: buying.i, j: buying.j, k: buying.k });
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
  game, pick, names, caps, whatHere, onWhatHere, onClose, onBuy, onUpgrade, onOpenCard,
}: {
  game: GameState;
  pick: MapPick;
  names: Record<string, string>;
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
  onConfirm: (type: BusinessType) => void;
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
  // Как на сервере: штраф, если лучший район этого бизнеса уже открыт, а ставишь его в другой.
  const offBest = !!type && BEST_DISTRICT[type] !== d && STAGE_OF[BEST_DISTRICT[type]] <= cityStage(game);
  const enough = item ? game.player.cash >= item.open_cost : false;

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
        {item && !enough && <p className="warning small">Не хватает денег: нужно {money(item.open_cost)}, у тебя {money(game.player.cash)}.</p>}
        <button className="button" disabled={!item || !enough} onClick={() => type && onConfirm(type)}>
          {item ? `Открыть за ${money(item.open_cost)}` : 'Выбери бизнес'}
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
                    {p.lot ? 'Свободный участок' : `${names[p.game ?? ''] ?? p.game} · ур. ${p.level}${p.owner?.me ? ' · твой' : ''}`}
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
