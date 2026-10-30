-- «Золотой номер», баланс v2: витрина с местами, продажа за 70%, касса 1%/ч до 12 ч,
-- ежедневный бонус, бесплатные прокрутки, удача (счастливые часы и каждая 100-я),
-- ставки по уровню, новая кривая опыта, подтверждение автопродажи редких номеров.
-- Константы баланса приходят из config.ts параметрами; в SQL зашиты только ставка и лимит кассы.

alter table gn_players
  add column if not exists total_spins  integer not null default 0,
  add column if not exists avg_bet      bigint  not null default 100000, -- копейки, скользящее среднее ставки
  add column if not exists free_charges integer not null default 2,
  add column if not exists free_at      timestamptz not null default now(),
  add column if not exists happy_key    text,     -- 'YYYY-MM-DDTHH' счастливого часа по Москве
  add column if not exists happy_used   integer not null default 0,
  add column if not exists daily_day    date,     -- день (по Москве), когда забран бонус
  add column if not exists daily_streak integer not null default 0,
  add column if not exists extra_slots  integer not null default 0;

alter table gn_sims
  add column if not exists bet     bigint,                      -- ставка, от которой посчитана цена
  add column if not exists luck    integer not null default 1,
  add column if not exists is_free boolean not null default false;

-- У тех, кто уже собрал больше 6 номеров, ничего не отнимаем: витрина расширяется под коллекцию.
update gn_players set extra_slots = greatest(0, collection_count - 6) where extra_slots = 0;
-- Старые игроки получают текущее число прокруток, чтобы счётчик «каждой 100-й» был честным.
update gn_players p set total_spins = (select count(*) from gn_sims s where s.player_id = p.id) where total_spins = 0;

-- ---------- касса: 1% в час, не больше 12 часов (= KASSA_RATE_PER_HOUR, KASSA_CAP_HOURS) ----------
create or replace function gn_kassa_total(p gn_players, p_now timestamptz default now())
returns numeric language sql stable as $$
  select greatest(
    p.kassa_acc,
    least(
      p.kassa_acc + p.collection_value * 0.01 * greatest(0, extract(epoch from (p_now - p.kassa_at)) / 3600),
      p.collection_value * 0.01 * 12
    )
  );
$$;

-- ---------- бесплатные прокрутки и счастливые часы (те же формулы — freeNow/happyNow в logic.ts) ----------
create or replace function gn_free_now(p gn_players, p_every_h numeric, p_max integer,
  out charges integer, out base_at timestamptz) language plpgsql stable as $$
declare n integer;
begin
  if p.free_charges >= p_max then charges := p_max; base_at := now(); return; end if;
  n := floor(greatest(0, extract(epoch from (now() - p.free_at))) / (p_every_h * 3600));
  charges := least(p_max, p.free_charges + n);
  base_at := case when charges >= p_max then now() else p.free_at + make_interval(secs => n * p_every_h * 3600) end;
end $$;

create or replace function gn_happy_now(p gn_players, p_hours integer[], p_spins integer,
  out active boolean, out left_spins integer, out key text) language plpgsql stable as $$
declare m timestamp := now() at time zone 'Europe/Moscow';
begin
  key := to_char(m, 'YYYY-MM-DD"T"HH24');
  active := extract(hour from m)::integer = any(p_hours);
  left_spins := case when not active then 0
                     when p.happy_key = key then greatest(0, p_spins - p.happy_used)
                     else p_spins end;
end $$;

-- ---------- чтение ----------
create or replace function gn_sim_json(s gn_sims) returns jsonb language sql immutable as $$
  select case when s.id is null then null else jsonb_build_object(
    'id', s.id, 'country', s.country, 'operator', s.operator, 'prefix', s.prefix, 'sub', s.sub,
    'label', s.label, 'mul', s.mul, 'tier', s.tier, 'tags', to_jsonb(s.tags), 'stake', s.stake,
    'value', s.value, 'luck', s.luck, 'is_free', s.is_free, 'created_at', s.created_at) end;
$$;

-- Сырые поля; производные (бесплатные сейчас, счастливый час, бонус) клиент считает теми же формулами.
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
    'total_spins', p.total_spins,
    'free_charges', p.free_charges,
    'free_at', p.free_at,
    'happy_key', p.happy_key,
    'happy_used', p.happy_used,
    'daily_day', p.daily_day,
    'daily_streak', p.daily_streak,
    'extra_slots', p.extra_slots,
    'pending', (select gn_sim_json(s) from gn_sims s where s.player_id = p.id and s.status = 'pending')
  ) from gn_players p where p.id = p_id;
