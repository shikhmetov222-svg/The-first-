import { Suspense, lazy, useMemo, useState } from 'react';
import type { Business, GameState, PublicProfile } from '../api';
import { DISTRICTS, STAGE_OF, cityPlots, districtOf, type CityPlot } from '../city/views';
import type { MapPick } from '../city/City';
import { LOGO_COLORS } from '../company';
import { useLowGraphics, useSimpleStreet } from '../graphics';
import { BizIcon } from './BizIcon';

const City = lazy(() => import('../city/City'));
const NO_REQUEST = { n: 0 };

/** Город другой компании — только посмотреть: её бизнесы, их уровни и районы, что сейчас строится. */
export function CompanyCity({ profile, game, onClose }: { profile: PublicProfile; game: GameState; onClose: () => void }) {
  const simple = useSimpleStreet();
  const low = useLowGraphics();
  const [picked, setPicked] = useState<string | null>(null);
  const c = profile.city!;
  const name = profile.company.name || 'Игрок';
  const owner = useMemo(
    // me: true — бизнесы компании на золотом подиуме и с метками, как свои на твоей карте; на метке — её буква.
    () => ({ name, color: LOGO_COLORS[profile.company.color ?? ''] ?? '#F07167', me: true }),
    [name, profile.company.color],
  );
  const names = Object.fromEntries(game.catalog.map((x) => [x.type, x.name])) as Record<string, string>;

  // Тот же расчёт участков, что и у своей карты, — только от лица этой компании и без свободных участков.
  const plots = useMemo<CityPlot[]>(() => {
    const view = {
      ...game,
      businesses: c.businesses.map((b) => ({ type: b.type, level: b.level ?? 1 })) as unknown as Business[],
      builds: c.builds.map((b) => ({ ...b, brigade: b.brigade ?? 'бригада компании' })),
      city: { seed: c.seed, stage: c.stage, caps: c.caps, other_mult: 1, plots: c.plots },
      company: game.company ? { ...game.company, name } : game.company,
    } as GameState;
    return cityPlots(view, null)
      .filter((p) => !p.lot || p.srv)
      .map((p) => ({ ...p, owner: p.lot ? undefined : owner, srv: p.srv ? { ...p.srv, owner } : undefined }));
  }, [c, game, name, owner]);

  const onPick = (p: MapPick | null) => {
    if (!p) return setPicked(null);
    if (p.kind === 'plot') {
      const t = p.plot.game ?? p.plot.srv?.game;
      setPicked(
        p.plot.lot
          ? `Здесь строится: ${names[t ?? ''] ?? 'бизнес'} · ${DISTRICTS[p.district].name}`
          : `${names[t ?? ''] ?? 'Бизнес'} · уровень ${p.plot.level} из 5 · ${DISTRICTS[p.district].name}`,
      );
    } else if (p.kind === 'site') setPicked(`${DISTRICTS[p.district].name} — у этой компании район ещё закрыт`);
    else setPicked(p.info.kind);
  };

  const open = (Object.keys(DISTRICTS) as (keyof typeof DISTRICTS)[]).filter((d) => STAGE_OF[d] <= c.stage).length;

  return (
    <div
      className="backdrop"
      onClick={(e) => {
        e.stopPropagation(); // не закрывать заодно карточку компании под городом
        onClose();
      }}
    >
      <div className="sheet company-street" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <h2>Город «{name}»</h2>
        <p className="hint small" style={{ margin: 0 }}>
          Районов: {open} из 6 · бизнесов: {c.businesses.length}
          {c.builds.length ? ` · строится: ${c.builds.length}` : ''}
        </p>
        {simple ? (
          <ul className="list">
            {c.plots.map((p) => {
              const b = c.businesses.find((x) => x.type === p.type);
              const d = districtOf(p.i, p.j);
              return (
                <li key={p.type}>
                  <span>
                    <BizIcon type={p.type as never} /> {names[p.type] ?? p.type}
                  </span>
                  <span className="right stat-label">
                    ур. {b?.level ?? 1} · {d === 'park' ? 'Парк' : DISTRICTS[d].name}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <Suspense
            fallback={
              <div className="city-stage street-placeholder">
                <span>Строим город…</span>
              </div>
            }
          >
            <City
              seed={c.seed}
              stage={c.stage}
              caps={c.caps}
              plots={plots}
              me={owner}
              heat={false}
              request={NO_REQUEST}
              onPick={onPick}
              serverOffset={0}
              low={low}
              pin={{ label: (name.trim()[0] ?? '?').toUpperCase(), color: owner.color }}
            />
          </Suspense>
        )}
        <p className="hint small center" aria-live="polite">
          {picked ?? 'Только просмотр. Нажми на здание, чтобы узнать, что это.'}
        </p>
        <button className="button ghost" onClick={onClose}>
          Закрыть
        </button>
      </div>
    </div>
  );
}
