-- «Золотой номер»: таблицы и атомарные операции с деньгами.
-- Все суммы — в копейках (bigint). Касса хранится в numeric, чтобы не терять доли копейки.
-- Клиент к таблицам доступа не имеет: RLS включён без политик, функции можно вызывать
-- только с ключом service_role (его знает только Edge Function).
-- Префикс gn_ — чтобы не пересечься с другими проектами в той же базе.

create table if not exists gn_players (
  id               uuid primary key default gen_random_uuid(),
  telegram_id      bigint not null unique,
  first_name       text not null default '',
  username         text,
  balance          bigint not null default 1000000 check (balance >= 0), -- 10 000 ₽
  xp               integer not null default 0,
  level            integer not null default 1,
  collection_value bigint not null default 0,  -- сумма цен номеров в коллекции
  collection_count integer not null default 0,
  kassa_acc        numeric not null default 0, -- накоплено в кассе на момент kassa_at
  kassa_at         timestamptz not null default now(),
  bailout_at       timestamptz,
  created_at       timestamptz not null default now(),
  seen_at          timestamptz not null default now()
);

create index if not exists gn_players_rating on gn_players (collection_value desc) where collection_value > 0;

-- Каждая выпавшая SIM-карта. status: pending → sold | auto_sold | kept → sold_from_collection
create table if not exists gn_sims (
  id          uuid primary key default gen_random_uuid(),
  player_id   uuid not null references gn_players (id) on delete cascade,
  country     text not null,
  operator    text not null,
  prefix      text not null,
  sub         text not null,
  label       text not null,
  mul         numeric not null,
  tier        text not null,
  tags        text[] not null default '{}',
  stake       integer not null,
  cost        bigint not null,
  value       bigint not null,
  status      text not null default 'pending'
              check (status in ('pending', 'sold', 'auto_sold', 'kept', 'sold_from_collection')),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);

create unique index if not exists gn_sims_one_pending on gn_sims (player_id) where status = 'pending';
create index if not exists gn_sims_collection on gn_sims (player_id, value desc) where status = 'kept';

alter table gn_players enable row level security;
alter table gn_sims enable row level security;
-- Политик нет намеренно: anon/authenticated не видят и не меняют ничего.
revoke all on gn_players, gn_sims from anon, authenticated;

-- ---------- касса ----------

-- То же, что kassaTotalKop() в logic.ts.
create or replace function gn_kassa_total(p gn_players, p_now timestamptz default now())
returns numeric language sql stable as $$
  select greatest(
    p.kassa_acc,
    least(
      p.kassa_acc + p.collection_value * 0.03 * greatest(0, extract(epoch from (p_now - p.kassa_at)) / 3600),
      p.collection_value * 0.03 * 8
    )
  );
$$;

-- Зафиксировать накопленное перед изменением дохода (покупка/продажа номера из коллекции).
create or replace function gn_kassa_settle(p_id uuid) returns void language sql as $$
  update gn_players set kassa_acc = gn_kassa_total(gn_players), kassa_at = now() where id = p_id;
$$;

-- ---------- чтение ----------

create or replace function gn_sim_json(s gn_sims) returns jsonb language sql immutable as $$
  select case when s.id is null then null else jsonb_build_object(
    'id', s.id, 'country', s.country, 'operator', s.operator, 'prefix', s.prefix, 'sub', s.sub,
    'label', s.label, 'mul', s.mul, 'tier', s.tier, 'tags', to_jsonb(s.tags), 'stake', s.stake,
    'value', s.value, 'created_at', s.created_at) end;
$$;

create or replace function gn_state(p_id uuid) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'balance', p.balance,
    'xp', p.xp,
    'level', p.level,
    'collection_value', p.collection_value,
    'collection_count', p.collection_count,
    'kassa_acc', round(gn_kassa_total(p), 4),
    'server_now', now(),
    'bailout_at', p.bailout_at,
    'pending', (select gn_sim_json(s) from gn_sims s where s.player_id = p.id and s.status = 'pending')
  ) from gn_players p where p.id = p_id;
