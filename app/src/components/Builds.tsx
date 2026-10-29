import { HardHat } from 'lucide-react';
import type { BrigadeId, Build, GameState } from '../api';
import { duration, money } from '../format';
import { BizIcon } from './BizIcon';
import { useNow } from './useTick';

/** Этапы стройки и их доля во времени — как в макете. Сервер хранит только начало и конец. */
export const BUILD_STAGES: [string, number][] = [
  ['Котлован', 0.19],
  ['Фундамент', 0.19],
  ['Каркас', 0.27],
  ['Фасад и окна', 0.23],
  ['Благоустройство', 0.12],
];

/** Где сейчас стройка: доля 0…1, номер и название этапа, сколько осталось (мс). */
export function buildProgress(b: Pick<Build, 'started_at' | 'ends_at' | 'queued'>, now: number) {
  const start = new Date(b.started_at).getTime();
  const end = new Date(b.ends_at).getTime();
  const pct = b.queued ? 0 : Math.max(0, Math.min(1, (now - start) / Math.max(1, end - start)));
  let acc = 0;
  let stage = 0;
  for (; stage < BUILD_STAGES.length - 1; stage++) {
    if (pct < acc + BUILD_STAGES[stage][1]) break;
    acc += BUILD_STAGES[stage][1];
  }
  return { pct, stage, stageName: BUILD_STAGES[stage][0], left: Math.max(0, end - now) };
}

/** Цена и срок у бригады: base — цена у «Стандарта» (коп.), level — до какого уровня строим. */
export function brigadeOffer(game: GameState, id: BrigadeId, level: number, base: number) {
  const cfg = game.build;
  const br = cfg?.brigades.find((x) => x.id === id);
  const minutes = ((cfg?.minutes[level - 1] ?? 0) * (br?.time ?? 1)) / (cfg?.speed ?? 1);
  return { price: Math.round((base * (br?.price ?? 1)) / 100) * 100, minutes, name: br?.name ?? id };
}

/** Выбор бригады: цена и время у каждой. */
export function BrigadePicker({
  game, level, base, value, onChange,
}: {
  game: GameState;
  level: number;
  base: number;
  value: BrigadeId;
  onChange: (b: BrigadeId) => void;
}) {
  const ids: BrigadeId[] = ['econom', 'standard', 'express'];
  return (
    <div className="brigades" role="radiogroup" aria-label="Бригада">
      {ids.map((id) => {
        const o = brigadeOffer(game, id, level, base);
        return (
          <button
            key={id}
            role="radio"
            aria-checked={value === id}
            className={`brigade ${value === id ? 'chip-active' : ''}`}
            onClick={() => onChange(id)}
          >
            <b>{o.name}</b>
            <span>{money(o.price)}</span>
            <span className="stat-label">≈ {duration(o.minutes * 60000)}</span>
          </button>
        );
      })}
    </div>
  );
}

/** «Империя»: активные стройки с таймером до конца. */
export function BuildsCard({ game, serverOffset, onShow }: { game: GameState; serverOffset: number; onShow?: (b: Build) => void }) {
  const now = useNow(serverOffset, 1000);
  const builds = game.builds ?? [];
  if (!builds.length) return null;
  const names = Object.fromEntries(game.catalog.map((c) => [c.type, c.name]));
  return (
    <section className="card builds">
      <div className="builds-head">
        <HardHat size={18} />
        <b>Стройки</b>
        <span className="stat-label">
          {builds.length} из {game.build?.max_active ?? 2}
        </span>
      </div>
      {builds.map((b) => {
        const p = buildProgress(b, now);
        return (
          <button key={b.id} className="build-row" onClick={() => onShow?.(b)} disabled={!onShow}>
            <BizIcon type={b.type} />
            <span className="grow">
              <b>
                {b.new ? 'Новый бизнес' : 'Улучшение'}: {names[b.type] ?? b.type}, ур. {b.level}
              </b>
              <span className="stat-label">
                {b.queued ? `в очереди у бригады «${b.brigade}»` : `${p.stageName} · бригада «${b.brigade}»`}
              </span>
              <span className="bar-track" aria-hidden>
                <span className="bar-fill build" style={{ width: `${Math.round(p.pct * 100)}%` }} />
              </span>
            </span>
            <span className="build-time">
              <b>{Math.round(p.pct * 100)}%</b>
              <span className="stat-label">{p.left > 0 ? duration(p.left) : 'почти готово'}</span>
            </span>
          </button>
        );
      })}
    </section>
  );
}
