-- «Золотой номер» v5: история прокруток, задания дня, лента «только что выпало», недельный рейтинг с призами,
-- значки номеров, альбомы, улучшение номеров (3 → 1), обмен с друзьями, уведомления ботом, статистика для владельца.
-- Числа (награды, лимиты) приходят из config.ts параметрами. Все функции — только для service_role.

-- ---------- поля и таблицы ----------
alter table gn_players
  add column if not exists notify            boolean not null default true,  -- касса полна, номер купили, обмен
  add column if not exists notify_happy      boolean not null default false, -- напоминать о счастливом часе
  add column if not exists kassa_notified_at timestamptz;

alter table gn_sims drop constraint if exists gn_sims_status_check;
alter table gn_sims add constraint gn_sims_status_check
  check (status in ('pending', 'sold', 'auto_sold', 'kept', 'sold_from_collection', 'listed', 'merged'));

create index if not exists gn_sims_history on gn_sims (player_id, created_at desc);
create index if not exists gn_sims_feed on gn_sims (created_at desc) where tier in ('epic', 'legend');
create index if not exists gn_sims_week on gn_sims (created_at, value desc);
create index if not exists gn_sims_first_tag on gn_sims ((tags[1]), created_at) where tags[1] is not null;

create table if not exists gn_trades (
  id         uuid primary key default gen_random_uuid(),
  from_id    uuid not null references gn_players (id) on delete cascade,
  to_id      uuid not null references gn_players (id) on delete cascade,
  from_sim   uuid not null references gn_sims (id) on delete cascade,
  to_sim     uuid not null references gn_sims (id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled', 'failed')),
  created_at timestamptz not null default now(),
  closed_at  timestamptz
);
create index if not exists gn_trades_to on gn_trades (to_id) where status = 'pending';
create index if not exists gn_trades_from on gn_trades (from_id, created_at desc);

-- Очередь сообщений бота. Edge Function забирает их (gn_notify_take) и отправляет в Telegram.
create table if not exists gn_notices (
  id         bigserial primary key,
  player_id  uuid not null references gn_players (id) on delete cascade,
  kind       text not null,
  text       text not null,
  created_at timestamptz not null default now(),
  sent_at    timestamptz
);
create index if not exists gn_notices_unsent on gn_notices (id) where sent_at is null;

create table if not exists gn_meta (key text primary key, value jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now());

alter table gn_trades enable row level security;
alter table gn_notices enable row level security;
alter table gn_meta enable row level security;
revoke all on gn_trades, gn_notices, gn_meta from anon, authenticated;

-- Начало дня по Москве для даты.
create or replace function gn_msk_day_start(p_day date) returns timestamptz language sql immutable as $$
  select (p_day::timestamp - interval '3 hours') at time zone 'UTC';
$$;

-- ---------- состояние: + настройки уведомлений ----------
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
    'keep_rule', p.keep_rule,
    'notify', p.notify,
    'notify_happy', p.notify_happy,
    'trades_in', (select count(*) from gn_trades t where t.to_id = p.id and t.status = 'pending'),
    'listed_count', (select count(*) from gn_lots l where l.seller_id = p.id and l.status = 'active'),
    'pending', (select gn_sim_json(s) from gn_sims s where s.player_id = p.id and s.status = 'pending')
  ) from gn_players p where p.id = p_id;
$$;

-- ---------- история ----------
create or replace function gn_history(p_telegram_id bigint, p_limit integer default 50) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(x.j order by x.created_at desc), '[]'::jsonb)
    from (select gn_sim_json(s) || jsonb_build_object('status', s.status, 'cost', s.cost, 'resolved_at', s.resolved_at) as j, s.created_at
            from gn_sims s join gn_players p on p.id = s.player_id
           where p.telegram_id = p_telegram_id
           order by s.created_at desc limit least(p_limit, 100)) x;
$$;

