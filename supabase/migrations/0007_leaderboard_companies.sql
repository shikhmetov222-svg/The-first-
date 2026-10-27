-- Рейтинг показывает компании (логотип, название); по id открывается карточка компании.

create or replace function public.leaderboard(p_player_id uuid, p_kind text) returns jsonb
language sql stable set search_path = ''
as $$
  with c as (
    select c.player_id, c.capital,
           coalesce(p.company_name, c.first_name) as name,
           p.company_icon as icon, p.company_color as color,
           coalesce((select s.capital from public.capital_snapshots s
                      where s.player_id = c.player_id and s.taken_at <= now() - interval '24 hours'
                      order by s.taken_at desc limit 1), public.start_capital()) as base
      from public.capitals() c
      join public.players p on p.id = c.player_id
  ), ranked as (
    select player_id, name, icon, color, capital,
           round((capital - base)::numeric / base * 100, 1) as growth,
           row_number() over (order by
             case when p_kind = 'growth' then (capital - base)::numeric / base else capital end desc,
             capital desc, player_id) as place
      from c
  )
  select jsonb_build_object(
    'kind', p_kind,
    'total', (select count(*) from ranked),
    'top', coalesce((select jsonb_agg(jsonb_build_object(
              'id', player_id, 'place', place, 'name', name, 'icon', icon, 'color', color,
              'capital', capital, 'growth', growth, 'me', player_id = p_player_id) order by place)
            from ranked where place <= 50), '[]'::jsonb),
    'me', (select jsonb_build_object('id', player_id, 'place', place, 'name', name, 'icon', icon, 'color', color,
                                     'capital', capital, 'growth', growth)
             from ranked where player_id = p_player_id)
  )
$$;

-- Карточка чужой компании: сначала обновляем достижения, чтобы титул и значки были свежими.
create function public.company_card(p_player_id uuid) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not exists (select 1 from public.players where id = p_player_id) then
    raise exception 'Компания не найдена';
  end if;
  perform public.check_achievements(p_player_id);
  result := public.public_profile(p_player_id);
  -- У игрока без компании показываем его имя.
  if result -> 'company' ->> 'name' is null then
    result := jsonb_set(result, '{company,name}',
                        to_jsonb((select first_name from public.players where id = p_player_id)));
  end if;
  return result;
end;
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