$$;

create or replace function gn_login(p_telegram_id bigint, p_first_name text, p_username text)
returns jsonb language plpgsql as $$
declare v_id uuid;
begin
  insert into gn_players (telegram_id, first_name, username)
  values (p_telegram_id, left(coalesce(p_first_name, ''), 64), left(p_username, 64))
  on conflict (telegram_id) do update
    set first_name = excluded.first_name, username = excluded.username, seen_at = now()
  returning id into v_id;
  return gn_state(v_id);
end $$;

create or replace function gn_player_id(p_telegram_id bigint) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  -- for update: все денежные операции одного игрока идут строго по очереди
  select id into v_id from gn_players where telegram_id = p_telegram_id for update;
  if v_id is null then raise exception 'Игрок не найден, перезапусти игру'; end if;
  return v_id;
end $$;

-- ---------- действия ----------

-- Прокрутка. Номер сгенерирован и оценён в Edge Function; здесь — деньги и опыт одной транзакцией.
create or replace function gn_spin(
  p_telegram_id bigint, p_required_level integer, p_cost bigint, p_xp integer,
  p_country text, p_operator text, p_prefix text, p_sub text, p_label text,
  p_mul numeric, p_tier text, p_tags text[], p_stake integer, p_value bigint
) returns jsonb language plpgsql as $$
declare
  v_id uuid := gn_player_id(p_telegram_id);
  v_p gn_players;
  v_auto bigint := 0;
  v_levels integer := 0;
  v_sim gn_sims;
begin
  select * into v_p from gn_players where id = v_id;
  if v_p.level < p_required_level then
    raise exception 'Страна откроется на уровне %', p_required_level;
  end if;

  -- Прошлый номер, по которому игрок не решил, продаётся автоматически.
  update gn_sims set status = 'auto_sold', resolved_at = now()
   where player_id = v_id and status = 'pending' returning value into v_auto;
  v_auto := coalesce(v_auto, 0);

  if v_p.balance + v_auto < p_cost then
    raise exception 'Не хватает денег';
  end if;

  v_p.xp := v_p.xp + p_xp;
  while v_p.xp >= v_p.level * 100 loop
    v_p.xp := v_p.xp - v_p.level * 100;
    v_p.level := v_p.level + 1;
    v_levels := v_levels + 1;
  end loop;

  update gn_players
     set balance = balance + v_auto - p_cost, xp = v_p.xp, level = v_p.level, seen_at = now()
   where id = v_id;

  insert into gn_sims (player_id, country, operator, prefix, sub, label, mul, tier, tags, stake, cost, value)
  values (v_id, p_country, p_operator, p_prefix, p_sub, p_label, p_mul, p_tier, p_tags, p_stake, p_cost, p_value)
  returning * into v_sim;

  return jsonb_build_object('sim', gn_sim_json(v_sim), 'auto_sold', v_auto, 'levels_gained', v_levels,
                            'state', gn_state(v_id));
end $$;

-- Продать текущий номер.
create or replace function gn_sell_pending(p_telegram_id bigint) returns jsonb language plpgsql as $$
declare v_id uuid := gn_player_id(p_telegram_id); v_value bigint;
begin
  update gn_sims set status = 'sold', resolved_at = now()
   where player_id = v_id and status = 'pending' returning value into v_value;
  if v_value is null then raise exception 'Нет номера для продажи'; end if;
  update gn_players set balance = balance + v_value where id = v_id;
  return jsonb_build_object('sold', v_value, 'state', gn_state(v_id));
end $$;

-- Оставить текущий номер в коллекции.
create or replace function gn_keep(p_telegram_id bigint) returns jsonb language plpgsql as $$
declare v_id uuid := gn_player_id(p_telegram_id); v_value bigint;
begin
  perform gn_kassa_settle(v_id);
  update gn_sims set status = 'kept', resolved_at = now()
   where player_id = v_id and status = 'pending' returning value into v_value;
  if v_value is null then raise exception 'Нет номера'; end if;
  update gn_players set collection_value = collection_value + v_value, collection_count = collection_count + 1
   where id = v_id;
  return jsonb_build_object('kept', v_value, 'state', gn_state(v_id));