-- ---------- задания дня: статистика за день (условия проверяет questProgress в logic.ts) ----------
create or replace function gn_day_stats(p_telegram_id bigint, p_day date) returns jsonb language sql stable as $$
  with p as (select * from gn_players where telegram_id = p_telegram_id),
       s as (select s.* from gn_sims s join p on p.id = s.player_id
              where s.created_at >= gn_msk_day_start(p_day) and s.created_at < gn_msk_day_start(p_day + 1))
  select jsonb_build_object(
    'day', p_day,
    'spins', (select count(*) from s),
    'tiers', coalesce((select jsonb_object_agg(tier, n) from (select tier, count(*) n from s group by tier) t), '{}'::jsonb),
    'tags', coalesce((select jsonb_agg(distinct t) from s, unnest(s.tags) t), '[]'::jsonb),
    'countries', (select count(distinct country) from s),
    'kept', (select count(*) from s where status in ('kept', 'listed', 'sold_from_collection', 'merged')),
    'big_stake', (select count(*) from s where stake >= 2 and not is_free),
    'claimed', coalesce((select jsonb_agg(c.key) from gn_claims c
                          where c.player_id = p.id and c.key like 'q:' || p_day::text || ':%'), '[]'::jsonb)
  ) from p;
$$;

-- ---------- лента: эпические и легендарные номера всех игроков за неделю ----------
create or replace function gn_feed(p_telegram_id bigint, p_limit integer default 20) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(x.j order by x.created_at desc), '[]'::jsonb)
    from (select jsonb_build_object('name', p.first_name, 'label', s.label, 'tier', s.tier, 'value', s.value,
                                    'tag', s.tags[1], 'country', s.country, 'created_at', s.created_at,
                                    'me', p.telegram_id = p_telegram_id) as j, s.created_at
            from gn_sims s join gn_players p on p.id = s.player_id
           where s.tier in ('epic', 'legend') and s.created_at > now() - interval '7 days'
           order by s.created_at desc limit least(p_limit, 50)) x;
$$;

-- ---------- недельный рейтинг: лучший номер недели (неделя с понедельника 00:00 МСК) ----------
create or replace function gn_week_ranked(p_start timestamptz)
returns table (player_id uuid, best bigint, best_at timestamptz, place bigint) language sql stable as $$
  with b as (
    select distinct on (s.player_id) s.player_id, s.value as best, s.created_at as best_at
      from gn_sims s
     where s.created_at >= p_start and s.created_at < p_start + interval '7 days'
     order by s.player_id, s.value desc, s.created_at
  )
  select b.player_id, b.best, b.best_at, row_number() over (order by b.best desc, b.best_at) from b;
$$;

create or replace function gn_week_board(p_telegram_id bigint, p_start timestamptz, p_limit integer default 50)
returns jsonb language sql stable as $$
  with r as (select r.*, p.first_name, p.telegram_id from gn_week_ranked(p_start) r join gn_players p on p.id = r.player_id)
  select jsonb_build_object(
    'start', p_start,
    'top', coalesce((select jsonb_agg(jsonb_build_object('place', place, 'name', first_name, 'value', best,
                       'me', telegram_id = p_telegram_id) order by place)
                     from (select * from r order by place limit p_limit) t), '[]'::jsonb),
    'me', (select jsonb_build_object('place', place, 'value', best) from r where telegram_id = p_telegram_id)
  );
$$;

-- Приз за прошлую неделю: выдаётся при входе, один раз (ключ week:<дата начала>).
create or replace function gn_week_prize(p_telegram_id bigint, p_prev_start timestamptz, p_prizes bigint[], p_spins integer[])
returns jsonb language plpgsql as $$
declare v_id uuid := gn_player_id(p_telegram_id); v_place bigint; v_key text := 'week:' || to_char(p_prev_start at time zone 'Europe/Moscow', 'YYYY-MM-DD');
  v_prize bigint; v_spins integer;
