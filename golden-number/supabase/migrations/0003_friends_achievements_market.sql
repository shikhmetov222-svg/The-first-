-- «Золотой номер» v3: друзья (приглашения), достижения, рынок между игроками.
-- Константы приходят из config.ts параметрами. Все функции — только для service_role.

-- ---------- поля и таблицы ----------
alter table gn_players
  add column if not exists referrer_id uuid references gn_players (id),
  add column if not exists ref_paid    boolean not null default false, -- пригласившему уже заплатили за этого игрока
  add column if not exists ref_count   integer not null default 0,     -- засчитанных друзей
  add column if not exists ref_earned  bigint  not null default 0,
  add column if not exists bonus_spins integer not null default 0;     -- подарочные бесплатные прокрутки

create index if not exists gn_players_referrer on gn_players (referrer_id) where referrer_id is not null;

alter table gn_sims drop constraint if exists gn_sims_status_check;
alter table gn_sims add constraint gn_sims_status_check
  check (status in ('pending', 'sold', 'auto_sold', 'kept', 'sold_from_collection', 'listed'));

create table if not exists gn_claims (
  player_id  uuid not null references gn_players (id) on delete cascade,
  key        text not null,
  reward     bigint not null,
  claimed_at timestamptz not null default now(),
  primary key (player_id, key)
);

create table if not exists gn_lots (
  id         uuid primary key default gen_random_uuid(),
  sim_id     uuid not null references gn_sims (id) on delete cascade,
  seller_id  uuid not null references gn_players (id) on delete cascade,
  buyer_id   uuid references gn_players (id),
  price      bigint not null check (price > 0),
  status     text not null default 'active' check (status in ('active', 'sold', 'cancelled')),
  created_at timestamptz not null default now(),
  closed_at  timestamptz
);
create unique index if not exists gn_lots_one_active on gn_lots (sim_id) where status = 'active';
create index if not exists gn_lots_active on gn_lots (created_at desc) where status = 'active';
create index if not exists gn_lots_pairs on gn_lots (seller_id, buyer_id, closed_at) where status = 'sold';

alter table gn_claims enable row level security;
alter table gn_lots enable row level security;
revoke all on gn_claims, gn_lots from anon, authenticated;

-- ---------- состояние ----------
create or replace function gn_state(p_id uuid) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'telegram_id', p.telegram_id,
    'balance', p.balance,
    'xp', p.xp,
    'level', p.level,
    'collection_value', p.collection_value,
    'collection_count', p.collection_count,
    'kassa_acc', round(gn_kassa_total(p), 4),
    'server_now', now(),
    'bailout_at', p.bailout_at,
    'total_spins', p.total_spins,
    'free_charges', p.free_charges,
    'free_at', p.free_at,
    'bonus_spins', p.bonus_spins,
    'happy_key', p.happy_key,
    'happy_used', p.happy_used,
    'daily_day', p.daily_day,
    'daily_streak', p.daily_streak,
    'extra_slots', p.extra_slots,
    'listed_count', (select count(*) from gn_lots l where l.seller_id = p.id and l.status = 'active'),
    'pending', (select gn_sim_json(s) from gn_sims s where s.player_id = p.id and s.status = 'pending')
  ) from gn_players p where p.id = p_id;
$$;

-- Вход. Новый игрок, пришедший по ссылке друга, запоминает пригласившего и получает подарочные прокрутки.
drop function if exists gn_login(bigint, text, text);
create or replace function gn_login(p_telegram_id bigint, p_first_name text, p_username text,
  p_ref_telegram_id bigint default null, p_ref_bonus integer default 0)
returns jsonb language plpgsql as $$
declare v_id uuid; v_new boolean; v_ref uuid;
begin
  insert into gn_players (telegram_id, first_name, username)
  values (p_telegram_id, left(coalesce(p_first_name, ''), 64), left(p_username, 64))
  on conflict (telegram_id) do update
    set first_name = excluded.first_name, username = excluded.username, seen_at = now()
  returning id, (xmax = 0) into v_id, v_new;
  if v_new and p_ref_telegram_id is not null and p_ref_telegram_id <> p_telegram_id then
    select id into v_ref from gn_players where telegram_id = p_ref_telegram_id;
    if v_ref is not null then
      update gn_players set referrer_id = v_ref, bonus_spins = bonus_spins + p_ref_bonus where id = v_id;
    end if;
  end if;
  return gn_state(v_id) || jsonb_build_object('is_new', v_new);
