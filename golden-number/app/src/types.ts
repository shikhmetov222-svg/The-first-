import type { Stats } from '../../supabase/functions/_shared/game/logic.ts';

// Ответы сервера. Все суммы — в копейках.

export interface Sim {
  id: string;
  country: string;
  operator: string;
  prefix: string;
  sub: string;
  label: string;
  mul: number;
  tier: 'legend' | 'epic' | 'rare' | 'nice' | 'common';
  tags: string[];
  stake: number;
  value: number;
  luck: number;
  is_free: boolean;
  created_at: string;
}

export interface State {
  telegram_id?: number;
  balance: number;
  xp: number;
  level: number;
  collection_value: number;
  collection_count: number;
  kassa_acc: number;
  server_now: string;
  bailout_at: string | null;
  total_spins: number;
  free_charges: number;
  free_at: string;
  happy_key: string | null;
  happy_used: number;
  daily_day: string | null;
  daily_streak: number;
  extra_slots: number;
  bonus_spins?: number;
  listed_count?: number;
  pending: Sim | null;
}

export interface SpinResult {
  sim: Sim;
  auto_sold: number;
  levels_gained: number;
  state: State;
}

export interface Leaderboard {
  top: { place: number; name: string; value: number; count: number; me: boolean }[];
  me: { place: number; value: number; count: number } | null;
}

export interface Friends {
  invited: number;
  active: number;
  earned: number;
  list: { name: string; spins: number; counted: boolean }[];
}

export interface Lot {
  id: string;
  price: number;
  created_at: string;
  mine: boolean;
  seller: string;
  sim: Sim;
}

export interface SpinOptions {
  free: boolean;
  autosellOk: boolean;
}

export interface Api {
  login(): Promise<State>;
  spin(country: string, stake: number, o: SpinOptions): Promise<SpinResult>;
  sell(): Promise<{ sold: number; state: State }>;
  keep(replaceId?: string): Promise<{ kept: number; replaced_sold: number; state: State }>;
  sellNumber(id: string): Promise<{ sold: number; state: State }>;
  buySlot(): Promise<{ paid: number; state: State }>;
  daily(): Promise<{ amount: number; streak: number; state: State }>;
  collect(): Promise<{ collected: number; state: State }>;
  bailout(): Promise<{ granted: number; state: State }>;
  collection(): Promise<Sim[]>;
  leaderboard(): Promise<Leaderboard>;
  friends(): Promise<Friends>;
  stats(): Promise<Stats>;
  claim(id: string): Promise<{ reward: number; spins: number; state: State }>;
  market(mine: boolean): Promise<Lot[]>;
  lotCreate(simId: string, price: number): Promise<{ lot: Lot; state: State }>;
  lotCancel(lotId: string): Promise<{ state: State }>;
  lotBuy(lotId: string): Promise<{ paid: number; state: State }>;
}
