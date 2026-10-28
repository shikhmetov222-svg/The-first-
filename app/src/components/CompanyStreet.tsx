import { Suspense, lazy, useState } from 'react';
import type { GameState, PublicProfile } from '../api';
import Street2D from '../street/Street2D';
import { companyStreet, type GameType } from '../street/views';
import { useSimpleStreet } from '../graphics';

const Street = lazy(() => import('../street/Street'));

/** Улица другой компании — только посмотреть: здания и уровни, район по её капиталу, её реклама на щите. */
export function CompanyStreet({
  profile,
  game,
  onClose,
}: {
  profile: PublicProfile;
  game: GameState;
  onClose: () => void;
}) {
  const simple = useSimpleStreet();
  const [picked, setPicked] = useState<string | null>(null);
  const { views, life } = companyStreet(profile.street!, profile.capital, game);
  const names = Object.fromEntries(game.catalog.map((c) => [c.type, c.name])) as Partial<Record<GameType, string>>;
  const select = (type: GameType, owned: boolean) => {
    const name = names[type] ?? 'Бизнес';
    setPicked(
      owned
        ? `${name} · уровень ${views[type].level} из 5`
        : `Участок продаётся — здесь может быть ${name.toLowerCase()}`,
    );
  };

  return (
    <div
      className="backdrop"
      onClick={(e) => {
        e.stopPropagation(); // не закрывать заодно карточку компании под улицей
        onClose();
      }}
    >
      <div className="sheet company-street" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <h2>Улица «{profile.company.name || 'Игрок'}»</h2>
        {simple ? (
          <Street2D views={views} life={life} names={names} onSelect={select} readOnly />
        ) : (
          <Suspense
            fallback={
              <div className="street-stage street-placeholder">
                <span>Строим улицу…</span>
              </div>
            }
          >
            <Street views={views} life={life} onSelect={select} readOnly />
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
