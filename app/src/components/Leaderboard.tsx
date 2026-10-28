import { useEffect, useState } from 'react';
import { api, type GameState, type LeaderKind, type Leaderboard as Board, type Season } from '../api';
import { duration, money } from '../format';
import { ChevronRight, Medal } from 'lucide-react';
import type { LeaderRow } from '../api';
import { CompanyLogo } from './CompanyLogo';
import { CompanySheet } from './CompanySheet';
import { DevBadge } from './DevBadge';

const PODIUM = ['gold', 'silver', 'bronze'];

export function Leaderboard({ season, serverOffset, game }: { season: Season | null; serverOffset: number; game: GameState }) {
  const [kind, setKind] = useState<LeaderKind>('capital');
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    api
      .leaderboard(kind)
      .then((r) => alive && setBoard(r.leaderboard))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [kind]);

  const left = season ? new Date(season.ends_at).getTime() - (Date.now() + serverOffset) : 0;
  const meInTop = board?.top.some((r) => r.me);

  return (
    <>
      {season && (
        <section className="card season">
          <div>
            <div className="stat-label">Сезон {season.number}</div>
            <b>{left > 0 ? `до конца ${duration(left)}` : 'подводим итоги…'}</b>
          </div>
          <p className="hint small">
            В конце сезона все начинают заново со 100&nbsp;000&nbsp;₽. Боты в рейтинге не участвуют.
          </p>
        </section>
      )}

      <div className="segmented">
        <button className={kind === 'capital' ? 'active' : ''} onClick={() => setKind('capital')}>
          По капиталу
        </button>
        <button className={kind === 'growth' ? 'active' : ''} onClick={() => setKind('growth')}>
          Рост за сутки
        </button>
      </div>

      <section className="card leaderboard">
        {error && <p className="warning">{error}</p>}
        {!board && !error && <p className="hint center">Загружаем рейтинг…</p>}
        {board && (
          <>
            <p className="hint small">
              {kind === 'capital'
                ? 'Капитал = деньги + выручка в кассах + товар на складах + 70% стоимости бизнесов.'
                : 'На сколько процентов вырос капитал за последние 24 часа.'}
            </p>
            <ol>
              {board.top.map((r) => (
                <Row key={r.id ?? r.place} row={r} kind={kind} onOpen={setOpenId} />
              ))}
            </ol>
            {board.me && !meInTop && (
              <ol className="me-row">
                <Row row={{ ...board.me, me: true }} kind={kind} onOpen={setOpenId} />
              </ol>
            )}
            <p className="hint small center">Игроков в сезоне: {board.total}</p>
          </>
        )}
      </section>

      {openId && <CompanySheet id={openId} game={game} onClose={() => setOpenId(null)} />}
    </>
  );
}

function Row({ row, kind, onOpen }: { row: LeaderRow; kind: LeaderKind; onOpen: (id: string) => void }) {
  const growth = `${row.growth > 0 ? '▲ +' : row.growth < 0 ? '▼ ' : ''}${String(row.growth).replace('.', ',')}%`;
  return (
    <li className={row.me ? 'me' : ''}>
      <button className="leader-row" disabled={!row.id} onClick={() => row.id && onOpen(row.id)}>
        <span className={`place ${PODIUM[row.place - 1] ?? ''}`}>
          {row.place <= 3 ? <Medal size={20} aria-label={`${row.place} место`} /> : row.place}
        </span>
        {row.icon ? (
          <CompanyLogo icon={row.icon} color={row.color ?? 'gold'} size={36} />
        ) : (
          <span className="logo-fallback">{row.name.slice(0, 1).toUpperCase()}</span>
        )}
        <span className="name">
          {row.name || 'Игрок'}
          {row.dev && <DevBadge />}
          {row.me && <span className="you"> · ты</span>}
        </span>
        <span
          className={`value ${kind === 'growth' ? (row.growth > 0 ? 'up' : row.growth < 0 ? 'down' : '') : ''}`}
        >
          {kind === 'capital' ? money(row.capital) : growth}
        </span>
        <ChevronRight size={16} className="chevron" />
      </button>
    </li>
  );
}
