import { Check, Clock3, Link2, Lock } from 'lucide-react';
import type { BusinessType, GameState } from '../api';
import { CATEGORIES } from '../content';
import { money } from '../format';
import { BizIcon } from './BizIcon';

/** «Открыть бизнес»: каталог по разделам. Открытие — тем же окном, что и раньше. */
export function CatalogSheet({ game, onPick, onClose }: { game: GameState; onPick: (type: BusinessType) => void; onClose: () => void }) {
  const owned = new Set(game.businesses.map((b) => b.type));
  const cash = game.player.cash;

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="sheet catalog" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <h2>Открыть бизнес</h2>
        {CATEGORIES.map((cat) => {
          const items = game.catalog.filter((c) => (c.category ?? 'classic') === cat.id);
          if (items.length === 0) return null;
          return (
            <div key={cat.id} className="catalog-section">
              <div className="overline">{cat.title}</div>
              {items.map((c) => {
                const has = owned.has(c.type);
                const enough = cash >= c.open_cost;
                const pct = Math.min(100, Math.floor((cash / c.open_cost) * 100));
                return (
                  <div key={c.type} className={`catalog-card ${has ? 'owned' : enough ? '' : 'locked'}`}>
                    <div className="biz-head">
                      <BizIcon type={c.type} />
                      <div className="grow">
                        <b>{c.name}</b>
                        <div className="stat-label">{c.description}</div>
                      </div>
                      <b className="catalog-price">{money(c.open_cost)}</b>
                    </div>
                    {c.link_text && (
                      <div className="catalog-meta">
                        <Link2 size={13} /> {c.link_text}
                      </div>
                    )}
                    {c.payback_days ? (
                      <div className="catalog-meta">
                        <Clock3 size={13} /> Окупаемость ≈ {String(c.payback_days).replace('.', ',')} дн.
                      </div>
                    ) : null}
                    {has ? (
                      <div className="catalog-owned">
                        <Check size={16} /> Уже есть
                      </div>
                    ) : enough ? (
                      <button className="button small" data-tour={`open-${c.type}`} onClick={() => onPick(c.type)}>
                        Открыть за {money(c.open_cost)}
                      </button>
                    ) : (
                      <div>
                        <div className="bar-text">
                          <span>
                            <Lock size={12} /> {money(cash)} из {money(c.open_cost)}
                          </span>
                          <span>{pct}%</span>
                        </div>
                        <div className="bar-track">
                          <div className="bar-fill" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
        <button className="button ghost" onClick={onClose}>
          Закрыть
        </button>
      </div>
    </div>
  );
}
