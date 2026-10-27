import {
  Anchor, Briefcase, Compass, Crown, Factory, Flame, Gem, Landmark, Mountain, Rocket, Shield, Zap,
  type LucideIcon,
} from 'lucide-react';

// Логотипы и цвета компании. Те же списки проверяет сервер.
export const LOGO_ICONS: Record<string, LucideIcon> = {
  crown: Crown,
  gem: Gem,
  rocket: Rocket,
  landmark: Landmark,
  briefcase: Briefcase,
  factory: Factory,
  anchor: Anchor,
  mountain: Mountain,
  flame: Flame,
  zap: Zap,
  shield: Shield,
  compass: Compass,
};

export const LOGO_COLORS: Record<string, string> = {
  gold: '#D4A73A',
  emerald: '#5FD39A',
  coral: '#F07167',
  amber: '#F2A65A',
  sky: '#5AB3F2',
  violet: '#A78BFA',
  rose: '#F472B6',
  silver: '#C4C8D0',
};

const ADJECTIVES = [
  'Северный', 'Золотой', 'Новый', 'Первый', 'Столичный', 'Восточный',
  'Западный', 'Южный', 'Верный', 'Гранд', 'Деловой', 'Городской',
];
const SURNAMES = ['Орлов', 'Соколов', 'Волков', 'Медведев', 'Лебедев', 'Морозов', 'Громов', 'Беркутов'];
const NOUNS = ['Капитал', 'Холдинг', 'Трест', 'Альянс', 'Инвест', 'Групп', 'Торг', 'Партнёры', 'Траст', 'Синдикат'];

const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];

/** «Северный Капитал», «Орлов Групп» и т. п. */
export function randomCompanyName(): string {
  for (;;) {
    const first = Math.random() < 0.6 ? pick(ADJECTIVES) : pick(SURNAMES);
    const name = `${first} ${pick(NOUNS)}`;
    if (name.length <= 24) return name;
  }
}

/** Быстрая проверка на телефоне, чтобы сразу подсказать. Окончательно проверяет сервер. */
export function nameProblem(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length < 3) return 'Минимум 3 символа';
  if (name.length > 24) return 'Максимум 24 символа';
  if (!/^[A-Za-zА-Яа-яЁё0-9 -]+$/.test(name)) return 'Только буквы, цифры, пробел и дефис';
  if (!/[A-Za-zА-Яа-яЁё]/.test(name)) return 'Нужна хотя бы одна буква';
  return null;
}
