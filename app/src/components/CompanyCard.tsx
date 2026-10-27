import { Award, Pencil, Shield } from 'lucide-react';
import type { PublicProfile } from '../api';
import { CompanyLogo } from './CompanyLogo';

/** Карточка компании: логотип, название, девиз, лига и титул. */
export function CompanyCard({ profile, onEdit }: { profile: PublicProfile; onEdit?: () => void }) {
  const c = profile.company;
  return (
    <section className="card company-card">
      <div className="company-card-head">
        <CompanyLogo icon={c.icon ?? 'crown'} color={c.color ?? 'gold'} size={64} />
        <div className="grow">
          <div className="company-preview-name">{c.name ?? 'Компания без названия'}</div>
          {c.motto && <div className="company-motto">«{c.motto}»</div>}
        </div>
        {onEdit && (
          <button className="icon-button" aria-label="Изменить компанию" onClick={onEdit}>
            <Pencil size={18} />
          </button>
        )}
      </div>
      <div className="tags">
        <span className="tag">
          <Shield size={14} /> {profile.league}
        </span>
        <span className="tag gold">
          <Award size={14} /> {profile.title}
        </span>
      </div>
    </section>
  );
}