end $$;

create or replace function gn_spin_context(p_telegram_id bigint, p_free_every_h numeric, p_free_max integer,
  p_happy_hours integer[], p_happy_spins integer) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'spin_no', p.total_spins + 1,
    'level', p.level,
    'avg_bet', p.avg_bet,
    'free', (gn_free_now(p, p_free_every_h, p_free_max)).charges,
    'bonus', p.bonus_spins,
    'happy_left', (gn_happy_now(p, p_happy_hours, p_happy_spins)).left_spins,
    'pending_tier', (select s.tier from gn_sims s where s.player_id = p.id and s.status = 'pending')
  ) from gn_players p where p.telegram_id = p_telegram_id;
$$;

-- ---------- прокрутка: + подарочные прокрутки и награда пригласившему ----------
drop function if exists gn_spin(bigint, integer, integer, boolean, boolean, boolean, integer, bigint, bigint, integer, boolean,
  text, text, text, text, text, numeric, text, text[], integer, bigint, numeric, numeric, numeric, integer, numeric, integer, integer[], integer);

create or replace function gn_spin(
  p_telegram_id bigint, p_spin_no integer, p_required_level integer,
  p_use_free boolean, p_use_bonus boolean, p_lucky boolean, p_happy_used boolean, p_luck integer,
  p_cost bigint, p_bet bigint, p_xp integer, p_autosell_ok boolean,
  p_country text, p_operator text, p_prefix text, p_sub text, p_label text,
  p_mul numeric, p_tier text, p_tags text[], p_stake integer, p_value bigint,
  p_xp_base numeric, p_xp_pow numeric, p_avg_weight numeric, p_lucky_every integer,
  p_free_every_h numeric, p_free_max integer, p_happy_hours integer[], p_happy_spins integer,
  p_ref_after integer, p_ref_reward bigint, p_ref_spins integer
) returns jsonb language plpgsql as $$
declare
  v_id uuid := gn_player_id(p_telegram_id);
  v_p gn_players;
  v_free record;
  v_happy record;
  v_pending gn_sims;
  v_auto bigint := 0;
  v_levels integer := 0;
  v_sim gn_sims;
