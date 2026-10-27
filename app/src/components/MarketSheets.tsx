import { useState } from 'react';
import { Info } from 'lucide-react';
import type { GameState, GoodsPrice, Lot, Product, Source } from '../api';
import { PRODUCTS, SELL_SOURCES } from '../content';
import { count, money } from '../format';
import { FEE, available, freeSpace, priceCorridor, vsMarket } from '../market';
import { selectionTick } from '../telegram';
import { CompanyLogo } from './CompanyLogo';
import { DevBadge } from './DevBadge';

function Sheet({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        {children}
        <button className="button ghost" onClick={onClose}>
          Отмена
        </button>
      </div>
    </div>
  );
}

/** Количество: −10/−1/+1/+10 и ползунок. */
function Qty({ value, max, onChange }: { value: number; max: number; onChange: (n: number) => void }) {
  const set = (n: number) => {
    selectionTick();
    onChange(Math.max(1, Math.min(max, n)));
  };
  return (
    <>
      <div className="stepper">
        <button className="step" onClick={() => set(value - 10)}>−10</button>
        <button className="step" onClick={() => set(value - 1)}>−1</button>
        <div className="step-value">{count(value)}</div>
        <button className="step" onClick={() => set(value + 1)}>+1</button>
        <button className="step" onClick={() => set(value + 10)}>+10</button>
      </div>
      {max > 1 && (
        <input className="slider" type="range" min={1} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      )}
    </>
  );
}

// ---------------- Купить лот ----------------

export function BuySheet({
  lot, game, market, busy, onBuy, onClose,
}: {
  lot: Lot;
  game: GameState;
  market: GoodsPrice | undefined;
  busy: boolean;
  onBuy: (qty: number) => void;
  onClose: () => void;
}) {
  const { dest, free } = freeSpace(game, lot.product);
  const affordable = Math.floor(game.player.cash / lot.price);
  const max = Math.max(0, Math.min(lot.qty_left, free, affordable));
  const [qty, setQty] = useState(Math.min(max, lot.qty_left) || 1);
  const info = PRODUCTS[lot.product];
  const cmp = market ? vsMarket(lot.price, market.price) : null;

  return (
    <Sheet onClose={onClose}>
      <h2>
        <info.icon size={22} /> {info.name} · {money(lot.price)} за шт.
      </h2>
      <div className="lot-seller">
        {lot.seller.icon ? <CompanyLogo icon={lot.seller.icon} color={lot.seller.color ?? 'gold'} size={28} /> : null}
        <span>
          {lot.seller.name}
          {lot.seller.dev && <DevBadge />}
        </span>
        <span className="stat-label">· в лоте {count(lot.qty_left)} шт.</span>
      </div>
      {cmp && (
        <p className={`small ${cmp.cheaper ? 'up' : 'warn'}`} style={{ margin: 0 }}>
          {cmp.pct === 0 ? 'Как на рынке' : `${cmp.cheaper ? '▼' : '▲'} на ${cmp.pct}% ${cmp.cheaper ? 'дешевле' : 'дороже'} рынка`}
          {market && <span className="stat-label"> · у поставщика ≈ {money(market.price)}</span>}
        </p>
      )}
      {!dest ? (
        <p className="warning">
          Некуда положить товар — открой {lot.product === 'coffee' ? 'кофейню' : lot.product === 'flour' ? 'пекарню' : 'магазин или пекарню'}.
        </p>
      ) : max <= 0 ? (
        <p className="warning">{free <= 0 ? 'Склад полон' : 'Не хватает денег даже на 1 шт.'}</p>
      ) : (
        <>
          <p className="hint small">
            Место на складе: {count(free)} шт. · хватает денег на {count(affordable)} шт.
          </p>
          <Qty value={qty} max={max} onChange={setQty} />
          <button className="button" disabled={busy} onClick={() => onBuy(qty)}>
            Купить {count(qty)} шт. за {money(qty * lot.price)}
          </button>
        </>
      )}
    </Sheet>
  );
}

// ---------------- Выставить лот / продать оптовику ----------------

