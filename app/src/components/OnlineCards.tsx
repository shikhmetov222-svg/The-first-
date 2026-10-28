import { ArrowRightLeft, PackageCheck, ShoppingCart } from 'lucide-react';
import type { Business, CatalogItem } from '../api';
import { PRODUCTS } from '../content';
import { count, money } from '../format';
import { BizIcon } from './BizIcon';

/** Магазин на маркетплейсе: товары на складе, продажи и выручка после комиссии. */
export function MarketplaceCard({
  item, business, busy, onTransfer, onBuyOnMarket,
}: {
  item: CatalogItem;
  business: Business;
  busy: boolean;
  onTransfer: () => void;
  onBuyOnMarket: () => void;
}) {
  const goods = business.goods ?? {};
  const total = (goods.coffee ?? 0) + (goods.bread ?? 0) + (goods.flour ?? 0);
  const pct = Math.min(100, (total / item.capacity) * 100);
  return (
    <section className="card biz">
      <div className="biz-head">
        <BizIcon type="marketplace" />
        <div className="grow">
          <h3>{item.name}</h3>
          <div className="stat-label">{count(business.last_sold ?? 0)} шт. за 5 мин · вся страна</div>
        </div>
        <div className="right">
          <div className="stat-label small">за 5 мин</div>
          <div className="kassa">{money(business.last_revenue ?? 0)}</div>
        </div>
      </div>
      <div className="goods-row">
        {(['coffee', 'bread', 'flour'] as const).map((p) => {
          const Icon = PRODUCTS[p].icon;
          return (
            <span key={p} className="goods-chip">
              <Icon size={14} /> {PRODUCTS[p].name}: <b>{count(goods[p] ?? 0)}</b>
            </span>
          );
        })}
      </div>
      <div>
        <div className="bar-text">
          <span>Склад</span>
          <span>
            {count(total)}/{count(item.capacity)}
          </span>
        </div>
        <div className="bar-track">
          <div className={`bar-fill ${pct < 15 ? 'low' : ''}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
      <p className="hint small" style={{ margin: 0 }}>
        Выручка уже за вычетом комиссии площадки. Каждая продажа — посылка для ПВЗ.
      </p>
      <div className="actions">
        <button className="button light small" disabled={busy || business.listed} onClick={onTransfer}>
          <ArrowRightLeft size={16} /> Перевезти своё
        </button>
        <button className="button small secondary" disabled={busy || business.listed} onClick={onBuyOnMarket}>
          <ShoppingCart size={16} /> На рынке
        </button>
      </div>
    </section>
  );
}

/** Пункт выдачи заказов: посылки за 5 минут, заполненность полки, доход. */
export function PvzCard({ item, business }: { item: CatalogItem; business: Business }) {
  const pct = Math.min(100, (business.stock / item.capacity) * 100);
  return (
    <section className="card biz">
      <div className="biz-head">
        <BizIcon type="pvz" />
        <div className="grow">
          <h3>{item.name}</h3>
          <div className="stat-label">
            <PackageCheck size={13} /> выдано {count(business.last_sold ?? 0)} посылок за 5 мин
          </div>
        </div>
        <div className="right">
          <div className="stat-label small">в кассе</div>
          <div className="kassa">{money(business.pending_revenue)}</div>
        </div>
      </div>
      <div>
        <div className="bar-text">
          <span>Полка</span>
          <span>
            {count(business.stock)}/{count(item.capacity)}
            {pct >= 100 ? ' · полна' : ''}
          </span>
        </div>
        <div className="bar-track">
          <div className="bar-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <p className="hint small" style={{ margin: 0 }}>
        Работает сам: посылки приходят от маркетплейсов игроков и от жителей города.
      </p>
    </section>
  );
}