begin
  select * into v_p from gn_players where id = v_id;
  if v_p.total_spins + 1 <> p_spin_no then raise exception 'GN_RETRY'; end if;
  if p_lucky <> (p_spin_no % p_lucky_every = 0) then raise exception 'GN_RETRY'; end if;
  select * into v_free from gn_free_now(v_p, p_free_every_h, p_free_max);
  select * into v_happy from gn_happy_now(v_p, p_happy_hours, p_happy_spins);
  if p_use_free and v_free.charges < 1 then raise exception 'GN_RETRY'; end if;
  if p_use_bonus and (p_use_free or v_p.bonus_spins < 1) then raise exception 'GN_RETRY'; end if;
  if not p_lucky and p_happy_used <> (v_happy.left_spins > 0) then raise exception 'GN_RETRY'; end if;

  if v_p.level < p_required_level then
    raise exception 'Откроется на уровне %', p_required_level;
  end if;

  select * into v_pending from gn_sims where player_id = v_id and status = 'pending';
  if v_pending.id is not null and v_pending.tier in ('rare', 'epic', 'legend') and not p_autosell_ok then
    raise exception 'Сначала реши, что делать с прошлым номером';
  end if;

  update gn_sims set status = 'auto_sold', resolved_at = now()
   where player_id = v_id and status = 'pending' returning value into v_auto;
  v_auto := coalesce(v_auto, 0);

  if v_p.balance + v_auto < p_cost then raise exception 'Не хватает денег'; end if;

  v_p.xp := v_p.xp + p_xp;
  while v_p.xp >= round(p_xp_base * power(v_p.level, p_xp_pow)) loop
    v_p.xp := v_p.xp - round(p_xp_base * power(v_p.level, p_xp_pow))::integer;
    v_p.level := v_p.level + 1;
    v_levels := v_levels + 1;
  end loop;

  update gn_players set
    balance = balance + v_auto - p_cost,
    xp = v_p.xp, level = v_p.level, seen_at = now(),
    total_spins = total_spins + 1,
    avg_bet = case when p_use_free or p_use_bonus then avg_bet else round(avg_bet * (1 - p_avg_weight) + p_bet * p_avg_weight) end,
    free_charges = case when p_use_free then v_free.charges - 1 else free_charges end,
    free_at = case when p_use_free then v_free.base_at else free_at end,
    bonus_spins = case when p_use_bonus then bonus_spins - 1 else bonus_spins end,
    happy_used = case when not p_happy_used then happy_used when happy_key = v_happy.key then happy_used + 1 else 1 end,
    happy_key = case when p_happy_used then v_happy.key else happy_key end
  where id = v_id;

  -- Друг засчитан: пригласивший получает награду один раз.
  if p_spin_no >= p_ref_after and v_p.referrer_id is not null and not v_p.ref_paid then
    update gn_players set ref_paid = true where id = v_id;
    update gn_players set balance = balance + p_ref_reward, bonus_spins = bonus_spins + p_ref_spins,
                          ref_count = ref_count + 1, ref_earned = ref_earned + p_ref_reward
     where id = v_p.referrer_id;
  end if;

  insert into gn_sims (player_id, country, operator, prefix, sub, label, mul, tier, tags, stake, cost, value, bet, luck, is_free)
  values (v_id, p_country, p_operator, p_prefix, p_sub, p_label, p_mul, p_tier, p_tags, p_stake, p_cost, p_value, p_bet, p_luck,
          p_use_free or p_use_bonus)
  returning * into v_sim;

  return jsonb_build_object('sim', gn_sim_json(v_sim), 'auto_sold', v_auto, 'levels_gained', v_levels,
                            'state', gn_state(v_id));
end $$;

-- Помощь не нужна, если есть подарочные прокрутки.
create or replace function gn_bailout(p_telegram_id bigint, p_min_cost bigint, p_amount bigint, p_cooldown_h integer,
  p_free_every_h numeric, p_free_max integer) returns jsonb language plpgsql as $$
declare v_id uuid := gn_player_id(p_telegram_id); v_p gn_players; v_pending bigint;
begin
  select * into v_p from gn_players where id = v_id;
  select coalesce(sum(value), 0) into v_pending from gn_sims where player_id = v_id and status = 'pending';
  if v_p.balance + v_pending + floor(gn_kassa_total(v_p)) >= p_min_cost then
    raise exception 'Денег хватает на прокрутку в России ×1';
  end if;
  if v_p.collection_count > 0 then raise exception 'Продай номер из коллекции или подожди кассу'; end if;
  if (gn_free_now(v_p, p_free_every_h, p_free_max)).charges > 0 or v_p.bonus_spins > 0 then
    raise exception 'У тебя есть бесплатная прокрутка';
  end if;
  if v_p.bailout_at is not null and v_p.bailout_at > now() - make_interval(hours => p_cooldown_h) then
    raise exception 'Помощь доступна раз в % ч', p_cooldown_h;
  end if;
  update gn_players set balance = balance + p_amount, bailout_at = now() where id = v_id;
  return jsonb_build_object('granted', p_amount, 'state', gn_state(v_id));
end $$;

-- ---------- друзья ----------
create or replace function gn_friends(p_telegram_id bigint) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'invited', (select count(*) from gn_players f where f.referrer_id = p.id),
    'active', p.ref_count,
    'earned', p.ref_earned,
    'list', coalesce((select jsonb_agg(jsonb_build_object('name', f.first_name, 'spins', f.total_spins, 'counted', f.ref_paid)
                                       order by f.created_at desc)
                        from (select * from gn_players f where f.referrer_id = p.id order by created_at desc limit 50) f), '[]'::jsonb)
  ) from gn_players p where p.telegram_id = p_telegram_id;
