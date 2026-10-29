-- Карточка компании: обёртка из 0023 была помечена stable, а внутри company_card_base проверяет достижения
-- (пишет в player_achievements) — API запускает stable-функции только на чтение, и карточка падала с ошибкой.
create or replace function public.company_card(p_player_id uuid) returns jsonb
language plpgsql volatile set search_path = ''
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
