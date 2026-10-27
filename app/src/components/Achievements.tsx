import { useState } from 'react';
import { Lock } from 'lucide-react';
import { ACHIEVEMENTS } from '../content';

/** Сетка достижений: полученные — золотые, остальные — серые; нажатие показывает, как получить. */
export function Achievements({ earned }: { earned: { code: string; earned_at: string }[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const got = new Map(earned.map((a) => [a.code, a.earned_at]));
  const current = ACHIEVEMENTS.find((a) => a.code === selected);

  return (
    <>
      <div className="badges">
        {ACHIEVEMENTS.map(({ code, title, icon: Icon }) => {
          const has = got.has(code);
          return (
            <button
              key={code}
              className={`badge ${has ? 'earned' : ''} ${selected === code ? 'selected' : ''}`}
              aria-label={`${title}${has ? ', получено' : ', не получено'}`}
              aria-pressed={selected === code}
              onClick={() => setSelected(selected === code ? null : code)}
            >
              <Icon size={22} />
              {!has && (
                <span className="badge-lock">
                  <Lock size={10} strokeWidth={3} />
                </span>
              )}
            </button>
          );
        })}
      </div>
      {current ? (
        <div className="badge-detail">
          <b>{current.title}</b>
          <span className="hint small">
            {got.has(current.code)
              ? `Получено ${new Date(got.get(current.code)!).toLocaleDateString('ru-RU')}`
              : current.hint}
          </span>
        </div>
      ) : (
        <p className="hint small" style={{ margin: 0 }}>
          Нажми на значок, чтобы узнать, как его получить.
        </p>
      )}
    </>
  );
}