$$;

-- ---------- достижения ----------
-- Статистика для прогресса (формулы прогресса — achProgress в logic.ts).
create or replace function gn_stats(p_telegram_id bigint) returns jsonb language sql stable as $$
  with p as (select * from gn_players where telegram_id = p_telegram_id),
       s as (select s.* from gn_sims s join p on p.id = s.player_id)
  select jsonb_build_object(
    'total_spins', p.total_spins,
    'tiers', coalesce((select jsonb_object_agg(tier, n) from (select tier, count(*) n from s group by tier) t), '{}'::jsonb),
    'ops', coalesce((select jsonb_agg(distinct country || ':' || operator) from s), '[]'::jsonb),
    't9', (select count(distinct t) from s, unnest(s.tags) t where t like 'T9: %'),
    'codes', (select count(*) from s where length(prefix) > 1 and length(replace(prefix, left(prefix, 1), '')) = 0),
    'collection_value', p.collection_value,
    'friends', p.ref_count,
    'claimed', coalesce((select jsonb_agg(key) from gn_claims c where c.player_id = p.id), '[]'::jsonb)
  ) from p;
$$;

-- Выдать награду за достижение. Выполнение проверяет Edge Function по gn_stats; повтор невозможен (ключ).
create or replace function gn_claim(p_telegram_id bigint, p_key text, p_reward bigint, p_spins integer)
returns jsonb language plpgsql as $$
declare v_id uuid := gn_player_id(p_telegram_id);
begin
  insert into gn_claims (player_id, key, reward) values (v_id, p_key, p_reward) on conflict do nothing;
  if not found then raise exception 'Награда уже получена'; end if;
  update gn_players set balance = balance + p_reward, bonus_spins = bonus_spins + p_spins where id = v_id;
  return jsonb_build_object('reward', p_reward, 'spins', p_spins, 'state', gn_state(v_id));
end $$;

-- ---------- рынок ----------
create or replace function gn_lot_json(l gn_lots, p_viewer uuid) returns jsonb language sql stable as $$
  select jsonb_build_object('id', l.id, 'price', l.price, 'created_at', l.created_at, 'mine', l.seller_id = p_viewer,
    'seller', (select first_name from gn_players where id = l.seller_id),
    'sim', (select gn_sim_json(s) from gn_sims s where s.id = l.sim_id));
$$;

-- Выставить номер из коллекции. Номер уходит с витрины (не приносит доход), пока не продан или не снят.
create or replace function gn_lot_create(p_telegram_id bigint, p_sim_id uuid, p_price bigint,
  p_min_share numeric, p_max_share numeric, p_max_lots integer) returns jsonb language plpgsql as $$
declare v_id uuid := gn_player_id(p_telegram_id); v_s gn_sims; v_lot gn_lots;
begin
  select * into v_s from gn_sims where id = p_sim_id and player_id = v_id and status = 'kept' for update;
  if v_s.id is null then raise exception 'Номер не найден в коллекции'; end if;
  if p_price < ceil(v_s.value * p_min_share) or p_price > floor(v_s.value * p_max_share) then
    raise exception 'Цена — от % до % ₽', ceil(v_s.value * p_min_share / 100), floor(v_s.value * p_max_share / 100);
  end if;
  if (select count(*) from gn_lots where seller_id = v_id and status = 'active') >= p_max_lots then
    raise exception 'Одновременно можно выставить не больше % номеров', p_max_lots;
  end if;
  perform gn_kassa_settle(v_id);
  update gn_sims set status = 'listed' where id = v_s.id;
  update gn_players set collection_value = collection_value - v_s.value, collection_count = collection_count - 1 where id = v_id;
  insert into gn_lots (sim_id, seller_id, price) values (v_s.id, v_id, p_price) returning * into v_lot;
  return jsonb_build_object('lot', gn_lot_json(v_lot, v_id), 'state', gn_state(v_id));
