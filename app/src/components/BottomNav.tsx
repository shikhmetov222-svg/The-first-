import { Building2, CandlestickChart, Trophy, UserRound, Wrench, type LucideIcon } from 'lucide-react';
import { haptic } from '../telegram';

export type Tab = 'empire' | 'market' | 'rating' | 'profile' | 'dev';

const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: 'empire', label: 'Империя', icon: Building2 },
  { id: 'market', label: 'Рынок', icon: CandlestickChart },
  { id: 'rating', label: 'Рейтинг', icon: Trophy },
  { id: 'profile', label: 'Профиль', icon: UserRound },
];

export function BottomNav({ tab, onChange, dev }: { tab: Tab; onChange: (tab: Tab) => void; dev?: boolean }) {
  const tabs = dev ? [...TABS, { id: 'dev' as Tab, label: 'DEV', icon: Wrench }] : TABS;
  return (
    <nav className="bottom-nav">
      {tabs.map(({ id, label, icon: Icon }) => (
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
