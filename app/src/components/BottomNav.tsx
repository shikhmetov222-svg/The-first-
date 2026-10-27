import { Building2, CandlestickChart, Trophy, UserRound, type LucideIcon } from 'lucide-react';
import { haptic } from '../telegram';

export type Tab = 'empire' | 'market' | 'rating' | 'profile';

const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: 'empire', label: 'Империя', icon: Building2 },
  { id: 'market', label: 'Рынок', icon: CandlestickChart },
  { id: 'rating', label: 'Рейтинг', icon: Trophy },
  { id: 'profile', label: 'Профиль', icon: UserRound },
];

export function BottomNav({ tab, onChange }: { tab: Tab; onChange: (tab: Tab) => void }) {
  return (
    <nav className="bottom-nav">
      {TABS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          className={tab === id ? 'active' : ''}
          aria-current={tab === id ? 'page' : undefined}
          onClick={() => {
            if (tab !== id) haptic('light');
            onChange(id);
          }}
        >
          <Icon size={22} strokeWidth={tab === id ? 2.4 : 2} />
          {label}
        </button>
      ))}
    </nav>
  );
}
