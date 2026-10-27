// Все запросы к серверу идут через одну функцию `api`.
// Клиент отправляет только действие; все числа считает и возвращает сервер.

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config';
import { tg } from './telegram';

export type BusinessType = 'coffee' | 'shop' | 'bakery';

export interface Player {
  id: string;
  first_name: string;
  cash: number; // все деньги — в копейках
  created_at: string;
  tutorial_step: number; // 0–2 — текущий шаг обучения, 3 — пройдено
  haptics?: boolean;
}

export interface PublicProfile {
  company: { name: string | null; icon: string | null; color: string | null; motto: string };
  league: string;
  title: string;
  capital: number;
  place: number | null;
  achievements: { code: string; earned_at: string }[];
}

export interface SeasonHistoryItem {
  season: number;
  place: number;
  total: number;
  capital: number;
  growth: number;
  theme: 'normal' | 'crisis';
}

export interface MyProfile extends PublicProfile {
  growth: number | null;
  businesses: number;
  streak: number;
  season: { number: number; theme: 'normal' | 'crisis'; ends_at: string } | null;
  history: SeasonHistoryItem[];
  referral: { code: string; invited: number };
  settings: { notify: boolean; haptics: boolean };
}

export interface Company {
  name: string;
  icon: string;
  color: string;
  motto: string;
  can_rename: boolean;
}

export interface CompanyInput {
  name: string;
  icon: string;
  color: string;
  motto: string;
}

export interface CatalogItem {
  type: BusinessType;
  name: string;
  product: string;
  open_cost: number;
  unit_cost: number;
  ref_price: number | null;
  capacity: number;
  raw_capacity: number;
  production_rate: number;
  market: 'coffee' | 'bread' | null;
}

export interface Bot {
  name: string;
  kind: 'dumper' | 'premium' | 'careful';
  price: number;
  last_sold: number;
}

export interface Market {
  market: 'coffee' | 'bread';
  name: string;
  ref_price: number;
  market_price: number;
  demand_level: number;
  sellers: number;
  players: number;
  last_demand: number;
  bots: Bot[];
}

export interface Business {
  id: string;
  type: BusinessType;
  price: number | null;
  stock: number;
  raw_stock: number;
  pending_revenue: number;
  last_sold: number;
}

export interface SummaryItem {
  type: BusinessType;
  sold: number;
  revenue: number;
  produced: number;
  stock: number;
  raw_stock: number;
}

export interface Decision {
  title: string;
  body: string;
  options: { label: string; hint: string }[];
  choice: number | null;
  result: string | null;
  success: boolean | null;
}

export interface Effect {
  label: string;
  kind: 'demand' | 'discount';
  market: string | null;
  mult: number;
  until: string;
}

export interface Season {
  number: number;
  starts_at: string;
  ends_at: string;
}

export interface SeasonResult {
  season: number;
  place: number;
  total: number;
  capital: number;
  growth: number;
}

export interface LeaderRow {
  id: string;
  place: number;
  name: string;
  icon: string | null;
  color: string | null;
  capital: number;
  growth: number;
  me: boolean;
}

export type LeaderKind = 'capital' | 'growth';

export interface Leaderboard {
  kind: LeaderKind;
  total: number;
  top: LeaderRow[];
  me: LeaderRow | null;
}

export interface GameState {
  server_time: string;
  player: Player;
  catalog: CatalogItem[];
  businesses: Business[];
  markets: Market[];
  capital: number;
  season: Season | null;
  decision: Decision | null;
  effects: Effect[];
  discount: number;
  company?: Company | null; // undefined — старый сервер без компаний
  // Ниже — поля для шапки и карточки «Капитал»; у старого сервера их нет.
  league?: string;
  league_place?: number;
  start_capital?: number;
  capital_history?: [number, number][]; // [секунды unix, копейки]
}

export interface LoginResult extends GameState {
  is_new: boolean;
  summary: { since: string; items: SummaryItem[] } | null;
  season_result: SeasonResult | null;
}

export class ApiError extends Error {}

async function call<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/api`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_PUBLISHABLE_KEY,
        'X-Telegram-Init-Data': tg?.initData ?? '',
      },
      body: JSON.stringify({ action, ...params }),
    });
  } catch {
    throw new ApiError('Нет связи с сервером. Проверь интернет.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Ошибка сервера (${res.status})`);
  return data as T;
}

type WithResult<R> = GameState & { result: R };

export const api = {
  login: () => call<LoginResult>('login'),
  state: () => call<WithResult<null>>('state'),
  openBusiness: (type: BusinessType) => call<WithResult<null>>('open_business', { type }),
  restock: (type: BusinessType, qty: number) => call<WithResult<null>>('restock', { type, qty }),
  transferBread: (qty: number) => call<WithResult<null>>('transfer_bread', { qty }),
  setPrice: (type: BusinessType, price: number) => call<WithResult<null>>('set_price', { type, price }),
  collect: () => call<WithResult<number>>('collect'),
  decide: (option: number) => call<WithResult<string>>('decide', { option }),
  createCompany: (c: CompanyInput) => call<WithResult<null>>('create_company', { ...c }),
  updateCompany: (c: CompanyInput) => call<WithResult<null>>('update_company', { ...c }),
  tutorial: (step: number) => call<WithResult<null>>('tutorial', { step }),
  profile: () => call<{ profile: MyProfile; bot_username: string | null }>('profile'),
  settings: (s: { notify?: boolean; haptics?: boolean }) => call<WithResult<null>>('settings', s),
  company: (id: string) => call<{ company: PublicProfile }>('company', { id }),
  leaderboard: (kind: LeaderKind) => call<{ leaderboard: Leaderboard }>('leaderboard', { kind }),
};
