import { useState } from 'react';
import type { BrigadeId, BusinessType, CatalogItem, GameState, Market } from '../api';
import { BOT_KIND, BUSINESS_INFO, demandLabel } from '../content';
import { count, money } from '../format';
import { capOf, rawCapOf } from '../market';
import { selectionTick } from '../telegram';
import { BizIcon } from './BizIcon';
import { BrigadePicker, brigadeOffer } from './Builds';

export type SheetKind =
  | { kind: 'open'; type: BusinessType }
  | { kind: 'restock'; type: BusinessType }
  | { kind: 'transfer'; type: BusinessType }
  | { kind: 'price'; type: BusinessType };

interface Props {
  sheet: SheetKind;
  game: GameState;
  busy: boolean;
  onClose: () => void;
  onOpenBusiness: (type: BusinessType, brigade?: BrigadeId) => void;
  onRestock: (type: BusinessType, qty: number) => void;
  onTransfer: (qty: number) => void;
  onSetPrice: (type: BusinessType, price: number) => void;
}

export function ActionSheet(props: Props) {
  return (
    <div className="backdrop" onClick={props.onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <SheetBody {...props} />
        <button className="button ghost" onClick={props.onClose}>
          Отмена
        </button>
      </div>
    </div>
  );
}

function SheetBody({ sheet, game, busy, onOpenBusiness, onRestock, onTransfer, onSetPrice }: Props) {
  const item = game.catalog.find((c) => c.type === sheet.type)!;
  const business = game.businesses.find((b) => b.type === sheet.type);
  const cash = game.player.cash;

  if (sheet.kind === 'open') return <OpenBody item={item} game={game} busy={busy} onOpen={onOpenBusiness} />;

  if (!business) return null;

  if (sheet.kind === 'restock') {
    const isFactory = item.production_rate > 0;
    const free = isFactory ? rawCapOf(item, business) - business.raw_stock : capOf(item, business) - business.stock;
    const unitCost = item.unit_cost * game.discount;
    const affordable = Math.floor(cash / unitCost);
    return (
      <QuantityPicker
        title={isFactory ? 'Закупить муку' : `Закупить ${item.product}`}
        hint={`${money(unitCost)} за ${isFactory ? 'муку на 1 буханку' : '1 шт.'}${game.discount < 1 ? ' (со скидкой)' : ''} · свободно на складе: ${count(free)}`}
        max={Math.min(free, affordable)}
        emptyText={free === 0 ? 'Склад полон' : 'Не хватает денег даже на 1 шт.'}
        busy={busy}
        confirm={(qty) => `Купить ${count(qty)} шт. за ${money(Math.ceil(qty * unitCost))}`}
        onConfirm={(qty) => onRestock(item.type, qty)}
      />
    );
  }

  if (sheet.kind === 'transfer') {
    const bakery = game.businesses.find((b) => b.type === 'bakery');
    const shop = game.businesses.find((b) => b.type === 'shop');
    const shopCap = shop ? capOf(game.catalog.find((c) => c.type === 'shop')!, shop) : 0;
    if (!bakery || !shop) return <p className="hint">Нужны и пекарня, и магазин.</p>;
    return (
      <QuantityPicker
        title="Перевезти хлеб в магазин"
        hint={`В пекарне: ${count(bakery.stock)} шт. · место в магазине: ${count(shopCap - shop.stock)}. Бесплатно — мука уже оплачена.`}
        max={Math.min(bakery.stock, shopCap - shop.stock)}
        emptyText={bakery.stock === 0 ? 'В пекарне нет хлеба' : 'Склад магазина полон'}
        busy={busy}
        confirm={(qty) => `Перевезти ${count(qty)} шт.`}
        onConfirm={onTransfer}
      />
    );
  }

  return (
    <PricePicker
      key={item.type}
      title={`Цена: ${item.name}`}
      current={business.price ?? item.ref_price!}
      reference={item.ref_price!}
      market={game.markets.find((m) => m.market === item.market)}
      product={item.product}
      busy={busy}
      onConfirm={(price) => onSetPrice(item.type, price)}
    />
  );
}

interface QuantityProps {
  title: string;
  hint: string;
  max: number;
  emptyText: string;
  busy: boolean;
  confirm: (qty: number) => string;
  onConfirm: (qty: number) => void;
}

function QuantityPicker({ title, hint, max, emptyText, busy, confirm, onConfirm }: QuantityProps) {
  const [qty, setQty] = useState(() => Math.min(max, 100));
  const clamp = (n: number) => {
    selectionTick();
    return Math.max(Math.min(1, max), Math.min(max, n));
  };

  return (
    <>
      <h2>{title}</h2>
      <p className="hint">{hint}</p>
      {max <= 0 ? (
        <p className="warning">{emptyText}</p>
      ) : (
        <>
          <div className="stepper">
            <button className="step" onClick={() => setQty(clamp(qty - 10))}>−10</button>
            <button className="step" onClick={() => setQty(clamp(qty - 1))}>−1</button>
            <div className="step-value">{count(qty)}</div>
            <button className="step" onClick={() => setQty(clamp(qty + 1))}>+1</button>
            <button className="step" onClick={() => setQty(clamp(qty + 10))}>+10</button>
          </div>
          <input
            className="slider"
            type="range"
            min={1}
            max={max}
            value={qty}
            onChange={(e) => setQty(Number(e.target.value))}
          />
          <div className="presets">
            {[50, 100, 200].filter((n) => n < max).map((n) => (
              <button key={n} className="chip" onClick={() => setQty(n)}>
                {n}
              </button>
            ))}
            <button className="chip" onClick={() => setQty(max)}>
              Максимум ({count(max)})
            </button>
          </div>
          <button className="button" disabled={busy || qty < 1} onClick={() => onConfirm(qty)}>
            {confirm(qty)}
          </button>
        </>
      )}
    </>
  );
}

interface PriceProps {
  title: string;
  current: number;
  reference: number;
  market?: Market;
  product: string;
  busy: boolean;
  onConfirm: (price: number) => void;
}

function PricePicker({ title, current, reference, market, product, busy, onConfirm }: PriceProps) {
  const min = Math.ceil((reference * 3) / 10 / 100) * 100;
  const max = reference * 3;
  const [price, setPrice] = useState(current);
  const change = (rub: number) => {
    selectionTick();
    setPrice((p) => Math.max(min, Math.min(max, p + rub * 100)));
  };

  const marketPrice = market?.market_price ?? reference;
  const ratio = price / marketPrice;
  const verdict =
    ratio < 0.85
      ? 'Дешевле рынка: покупателей больше, но с каждой продажи меньше прибыли.'
      : ratio > 1.15
        ? 'Дороже рынка: покупателей станет меньше.'
        : 'Около рыночной цены.';

  return (
    <>
      <h2>{title}</h2>
      <p className="hint">
        Сейчас на рынке {product} стоит около {money(marketPrice)}.
        {market && ` Спрос ${demandLabel(market.demand_level)}.`}
      </p>
      <div className="stepper">
        <button className="step" onClick={() => change(-10)}>−10</button>
        <button className="step" onClick={() => change(-1)}>−1</button>
        <div className="step-value">{money(price)}</div>
        <button className="step" onClick={() => change(1)}>+1</button>
        <button className="step" onClick={() => change(10)}>+10</button>
      </div>
      <p className="hint small center">{verdict}</p>
      <button className="button" disabled={busy || price === current} onClick={() => onConfirm(price)}>
        Поставить {money(price)}
      </button>
      {market && <Competitors market={market} />}
    </>
  );
}

function Competitors({ market }: { market: Market }) {
  return (
    <div className="competitors">
      <div className="stat-label small">Конкуренты в городе</div>
      <ul>
        {market.bots.map((b) => (
          <li key={b.name}>
            <span>
              {b.name} <span className="hint small">· {BOT_KIND[b.kind]}</span>
            </span>
            <b>{money(b.price)}</b>
          </li>
        ))}
        <li>
          <span>Игроки</span>
          <b>{market.players}</b>
        </li>
      </ul>
      {market.bots.length === 0 && (
        <p className="hint small">Ботов нет — в городе достаточно живых игроков.</p>
      )}
    </div>
  );
}

/** Открыть бизнес. Самый первый открывается сразу, следующие — строит выбранная бригада. */
function OpenBody({
  item, game, busy, onOpen,
}: {
  item: CatalogItem;
  game: GameState;
  busy: boolean;
  onOpen: (type: BusinessType, brigade?: BrigadeId) => void;
}) {
  const [brigade, setBrigade] = useState<BrigadeId>('standard');
  const builds = !!game.build && (game.businesses.length > 0 || (game.builds?.length ?? 0) > 0);
  const offer = builds ? brigadeOffer(game, brigade, 1, item.open_cost) : null;
  const price = offer?.price ?? item.open_cost;
  const full = builds && (game.builds?.length ?? 0) >= (game.build?.max_active ?? 2);
  const building = game.builds?.some((b) => b.new && b.type === item.type);
  return (
    <>
      <h2>
        <BizIcon type={item.type} /> {item.name}
      </h2>
      <p className="hint">{BUSINESS_INFO[item.type].about}</p>
      <p className="hint">
        {item.type === 'pvz'
          ? 'Посылки начнут приходить сами — от маркетплейсов игроков и жителей города.'
          : item.type === 'marketplace'
            ? 'После открытия перевези на его склад товар со своих бизнесов или купи на рынке.'
            : `После открытия склад будет пустым — не забудь закупить ${item.production_rate > 0 ? 'муку' : 'товар'}.`}
      </p>
      {builds && (
        <>
          <p className="hint small">
            Бизнес построит бригада — он заработает, когда стройку закончат. Участок выберется в лучшем свободном
            районе; выбрать место можно на карте.
          </p>
          <BrigadePicker game={game} level={1} base={item.open_cost} value={brigade} onChange={setBrigade} />
        </>
      )}
      {building && <p className="warning small">Такой бизнес уже строится.</p>}
      {full && !building && (
        <p className="warning small">Сейчас идут {game.builds?.length} стройки — это максимум. Дождись, пока одна закончится.</p>
      )}
      {game.player.cash < price && (
        <p className="warning small">Не хватает денег: нужно {money(price)}, у тебя {money(game.player.cash)}.</p>
      )}
      <button
        className="button"
        disabled={busy || game.player.cash < price || full || building}
        onClick={() => onOpen(item.type, builds ? brigade : undefined)}
      >
        {builds ? `Начать стройку за ${money(price)}` : `Открыть за ${money(price)}`}
      </button>
    </>
  );
}
