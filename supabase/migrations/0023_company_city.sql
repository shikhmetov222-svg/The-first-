-- Город другой компании: в карточке компании вместо улицы — её карта (только посмотреть).
-- company_card теперь обёртка: основная карточка — company_card_base, обёртка добавляет city.
-- В city только то, что и так видно в профиле и рейтинге: какие бизнесы, какого уровня, в каком районе, что строится.

create function public.company_city(p_player uuid) returns jsonb
language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'seed', public.city_seed(p_player),
    'stage', public.city_stage(p_player),
    'caps', jsonb_build_array(0, public.cfg('city.stage_2'), public.cfg('city.stage_3'), public.cfg('city.stage_4')),
    'plots', coalesce((select jsonb_agg(jsonb_build_object('type', b.type, 'i', bp.bi, 'j', bp.bj, 'k', bp.bk))
                         from public.businesses b join public.business_plots bp on bp.business_id = b.id
                        where b.player_id = p_player), '[]'::jsonb),
    'businesses', coalesce((select jsonb_agg(jsonb_build_object('type', b.type, 'level', b.level))
                              from public.businesses b where b.player_id = p_player), '[]'::jsonb),
    'builds', (select coalesce(jsonb_agg(x - 'brigade'), '[]'::jsonb)
                 from jsonb_array_elements(public.builds_view(p_player)) x)
  )
$$;

alter function public.company_card(uuid) rename to company_card_base;

create function public.company_card(p_player_id uuid) returns jsonb
language plpgsql stable set search_path = ''
as $$
declare
  v jsonb := public.company_card_base(p_player_id);
begin
  if v is null then return null; end if;
  return v || jsonb_build_object('city', public.company_city(p_player_id));
end;
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