export function SellSheet({
  game, prices, preset, initialMode = 'lot', busy, onLot, onWholesale, onClose,
}: {
  game: GameState;
  prices: GoodsPrice[];
  preset?: Source;
  initialMode?: 'lot' | 'wholesale';
  busy: boolean;
  onLot: (p: { product: Product; source: Source; qty: number; price: number }) => void;
  onWholesale: (p: { product: Product; source: Source; qty: number }) => void;
  onClose: () => void;
}) {
  const options = SELL_SOURCES.filter((o) => game.businesses.some((b) => b.type === o.source));
  const first = options.find((o) => o.source === preset && available(game, o.product, o.source) > 0)
    ?? options.find((o) => available(game, o.product, o.source) > 0)
    ?? options[0];
  const [pick, setPick] = useState(first);
  const [mode, setMode] = useState<'lot' | 'wholesale'>(initialMode);
  const have = pick ? available(game, pick.product, pick.source) : 0;
  const [qty, setQty] = useState(Math.min(have, 50) || 1);
  const market = prices.find((p) => p.product === pick?.product);
  const [lo, hi] = market ? priceCorridor(market.price) : [100, 100];
  const [price, setPrice] = useState(market ? Math.round(market.price / 100) * 100 : 100);

  if (!pick || !market) {
    return (
      <Sheet onClose={onClose}>
        <h2>Продать товар</h2>
        <p className="hint">Сначала открой бизнес — продавать можно только товар со своих складов.</p>
      </Sheet>
    );
  }

  const q = Math.max(1, Math.min(qty, have));
  const p = Math.max(lo, Math.min(hi, price));
  const gross = q * p;
  const fee = Math.ceil(gross * FEE);
  const cmp = vsMarket(p, market.price);

  return (
    <Sheet onClose={onClose}>
      <h2>Продать товар</h2>
      <div className="segmented">
        <button className={mode === 'lot' ? 'active' : ''} onClick={() => setMode('lot')}>
          Выставить лот
        </button>
        <button className={mode === 'wholesale' ? 'active' : ''} onClick={() => setMode('wholesale')}>
          Оптовику
        </button>
      </div>

      <div className="dev-row">
        {options.map((o) => (
          <button
            key={o.label}
            className={`chip ${o === pick ? 'chip-active' : ''}`}
            onClick={() => {
              setPick(o);
              const m = prices.find((x) => x.product === o.product);
              if (m) setPrice(Math.round(m.price / 100) * 100);
              setQty(Math.min(available(game, o.product, o.source), 50) || 1);
            }}
          >
            {o.label} · {count(available(game, o.product, o.source))}
          </button>
        ))}
      </div>

      {have <= 0 ? (
        <p className="warning">На этом складе пусто.</p>
      ) : (
        <>
          <div className="stat-label">Количество</div>
          <Qty value={q} max={have} onChange={setQty} />

          {mode === 'lot' ? (
            <>
              <div className="price-head">
                <span className="stat-label">Цена за штуку</span>
                <b className="price-big">{money(p)}</b>
              </div>
              <input
                className="slider"
                type="range"
                min={lo}
                max={hi}
                step={100}
                value={p}
                onChange={(e) => {
                  selectionTick();
                  setPrice(Number(e.target.value));
                }}
              />
              <div className="bar-text">
                <span>{money(lo)}</span>
                <span className={cmp.pct === 0 ? '' : cmp.cheaper ? 'up' : 'warn'}>
                  {cmp.pct === 0 ? 'как рынок' : `${cmp.cheaper ? '▼' : '▲'} ${cmp.pct}% к рынку`}
                </span>
                <span>{money(hi)}</span>
              </div>
              <div className="calc">
                <div><span>Рыночная цена</span><b>{money(market.price)}</b></div>
                <div><span>Сумма</span><b>{money(gross)}</b></div>
                <div><span>Комиссия рынка 5%</span><b className="down">−{money(fee)}</b></div>
                <div className="calc-total"><span>Получишь</span><b>{money(gross - fee)}</b></div>
              </div>
              <p className="hint small">
                <Info size={13} /> Товар сразу снимается со склада. Лот живёт 24 часа, нераспроданное вернётся.
              </p>
              <button className="button" disabled={busy} onClick={() => onLot({ product: pick.product, source: pick.source, qty: q, price: p })}>
                Выставить {count(q)} шт. по {money(p)}
              </button>
            </>
          ) : (
            <>
              <div className="calc">
                <div><span>Оптовик платит</span><b>{money(market.wholesale)} за шт.</b></div>
                <div className="calc-total"><span>Получишь сразу</span><b>{money(q * market.wholesale)}</b></div>
              </div>
              <p className="hint small">
                <Info size={13} /> Оптовик берёт всё и сразу, но дёшево — 70% рыночной цены. Без комиссии.
              </p>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => onWholesale({ product: pick.product, source: pick.source, qty: q })}
              >
                Продать оптовику за {money(q * market.wholesale)}
              </button>
            </>
          )}
        </>
      )}
    </Sheet>
  );
}
