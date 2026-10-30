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
}
