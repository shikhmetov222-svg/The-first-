import { useCallback, useEffect, useState } from 'react';
import { ArrowDownToLine, Bot, Clock, PackageOpen, ShoppingBag, Store, Upload, X } from 'lucide-react';
import { api, type BusinessLot, type GameState, type Lot, type MarketView, type Product, type Source } from '../api';
import { BOT_KIND, PRODUCTS } from '../content';
import { MiniChart } from './MiniChart';
import { count, money, shortDuration } from '../format';
import { vsMarket } from '../market';
import { feel, notify } from '../telegram';
import { CompanyLogo } from './CompanyLogo';
import { DevBadge } from './DevBadge';
import { BuyBusinessSheet, BuySheet, SellBusinessSheet, SellSheet, businessStock } from './MarketSheets';
import { BizIcon } from './BizIcon';

type Section = 'goods' | 'business' | 'mine';

interface Props {
  game: GameState;
  onState: (s: GameState) => void;
  onToast: (text: string, error?: boolean) => void;
  /** Открыть окно продажи сразу (кнопка «Выставить» на карточке бизнеса). */
  sellPreset: Source | null;
  onSellPresetUsed: () => void;
  /** Пришли с карточки маркетплейса: покупки идут на его склад. */
  buyToMarketplace?: boolean;
  onBuyToMarketplaceOff?: () => void;
  /** Открыть сразу нужный товар (например, «Реклама» из окна запуска рекламы). */
  productPreset?: Product | null;
  onProductPresetUsed?: () => void;
}

