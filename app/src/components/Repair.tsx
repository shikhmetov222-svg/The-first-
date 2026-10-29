import { useEffect, useState } from 'react';
import { ArrowUpCircle, Bot, Clock, Hammer, Info, Star } from 'lucide-react';
import { api, type Business, type BusinessType, type CatalogItem, type GameState, type RepairOffer, type RepairOffers } from '../api';
import { count, duration, money } from '../format';
import { capOf } from '../market';
import { selectionTick } from '../telegram';
import { BizIcon } from './BizIcon';
import { CompanyLogo } from './CompanyLogo';
import { DevBadge } from './DevBadge';
import { buildProgress } from './Builds';

/** «ур. 2» рядом с названием бизнеса. */
export function LevelTag({ business }: { business: Business | undefined }) {
  if (!business?.level || business.type === 'repair') return null;
  return <span className="lvl-tag">ур. {business.level}</span>;
}

/** Полоска на карточке: идёт ремонт (с таймером) или кнопка «Улучшить». */
export function UpgradeStrip({
  business, game, serverOffset, busy, onOpen,
}: {
  business: Business;
  game: GameState;
  serverOffset: number;
  busy: boolean;
  onOpen: () => void;
}) {
  const cfg = game.upgrade;
  if (!cfg || business.type === 'repair' || business.level === undefined) return null;
  // Стройка бригадой города: этап и процент по времени сервера.
  const b = game.builds?.find((x) => !x.new && x.type === business.type);
  if (b && !business.repair) {
    const p = buildProgress(b, Date.now() + serverOffset);
    return (
      <div className="ad-strip repair-on">
        <Hammer size={15} />
        <span>
          Стройка до ур. {b.level} · {p.stageName} · {Math.round(p.pct * 100)}%
        </span>
        <span className="ad-timer">{p.left > 0 ? `≈ ${duration(p.left)}` : 'вот-вот'}</span>
      </div>
    );
  }
  const r = business.repair;
  if (r) {
    const left = new Date(r.finish_at).getTime() - (Date.now() + serverOffset);
    return (
      <div className="ad-strip repair-on">
        <Hammer size={15} />
        <span>
          Ремонт до ур. {r.to_level} · {r.contractor ?? 'бригада'}
          {r.status === 'queued' ? ' · в очереди' : ''}
        </span>
        <span className="ad-timer">{left > 0 ? `≈ ${duration(left)}` : 'вот-вот'}</span>
      </div>
    );
  }
  if (business.level >= cfg.max_level) return null;
  const cost = cfg.costs?.[business.type];
  return (
    <button className="ad-strip ad-off" disabled={busy || business.listed} onClick={onOpen}>
      <ArrowUpCircle size={15} /> Улучшить до ур. {business.level + 1}
      {cost ? <span className="ad-timer muted-timer">от {money(cost)}</span> : null}
    </button>
  );
}

function ratingText(o: RepairOffer): string {
  if (o.kind === 'npc') return o.time_mult ? `бригада города · время ×${String(o.time_mult).replace('.', ',')}` : 'всегда свободен';
  if (o.rating === null) return 'новая бригада';
  return `вовремя ${Math.round(o.rating * 100)}%${o.done ? ` · ${count(o.done)} заказов` : ''}`;
}

