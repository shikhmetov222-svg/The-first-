// Все запросы к серверу идут через одну функцию `api`.
// Клиент отправляет только действие; все числа считает и возвращает сервер.

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config';
import { tg } from './telegram';

export type BusinessType = 'coffee' | 'shop' | 'bakery' | 'marketplace' | 'pvz' | 'agency' | 'repair';

export interface Player {
  id: string;
  first_name: string;
  cash: number; // все деньги — в копейках
  created_at: string;
  tutorial_step: number; // 0–2 — текущий шаг обучения, 3 — пройдено
  haptics?: boolean;
}

export interface PublicProfile {
  dev?: boolean;
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
  category?: 'classic' | 'online' | 'services';
  description?: string;
  link_text?: string;
  payback_days?: number | null;
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
  listed?: boolean; // выставлен на продажу — заморожен
  goods?: Partial<Record<'coffee' | 'bread' | 'flour', number>> | null; // склад маркетплейса
  last_revenue?: number; // выручка за последние 5 минут (после комиссий)
  progress?: number; // агентство: готовность следующей кампании, 0…1
  level?: number; // уровень 1–5
  capacity?: number; // склад с учётом уровня
  raw_capacity?: number;
  repair?: ActiveRepair | null; // идёт ремонт для улучшения
  crew?: CrewInfo | null; // ремонтная бригада: цена, очередь, рейтинг
  ads?: string[]; // окончания активных рекламных кампаний
}

export interface ActiveRepair {
  to_level: number;
  kind: 'crew' | 'self' | 'npc';
  status: 'queued' | 'working';
  finish_at: string;
  due_at: string;
  contractor: string | null;
}

export interface CrewOrder {
  id: number;
  type: BusinessType;
  to_level: number;
  kind: 'crew' | 'self';
  status: 'queued' | 'working';
  fee: number;
  finish_at: string;
  customer: string;
}

export interface CrewInfo {
  pct: number;
  rating: number | null;
  done: number;
  earned_24h: number;
  queue: CrewOrder[];
}

export interface UpgradeConfig {
  max_level: number;
  capacity_step: number;
  sales_step: number;
  min_pct: number;
  max_pct: number;
  queue: number;
  minutes: number;
  costs: Partial<Record<BusinessType, number>> | null; // цена следующего улучшения
}

export interface RepairOffer {
  kind: 'crew' | 'self' | 'npc';
  id: string | null;
  name: string;
  icon?: string | null;
  color?: string | null;
  dev?: boolean;
  test?: boolean;
  pct: number;
  fee: number;
  wait_minutes: number;
  rating: number | null;
  done?: number;
  queue: number;
  full: boolean;
}

export interface RepairOffers {
  type: BusinessType;
  level: number;
  to_level: number;
  cost: number;
  capacity_step: number;
  sales_step: number;
  active: boolean;
  offers: RepairOffer[];
}

/** Настройки рекламы с сервера (числа берутся из конфига баланса). */
export interface AdsConfig {
  boost: number; // 0.25 = +25% спроса
  minutes: number; // сколько действует одна кампания
  max: number; // кампаний на один бизнес одновременно
  npc_price: number; // цена у NPC-агентства, коп.
  npc_name: string;
  minutes_per_campaign: number; // агентство делает одну кампанию за столько минут
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
  dev?: boolean;
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
  is_admin?: boolean; // решает сервер по секрету ADMIN_TELEGRAM_IDS
  notifications?: { id: number; text: string; at: string; read: boolean }[];
  unread?: number;
  ads?: AdsConfig;
  upgrade?: UpgradeConfig;
}

export interface DevInfo {
  me: { dev_cash_total: number; show_dev_badge: boolean };
  season: { number: number; ends_at: string; theme: string } | null;
  markets: {
    market: 'coffee' | 'bread';
    name: string;
    market_price: number;
    demand_level: number;
    last_demand: number;
    sellers: number;
    bot_override: number | null;
    bots: { name: string; kind: string; price: number; active: boolean; last_sold: number }[];
  }[];
  test_players: { id: string; name: string; icon: string; color: string; cash: number; friend: boolean }[];
  log: { action: string; details: Record<string, unknown>; amount: number | null; at: string; admin: string }[];
  trades?: {
    kind: 'lot' | 'wholesale';
    product: string;
    qty: number;
    price: number;
    total: number;
    fee: number;
    flags: string[];
    at: string;
    seller: string;
    buyer: string;
  }[];
  flagged_24h?: number;
}

