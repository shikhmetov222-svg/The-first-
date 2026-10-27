import { UserRound } from 'lucide-react';
import type { GameState } from '../api';
import { money } from '../format';

/** Вкладка «Профиль» — заглушка в новом стиле. */
export function ProfileTab({ game }: { game: GameState }) {
  const name = game.player.first_name || 'Игрок';
  return (
    <>
      <section className="card" style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
        <div className="avatar">{initials(name)}</div>
        <div className="grow">
          <h2 style={{ margin: 0 }}>{name}</h2>
          <div className="stat-label">Сезон {game.season?.number ?? '—'} · Капитал {money(game.capital)}</div>
        </div>
      </section>
      <section className="card placeholder">
        <div className="placeholder-icon">
          <UserRound size={28} />
        </div>
        <h2>Профиль скоро</h2>
        <p className="hint">Здесь будут твоя компания, достижения и итоги прошлых сезонов.</p>
      </section>
    </>
  );
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2);
  return letters.toUpperCase() || 'К';
}