begin
  select place into v_place from gn_week_ranked(p_prev_start) where player_id = v_id;
  if v_place is null or v_place > array_length(p_prizes, 1) then return null; end if;
  v_prize := p_prizes[v_place]; v_spins := coalesce(p_spins[v_place], 0);
  insert into gn_claims (player_id, key, reward) values (v_id, v_key, v_prize) on conflict do nothing;
  if not found then return null; end if;
  update gn_players set balance = balance + v_prize, bonus_spins = bonus_spins + v_spins where id = v_id;
  return jsonb_build_object('place', v_place, 'prize', v_prize, 'spins', v_spins);
end $$;

-- ---------- коллекция: + значок «первый в игре» (первый номер с таким узором у всех игроков) ----------
create or replace function gn_collection(p_telegram_id bigint) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(gn_sim_json(s) || jsonb_build_object('first', s.tags[1] is not null and not exists (
             select 1 from gn_sims o where o.tags[1] = s.tags[1] and o.created_at < s.created_at))
           order by s.value desc, s.created_at), '[]'::jsonb)
    from gn_sims s join gn_players p on p.id = s.player_id
   where p.telegram_id = p_telegram_id and s.status = 'kept';
$$;

-- ---------- достижения и альбомы: + все узоры, которые выпадали ----------
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
    'tags', coalesce((select jsonb_agg(t) from (select distinct t from s, unnest(s.tags) t limit 1000) x), '[]'::jsonb),
    'claimed', coalesce((select jsonb_agg(key) from gn_claims c where c.player_id = p.id and c.key not like 'q:%'), '[]'::jsonb)
  ) from p;
$$;

-- ---------- улучшение: 3 номера одной редкости → 1 номер следующей ----------
-- Снимок для Edge Function: какая редкость, страна и ставка (новый номер генерирует она).
create or replace function gn_merge_ctx(p_telegram_id bigint, p_ids uuid[]) returns jsonb language plpgsql stable as $$
declare v_n int; v_tiers int; v_tier text; v_country text; v_bet bigint;
begin
  if array_length(p_ids, 1) <> 3 or (select count(distinct x) from unnest(p_ids) x) <> 3 then
    raise exception 'Выбери три разных номера';
  end if;
  select count(*), count(distinct s.tier), min(s.tier), mode() within group (order by s.country),
         round(avg(coalesce(s.bet, s.cost, 100000)))
    into v_n, v_tiers, v_tier, v_country, v_bet
    from gn_sims s join gn_players p on p.id = s.player_id
   where p.telegram_id = p_telegram_id and s.id = any(p_ids) and s.status = 'kept';
  if v_n <> 3 then raise exception 'Номера должны быть в твоей коллекции'; end if;
  if v_tiers <> 1 then raise exception 'Нужны три номера одной редкости'; end if;
  if v_tier = 'legend' then raise exception 'Легендарный — уже высшая редкость'; end if;
  return jsonb_build_object('tier', v_tier, 'country', v_country, 'bet', greatest(v_bet, 1));
end $$;

create or replace function gn_merge(p_telegram_id bigint, p_ids uuid[], p_tier text,
  p_country text, p_operator text, p_prefix text, p_sub text, p_label text, p_mul numeric, p_new_tier text,
  p_tags text[], p_value bigint, p_bet bigint) returns jsonb language plpgsql as $$
declare v_id uuid := gn_player_id(p_telegram_id); v_n int; v_old bigint; v_sim gn_sims;
begin
  select count(*), coalesce(sum(value), 0) into v_n, v_old from (
    select value from gn_sims where id = any(p_ids) and player_id = v_id and status = 'kept' and tier = p_tier for update) x;
  if v_n <> 3 or (select count(distinct x) from unnest(p_ids) x) <> 3 then
    raise exception 'Номера изменились — открой коллекцию заново';
  end if;
  perform gn_kassa_settle(v_id);
  update gn_sims set status = 'merged', resolved_at = now() where id = any(p_ids);
  insert into gn_sims (player_id, country, operator, prefix, sub, label, mul, tier, tags, stake, cost, value, bet, status, resolved_at)
  values (v_id, p_country, p_operator, p_prefix, p_sub, p_label, p_mul, p_new_tier, p_tags, 1, 0, p_value, p_bet, 'kept', now())
  returning * into v_sim;
  update gn_players set collection_value = collection_value - v_old + p_value, collection_count = collection_count - 2 where id = v_id;
  return jsonb_build_object('sim', gn_sim_json(v_sim), 'state', gn_state(v_id));