export function MarketTab({
  game, onState, onToast, sellPreset, onSellPresetUsed, buyToMarketplace, onBuyToMarketplaceOff, productPreset, onProductPresetUsed,
}: Props) {
  const [view, setView] = useState<MarketView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<Section>('goods');
  const [product, setProduct] = useState<Product>('coffee');
  const [buying, setBuying] = useState<Lot | null>(null);
  const [selling, setSelling] = useState<{ preset?: Source; mode?: 'lot' | 'wholesale' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [buyingBiz, setBuyingBiz] = useState<BusinessLot | null>(null);
  const [sellingBiz, setSellingBiz] = useState(false);

  const load = useCallback(() => {
    api
      .market()
      .then((r) => {
        setView(r.market);
        setError(null);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  useEffect(() => {
    load();
    const id = window.setInterval(() => document.visibilityState === 'visible' && load(), 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (productPreset) {
      setSection('goods');
      setProduct(productPreset);
      onProductPresetUsed?.();
    }
  }, [productPreset, onProductPresetUsed]);

  useEffect(() => {
    if (sellPreset) {
      setSelling({ preset: sellPreset });
      onSellPresetUsed();
    }
  }, [sellPreset, onSellPresetUsed]);

  /** Сделка на сервере → новое состояние игры и рынка. */
  const deal = async (
    fn: () => Promise<GameState & { result: string; market: MarketView }>,
    kind: 'purchase' | 'collect' = 'purchase',
  ) => {
    if (busy) return false;
    setBusy(true);
    try {
      const res = await fn();
      onState(res);
      setView(res.market);
      feel(kind);
      onToast(res.result);
      return true;
    } catch (e) {
      notify('error');
      onToast((e as Error).message, true);
      load();
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (error && !view) return <p className="warning">{error}</p>;
  if (!view) return <p className="hint center">Открываем биржу…</p>;

  const priceOf = (p: Product) => view.prices.find((x) => x.product === p);
  const lots = view.lots.filter((l) => l.product === product);
  const active = view.my_lots.filter((l) => l.status === 'active');

  return (
    <>
      <section className="price-tiles">
        {view.prices.map((p) => {
          const info = PRODUCTS[p.product];
          const change = p.day_ago ? Math.round((p.price / p.day_ago - 1) * 1000) / 10 : null;
          return (
            <div key={p.product} className="price-tile">
              <span className="price-tile-name">
                <info.icon size={15} /> {info.name}
              </span>
              <b>{money(p.price)}</b>
              <span className={`small ${change === null || change === 0 ? 'muted' : change > 0 ? 'up' : 'down'}`}>
                {change === null ? 'за сутки —' : change === 0 ? '0% за сутки' : `${change > 0 ? '▲ +' : '▼ '}${String(change).replace('.', ',')}%`}
              </span>
              <MiniChart points={p.history} color={change !== null && change < 0 ? '#F07167' : '#D4A73A'} />
              <span className="stat-label">оптовик {money(p.wholesale)}</span>
            </div>
          );
        })}
      </section>

      <div className="segmented">
        <button className={section === 'goods' ? 'active' : ''} onClick={() => setSection('goods')}>
          Товары
        </button>
        <button className={section === 'business' ? 'active' : ''} onClick={() => setSection('business')}>
          Бизнесы
        </button>
        <button className={section === 'mine' ? 'active' : ''} onClick={() => setSection('mine')}>
          Мои лоты{active.length ? ` · ${active.length}` : ''}
        </button>
      </div>

      {section === 'goods' && (
        <>
          {buyToMarketplace && product !== 'campaign' && (
            <div className="listed-note">
              <ShoppingBag size={15} /> Покупки идут на склад маркетплейса
              <button className="link-button" onClick={onBuyToMarketplaceOff}>
                отменить
              </button>
            </div>
          )}
          <div className="dev-row">
            {(Object.keys(PRODUCTS) as Product[]).map((p) => {
              const n = view.lots.filter((l) => l.product === p).length;
              return (
                <button key={p} className={`chip ${product === p ? 'chip-active' : ''}`} onClick={() => setProduct(p)}>
                  {PRODUCTS[p].name} · {n}
                </button>
              );
            })}
          </div>
          {lots.length === 0 ? (
            <section className="card placeholder">
              <div className="placeholder-icon">
                <PackageOpen size={26} />
              </div>
              <h2>Лотов пока нет</h2>
              <p className="hint">
                {product === 'campaign'
                  ? 'Кампании продают игроки с рекламным агентством. А NPC-агентство продаёт их всегда — кнопка «Реклама» на карточке бизнеса.'
                  : 'Выставь свой товар первым — другие игроки его увидят.'}
              </p>
            </section>
          ) : (
            <section className="card lots">
              {lots.map((l) => {
                const m = priceOf(l.product);
                const cmp = m ? vsMarket(l.price, m.price) : null;
                return (
                  <div key={l.id} className="lot-row">
                    {l.seller.bot ? (
                      <span className="logo-fallback bot-logo">
                        <Bot size={18} />
                      </span>
                    ) : l.seller.icon ? (
                      <CompanyLogo icon={l.seller.icon} color={l.seller.color ?? 'gold'} size={36} />
                    ) : (
                      <span className="logo-fallback">{l.seller.name.slice(0, 1).toUpperCase()}</span>
                    )}
                    <div className="grow">
                      <div className="lot-name">
                        {l.seller.name}
                        {l.seller.dev && <DevBadge />}
                        {l.seller.test && <span className="tag small-tag">тест</span>}
                        {l.seller.bot && (
                          <span className="tag small-tag">бот · {BOT_KIND[l.seller.kind ?? 'careful']}</span>
                        )}
                      </div>
                      <div className="stat-label">
                        {count(l.qty_left)} шт. · <b className="lot-price">{money(l.price)}</b>/шт.
                      </div>
                      {cmp && cmp.pct > 0 && (
                        <div className={`small ${cmp.cheaper ? 'up' : 'warn'}`}>
                          {cmp.cheaper ? '▼' : '▲'} на {cmp.pct}% {cmp.cheaper ? 'дешевле' : 'дороже'} рынка
                        </div>
                      )}
                    </div>
                    <button className="button small" style={{ width: 'auto' }} onClick={() => setBuying(l)}>
                      Купить
                    </button>
                  </div>
                );
              })}
            </section>
          )}
          <SellButtons onSell={(mode) => setSelling({ mode })} />
        </>
      )}

      {section === 'business' && (
        <>
          {(view.business_lots ?? []).length === 0 ? (
            <section className="card placeholder">
              <div className="placeholder-icon">
                <Store size={26} />
              </div>
              <h2>Бизнесов на продаже нет</h2>
              <p className="hint">Выставь свой — покупатель получит его вместе с товаром на складе.</p>
            </section>
          ) : (
            (view.business_lots ?? []).map((l) => {
              const item = game.catalog.find((c) => c.type === l.type)!;
              const diff = Math.round((l.price / l.valuation - 1) * 100);
              return (
                <section key={l.id} className="card biz-lot">
                  <div className="biz-head">
                    <BizIcon type={l.type} />
                    <div className="grow">
                      <h3>{item.name}</h3>
                      <div className="stat-label">
                        {l.seller.name}
                        {l.seller.dev && <DevBadge />}
                        {l.seller.test && <span className="tag small-tag">тест</span>}
                      </div>
                    </div>
                    <span className={`price-badge ${diff < 0 ? 'up' : diff > 0 ? 'warn' : ''}`}>
                      {diff === 0 ? '≈ оценка' : `${diff < 0 ? '▼ −' : '▲ +'}${Math.abs(diff)}% к оценке`}
                    </span>
                  </div>
                  <div className="price-line">
                    Склад: <b>{businessStock(l.type, l.stock, l.raw_stock, item.capacity, item.raw_capacity)}</b>
                    <br />
                    Цена <b>{money(l.price)}</b> · оценка <b>{money(l.valuation)}</b>
                  </div>
                  <button className="button small" onClick={() => setBuyingBiz(l)}>
                    Подробнее и купить
                  </button>
                </section>
              );
            })
          )}
          <button className="button secondary" onClick={() => setSellingBiz(true)}>
            <Upload size={18} /> Продать свой бизнес
          </button>
        </>
      )}

      {section === 'mine' && (
        <>
          <SellButtons onSell={(mode) => setSelling({ mode })} />
          <h2 className="section-title">
            <span>Активные лоты</span>
            <span className="stat-label">{active.length} из 5</span>
          </h2>
          {active.length === 0 ? (
            <p className="hint small" style={{ margin: 0 }}>Активных лотов нет.</p>
          ) : (
            active.map((l) => {
              const sold = l.qty_total - l.qty_left;
              const pct = Math.round((sold / l.qty_total) * 100);
              const left = new Date(l.expires_at).getTime() - Date.now();
              if (l.kind === 'business' && l.business_type) {
                const item = game.catalog.find((c) => c.type === l.business_type)!;
                return (
                  <section key={l.id} className="card my-lot">
                    <div className="biz-head">
                      <BizIcon type={l.business_type} />
                      <div className="grow">
                        <b>
                          {item.name} · {money(l.price)}
                        </b>
                        <div className="stat-label">
                          <Clock size={12} /> ещё {shortDuration(left)} · бизнес на паузе
                        </div>
                      </div>
                      <button
                        className="button small secondary"
                        style={{ width: 'auto' }}
                        disabled={busy}
                        onClick={() => deal(() => api.cancelLot(l.id))}
                      >
                        <X size={16} /> Снять
                      </button>
                    </div>
                  </section>
                );
              }
              const info = PRODUCTS[l.product];
              return (
                <section key={l.id} className="card my-lot">
                  <div className="biz-head">
                    <span className={`biz-icon ${info.color}`}>
                      <info.icon size={20} />
                    </span>
                    <div className="grow">
                      <b>
                        {info.name} · {money(l.price)}/шт.
                      </b>
                      <div className="stat-label">
                        <Clock size={12} /> ещё {shortDuration(left)}
                      </div>
                    </div>
                    <button
                      className="button small secondary"
                      style={{ width: 'auto' }}
                      disabled={busy}
                      onClick={() => deal(() => api.cancelLot(l.id))}
                    >
                      <X size={16} /> Снять
                    </button>
                  </div>
                  <div>
                    <div className="bar-text">
                      <span>Продано {count(sold)} из {count(l.qty_total)}</span>
                      <span>{pct}%</span>
                    </div>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                </section>
              );
            })
          )}

          <h2 className="section-title">История сделок</h2>
          <section className="card">
            {view.my_trades.length === 0 ? (
              <p className="hint small" style={{ margin: 0 }}>Сделок пока не было.</p>
            ) : (
              <ul className="list">
                {view.my_trades.map((t, i) => (
                  <li key={i}>
                    <span>
                      <b>
                        {t.side === 'sold' ? 'Продано' : 'Куплено'}:{' '}
                        {t.kind === 'business'
                          ? game.catalog.find((c) => c.type === t.product)?.name ?? 'бизнес'
                          : t.kind === 'repair'
                          ? `Ремонт: ${game.catalog.find((c) => c.type === t.product)?.name ?? 'бизнес'} → ур. ${t.qty}`
                          : `${PRODUCTS[t.product as Product].name} × ${count(t.qty)}`}
                      </b>
                      <div className="stat-label">
                        {t.side === 'sold' ? 'покупатель' : 'продавец'}: {t.other ?? '—'} ·{' '}
                        {new Date(t.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </span>
                    <b className={t.side === 'sold' ? 'up' : 'down'}>
                      {t.side === 'sold' ? '+' : '−'}
                      {money(t.side === 'sold' ? t.total - t.fee : t.total)}
                    </b>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {buying && (
        <BuySheet
          lot={buying}
          game={game}
          market={priceOf(buying.product)}
          toMarketplace={Boolean(buyToMarketplace)}
          busy={busy}
          onClose={() => setBuying(null)}
          onBuy={async (qty, dest) => {
            const to = buying.product === 'campaign' ? dest : buyToMarketplace ? 'marketplace' : undefined;
            if (await deal(() => api.buyLot(buying.id, qty, to))) setBuying(null);
          }}
        />
      )}

      {buyingBiz && (
        <BuyBusinessSheet
          lot={buyingBiz}
          game={game}
          busy={busy}
          onClose={() => setBuyingBiz(null)}
          onBuy={async () => {
            if (await deal(() => api.buyBusinessLot(buyingBiz.id), 'collect')) setBuyingBiz(null);
          }}
        />
      )}

      {sellingBiz && (
        <SellBusinessSheet
          game={game}
          valuations={view.my_businesses ?? []}
          goodsLotSources={view.my_lots.filter((l) => l.kind !== 'business' && l.status === 'active').map((l) => l.source)}
          busy={busy}
          onClose={() => setSellingBiz(false)}
          onSell={async (type, price) => {
            if (await deal(() => api.createBusinessLot(type, price))) {
              setSellingBiz(false);
              setSection('mine');
            }
          }}
        />
      )}

      {selling && (
        <SellSheet
          game={game}
          prices={view.prices}
          preset={selling.preset}
          initialMode={selling.mode}
          busy={busy}
          onClose={() => setSelling(null)}
          onLot={async (p) => {
            if (await deal(() => api.createLot(p))) {
              setSelling(null);
              setSection('mine');
            }
          }}
          onWholesale={async (p) => {
            if (await deal(() => api.sellWholesale(p), 'collect')) setSelling(null);
          }}
        />
      )}
    </>
  );
}

function SellButtons({ onSell }: { onSell: (mode: 'lot' | 'wholesale') => void }) {
  return (
    <div className="actions">
      <button className="button" onClick={() => onSell('lot')}>
        <Upload size={18} /> Выставить
      </button>
      <button className="button secondary" onClick={() => onSell('wholesale')}>
        <ArrowDownToLine size={18} /> Оптовику
      </button>
    </div>
  );
}
