-- Улица другого игрока (только просмотр): карточка компании отдаёт её бизнесы с уровнями и рекламу на щите.
-- Ничего секретного: те же здания видны любому, кто зайдёт на улицу. Цены, склады и деньги сюда не попадают.

CREATE OR REPLACE FUNCTION public.company_card(p_player_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  result := result || jsonb_build_object('street', jsonb_build_object(
    'businesses', coalesce((select jsonb_agg(jsonb_build_object('type', b.type, 'level', b.level) order by t.sort)
                              from public.businesses b join public.business_types t using (type)
                             where b.player_id = p_player_id), '[]'::jsonb),
    -- Бизнес, чья рекламная кампания сейчас на щите у дороги (самая ранняя из активных).
    'ad', (select e.market from public.player_effects e
            where e.player_id = p_player_id and e.kind = 'ad' and e.until > now()
            order by e.until limit 1)));
  return result;
end;
$function$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