end $$;

-- ---------- друзья и обмен ----------
-- Друзья — те, кого ты пригласил, и тот, кто пригласил тебя.
create or replace function gn_are_friends(a uuid, b uuid) returns boolean language sql stable as $$
  select exists (select 1 from gn_players where (id = a and referrer_id = b) or (id = b and referrer_id = a));
$$;

create or replace function gn_friends(p_telegram_id bigint) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'invited', (select count(*) from gn_players f where f.referrer_id = p.id),
    'active', p.ref_count,
    'earned', p.ref_earned,
    'list', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.first_name, 'spins', f.total_spins,
                         'counted', f.ref_paid, 'count', f.collection_count) order by f.created_at desc)
                        from (select * from gn_players f where f.referrer_id = p.id order by created_at desc limit 50) f), '[]'::jsonb),
    'inviter', (select jsonb_build_object('id', r.id, 'name', r.first_name, 'count', r.collection_count)
                  from gn_players r where r.id = p.referrer_id)
  ) from gn_players p where p.telegram_id = p_telegram_id;
$$;

create or replace function gn_friend_collection(p_telegram_id bigint, p_friend uuid) returns jsonb language plpgsql stable as $$
declare v_me uuid;
begin
  select id into v_me from gn_players where telegram_id = p_telegram_id;
  if v_me is null or not gn_are_friends(v_me, p_friend) then raise exception 'Это не твой друг'; end if;
  return jsonb_build_object(
    'name', (select first_name from gn_players where id = p_friend),
    'list', coalesce((select jsonb_agg(gn_sim_json(s) order by s.value desc) from gn_sims s
                       where s.player_id = p_friend and s.status = 'kept'), '[]'::jsonb));
end $$;

create or replace function gn_trade_json(t gn_trades, p_viewer uuid) returns jsonb language sql stable as $$
  select jsonb_build_object('id', t.id, 'status', t.status, 'created_at', t.created_at, 'incoming', t.to_id = p_viewer,
    'from_name', (select first_name from gn_players where id = t.from_id),
    'to_name', (select first_name from gn_players where id = t.to_id),
    'give', (select gn_sim_json(s) from gn_sims s where s.id = case when t.to_id = p_viewer then t.to_sim else t.from_sim end),
    'get', (select gn_sim_json(s) from gn_sims s where s.id = case when t.to_id = p_viewer then t.from_sim else t.to_sim end));
$$;

create or replace function gn_trades_list(p_telegram_id bigint) returns jsonb language sql stable as $$
  with me as (select id from gn_players where telegram_id = p_telegram_id)
  select coalesce(jsonb_agg(gn_trade_json(t, (select id from me)) order by t.created_at desc), '[]'::jsonb)
    from gn_trades t
   where t.status = 'pending' and (t.from_id = (select id from me) or t.to_id = (select id from me));
$$;

-- Предложить обмен: мой номер на номер друга. Цены — не больше чем в p_max_ratio раз разные (чтобы не перекачивать ценность).
create or replace function gn_trade_offer(p_telegram_id bigint, p_my_sim uuid, p_friend uuid, p_their_sim uuid,
  p_max_ratio numeric, p_max_pending integer, p_max_per_day integer) returns jsonb language plpgsql as $$
