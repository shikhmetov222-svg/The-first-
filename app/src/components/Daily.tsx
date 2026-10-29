import { CalendarCheck, CircleCheck, PartyPopper, TrafficCone } from 'lucide-react';
import type { CityEvent, DailyCode, DailyTasks, GameState } from '../api';
import { duration, money } from '../format';
import { useNow } from './useTick';

const TITLE: Record<DailyCode, (t: number) => string> = {
  sell: (t) => `Продай ${t.toLocaleString('ru-RU')} товаров`,
  revenue: (t) => `Заработай ${money(t)} на продажах`,
  market_buy: () => 'Купи что-нибудь у игрока на рынке',
  market_sell: () => 'Продай товар на рынке или оптовику',
  build: () => 'Начни стройку или улучшение',
  decision: () => 'Прими решение дня',
};

/** «Империя»: три задания на сегодня, награда за каждое и за все сразу. */
export function DailyCard({ daily, busy, onClaim }: { daily: DailyTasks; busy: boolean; onClaim: (code: string) => void }) {
  const items = daily.items ?? [];
  if (!items.length) return null;
  const done = items.filter((i) => i.claimed).length;
  return (
    <section className="card daily">
      <div className="builds-head">
        <CalendarCheck size={18} />
        <b>Задания дня</b>
        <span className="stat-label">
          {done} из {items.length}
        </span>
      </div>
      {items.map((t) => {
        const ready = t.progress >= t.target && !t.claimed;
        const pct = Math.round((Math.min(t.progress, t.target) / Math.max(1, t.target)) * 100);
        return (
          <div key={t.code} className={`daily-row ${t.claimed ? 'claimed' : ''}`}>
            <span className="grow">
              <b>{TITLE[t.code]?.(t.target) ?? t.code}</b>
              {t.target > 1 && (
                <>
                  <span className="stat-label">
                    {t.code === 'revenue' ? `${money(t.progress)} из ${money(t.target)}` : `${t.progress} из ${t.target}`}
                  </span>
                  <span className="bar-track" aria-hidden>
                    <span className="bar-fill" style={{ width: `${pct}%` }} />
                  </span>
                </>
              )}
            </span>
            {t.claimed ? (
              <span className="daily-done">
                <CircleCheck size={18} /> Готово
              </span>
            ) : (
              <button className={`button small daily-claim ${ready ? '' : 'secondary'}`} disabled={!ready || busy} onClick={() => onClaim(t.code)}>
                +{money(daily.reward)}
              </button>
            )}
          </div>
        );
      })}
      <p className="hint small" style={{ margin: 0 }}>
        {done === items.length
          ? 'Всё выполнено. Новые задания — завтра.'
          : `За все три — ещё +${money(daily.bonus)}. Новые задания каждый день.`}
      </p>
    </section>
  );
}

const DISTRICT_NAME: Record<string, string> = {
  center: 'Старый город', sleep: 'Спальный район', private: 'Частный сектор',
  business: 'Деловой квартал', industry: 'Промзона', newres: 'Новый район',
};

/** Событие в городе: что происходит, в каком районе, кого касается, сколько осталось. */
export function EventCard({ game, serverOffset, compact = false, onShow }: {
  game: GameState;
  serverOffset: number;
  compact?: boolean;
  onShow?: (e: CityEvent) => void;
}) {
  const now = useNow(serverOffset, 1000);
  const events = (game.events ?? []).filter((e) => new Date(e.ends_at).getTime() > now);
  const e = events[0];
  if (!e) return null;
  const active = new Date(e.starts_at).getTime() <= now;
  const bad = e.mult < 1;
  const pct = Math.round(Math.abs(e.mult - 1) * 100);
  const names = Object.fromEntries(game.catalog.map((c) => [c.type, c.name]));
  const who = e.types ? e.types.map((t) => names[t] ?? t).join(', ') : 'все бизнесы';
  const mine = game.businesses.filter((b) => !e.types || e.types.includes(b.type)).length > 0;
  const Icon = bad ? TrafficCone : PartyPopper;
  return (
    <section className={`card event-card ${bad ? 'bad' : ''} ${compact ? 'compact' : ''}`}>
      <div className="event-head">
        <Icon size={18} />
        <b className="grow">{e.title}</b>
        <span className="stat-label">
          {active
            ? `ещё ${duration(new Date(e.ends_at).getTime() - now)}`
            : `через ${duration(new Date(e.starts_at).getTime() - now)}`}
        </span>
      </div>
      {!compact && <p className="hint small" style={{ margin: 0 }}>{e.body}</p>}
      <div className="event-meta">
        <span className={`tag ${bad ? 'warn' : 'gold'}`}>
          {bad ? '▼' : '▲'} {bad ? '−' : '+'}
          {pct}% покупателей
        </span>
        <span className="stat-label">
          {DISTRICT_NAME[e.district] ?? e.district} · {who}
        </span>
        {onShow && (
          <button className="link-button" onClick={() => onShow(e)}>
            На карте
          </button>
        )}
      </div>
      {!compact && mine && !bad && active && (
        <p className="hint small" style={{ margin: 0 }}>
          Бизнесы этого типа в районе события продают больше — пополни склад заранее.
        </p>
      )}
    </section>
  );
}
