import { useEffect, useState } from 'react';
import { Trophy } from 'lucide-react';
import { api, type PublicProfile } from '../api';
import { money } from '../format';
import { Achievements } from './Achievements';
import { CompanyCard } from './CompanyCard';

/** Карточка чужой (или своей) компании из рейтинга. */
export function CompanySheet({ id, onClose }: { id: string; onClose: () => void }) {
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .company(id)
      .then((r) => alive && setProfile(r.company))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [id]);

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        {error && <p className="warning">{error}</p>}
        {!profile && !error && <p className="hint center">Загружаем компанию…</p>}
        {profile && (
          <>
            <CompanyCard profile={profile} />
            <div className="stats-grid">
              <div className="stat-tile">
                <span className="stat-label">Место в сезоне</span>
                <b>
                  <Trophy size={16} className="inline-icon" /> {profile.place ? `#${profile.place}` : '—'}
                </b>
              </div>
              <div className="stat-tile">
                <span className="stat-label">Капитал</span>
                <b>{money(profile.capital)}</b>
              </div>
            </div>
            <div className="section-title" style={{ margin: '4px 2px 0' }}>
              <span>Достижения</span>
              <span className="stat-label">{profile.achievements.length} из 10</span>
            </div>
            <Achievements earned={profile.achievements} />
          </>
        )}
        <button className="button ghost" onClick={onClose}>
          Закрыть
        </button>
      </div>
    </div>
  );
}
