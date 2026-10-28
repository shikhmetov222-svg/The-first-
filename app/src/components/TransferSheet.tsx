import { useState } from 'react';
import type { GameState, Product, Source } from '../api';
import { SELL_SOURCES } from '../content';
import { count } from '../format';
import { available, capOf } from '../market';
import { selectionTick } from '../telegram';

/** Перевезти товар со своих бизнесов на склад маркетплейса. */
export function TransferSheet({
  game, busy, onTransfer, onClose,
}: {
  game: GameState;
  busy: boolean;
  onTransfer: (p: { product: Product; source: Source; qty: number }) => void;
  onClose: () => void;
}) {
  const mp = game.businesses.find((b) => b.type === 'marketplace');
  const item = game.catalog.find((c) => c.type === 'marketplace');
  const cap = item ? capOf(item, mp) : 0;
  const goods = mp?.goods ?? {};
  const free = Math.max(0, cap - ((goods.coffee ?? 0) + (goods.bread ?? 0) + (goods.flour ?? 0)));
  const options = SELL_SOURCES.filter((o) => o.product !== 'campaign' && game.businesses.some((b) => b.type === o.source));
  const [pick, setPick] = useState(options.find((o) => available(game, o.product, o.source) > 0) ?? options[0]);
  const have = pick ? available(game, pick.product, pick.source) : 0;
  const max = Math.min(have, free);
  const [qty, setQty] = useState(Math.min(max, 50) || 1);
  const q = Math.max(1, Math.min(qty, max));
  const set = (n: number) => {
    selectionTick();
    setQty(Math.max(1, Math.min(max, n)));
  };

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <h2>В маркетплейс</h2>
        <p className="hint">Свободно на складе маркетплейса: {count(free)} шт.</p>
        {options.length === 0 ? (
          <p className="warning">Сначала открой кофейню, магазин или пекарню — товар берётся с их складов.</p>
        ) : (
          <>
            <div className="dev-row">
              {options.map((o) => (
                <button
                  key={o.label}
                  className={`chip ${o === pick ? 'chip-active' : ''}`}
                  onClick={() => {
                    setPick(o);
                    setQty(Math.min(available(game, o.product, o.source), free, 50) || 1);
                  }}
                >
                  {o.label} · {count(available(game, o.product, o.source))}
                </button>
              ))}
            </div>
            {max <= 0 ? (
              <p className="warning">{free <= 0 ? 'Склад маркетплейса полон' : 'На этом складе пусто'}</p>
            ) : (
              <>
                <div className="stepper">
                  <button className="step" onClick={() => set(q - 10)}>−10</button>
                  <button className="step" onClick={() => set(q - 1)}>−1</button>
                  <div className="step-value">{count(q)}</div>
                  <button className="step" onClick={() => set(q + 1)}>+1</button>
                  <button className="step" onClick={() => set(q + 10)}>+10</button>
                </div>
                {max > 1 && (
                  <input className="slider" type="range" min={1} max={max} value={q} onChange={(e) => setQty(Number(e.target.value))} />
                )}
                <button className="button" disabled={busy} onClick={() => onTransfer({ product: pick.product, source: pick.source, qty: q })}>
                  Перевезти {count(q)} шт.
                </button>
              </>
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
