-- «Золотой номер»: правило «Что оставлять себе». Невыбранный номер при следующей прокрутке
-- сам уходит в коллекцию, если подходит под правило (по редкости или по цене), иначе продаётся.
-- По умолчанию — «Редкие и дороже», чтобы редкий номер не продался случайно.

alter table gn_players
  add column if not exists keep_rule jsonb not null default '{"mode": "tier", "tier": "rare"}'::jsonb;

-- Подходит ли номер под правило игрока.
create or replace function gn_rule_match(p_rule jsonb, s gn_sims) returns boolean language sql immutable as $$
  select case p_rule->>'mode'
    when 'tier' then array_position(array['common','nice','rare','epic','legend'], s.tier)
                   >= array_position(array['common','nice','rare','epic','legend'], p_rule->>'tier')
    when 'price' then s.value >= coalesce((p_rule->>'from')::bigint, 0)
                  and (p_rule->>'to' is null or s.value <= (p_rule->>'to')::bigint)
    else false
  end;
$$;

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
    'listed_count', (select count(*) from gn_lots l where l.seller_id = p.id and l.status = 'active'),
    'pending', (select gn_sim_json(s) from gn_sims s where s.player_id = p.id and s.status = 'pending')
  ) from gn_players p where p.id = p_id;
$$;

-- Правило проверяет Edge Function (формат и границы), здесь только сохраняем.
create or replace function gn_set_keep_rule(p_telegram_id bigint, p_rule jsonb) returns jsonb language plpgsql as $$
declare v_id uuid := gn_player_id(p_telegram_id);
begin
  update gn_players set keep_rule = p_rule where id = v_id;
  return jsonb_build_object('state', gn_state(v_id));
end $$;

-- ---------- прокрутка: прошлый номер — в коллекцию по правилу или в продажу ----------
drop function if exists gn_spin(bigint, integer, integer, boolean, boolean, boolean, boolean, integer, bigint, bigint, integer, boolean,
  text, text, text, text, text, numeric, text, text[], integer, bigint, numeric, numeric, numeric, integer, numeric, integer, integer[], integer,
  integer, bigint, integer);

create or replace function gn_spin(
  p_telegram_id bigint, p_spin_no integer, p_required_level integer,
  p_use_free boolean, p_use_bonus boolean, p_lucky boolean, p_happy_used boolean, p_luck integer,
  p_cost bigint, p_bet bigint, p_xp integer, p_autosell_ok boolean,
  p_country text, p_operator text, p_prefix text, p_sub text, p_label text,
  p_mul numeric, p_tier text, p_tags text[], p_stake integer, p_value bigint,
  p_xp_base numeric, p_xp_pow numeric, p_avg_weight numeric, p_lucky_every integer,
  p_free_every_h numeric, p_free_max integer, p_happy_hours integer[], p_happy_spins integer,
  p_ref_after integer, p_ref_reward bigint, p_ref_spins integer, p_slots_start integer
) returns jsonb language plpgsql as $$
declare
  v_id uuid := gn_player_id(p_telegram_id);
  v_p gn_players;
  v_free record;
  v_happy record;
  v_pending gn_sims;
  v_auto bigint := 0;
  v_kept bigint := 0;
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

  -- Прошлый номер, по которому игрок не решил: по правилу — в коллекцию, иначе — продаётся.
  select * into v_pending from gn_sims where player_id = v_id and status = 'pending';
  if v_pending.id is not null then
    if gn_rule_match(v_p.keep_rule, v_pending) and v_p.collection_count < p_slots_start + v_p.extra_slots then
      perform gn_kassa_settle(v_id);
      update gn_sims set status = 'kept', resolved_at = now() where id = v_pending.id;
      update gn_players set collection_value = collection_value + v_pending.value, collection_count = collection_count + 1
       where id = v_id;
      v_kept := v_pending.value;
    elsif gn_rule_match(v_p.keep_rule, v_pending) and not p_autosell_ok then
      raise exception 'Витрина заполнена: прошлый номер подходит под правило «оставлять», но ему нет места';
    else
      update gn_sims set status = 'auto_sold', resolved_at = now() where id = v_pending.id;
      v_auto := v_pending.value;
    end if;
  end if;

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

  return jsonb_build_object('sim', gn_sim_json(v_sim), 'auto_sold', v_auto, 'auto_kept', v_kept, 'levels_gained', v_levels,
                            'state', gn_state(v_id));
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