declare v_id uuid := gn_player_id(p_telegram_id); v_my gn_sims; v_their gn_sims; v_t gn_trades;
begin
  if not gn_are_friends(v_id, p_friend) then raise exception 'Меняться можно только с друзьями'; end if;
  select * into v_my from gn_sims where id = p_my_sim and player_id = v_id and status = 'kept';
  if v_my.id is null then raise exception 'Твой номер не найден в коллекции'; end if;
  select * into v_their from gn_sims where id = p_their_sim and player_id = p_friend and status = 'kept';
  if v_their.id is null then raise exception 'Номер друга уже не в его коллекции'; end if;
  if greatest(v_my.value, v_their.value) > p_max_ratio * least(v_my.value, v_their.value) then
    raise exception 'Слишком разные цены: меняться можно номерами, которые отличаются не больше чем в % раза', p_max_ratio;
  end if;
  if (select count(*) from gn_trades where from_id = v_id and status = 'pending') >= p_max_pending then
    raise exception 'У тебя уже % предложений — дождись ответа', p_max_pending;
  end if;
  if (select count(*) from gn_trades where (from_id = v_id or to_id = v_id) and status = 'accepted'
        and closed_at > now() - interval '24 hours') >= p_max_per_day then
    raise exception 'Не больше % обменов в сутки', p_max_per_day;
  end if;
  if exists (select 1 from gn_trades where status = 'pending' and from_id = v_id and from_sim = p_my_sim and to_sim = p_their_sim) then
    raise exception 'Такое предложение уже отправлено';
  end if;
  insert into gn_trades (from_id, to_id, from_sim, to_sim) values (v_id, p_friend, p_my_sim, p_their_sim) returning * into v_t;
  insert into gn_notices (player_id, kind, text)
  select p_friend, 'trade', (select first_name from gn_players where id = v_id) || ' предлагает обмен: ' || v_my.label
         || ' на твой ' || v_their.label || '. Открой «Друзья», чтобы ответить.';
  return jsonb_build_object('trade', gn_trade_json(v_t, v_id), 'state', gn_state(v_id));
end $$;

-- Ответить на обмен. Порядок блокировок: обмен → игроки по возрастанию id.
create or replace function gn_trade_answer(p_telegram_id bigint, p_trade uuid, p_accept boolean) returns jsonb language plpgsql as $$
declare v_me uuid; v_t gn_trades; v_a gn_sims; v_b gn_sims; v_p gn_players;
begin
  select id into v_me from gn_players where telegram_id = p_telegram_id;
  select * into v_t from gn_trades where id = p_trade for update;
  if v_t.id is null or v_t.status <> 'pending' then raise exception 'Предложение уже закрыто'; end if;
  if v_t.to_id <> v_me and v_t.from_id <> v_me then raise exception 'Предложение не найдено'; end if;
  perform 1 from gn_players where id in (v_t.from_id, v_t.to_id) order by id for update;
  if v_t.from_id = v_me then
    update gn_trades set status = 'cancelled', closed_at = now() where id = v_t.id;
    return jsonb_build_object('status', 'cancelled', 'state', gn_state(v_me));
  end if;
  if not p_accept then
    update gn_trades set status = 'declined', closed_at = now() where id = v_t.id;
    return jsonb_build_object('status', 'declined', 'state', gn_state(v_me));
  end if;
  select * into v_a from gn_sims where id = v_t.from_sim for update;
  select * into v_b from gn_sims where id = v_t.to_sim for update;
  if v_a.player_id <> v_t.from_id or v_a.status <> 'kept' or v_b.player_id <> v_t.to_id or v_b.status <> 'kept' then
    update gn_trades set status = 'failed', closed_at = now() where id = v_t.id;
    raise exception 'Один из номеров уже продан или выставлен — обмен отменён';
  end if;
  perform gn_kassa_settle(v_t.from_id);
  perform gn_kassa_settle(v_t.to_id);
  update gn_sims set player_id = v_t.to_id where id = v_a.id;
  update gn_sims set player_id = v_t.from_id where id = v_b.id;
  update gn_players set collection_value = collection_value - v_a.value + v_b.value where id = v_t.from_id;
  update gn_players set collection_value = collection_value - v_b.value + v_a.value where id = v_t.to_id;
  update gn_trades set status = 'accepted', closed_at = now() where id = v_t.id;
  -- остальные предложения с этими номерами больше не выполнимы
  update gn_trades set status = 'failed', closed_at = now()
   where status = 'pending' and id <> v_t.id and (from_sim in (v_a.id, v_b.id) or to_sim in (v_a.id, v_b.id));
  insert into gn_notices (player_id, kind, text)
  select v_t.from_id, 'trade', (select first_name from gn_players where id = v_t.to_id) || ' принял обмен: теперь у тебя ' || v_b.label || '.';
  return jsonb_build_object('status', 'accepted', 'state', gn_state(v_me));
