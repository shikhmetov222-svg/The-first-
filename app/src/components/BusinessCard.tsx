import type { Business, CatalogItem, Market } from '../api';
import { BUSINESS_INFO, demandLabel } from '../content';
import { count, money } from '../format';

export type CardAction = 'restock' | 'price' | 'transfer';

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

export function BusinessCard({ item, business, market, cash, hasBakery, hasShop, busy, onOpen, onAction }: Props) {
  const info = BUSINESS_INFO[item.type];

  if (!business) {
    return (
      <section className="card business locked">
        <div className="business-head">
          <span className="icon">{info.icon}</span>
          <div className="grow">
            <h3>{item.name}</h3>
            <p className="hint small">{info.about}</p>
          </div>
        </div>
        <button className="button secondary" disabled={busy || cash < item.open_cost} onClick={onOpen}>
          Открыть за {money(item.open_cost)}
        </button>
      </section>
    );
  }

  const isFactory = item.production_rate > 0;

  return (
    <section className="card business">
      <div className="business-head">
        <span className="icon">{info.icon}</span>
        <div className="grow">
          <h3>{item.name}</h3>
          {isFactory ? (
            <p className="hint small">Печёт до {item.production_rate} шт. каждые 5 минут</p>
          ) : (
            <p className="hint small">Цена: {money(business.price ?? 0)} за 1 {item.product}</p>
          )}
        </div>
        {!isFactory && (
          <div className="right">
            <div className="stat-label small">в кассе</div>
            <div className="kassa">{money(business.pending_revenue)}</div>
          </div>
        )}
      </div>

      {isFactory && (
        <Bar label="Мука" value={business.raw_stock} max={item.raw_capacity} unit="на буханок" />
      )}
      <Bar
        label={isFactory ? 'Готовый хлеб' : `Склад (${item.product})`}
        value={business.stock}
        max={item.capacity}
      />

      {market && (
        <div className="market-line">
          <span>Рынок ~{money(market.market_price)}</span>
          <span>продавцов {market.sellers}</span>
          <span>спрос {demandLabel(market.demand_level)}</span>
        </div>
      )}
      {market && business.last_sold > 0 && (
        <p className="hint small">За последние 5 минут продано: {count(business.last_sold)} шт.</p>
      )}

      {!isFactory && business.stock === 0 && (
        <p className="warning">Склад пуст — продажи стоят. Пополни склад!</p>
      )}
      {isFactory && business.raw_stock === 0 && (
        <p className="warning">Мука закончилась — пекарня простаивает.</p>
      )}

      <div className="actions">
        {isFactory ? (
          <>
            <button className="button small" disabled={busy} onClick={() => onAction('restock')}>
              Закупить муку
            </button>
            <button
              className="button small secondary"
              disabled={busy || !hasShop || business.stock === 0}
              onClick={() => onAction('transfer')}
            >
              В магазин
            </button>
          </>
        ) : (
          <>
            <button className="button small" disabled={busy} onClick={() => onAction('restock')}>
              Пополнить склад
            </button>
            {item.type === 'shop' && hasBakery && (
              <button className="button small secondary" disabled={busy} onClick={() => onAction('transfer')}>
                Из пекарни
              </button>
            )}
            <button className="button small secondary" disabled={busy} onClick={() => onAction('price')}>
              Цена
            </button>
          </>
        )}
      </div>
    </section>
  );
}

function Bar({ label, value, max, unit }: { label: string; value: number; max: number; unit?: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="bar">
      <div className="bar-text">
        <span>{label}</span>
        <span>
          {count(value)} / {count(max)} {unit ?? ''}
        </span>
      </div>
      <div className="bar-track">
        <div className={`bar-fill ${pct < 15 ? 'low' : ''}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
