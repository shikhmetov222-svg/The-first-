import { Lock, Moon, Tag, TriangleAlert, Truck, Upload } from 'lucide-react';
import type { Business, CatalogItem, Market } from '../api';
import { BUSINESS_INFO, demandLabel } from '../content';
import { count, money } from '../format';
import { BizIcon } from './BizIcon';

export type CardAction = 'restock' | 'price' | 'transfer' | 'sell';

interface Props {
  item: CatalogItem;
  business?: Business;
  market?: Market;
  cash: number;
  hasBakery: boolean;
  hasShop: boolean;
  busy: boolean;
  onOpen: () => void;
  onAction: (kind: CardAction) => void;
}

export function BusinessCard(props: Props) {
  return props.business ? <OpenCard {...props} business={props.business} /> : <LockedCard {...props} />;
}

/** Закрытый бизнес: пунктир, замок, прогресс накопления на открытие. */
function LockedCard({ item, cash, busy, onOpen }: Props) {
  const pct = Math.min(100, Math.floor((cash / item.open_cost) * 100));
  const enough = cash >= item.open_cost;

  return (
    <section className="card biz locked">
      <div className="biz-head">
        <BizIcon type={item.type} />
        <div className="grow">
          <h3>{item.name}</h3>
          <div className="stat-label">{BUSINESS_INFO[item.type].about}</div>
        </div>
        <span className="lock-badge" aria-label="Закрыто">
          <Lock size={16} />
        </span>
      </div>

      <div>
        <div className="bar-text">
          <span>
            {money(Math.min(cash, item.open_cost))} из {money(item.open_cost)}
          </span>
          <span>{pct}%</span>
        </div>
        <div className="bar-track">
          <div className="bar-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {enough ? (
        <button className="button" data-tour={`open-${item.type}`} disabled={busy} onClick={onOpen}>
          Открыть за {money(item.open_cost)}
        </button>
      ) : (
        <p className="stat-label" data-tour={`open-${item.type}`}>
          Не хватает {money(item.open_cost - cash)}
        </p>
      )}
    </section>
  );
}

function OpenCard({ item, business, market, hasBakery, hasShop, busy, onAction }: Props & { business: Business }) {
  const isFactory = item.production_rate > 0;

  return (
    <section className="card biz">
      <div className="biz-head">
        <BizIcon type={item.type} />
        <div className="grow">
          <h3>{item.name}</h3>
          <div className="stat-label">
            {isFactory
              ? `до ${item.production_rate} шт. за 5 мин`
              : `${count(business.last_sold ?? 0)} шт. за 5 мин`}
          </div>
        </div>
        {!isFactory && market && business.price ? <PriceBadge price={business.price} market={market.market_price} /> : null}
      </div>

      {!isFactory && market && business.price ? (
        <div className="price-line">
          Твоя цена <b>{money(business.price)}</b> · Рынок <b>{money(market.market_price)}</b>
        </div>
      ) : null}

      <div className="biz-columns">
        {isFactory ? (
          <>
            <Meter label="Мука" value={business.raw_stock} max={item.raw_capacity} />
            <Meter label="Готовый хлеб" value={business.stock} max={item.capacity} />
          </>
        ) : (
          <>
            <Meter label="Склад" value={business.stock} max={item.capacity} />
            {market && <Demand level={market.demand_level} />}
          </>
        )}
      </div>

      {!isFactory && market && market.demand_level < 0.5 && business.stock > 0 && (
        <p className="night-hint">
          <Moon size={15} /> Ночь — покупателей мало, утром будет больше
        </p>
      )}

      {!isFactory && business.stock === 0 && (
        <p className="warning">
          <TriangleAlert size={16} /> Склад пуст — продажи стоят
        </p>
      )}
      {isFactory && business.raw_stock === 0 && (
        <p className="warning">
          <TriangleAlert size={16} /> Мука закончилась — пекарня стоит
        </p>
      )}

      <div className="actions">
        <button
          className="button light small"
          data-tour={`restock-${item.type}`}
          disabled={busy}
          onClick={() => onAction('restock')}
        >
          {isFactory ? 'Закупить муку' : 'Пополнить склад'}
        </button>
        {(isFactory ? hasShop : item.type === 'shop' && hasBakery) && (
          <button
            className="icon-button"
            aria-label={isFactory ? 'Отвезти хлеб в магазин' : 'Привезти хлеб из пекарни'}
            disabled={busy || (isFactory && business.stock === 0)}
            onClick={() => onAction('transfer')}
          >
            <Truck size={20} />
          </button>
        )}
        <button
          className="icon-button"
          aria-label="Выставить товар на рынок"
          title="Выставить на рынок"
          disabled={busy}
          onClick={() => onAction('sell')}
        >
          <Upload size={20} />
        </button>
        {!isFactory && (
          <button
            className="icon-button"
            aria-label="Изменить цену"
            data-tour={`price-${item.type}`}
            disabled={busy}
            onClick={() => onAction('price')}
          >
            <Tag size={20} />
          </button>
        )}
      </div>
    </section>
  );
}

/** «−17% к рынку»: дешевле — зелёный, дороже — оранжевый; всегда со стрелкой. */
function PriceBadge({ price, market }: { price: number; market: number }) {
  const diff = Math.round((price / market - 1) * 100);
  if (diff === 0) return <span className="price-badge">≈ рынок</span>;
  const cheaper = diff < 0;
  return (
    <span className={`price-badge ${cheaper ? 'up' : 'warn'}`}>
      {cheaper ? '▼' : '▲'} {cheaper ? '−' : '+'}
      {Math.abs(diff)}% к рынку
    </span>
  );
}

function Meter({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="meter">
      <div className="bar-text">
        <span>{label}</span>
        <span>
          {count(value)}/{count(max)}
        </span>
      </div>
      <div className="bar-track">
        <div className={`bar-fill ${pct < 15 ? 'low' : ''}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Спрос: шкала из 5 делений и слово. */
function Demand({ level }: { level: number }) {
  const filled = level < 0.3 ? 1 : level < 0.6 ? 2 : level < 1.0 ? 3 : level < 1.4 ? 4 : 5;
  const word = demandLabel(level);
  const low = filled <= 2;
  return (
    <div className="meter">
      <div className="bar-text">
        <span>Спрос</span>
        <span className={low ? 'warn' : ''}>{word}</span>
      </div>
      <div className="segments" role="img" aria-label={`Спрос ${word}`}>
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} className={i <= filled ? (low ? 'on low' : 'on') : ''} />
        ))}
      </div>
    </div>
  );
}