end $$;

-- Продать номер из коллекции.
create or replace function gn_sell_number(p_telegram_id bigint, p_sim_id uuid) returns jsonb language plpgsql as $$
declare v_id uuid := gn_player_id(p_telegram_id); v_value bigint;
begin
  perform gn_kassa_settle(v_id);
  update gn_sims set status = 'sold_from_collection', resolved_at = now()
   where id = p_sim_id and player_id = v_id and status = 'kept' returning value into v_value;
  if v_value is null then raise exception 'Номер не найден в коллекции'; end if;
  update gn_players
     set balance = balance + v_value,
         collection_value = collection_value - v_value,
         collection_count = collection_count - 1
   where id = v_id;
  return jsonb_build_object('sold', v_value, 'state', gn_state(v_id));
end $$;

-- Забрать кассу.
create or replace function gn_collect(p_telegram_id bigint) returns jsonb language plpgsql as $$
declare v_id uuid := gn_player_id(p_telegram_id); v_total numeric; v_paid bigint;
begin
  select gn_kassa_total(p) into v_total from gn_players p where id = v_id;
  v_paid := floor(v_total);
  if v_paid < 100 then raise exception 'В кассе пока пусто'; end if;
  update gn_players set balance = balance + v_paid, kassa_acc = v_total - v_paid, kassa_at = now()
   where id = v_id;
  return jsonb_build_object('collected', v_paid, 'state', gn_state(v_id));
end $$;

-- Помощь разорившемуся игроку: только если продавать нечего, не чаще раза в p_cooldown_h часов.
create or replace function gn_bailout(p_telegram_id bigint, p_min_cost bigint, p_amount bigint, p_cooldown_h integer)
returns jsonb language plpgsql as $$
declare v_id uuid := gn_player_id(p_telegram_id); v_p gn_players; v_pending bigint;
begin
  select * into v_p from gn_players where id = v_id;
  select coalesce(sum(value), 0) into v_pending from gn_sims where player_id = v_id and status = 'pending';
  if v_p.balance + v_pending + floor(gn_kassa_total(v_p)) >= p_min_cost then
    raise exception 'Денег хватает на прокрутку';
  end if;
  if v_p.collection_count > 0 then
    raise exception 'Продай номер из коллекции или подожди кассу';
  end if;
  if v_p.bailout_at is not null and v_p.bailout_at > now() - make_interval(hours => p_cooldown_h) then
    raise exception 'Помощь доступна раз в % ч', p_cooldown_h;
  end if;
  update gn_players set balance = balance + p_amount, bailout_at = now() where id = v_id;
  return jsonb_build_object('granted', p_amount, 'state', gn_state(v_id));
end $$;

create or replace function gn_collection(p_telegram_id bigint) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(gn_sim_json(s) order by s.value desc, s.created_at), '[]'::jsonb)
    from gn_sims s join gn_players p on p.id = s.player_id
   where p.telegram_id = p_telegram_id and s.status = 'kept';
$$;

-- Рейтинг: топ по стоимости коллекции + место текущего игрока.
create or replace function gn_leaderboard(p_telegram_id bigint, p_limit integer default 50)
returns jsonb language sql stable as $$
  with ranked as (
    select telegram_id, first_name, collection_value, collection_count,
           rank() over (order by collection_value desc) as place
      from gn_players where collection_value > 0
  )
  select jsonb_build_object(
    'top', coalesce((select jsonb_agg(jsonb_build_object(
              'place', place, 'name', first_name, 'value', collection_value, 'count', collection_count,
              'me', telegram_id = p_telegram_id) order by place, collection_count desc)
            from (select * from ranked order by place limit p_limit) t), '[]'::jsonb),
    'me', (select jsonb_build_object('place', place, 'value', collection_value, 'count', collection_count)
             from ranked where telegram_id = p_telegram_id)
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
