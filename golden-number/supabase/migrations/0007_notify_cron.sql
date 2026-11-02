-- «Золотой номер»: рассылка ботом по расписанию. Каждые 5 минут база зовёт Edge Function с ?tick=notify,
-- та забирает готовые сообщения (gn_notify_take: касса полна, скоро счастливый час, номер купили, обмен) и отправляет.
-- Отдельный файл: если расширение pg_cron недоступно, не откатятся остальные изменения (0006).
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('gn-notify') where exists (select 1 from cron.job where jobname = 'gn-notify');
select cron.schedule('gn-notify', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://vufqhvjaonqiplcardiw.supabase.co/functions/v1/golden-number?tick=notify',
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 20000)
$$);
