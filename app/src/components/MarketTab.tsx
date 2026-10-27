import { CandlestickChart } from 'lucide-react';
import type { GameState } from '../api';
import { demandLabel } from '../content';
import { money } from '../format';

/** Вкладка «Рынок» — пока простая: текущие цены и конкуренты. Графики появятся позже. */
export function MarketTab({ game }: { game: GameState }) {
  return (
    <>
      <section className="card placeholder">
        <div className="placeholder-icon">
          <CandlestickChart size={28} />
        </div>
        <h2>Биржа города</h2>
        <p className="hint">Скоро здесь появятся графики цен и спроса. Пока — главное о рынке.</p>
      </section>

      {game.markets.map((m) => (
        <section key={m.market} className="card">
          <div className="section-title" style={{ margin: '0 0 8px' }}>
            <span>Рынок: {m.name}</span>
            <span className="stat-label">спрос {demandLabel(m.demand_level)}</span>
          </div>
          <ul className="list">
            <li>
              <span className="hint small" style={{ margin: 0 }}>Рыночная цена</span>
              <b>{money(m.market_price)}</b>
            </li>
            <li>
              <span className="hint small" style={{ margin: 0 }}>Продавцов (из них игроков)</span>
              <b>
                {m.sellers} ({m.players})
              </b>
            </li>
            {m.bots.map((b) => (
              <li key={b.name}>
                <span>{b.name}</span>
                <b>{money(b.price)}</b>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
