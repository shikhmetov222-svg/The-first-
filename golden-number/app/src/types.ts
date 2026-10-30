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

export interface Api {
  login(): Promise<State>;
  spin(country: string, stake: number): Promise<SpinResult>;
  sell(): Promise<{ sold: number; state: State }>;
  keep(): Promise<{ kept: number; state: State }>;
  sellNumber(id: string): Promise<{ sold: number; state: State }>;
  collect(): Promise<{ collected: number; state: State }>;
  bailout(): Promise<{ granted: number; state: State }>;
  collection(): Promise<Sim[]>;
  leaderboard(): Promise<Leaderboard>;
}
