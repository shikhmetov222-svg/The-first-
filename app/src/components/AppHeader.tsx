import { Clock } from 'lucide-react';
import type { GameState } from '../api';
import { shortDuration } from '../format';
import { CompanyLogo } from './CompanyLogo';
import { useNow } from './useTick';

/** Шапка: логотип и название компании, «Лига · Сезон N», чип с таймером до конца сезона. */
export function AppHeader({ game, serverOffset }: { game: GameState; serverOffset: number }) {
  const now = useNow(serverOffset);
  const company = game.company;
  const name = company?.name ?? game.player.first_name ?? 'Компания';
  const left = game.season ? new Date(game.season.ends_at).getTime() - now : 0;
  const sub = [game.league, game.season && `Сезон ${game.season.number}`].filter(Boolean).join(' · ');

  return (
    <header className="app-header">
      {company ? (
        <CompanyLogo icon={company.icon} color={company.color} size={42} />
      ) : (
        <span className="company-logo initials" style={{ width: 42, height: 42, borderRadius: 13 }}>
          {name.slice(0, 2).toUpperCase()}
        </span>
      )}
      <div className="grow">
        <div className="app-header-name">{name}</div>
        <div className="stat-label">{sub}</div>
      </div>
      {game.season && (
        <span className="chip-timer" aria-label="До конца сезона">
          <Clock size={14} />
          {left > 0 ? shortDuration(left) : 'итоги'}
        </span>
      )}
    </header>
  );
}