end $$;

-- ---------- рынок: + сообщение продавцу ----------
create or replace function gn_lot_buy(p_telegram_id bigint, p_lot_id uuid, p_slots_start integer, p_fee numeric,
  p_max_buys integer) returns jsonb language plpgsql as $$
declare v_lot gn_lots; v_buyer uuid; v_b gn_players; v_value bigint; v_paid bigint; v_label text;
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
  update gn_sims set player_id = v_buyer, status = 'kept', resolved_at = now() where id = v_lot.sim_id returning value, label into v_value, v_label;
  update gn_players set balance = balance - v_lot.price, collection_value = collection_value + v_value,
                        collection_count = collection_count + 1 where id = v_buyer;
  update gn_players set balance = balance + v_paid where id = v_lot.seller_id;
  insert into gn_notices (player_id, kind, text)
  values (v_lot.seller_id, 'sold', 'Твой номер ' || v_label || ' купили на рынке. Тебе зачислено ' ||
          to_char(v_paid / 100, 'FM999G999G999') || ' ₽.');
  return jsonb_build_object('paid', v_lot.price, 'state', gn_state(v_buyer));
end $$;

-- ---------- уведомления ----------
create or replace function gn_notify_prefs(p_telegram_id bigint, p_notify boolean, p_happy boolean) returns jsonb language plpgsql as $$
declare v_id uuid := gn_player_id(p_telegram_id);
begin
  update gn_players set notify = p_notify, notify_happy = p_happy where id = v_id;
  return jsonb_build_object('state', gn_state(v_id));
end $$;

-- Забрать сообщения к отправке. Вызывается по расписанию; не чаще раза в p_min_gap_s секунд (повторный вызов ничего не даёт).
-- Сначала ставит в очередь «касса полна» и «скоро счастливый час», потом отдаёт до p_limit неотправленных и помечает их.
create or replace function gn_notify_take(p_min_gap_s integer, p_limit integer, p_kassa_rate numeric, p_kassa_cap_h numeric,
  p_happy_hours integer[], p_happy_luck integer) returns jsonb language plpgsql as $$