/** Улучшение: что даст уровень, сколько стоит и выбор подрядчика. */
export function UpgradeSheet({
  game, type, busy, onOrder, onClose,
}: {
  game: GameState;
  type: BusinessType;
  busy: boolean;
  onOrder: (contractor: string) => void;
  onClose: () => void;
}) {
  const [data, setData] = useState<RepairOffers | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<RepairOffer | null>(null);
  const item = game.catalog.find((c) => c.type === type)!;
  const business = game.businesses.find((b) => b.type === type);

  useEffect(() => {
    api
      .repairOffers(type)
      .then((r) => {
        setData(r.offers);
        setPick(r.offers.offers.find((o) => !o.full) ?? null);
      })
      .catch((e) => setError((e as Error).message));
  }, [type]);

  const cash = game.player.cash;
  const capNow = capOf(item, business);
  const capNext = data ? Math.floor(item.capacity * (1 + data.capacity_step * (data.to_level - 1))) : capNow;

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <h2>
          <BizIcon type={type} size={18} /> {item.name}
        </h2>
        {error ? (
          <p className="warning">{error}</p>
        ) : !data ? (
          <p className="hint center">Ищем подрядчиков…</p>
        ) : data.active ? (
          <p className="warning">Этот бизнес уже строится.</p>
        ) : (
          <>
            <div className="calc">
              <div>
                <span>Уровень</span>
                <b>
                  {data.level} → {data.to_level}
                </b>
              </div>
              <div>
                <span>Склад</span>
                <b className="up">
                  {count(capNow)} → {count(capNext)}
                </b>
              </div>
              <div>
                <span>Продажи</span>
                <b className="up">▲ +{Math.round(data.sales_step * 100)}%</b>
              </div>
              <div>
                <span>Улучшение (материалы)</span>
                <b>{money(data.cost)}</b>
              </div>
            </div>
            <div className="overline">Бригада для стройки</div>
            {data.max_builds !== undefined && (data.builds ?? 0) >= data.max_builds && (
              <p className="warning small" style={{ margin: 0 }}>
                Сейчас идут {data.builds} стройки — это максимум. Дождись, пока одна закончится.
              </p>
            )}
            <div className="ad-options">
              {data.offers.map((o) => {
                const total = data.cost + o.fee;
                const disabled = o.full || cash < total;
                return (
                  <button
                    key={o.kind + (o.id ?? '')}
                    className={`ad-option ${pick === o ? 'ad-option-active' : ''}`}
                    disabled={disabled}
                    onClick={() => {
                      selectionTick();
                      setPick(o);
                    }}
                  >
                    {o.kind === 'npc' ? (
                      <span className="logo-fallback bot-logo">
                        <Bot size={18} />
                      </span>
                    ) : o.kind === 'self' ? (
                      <BizIcon type="repair" size={18} />
                    ) : o.icon ? (
                      <CompanyLogo icon={o.icon} color={o.color ?? 'gold'} size={36} />
                    ) : (
                      <span className="logo-fallback">{o.name.slice(0, 1).toUpperCase()}</span>
                    )}
                    <span className="grow">
                      <b>
                        {o.kind === 'npc' ? `«${o.name}»` : o.name}
                        {o.dev && <DevBadge />}
                        {o.test && <span className="tag small-tag">тест</span>}
                      </b>
                      <span className="stat-label">
                        <Clock size={11} /> {o.full ? 'очередь полна' : `≈ ${duration(o.wait_minutes * 60000)}`} ·{' '}
                        {o.kind !== 'npc' && o.rating !== null ? <Star size={11} /> : null} {ratingText(o)}
                      </span>
                    </span>
                    <span className="right">
                      <b>{money(o.fee)}</b>
                      <span className="stat-label">
                        {o.price_mult ? `цена ×${String(o.price_mult).replace('.', ',')}` : `${Math.round(o.pct * 100)}%`}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="hint small" style={{ margin: 0 }}>
              <Info size={13} /> Деньги списываются сразу. Стройка идёт по этапам: котлован, фундамент, каркас, фасад,
              благоустройство. Бизнес работает на старом уровне, новый уровень — когда бригада закончит.
            </p>
            {pick && (
              <button
                className="button"
                disabled={busy || cash < data.cost + pick.fee || (data.max_builds !== undefined && (data.builds ?? 0) >= data.max_builds)}
                onClick={() => onOrder(pick.kind === 'crew' ? pick.id! : pick.kind === 'npc' ? pick.id ?? 'npc' : pick.kind)}
              >
                {cash < data.cost + pick.fee
                  ? `Не хватает ${money(data.cost + pick.fee - cash)}`
                  : `Начать стройку за ${money(data.cost + pick.fee)}`}
              </button>
            )}
          </>
        )}
        <button className="button ghost" onClick={onClose}>
          Отмена
        </button>
      </div>
    </div>
  );
}

/** Карточка ремонтной бригады: очередь заказов, цена работы, рейтинг. */
export function RepairCard({
  item, business, game, serverOffset, busy, onSetPrice,
}: {
  item: CatalogItem;
  business: Business;
  game: GameState;
  serverOffset: number;
  busy: boolean;
  onSetPrice: (pct: number) => void;
}) {
  const crew = business.crew;
  const cfg = game.upgrade;
  const current = Math.round((crew?.pct ?? 0.12) * 100);
  const [pct, setPct] = useState(current);
  useEffect(() => setPct(current), [current]);
  const lo = Math.round((cfg?.min_pct ?? 0.05) * 100);
  const hi = Math.round((cfg?.max_pct ?? 0.2) * 100);
  const queue = crew?.queue ?? [];
  const qmax = cfg?.queue ?? 5;
  const hours = (cfg?.minutes ?? 120) / 60;
  const name = (t: BusinessType) => game.catalog.find((c) => c.type === t)?.name ?? t;

  return (
    <section className="card biz">
      <div className="biz-head">
        <BizIcon type="repair" />
        <div className="grow">
          <h3>{item.name}</h3>
          <div className="stat-label">
            1 заказ за {String(hours).replace('.', ',')} ч · от игроков за сутки {money(crew?.earned_24h ?? 0)} ·{' '}
            {crew?.rating == null ? 'заказов ещё не было' : `вовремя ${Math.round(crew.rating * 100)}%`}
          </div>
        </div>
        <div className="right">
          <div className="stat-label small">в кассе</div>
          <div className="kassa">{money(business.pending_revenue)}</div>
        </div>
      </div>

      <div>
        <div className="bar-text">
          <span>Очередь</span>
          <span>
            {queue.length}/{qmax}
          </span>
        </div>
        <div className="bar-track">
          <div className="bar-fill" style={{ width: `${Math.min(100, (queue.length / qmax) * 100)}%` }} />
        </div>
      </div>

      {queue.length === 0 ? (
        crew?.npc_job_until && new Date(crew.npc_job_until).getTime() > Date.now() + serverOffset ? (
          <p className="listed-note">
            <Hammer size={15} /> Городской заказ · ≈ {duration(new Date(crew.npc_job_until).getTime() - (Date.now() + serverOffset))}
          </p>
        ) : (
          <p className="hint small" style={{ margin: 0 }}>
            Заказов от игроков нет — бригада берёт городские заказы, деньги приходят в кассу. Игроки видят твою бригаду,
            когда улучшают бизнес.
          </p>
        )
      ) : (
        <ul className="list crew-queue">
          {queue.map((o) => {
            const left = new Date(o.finish_at).getTime() - (Date.now() + serverOffset);
            return (
              <li key={o.id}>
                <span>
                  <b>
                    {name(o.type)} → ур. {o.to_level}
                  </b>
                  <div className="stat-label">
                    {o.kind === 'self' ? 'свой бизнес' : o.customer} ·{' '}
                    {o.status === 'working' ? `в работе, ≈ ${duration(Math.max(left, 60000))}` : `в очереди, ≈ ${duration(Math.max(left, 60000))}`}
                  </div>
                </span>
                <b className={o.kind === 'self' ? 'muted' : 'up'}>{o.kind === 'self' ? '—' : `+${money(o.fee)}`}</b>
              </li>
            );
          })}
        </ul>
      )}

      <div className="price-head">
        <span className="stat-label">Цена работы для других игроков</span>
        <b className="price-big">{pct}%</b>
      </div>
      <input
        className="slider"
        type="range"
        min={lo}
        max={hi}
        step={1}
        value={pct}
        onChange={(e) => {
          selectionTick();
          setPct(Number(e.target.value));
        }}
      />
      <div className="bar-text">
        <span>{lo}%</span>
        <span>NPC берёт 20%</span>
        <span>{hi}%</span>
      </div>
      {pct !== current && (
        <button className="button small" disabled={busy} onClick={() => onSetPrice(pct)}>
          Сохранить цену {pct}%
        </button>
      )}
      <p className="hint small" style={{ margin: 0 }}>
        <Info size={13} /> Свои бизнесы бригада ремонтирует по себестоимости. Оплата приходит после заказа, минус 5% комиссии.
      </p>
    </section>
  );
}
