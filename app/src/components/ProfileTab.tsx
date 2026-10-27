import { useCallback, useEffect, useState } from 'react';
import { Bell, Copy, Flame, Send, Vibrate } from 'lucide-react';
import { api, type GameState, type MyProfile } from '../api';
import { count, money } from '../format';
import { notify, requestWriteAccess, setHapticsEnabled, shareLink } from '../telegram';
import { Achievements } from './Achievements';
import { CompanyCard } from './CompanyCard';

interface Props {
  game: GameState;
  onEditCompany: () => void;
  onToast: (text: string, error?: boolean) => void;
}

export function ProfileTab({ game, onEditCompany, onToast }: Props) {
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [bot, setBot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .profile()
      .then((r) => {
        setProfile(r.profile);
        setBot(r.bot_username);
        setError(null);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  // Перезагружаем при изменении капитала или компании — данные профиля считает сервер.
  useEffect(load, [load, game.capital, game.company?.name, game.company?.icon, game.company?.color, game.company?.motto]);

  if (error && !profile) return <p className="warning">{error}</p>;
  if (!profile) return <p className="hint center">Загружаем профиль…</p>;

  const link = bot ? `https://t.me/${bot}?startapp=ref_${profile.referral.code}` : null;
  const growth = profile.growth ?? 0;

  const changeSetting = async (key: 'notify' | 'haptics', value: boolean) => {
    if (key === 'notify' && value && !(await requestWriteAccess())) {
      onToast('Разреши боту писать тебе, чтобы получать уведомления', true);
      return;
    }
    if (key === 'haptics') setHapticsEnabled(value);
    setProfile({ ...profile, settings: { ...profile.settings, [key]: value } });
    try {
      await api.settings({ [key]: value });
      if (value) notify('success');
    } catch (e) {
      onToast((e as Error).message, true);
      load();
    }
  };

  return (
    <>
      <CompanyCard profile={profile} onEdit={onEditCompany} />

      <h2 className="section-title">
        <span>Сезон {profile.season?.number ?? '—'}</span>
        {profile.season?.theme === 'crisis' && <span className="tag warn">Кризис</span>}
      </h2>
      <section className="stats-grid">
        <div className="stat-tile">
          <span className="stat-label">Капитал</span>
          <b>{money(profile.capital)}</b>
        </div>
        <div className="stat-tile">
          <span className="stat-label">Место</span>
          <b>{profile.place ? `#${profile.place}` : '—'}</b>
        </div>
        <div className="stat-tile">
          <span className="stat-label">Рост за сутки</span>
          <b className={growth > 0 ? 'up' : growth < 0 ? 'down' : ''}>
            {growth > 0 ? '▲ +' : growth < 0 ? '▼ ' : ''}
            {String(growth).replace('.', ',')}%
          </b>
        </div>
        <div className="stat-tile">
          <span className="stat-label">Бизнесов</span>
          <b>{profile.businesses} из 3</b>
        </div>
      </section>
      {profile.streak > 1 && (
        <p className="streak">
          <Flame size={16} /> {profile.streak} {plural(profile.streak, 'день', 'дня', 'дней')} подряд в игре
        </p>
      )}

      <h2 className="section-title">
        <span>Достижения</span>
        <span className="stat-label">
          {profile.achievements.length} из 10
        </span>
      </h2>
      <section className="card">
        <Achievements earned={profile.achievements} />
      </section>

      <h2 className="section-title">История сезонов</h2>
      <section className="card">
        {profile.history.length === 0 ? (
          <p className="hint small" style={{ margin: 0 }}>
            Итоги появятся, когда закончится твой первый сезон.
          </p>
        ) : (
          <ul className="list">
            {profile.history.map((h) => (
              <li key={h.season}>
                <span>
                  Сезон {h.season}
                  {h.theme === 'crisis' && <span className="tag warn small-tag">Кризис</span>}
                </span>
                <span className="right">
                  <b>
                    #{h.place} <span className="stat-label">из {h.total}</span>
                  </b>
                  <div className="stat-label">{money(h.capital)}</div>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <h2 className="section-title">
        <span>Пригласить друга</span>
        <span className="stat-label">приглашено: {count(profile.referral.invited)}</span>
      </h2>
      <section className="card invite">
        <p className="hint small" style={{ margin: 0 }}>
          Друг откроет игру по твоей ссылке — и он засчитается тебе. За первого друга — достижение «Друг в деле».
        </p>
        {link ? (
          <>
            <div className="invite-link">{link.replace('https://', '')}</div>
            <div className="actions">
              <button
                className="button"
                onClick={() => shareLink(link, 'Залетай в CAPITAL — посоревнуемся, у кого бизнес круче!')}
              >
                <Send size={18} /> Поделиться
              </button>
              <button
                className="icon-button"
                aria-label="Скопировать ссылку"
                onClick={() =>
                  navigator.clipboard
                    ?.writeText(link)
                    .then(() => onToast('Ссылка скопирована'))
                    .catch(() => onToast('Не удалось скопировать', true))
                }
              >
                <Copy size={18} />
              </button>
            </div>
          </>
        ) : (
          <p className="warning small">Не удалось получить ссылку. Попробуй позже.</p>
        )}
      </section>

      <h2 className="section-title">Настройки</h2>
      <section className="card settings">
        <Toggle
          icon={<Bell size={20} />}
          title="Уведомления от бота"
          hint="Сообщения о важных событиях в игре"
          checked={profile.settings.notify}
          onChange={(v) => changeSetting('notify', v)}
        />
        <Toggle
          icon={<Vibrate size={20} />}
          title="Вибрация"
          hint="Отклик при покупках и сборе выручки"
          checked={profile.settings.haptics}
          onChange={(v) => changeSetting('haptics', v)}
        />
      </section>
    </>
  );
}

function Toggle(props: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="toggle-row">
      <span className="toggle-icon">{props.icon}</span>
      <span className="grow">
        <b>{props.title}</b>
        <span className="stat-label">{props.hint}</span>
      </span>
      <input
        type="checkbox"
        role="switch"
        className="switch"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
      />
    </label>
  );
}

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2);
  return letters.toUpperCase() || 'К';
}