declare v_last timestamptz; v_msk timestamp := now() at time zone 'Europe/Moscow'; v_key text; v_out jsonb;
begin
  select updated_at into v_last from gn_meta where key = 'notify_tick' for update;
  if v_last is not null and v_last > now() - make_interval(secs => p_min_gap_s) then return '[]'::jsonb; end if;
  insert into gn_meta (key, updated_at) values ('notify_tick', now())
    on conflict (key) do update set updated_at = now();

  -- касса заполнилась (12 ч), один раз за цикл: после «Забрать» kassa_at сдвигается и напоминание снова возможно
  with full_ as (
    update gn_players p set kassa_notified_at = now()
     where p.notify and p.collection_value > 0 and p.seen_at > now() - interval '7 days'
       and (p.kassa_notified_at is null or p.kassa_notified_at < p.kassa_at)
       and gn_kassa_total(p) >= p.collection_value * p_kassa_rate * p_kassa_cap_h - 1
    returning p.id, gn_kassa_total(p) as total)
  insert into gn_notices (player_id, kind, text)
  select id, 'kassa', 'Касса полна: ' || to_char(floor(total / 100), 'FM999G999G999') || ' ₽ ждут тебя. Больше она не копит — забери.'
    from full_;

  -- за 10 минут до счастливого часа
  if extract(minute from v_msk) >= 50 and (extract(hour from v_msk)::int + 1) % 24 = any(p_happy_hours) then
    v_key := 'happy:' || to_char(v_msk, 'YYYY-MM-DD"T"HH24');
    insert into gn_meta (key) values (v_key) on conflict do nothing;
    if found then
      insert into gn_notices (player_id, kind, text)
      select id, 'happy', 'Через 10 минут счастливый час: целый час удача ×' || p_happy_luck || ' на все прокрутки.'
        from gn_players where notify_happy and seen_at > now() - interval '14 days';
    end if;
  end if;

  with picked as (
    select n.id from gn_notices n where n.sent_at is null and n.created_at > now() - interval '1 day'
     order by n.id limit p_limit for update skip locked),
  upd as (update gn_notices n set sent_at = now() from picked where n.id = picked.id returning n.player_id, n.text, n.kind)
  select coalesce(jsonb_agg(jsonb_build_object('telegram_id', p.telegram_id, 'text', upd.text, 'kind', upd.kind)), '[]'::jsonb)
    into v_out
    from upd join gn_players p on p.id = upd.player_id;
  -- старое неотправленное (бот был недоступен сутки) выбрасываем
  update gn_notices set sent_at = now() where sent_at is null and created_at <= now() - interval '1 day';
  return v_out;
end $$;

-- ---------- статистика для владельца ----------
create or replace function gn_admin_stats() returns jsonb language sql stable as $$
  with today as (select gn_msk_day_start((now() at time zone 'Europe/Moscow')::date) as t0),
       s7 as (select * from gn_sims where created_at > now() - interval '7 days')
  select jsonb_build_object(
    'players', (select count(*) from gn_players),
    'new_today', (select count(*) from gn_players, today where created_at >= t0),
    'active_today', (select count(*) from gn_players, today where seen_at >= t0),
    'active_7d', (select count(*) from gn_players where seen_at > now() - interval '7 days'),
    'returned_next_day', (select round(100.0 * count(*) filter (where seen_at >= created_at + interval '1 day') / nullif(count(*), 0))
                            from gn_players where created_at between now() - interval '15 days' and now() - interval '1 day'),
    'spins_today', (select count(*) from gn_sims, today where created_at >= t0),
    'spins_7d', (select count(*) from s7),
    'rtp_7d', (select round(100.0 * sum(value) / nullif(sum(cost), 0), 1) from s7 where cost > 0),
    'stuck_under_10', (select count(*) from gn_players where total_spins < 10),
    'spins_buckets', (select jsonb_build_object(
        '0', count(*) filter (where total_spins = 0), '1-9', count(*) filter (where total_spins between 1 and 9),
        '10-49', count(*) filter (where total_spins between 10 and 49), '50-199', count(*) filter (where total_spins between 50 and 199),
        '200+', count(*) filter (where total_spins >= 200)) from gn_players),
    'tiers_7d', coalesce((select jsonb_object_agg(tier, n) from (select tier, count(*) n from s7 group by tier) t), '{}'::jsonb),
    'market_7d', (select count(*) from gn_lots where status = 'sold' and closed_at > now() - interval '7 days'),
    'trades_7d', (select count(*) from gn_trades where status = 'accepted' and closed_at > now() - interval '7 days'),
    'by_day', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'spins', n, 'players', u) order by d desc) from (
        select (created_at at time zone 'Europe/Moscow')::date d, count(*) n, count(distinct player_id) u
          from gn_sims where created_at > now() - interval '14 days' group by 1) x), '[]'::jsonb)
  );
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
