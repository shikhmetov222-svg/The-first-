-- 3D-улица: общая для всех погода, пороги районов по капиталу, время последней выручки бизнеса (для монеток).

insert into public.balance_config (key, value, description) values
  ('street.district_1',      30000000,  'Улица: с какого капитала «Район» (коп.); ниже — «Окраина»'),
  ('street.district_2',      150000000, 'Улица: с какого капитала «Центр» (коп.)'),
  ('street.weather_hours',   3,         'Улица: погода меняется раз в столько часов (одна на весь город)'),
  ('street.rain_chance',     0.3,       'Улица: вероятность дождя (весна, лето, осень)'),
  ('street.snow_chance',     0.4,       'Улица: вероятность снега зимой (декабрь — февраль)'),
  ('street.winter_rain_chance', 0.1,    'Улица: вероятность дождя зимой');

-- Погода города. Без таблицы: выбирается по номеру отрезка времени, поэтому у всех игроков одна и та же.
create function public.street_weather() returns jsonb
language sql stable set search_path = ''
as $$
  with b as (
    select floor(extract(epoch from now()) / (public.cfg('street.weather_hours') * 3600))::bigint as n
  ), r as (
    select n, ('x' || substr(md5('capital-weather-' || n), 1, 8))::bit(32)::bigint / 4294967296.0 as v from b
  )
  select jsonb_build_object(
    'kind', case
      when extract(month from now() at time zone 'Europe/Moscow') in (12, 1, 2) then
        case when v < public.cfg('street.snow_chance') then 'snow'
             when v < public.cfg('street.snow_chance') + public.cfg('street.winter_rain_chance') then 'rain'
             else 'clear' end
      else case when v < public.cfg('street.rain_chance') then 'rain' else 'clear' end
    end,
    'until', to_timestamp((n + 1) * public.cfg('street.weather_hours') * 3600))
  from r
$$;