export interface LoginResult extends GameState {
  is_new: boolean;
  summary: { since: string; items: SummaryItem[] } | null;
  season_result: SeasonResult | null;
}

export type Product = 'coffee' | 'bread' | 'flour' | 'campaign';
export type Source = 'coffee' | 'shop' | 'bakery' | 'agency';

export interface GoodsPrice {
  product: Product;
  price: number; // оптовая цена за штуку
  wholesale: number; // столько платит оптовик
  day_ago: number | null;
  history: [number, number][];
}

export interface Lot {
  id: number;
  product: Product;
  qty_left: number;
  qty_total: number;
  price: number;
  expires_at: string;
  seller: {
    id: string;
    name: string;
    icon: string | null;
    color: string | null;
    dev: boolean;
    test: boolean;
    bot?: boolean;
    kind?: 'dumper' | 'premium' | 'careful';
  };
}

export interface BusinessLot {
  id: number;
  type: BusinessType;
  price: number;
  valuation: number;
  stock: number;
  raw_stock: number;
  expires_at: string;
  seller: Lot['seller'];
}

export interface MyLot {
  id: number;
  kind: 'goods' | 'business';
  business_type: BusinessType | null;
  valuation: number | null;
  product: Product;
  source: Source;
  qty_left: number;
  qty_total: number;
  price: number;
  status: 'active' | 'sold' | 'cancelled' | 'expired';
  created_at: string;
  expires_at: string;
}

export interface Trade {
  side: 'sold' | 'bought';
  kind: 'lot' | 'wholesale' | 'business' | 'repair';
  product: Product | BusinessType;
  qty: number;
  price: number;
  total: number;
  fee: number;
  at: string;
  other: string | null;
}

export interface MarketView {
  prices: GoodsPrice[];
  lots: Lot[];
  my_lots: MyLot[];
  my_trades: Trade[];
  business_lots?: BusinessLot[];
  my_businesses?: { type: BusinessType; valuation: number; listed: boolean }[];
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
  market: () => call<{ market: MarketView }>('market'),
  createLot: (p: { product: Product; source: Source; qty: number; price: number }) =>
    call<WithResult<string> & { market: MarketView }>('create_lot', p),
  cancelLot: (lot: number) => call<WithResult<string> & { market: MarketView }>('cancel_lot', { lot }),
  /** dest: 'marketplace' — на склад маркетплейса; для кампании — бизнес, которому нужна реклама. */
  buyLot: (lot: number, qty: number, dest?: string) =>
    call<WithResult<string> & { market: MarketView }>('buy_lot', { lot, qty, dest }),
  applyCampaign: (type: BusinessType) => call<WithResult<string>>('apply_campaign', { type }),
  buyNpcCampaign: (type: BusinessType) => call<WithResult<string>>('buy_npc_campaign', { type }),
  repairOffers: (type: BusinessType) => call<{ offers: RepairOffers }>('repair_offers', { type }),
  /** contractor: 'npc', 'self' или id бригады другого игрока. */
  orderUpgrade: (type: BusinessType, contractor: string) =>
    call<WithResult<string>>('order_upgrade', { type, contractor }),
  setRepairPrice: (pct: number) => call<WithResult<string>>('set_repair_price', { pct }),
  marketplaceTransfer: (p: { product: Product; source: Source; qty: number }) =>
    call<WithResult<string>>('marketplace_transfer', p),
  sellWholesale: (p: { product: Product; source: Source; qty: number }) =>
    call<WithResult<string> & { market: MarketView }>('sell_wholesale', p),
  notificationsRead: () => call<WithResult<null>>('notifications_read'),
  createBusinessLot: (type: BusinessType, price: number) =>
    call<WithResult<string> & { market: MarketView }>('create_business_lot', { type, price }),
  buyBusinessLot: (lot: number) => call<WithResult<string> & { market: MarketView }>('buy_business_lot', { lot }),
  devInfo: () => call<{ dev: DevInfo }>('dev_info'),
  dev: (op: string, params: Record<string, unknown> = {}) =>
    call<WithResult<string> & { dev: DevInfo }>('dev', { op, ...params }),
  leaderboard: (kind: LeaderKind) => call<{ leaderboard: Leaderboard }>('leaderboard', { kind }),
};
