import { Target, Trophy, Wallet } from 'lucide-react';
import type { GameState } from '../api';
import { money, signedMoney } from '../format';
import { TICK_MS, useTickCountdown } from './useTick';
import { useCountUp } from './useCountUp';

const START_FALLBACK = 10_000_000;

interface Props {
  game: GameState;
  serverOffset: number;
  pending: number;
  busy: boolean;
  onCollect: () => void;
}

/** Главная карточка: капитал, изменение от старта, график за сутки, деньги и касса. */
export function CapitalCard({ game, serverOffset, pending, busy, onCollect }: Props) {
  const start = game.start_capital ?? START_FALLBACK;
  const diff = game.capital - start;
  const pct = Math.round((diff / start) * 100);
  const trend = diff > 0 ? 'up' : diff < 0 ? 'down' : '';
  const [capital, capitalDir] = useCountUp(game.capital);
  const [cash, cashDir] = useCountUp(game.player.cash);
  const [pendingShown] = useCountUp(pending, 600);

  return (
    <section className="card capital-card">
      <div className="capital-head">
        <span className="overline">Капитал</span>
        {game.league_place !== undefined && (
          <span className="place-badge">
            <Trophy size={13} /> #{game.league_place} в лиге
          </span>
        )}
      </div>
      <div className={`capital-big ${capitalDir ? `flash-${capitalDir}` : ''}`}>{money(capital)}</div>
      <div className={`capital-change ${trend}`}>
        {signedMoney(diff)} ({pct > 0 ? '+' : pct < 0 ? '−' : ''}
        {Math.abs(pct)}%) <span className="muted">от старта</span>
      </div>

      <RivalLine game={game} />

      <Sparkline points={game.capital_history ?? []} current={game.capital} serverOffset={serverOffset} />

      <div className="capital-tiles">
        <div className="tile">
          <span className="stat-label">
            <Wallet size={14} /> Деньги
          </span>
          <b className={cashDir ? `flash-${cashDir}` : ''}>{money(cash)}</b>
        </div>
        {pending > 0 ? (
          <button className="tile tile-collect" data-tour="collect" disabled={busy} onClick={onCollect}>
            <span>Забрать</span>
            <b>{money(pendingShown)}</b>
          </button>
        ) : (
          <TickTile serverOffset={serverOffset} />
        )}
      </div>
    </section>
  );
}

/** Круговой таймер до следующего расчёта рынка. */
function TickTile({ serverOffset }: { serverOffset: number }) {
  const left = useTickCountdown(serverOffset);
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  const r = 15;
  const c = 2 * Math.PI * r;
  const done = 1 - left / TICK_MS;

  return (
    <div className="tile tile-timer" data-tour="collect">
      <svg width="38" height="38" viewBox="0 0 38 38" aria-hidden="true">
        <circle cx="19" cy="19" r={r} fill="none" stroke="var(--border)" strokeWidth="3" />
        <circle
          cx="19"
          cy="19"
          r={r}
          fill="none"
          stroke="var(--gold)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - done)}
          transform="rotate(-90 19 19)"
        />
      </svg>
      <span>
        <span className="stat-label">Расчёт через</span>
        <b>
          {m}:{String(s).padStart(2, '0')}
        </b>
      </span>
    </div>
  );
}

/** Маленький график капитала за сутки: линия и лёгкая заливка. */
function Sparkline({ points, current, serverOffset }: { points: [number, number][]; current: number; serverOffset: number }) {
  const data = [...points.map(([t, v]) => [t * 1000, v] as const), [Date.now() + serverOffset, current] as const];
  if (data.length < 3) {
    return <div className="sparkline-empty">График появится после нескольких расчётов рынка</div>;
  }

  const W = 320;
  const H = 64;
  const t0 = data[0][0];
  const t1 = data[data.length - 1][0];
  const values = data.map((d) => d[1]);
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi === lo) {
    hi += 1;
    lo -= 1;
  }
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * W;
  const y = (v: number) => H - 4 - ((v - lo) / (hi - lo)) * (H - 8);
  const line = data.map(([t, v], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${W},${H} L0,${H} Z`;

  return (
    <svg className="sparkline" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Капитал за сутки">
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#D4A73A" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#D4A73A" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#spark-fill)" />
      <path d={line} fill="none" stroke="#D4A73A" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

/** «Золотая лига» → «в Золотую лигу». */
const toLeague = (name: string) => 'в ' + name.replace(/ая лига$/, 'ую лигу');

/** Ближняя цель: зона повышения или вылета в лиге и сколько до игрока выше. */
function RivalLine({ game }: { game: GameState }) {
  const lg = game.league_info;
  const r = game.rival;
  const place = game.league_place;
  const lines: { cls: string; icon: string; text: string }[] = [];
  if (lg && lg.place && lg.moves > 0) {
    if (lg.up_name && lg.place <= lg.moves) {
      lines.push({ cls: 'up', icon: '▲', text: `Зона повышения: в новом сезоне перейдёшь ${toLeague(lg.up_name)}` });
    } else if (lg.down_name && lg.place > lg.size - lg.moves) {
      lines.push({ cls: 'down', icon: '▼', text: `Зона вылета: если сезон закончится сейчас, опустишься ${toLeague(lg.down_name)}` });
    } else if (lg.up_name && lg.gap_up) {
      lines.push({ cls: '', icon: '▲', text: `До зоны повышения — ${money(lg.gap_up)}` });
    }
  }
  const ahead = lg?.ahead ?? r?.ahead;
  if (ahead) lines.push({ cls: '', icon: '', text: `До ${place && place > 1 ? `#${place - 1}` : 'места выше'} — ${money(ahead.gap)} · ${ahead.name}` });
  else if (!lg && r?.next_league) lines.push({ cls: '', icon: '', text: `Ты первый в лиге. До «${r.next_league.name}» — ${money(r.next_league.gap)}` });
  if (!lines.length) return null;
  return (
    <>
      {lines.map((l) => (
        <div key={l.text} className={`rival-line ${l.cls}`}>
          {l.icon ? <span aria-hidden>{l.icon}</span> : <Target size={14} aria-hidden />} {l.text}
        </div>
      ))}
    </>
  );
}
