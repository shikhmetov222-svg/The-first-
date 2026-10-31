-- Рассылка сообщений ботом выключена (решение владельца). Уведомления внутри игры (колокольчик) остаются.
-- Включить обратно: новой миграцией поставить notify.bot_enabled = 1.
insert into public.balance_config (key, value, description) values
  ('notify.bot_enabled', 0, 'Бот пишет игрокам в Telegram: 1 — да, 0 — нет (уведомления в игре остаются)')
on conflict (key) do update set value = excluded.value;

alter function public.notifications_batch() rename to notifications_batch_base;

-- Пока бот выключен — ничего не отдаём на отправку, а ждущие сообщения помечаем пропущенными,
-- чтобы при включении не ушла пачка старых.
create function public.notifications_batch() returns jsonb
language plpgsql set search_path = ''
as $$
begin
  if coalesce(public.cfg('notify.bot_enabled'), 1) = 0 then
    update public.notifications set bot_status = 'skipped', bot_at = now() where bot_status = 'pending';
    return '[]'::jsonb;
  end if;
  return public.notifications_batch_base();
end;
$$;

-- Ждущие отправки сейчас — не отправляем.
update public.notifications set bot_status = 'skipped', bot_at = now() where bot_status = 'pending';

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
