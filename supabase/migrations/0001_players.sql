-- Этап 2: игроки.
-- Деньги храним в копейках (bigint), чтобы не было ошибок округления.
-- Доступ к таблицам — только у сервера (service_role). Клиент напрямую в базу не ходит.

create table public.players (
  id            uuid primary key default gen_random_uuid(),
  telegram_id   bigint not null unique,
  first_name    text not null default '',
  username      text,
  language_code text,
  cash          bigint not null default 10000000 check (cash >= 0), -- 100 000 ₽
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

alter table public.players enable row level security;
revoke all on public.players from anon, authenticated;

-- Вход: создаёт игрока при первом визите или обновляет имя и время визита.
-- Возвращает игрока и флаг is_new.
create function public.login_player(
  p_telegram_id bigint,
  p_first_name text,
  p_username text,
  p_language_code text
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  result jsonb;
begin
  insert into public.players as p (telegram_id, first_name, username, language_code)
  values (p_telegram_id, coalesce(p_first_name, ''), p_username, p_language_code)
  on conflict (telegram_id) do update
    set first_name    = excluded.first_name,
        username      = excluded.username,
        language_code = excluded.language_code,
        last_seen_at  = now()
  returning to_jsonb(p.*) || jsonb_build_object('is_new', p.xmax = 0)
  into result;
  return result;
end;
$$;

revoke execute on function public.login_player(bigint, text, text, text) from public, anon, authenticated;
grant execute on function public.login_player(bigint, text, text, text) to service_role;