-- Состояние: погода и районы для улицы, время последней выручки бизнеса.
CREATE OR REPLACE FUNCTION public.get_state(p_player_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  pd     public.player_decisions;
  v_cap  bigint;
  result jsonb;
begin
  update public.players set last_seen_at = now() where id = p_player_id;
  insert into public.player_days (player_id, day) values (p_player_id, public.moscow_today())
  on conflict do nothing;
  pd := public.today_decision(p_player_id);
  select capital into v_cap from public.capitals() where player_id = p_player_id;

  select jsonb_build_object(
    'server_time', now(),
    'player', (select jsonb_build_object('id', id, 'first_name', first_name, 'cash', cash, 'created_at', created_at,
                                         'tutorial_step', tutorial_step, 'haptics', haptics_enabled)
               from public.players where id = p_player_id),
    'company', (select case when company_name is null then null else jsonb_build_object(
                  'name', company_name, 'icon', company_icon, 'color', company_color, 'motto', company_motto,
                  'can_rename', name_changed_season is distinct from public.current_season()) end
                from public.players where id = p_player_id),
    'catalog', (select jsonb_agg(to_jsonb(t.*) order by t.sort) from public.business_types t),
    'businesses', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', b.id, 'type', b.type, 'price', b.price, 'stock', b.stock,
               'raw_stock', b.raw_stock, 'pending_revenue', b.pending_revenue, 'listed', b.listed,
               'progress', b.work_progress,
               'last_sale_at', (select max(l.tick_at) from public.sales_log l
                                 where l.business_id = b.id and l.revenue > 0 and l.tick_at > now() - interval '10 minutes'),
               'level', b.level,
               'capacity', public.lvl_cap(t.capacity, b.level),
               'raw_capacity', public.lvl_cap(t.raw_capacity, b.level),
               'repair', (select jsonb_build_object(
                            'to_level', o.to_level, 'kind', o.kind, 'status', o.status,
                            'finish_at', coalesce(o.finish_at, o.due_at), 'due_at', o.due_at,
                            'contractor', case o.kind when 'npc' then 'СтройБыт' when 'self' then 'Своя бригада'
                                          else (select coalesce(cp.company_name, cp.first_name) from public.businesses cb
                                                  join public.players cp on cp.id = cb.player_id
                                                 where cb.id = o.crew_business_id) end)
                          from public.repair_orders o
                         where o.business_id = b.id and o.status in ('queued', 'working')),
               'crew', case when b.type = 'repair' then jsonb_build_object(
                         'npc_job_until', b.npc_job_until,
                         'pct', b.repair_pct,
                         'rating', public.crew_rating(b.id),
                         'done', (select count(*) from public.repair_orders o where o.crew_business_id = b.id and o.status = 'done'),
                         'earned_24h', (select coalesce(sum(o.fee - ceil(o.fee * 0.05)), 0) from public.repair_orders o
                                         where o.crew_business_id = b.id and o.status = 'done' and o.kind = 'crew'
                                           and o.finished_at > now() - interval '24 hours'),
                         'queue', coalesce((select jsonb_agg(jsonb_build_object(
                                    'id', o.id, 'type', o.business_type, 'to_level', o.to_level, 'kind', o.kind,
                                    'status', o.status, 'fee', o.fee, 'finish_at', coalesce(o.finish_at, o.due_at),
                                    'customer', coalesce(cu.company_name, cu.first_name)) order by o.id)
                                  from public.repair_orders o join public.players cu on cu.id = o.customer_id
                                 where o.crew_business_id = b.id and o.status in ('queued', 'working')), '[]'::jsonb)) end,
               'goods', (select jsonb_object_agg(g.product, g.qty) from public.business_goods g where g.business_id = b.id),
               'ads', coalesce((select jsonb_agg(e.until order by e.until) from public.player_effects e
                                 where e.player_id = p_player_id and e.kind = 'ad' and e.market = b.type
                                   and e.until > now()), '[]'::jsonb),
               'last_revenue', coalesce((select l.revenue from public.sales_log l
                                          where l.business_id = b.id and l.tick_at > now() - interval '5 minutes'
                                          order by l.tick_at desc limit 1), 0),
               'last_sold', coalesce((select l.sold from public.sales_log l
                                       where l.business_id = b.id and l.sold > 0
                                         and l.tick_at > now() - interval '5 minutes'
                                       order by l.tick_at desc limit 1), 0)) order by t.sort)
      from public.businesses b join public.business_types t using (type)
      where b.player_id = p_player_id), '[]'::jsonb),
    'street', jsonb_build_object(
      'district', jsonb_build_array(public.cfg('street.district_1'), public.cfg('street.district_2')),
      'weather', public.street_weather()),
    'npc_niches', (select jsonb_object_agg(k, names) from (
                     select kind k, jsonb_agg(name order by id) names from public.npc_niches
                      where active and kind in ('marketplace', 'pvz') group by kind) x),
    'upgrade', jsonb_build_object(
      'max_level', public.cfg('upgrade.max_level'),
      'capacity_step', public.cfg('upgrade.capacity_step'),
      'sales_step', public.cfg('upgrade.sales_step'),
      'min_pct', public.cfg('repair.min_pct'), 'max_pct', public.cfg('repair.max_pct'),
      'queue', public.cfg('repair.queue'), 'minutes', public.cfg('repair.minutes'),
      'costs', (select jsonb_object_agg(bb.type, public.upgrade_cost(bb.type, bb.level + 1))
                  from public.businesses bb where bb.player_id = p_player_id)),
    'ads', jsonb_build_object(
      'boost', public.cfg('agency.boost'),
      'minutes', public.cfg('agency.minutes'),
      'max', public.cfg('agency.max_per_business'),
      'npc_price', public.cfg('agency.npc_price'),
      'npc_name', 'Громкий голос',
      'npc', (select jsonb_agg(jsonb_build_object('id', n.id, 'name', n.name, 'price', public.npc_price(n))
                               order by public.npc_price(n))
                from public.npc_niches n where n.kind = 'agency' and n.active),
      'minutes_per_campaign', public.cfg('agency.minutes_per_campaign')),
    'markets', (
      select jsonb_agg(jsonb_build_object(
               'market', mk.market, 'name', mk.name, 'ref_price', mk.ref_price,
               'market_price', mk.market_price, 'demand_level', mk.demand_level,
               'sellers', mk.sellers, 'last_demand', mk.last_demand,
               'players', (select count(*) from public.businesses b join public.business_types t using (type)
                            where t.market = mk.market),
               'bots', coalesce((select jsonb_agg(jsonb_build_object(
                                   'name', n.name, 'kind', n.kind, 'price', n.price, 'last_sold', n.last_sold) order by n.id)
                                 from public.npc_sellers n where n.market = mk.market and n.active), '[]'::jsonb)))
      from public.markets mk),
    'capital', v_cap,
    'start_capital', public.start_capital(),
    'league', public.league_of(v_cap),
    -- Место среди игроков той же лиги.
    'league_place', (select count(*) + 1 from public.capitals() c
                      where public.league_of(c.capital) = public.league_of(v_cap) and c.capital > v_cap),
    -- Капитал за последние сутки: [секунды unix, копейки].
    'capital_history', coalesce((select jsonb_agg(jsonb_build_array(extract(epoch from s.taken_at)::bigint, s.capital)
                                                  order by s.taken_at)
                                   from public.capital_snapshots s
                                  where s.player_id = p_player_id and s.taken_at > now() - interval '24 hours'),
                                '[]'::jsonb),
    'season', (select jsonb_build_object('number', s.id, 'starts_at', s.starts_at, 'ends_at', s.ends_at)
                 from public.seasons s where not s.finished order by s.id desc limit 1),
    'decision', (select jsonb_build_object(
                   'title', d.title, 'body', d.body,
                   'options', (select jsonb_agg(jsonb_build_object('label', o ->> 'label', 'hint', o ->> 'hint'))
                                 from jsonb_array_elements(d.options) o),
                   'choice', pd.choice, 'result', pd.result, 'success', pd.success)
                   from public.decisions d where d.id = pd.decision_id),
    -- Реклама показывается на карточках бизнесов, здесь — только эффекты решений дня.
    'effects', coalesce((select jsonb_agg(jsonb_build_object(
                           'label', e.label, 'kind', e.kind, 'market', e.market, 'mult', e.mult, 'until', e.until)
                           order by e.until)
                         from public.player_effects e
                         where e.player_id = p_player_id and e.until > now() and e.kind <> 'ad'), '[]'::jsonb),
    'discount', public.effect_mult(p_player_id, 'discount', null),
    'notifications', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'text', x.text, 'at', x.created_at,
                                                                   'read', x.read_at is not null) order by x.id desc)
                                 from (select * from public.notifications where player_id = p_player_id
                                        order by id desc limit 20) x), '[]'::jsonb),
    'unread', (select count(*) from public.notifications where player_id = p_player_id and read_at is null)
  ) into result;
  return result;
end;
$function$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