$$;

-- Снимок для Edge Function перед прокруткой: какая это по счёту, есть ли удача и бесплатные.
create or replace function gn_spin_context(p_telegram_id bigint, p_free_every_h numeric, p_free_max integer,
  p_happy_hours integer[], p_happy_spins integer) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'spin_no', p.total_spins + 1,
    'level', p.level,
    'avg_bet', p.avg_bet,
    'free', (gn_free_now(p, p_free_every_h, p_free_max)).charges,
    'happy_left', (gn_happy_now(p, p_happy_hours, p_happy_spins)).left_spins,
    'pending_tier', (select s.tier from gn_sims s where s.player_id = p.id and s.status = 'pending')
  ) from gn_players p where p.telegram_id = p_telegram_id;
$$;

-- ---------- прокрутка ----------
drop function if exists gn_spin(bigint, integer, bigint, integer, text, text, text, text, text, numeric, text, text[], integer, bigint);

-- Номер сгенерирован и оценён в Edge Function по снимку gn_spin_context. Здесь — проверка, что снимок
-- ещё верен (иначе GN_RETRY и функция повторит), и все изменения денег, опыта и счётчиков одной транзакцией.
create or replace function gn_spin(
  p_telegram_id bigint, p_spin_no integer, p_required_level integer,
  p_use_free boolean, p_lucky boolean, p_happy_used boolean, p_luck integer,
  p_cost bigint, p_bet bigint, p_xp integer, p_autosell_ok boolean,
  p_country text, p_operator text, p_prefix text, p_sub text, p_label text,
  p_mul numeric, p_tier text, p_tags text[], p_stake integer, p_value bigint,
  p_xp_base numeric, p_xp_pow numeric, p_avg_weight numeric, p_lucky_every integer,
  p_free_every_h numeric, p_free_max integer, p_happy_hours integer[], p_happy_spins integer
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
  if not p_lucky and p_happy_used <> (v_happy.left_spins > 0) then raise exception 'GN_RETRY'; end if;

  if v_p.level < p_required_level then
    raise exception 'Откроется на уровне %', p_required_level;
  end if;

  select * into v_pending from gn_sims where player_id = v_id and status = 'pending';
  if v_pending.id is not null and v_pending.tier in ('rare', 'epic', 'legend') and not p_autosell_ok then
    raise exception 'Сначала реши, что делать с прошлым номером';
  end if;

  -- Прошлый номер, по которому игрок не решил, продаётся автоматически.
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
    avg_bet = case when p_use_free then avg_bet else round(avg_bet * (1 - p_avg_weight) + p_bet * p_avg_weight) end,
    free_charges = case when p_use_free then v_free.charges - 1 else free_charges end,
    free_at = case when p_use_free then v_free.base_at else free_at end,
    happy_used = case when not p_happy_used then happy_used when happy_key = v_happy.key then happy_used + 1 else 1 end,
    happy_key = case when p_happy_used then v_happy.key else happy_key end
  where id = v_id;

  insert into gn_sims (player_id, country, operator, prefix, sub, label, mul, tier, tags, stake, cost, value, bet, luck, is_free)
  values (v_id, p_country, p_operator, p_prefix, p_sub, p_label, p_mul, p_tier, p_tags, p_stake, p_cost, p_value, p_bet, p_luck, p_use_free)
  returning * into v_sim;

  return jsonb_build_object('sim', gn_sim_json(v_sim), 'auto_sold', v_auto, 'levels_gained', v_levels,
                            'state', gn_state(v_id));
end $$;

-- ---------- витрина ----------
drop function if exists gn_keep(bigint);

-- Оставить текущий номер. Если витрина полна — нужно указать, какой номер заменить (он продаётся за p_sell_back).
create or replace function gn_keep(p_telegram_id bigint, p_slots_start integer, p_sell_back numeric,
  p_replace_id uuid default null) returns jsonb language plpgsql as $$
declare v_id uuid := gn_player_id(p_telegram_id); v_p gn_players; v_value bigint; v_old bigint; v_paid bigint := 0;
begin
  select * into v_p from gn_players where id = v_id;
  if not exists (select 1 from gn_sims where player_id = v_id and status = 'pending') then raise exception 'Нет номера'; end if;
  perform gn_kassa_settle(v_id);
  if v_p.collection_count >= p_slots_start + v_p.extra_slots then
    if p_replace_id is null then raise exception 'Витрина заполнена'; end if;
    update gn_sims set status = 'sold_from_collection', resolved_at = now()
     where id = p_replace_id and player_id = v_id and status = 'kept' returning value into v_old;
    if v_old is null then raise exception 'Номер для замены не найден'; end if;
    v_paid := floor(v_old * p_sell_back);
    update gn_players set balance = balance + v_paid, collection_value = collection_value - v_old,
                          collection_count = collection_count - 1 where id = v_id;
  end if;
  update gn_sims set status = 'kept', resolved_at = now()
   where player_id = v_id and status = 'pending' returning value into v_value;
  update gn_players set collection_value = collection_value + v_value, collection_count = collection_count + 1
   where id = v_id;
  return jsonb_build_object('kept', v_value, 'replaced_sold', v_paid, 'state', gn_state(v_id));
end $$;

drop function if exists gn_sell_number(bigint, uuid);

-- Продать номер из коллекции за p_sell_back его цены.
create or replace function gn_sell_number(p_telegram_id bigint, p_sim_id uuid, p_sell_back numeric)
returns jsonb language plpgsql as $$
declare v_id uuid := gn_player_id(p_telegram_id); v_value bigint; v_paid bigint;
begin
  perform gn_kassa_settle(v_id);
  update gn_sims set status = 'sold_from_collection', resolved_at = now()
   where id = p_sim_id and player_id = v_id and status = 'kept' returning value into v_value;
  if v_value is null then raise exception 'Номер не найден в коллекции'; end if;
  v_paid := floor(v_value * p_sell_back);
  update gn_players
     set balance = balance + v_paid,
         collection_value = collection_value - v_value,
         collection_count = collection_count - 1
   where id = v_id;
  return jsonb_build_object('sold', v_paid, 'state', gn_state(v_id));
end $$;

-- Купить место на витрине. Цену считает Edge Function по extra_slots из снимка — сверяем снимок.
create or replace function gn_buy_slot(p_telegram_id bigint, p_expected_extra integer, p_price bigint, p_max_extra integer)
returns jsonb language plpgsql as $$
declare v_id uuid := gn_player_id(p_telegram_id); v_p gn_players;
begin
  select * into v_p from gn_players where id = v_id;
  if v_p.extra_slots <> p_expected_extra then raise exception 'GN_RETRY'; end if;
  if v_p.extra_slots >= p_max_extra then raise exception 'Витрина уже максимальная'; end if;
  if v_p.balance < p_price then raise exception 'Не хватает денег'; end if;
  update gn_players set balance = balance - p_price, extra_slots = extra_slots + 1 where id = v_id;
  return jsonb_build_object('paid', p_price, 'state', gn_state(v_id));
end $$;

-- ---------- бонусы ----------
create or replace function gn_daily(p_telegram_id bigint, p_base bigint, p_step bigint, p_max_streak integer)
returns jsonb language plpgsql as $$
declare v_id uuid := gn_player_id(p_telegram_id); v_p gn_players;
        v_today date := (now() at time zone 'Europe/Moscow')::date; v_streak integer; v_amount bigint;
begin
  select * into v_p from gn_players where id = v_id;
  if v_p.daily_day = v_today then raise exception 'Бонус уже получен — приходи завтра'; end if;
  v_streak := case when v_p.daily_day = v_today - 1 then v_p.daily_streak + 1 else 0 end;
  v_amount := p_base + p_step * least(v_streak, p_max_streak);
  update gn_players set balance = balance + v_amount, daily_day = v_today, daily_streak = v_streak where id = v_id;
  return jsonb_build_object('amount', v_amount, 'streak', v_streak, 'state', gn_state(v_id));
end $$;

drop function if exists gn_bailout(bigint, bigint, bigint, integer);

-- Помощь: только если денег не хватает даже на самую дешёвую прокрутку, продавать нечего и бесплатных нет.
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
  if (gn_free_now(v_p, p_free_every_h, p_free_max)).charges > 0 then raise exception 'У тебя есть бесплатная прокрутка'; end if;
  if v_p.bailout_at is not null and v_p.bailout_at > now() - make_interval(hours => p_cooldown_h) then
    raise exception 'Помощь доступна раз в % ч', p_cooldown_h;
  end if;
  update gn_players set balance = balance + p_amount, bailout_at = now() where id = v_id;
  return jsonb_build_object('granted', p_amount, 'state', gn_state(v_id));
end $$;

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