end $$;

-- Снять с продажи: номер возвращается на витрину, если там есть место.
create or replace function gn_lot_cancel(p_telegram_id bigint, p_lot_id uuid, p_slots_start integer)
returns jsonb language plpgsql as $$
declare v_id uuid := gn_player_id(p_telegram_id); v_p gn_players; v_lot gn_lots; v_value bigint;
begin
  select * into v_lot from gn_lots where id = p_lot_id and seller_id = v_id and status = 'active' for update;
  if v_lot.id is null then raise exception 'Лот не найден'; end if;
  select * into v_p from gn_players where id = v_id;
  if v_p.collection_count >= p_slots_start + v_p.extra_slots then raise exception 'Освободи место на витрине'; end if;
  perform gn_kassa_settle(v_id);
  update gn_lots set status = 'cancelled', closed_at = now() where id = v_lot.id;
  update gn_sims set status = 'kept' where id = v_lot.sim_id returning value into v_value;
  update gn_players set collection_value = collection_value + v_value, collection_count = collection_count + 1 where id = v_id;
  return jsonb_build_object('state', gn_state(v_id));
end $$;

-- Купить лот. Порядок блокировок: лот → игроки по возрастанию id. Комиссия p_fee сгорает.
create or replace function gn_lot_buy(p_telegram_id bigint, p_lot_id uuid, p_slots_start integer, p_fee numeric,
  p_max_buys integer) returns jsonb language plpgsql as $$
declare v_lot gn_lots; v_buyer uuid; v_b gn_players; v_value bigint; v_paid bigint;
begin
  select * into v_lot from gn_lots where id = p_lot_id for update;
  if v_lot.id is null or v_lot.status <> 'active' then raise exception 'Этот номер уже купили или сняли с продажи'; end if;
  select id into v_buyer from gn_players where telegram_id = p_telegram_id;
  if v_buyer is null then raise exception 'Игрок не найден, перезапусти игру'; end if;
  if v_buyer = v_lot.seller_id then raise exception 'Это твой лот'; end if;
  perform 1 from gn_players where id in (v_buyer, v_lot.seller_id) order by id for update;
  select * into v_b from gn_players where id = v_buyer;
  if v_b.collection_count >= p_slots_start + v_b.extra_slots then raise exception 'Освободи место на витрине'; end if;
  if v_b.balance < v_lot.price then raise exception 'Не хватает денег'; end if;
  if (select count(*) from gn_lots where seller_id = v_lot.seller_id and buyer_id = v_buyer and status = 'sold'
        and closed_at > now() - interval '24 hours') >= p_max_buys then
    raise exception 'У одного продавца — не больше % покупок в сутки', p_max_buys;
  end if;
  perform gn_kassa_settle(v_buyer);
  v_paid := floor(v_lot.price * (1 - p_fee));
  update gn_lots set status = 'sold', buyer_id = v_buyer, closed_at = now() where id = v_lot.id;
  update gn_sims set player_id = v_buyer, status = 'kept', resolved_at = now() where id = v_lot.sim_id returning value into v_value;
  update gn_players set balance = balance - v_lot.price, collection_value = collection_value + v_value,
                        collection_count = collection_count + 1 where id = v_buyer;
  update gn_players set balance = balance + v_paid where id = v_lot.seller_id;
  return jsonb_build_object('paid', v_lot.price, 'state', gn_state(v_buyer));
end $$;

create or replace function gn_market(p_telegram_id bigint, p_mine boolean default false, p_limit integer default 100)
returns jsonb language sql stable as $$
  with me as (select id from gn_players where telegram_id = p_telegram_id)
  select coalesce(jsonb_agg(x.j order by x.created_at desc), '[]'::jsonb)
    from (select gn_lot_json(l, (select id from me)) as j, l.created_at
            from gn_lots l
           where l.status = 'active' and (not p_mine or l.seller_id = (select id from me))
           order by l.created_at desc limit p_limit) x;
$$;

-- Вызывать функции может только service_role (Edge Function).
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'gn\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
