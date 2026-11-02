-- Проверка функций v5 (0006): история, задания, лента, неделя, улучшение, обмен, уведомления, статистика.
-- Запуск: psql "<строка подключения>" -v ON_ERROR_STOP=1 -f supabase/tests/v5_test.sql. Всё откатывается.
begin;

create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin if not ok then raise exception 'FAIL: %', msg; end if; raise notice 'ok: %', msg; end $$;

-- Номер в коллекции игрока (как будто выпал и оставлен).
create or replace function pg_temp.kept(tg bigint, sub text, tier text, value bigint, tags text[] default '{}',
  at timestamptz default now(), status text default 'kept') returns uuid language plpgsql as $$
declare v_p uuid; v_id uuid;
begin
  select id into v_p from gn_players where telegram_id = tg;
  insert into gn_sims (player_id, country, operator, prefix, sub, label, mul, tier, tags, stake, cost, value, bet, status, created_at, resolved_at)
  values (v_p, 'ru', 'МТС', '910', sub, '+7 (910) ' || sub, 1, tier, tags, 1, 100000, value, 100000, status, at, at)
  returning id into v_id;
  if status = 'kept' then
    update gn_players set collection_value = collection_value + value, collection_count = collection_count + 1 where id = v_p;
  end if;
  return v_id;
end $$;

do $$
declare r jsonb; a uuid; b uuid; c uuid; d uuid; f1 uuid; t uuid; v_day date := (now() at time zone 'Europe/Moscow')::date;
  v_week timestamptz := gn_msk_day_start(date_trunc('week', now() at time zone 'Europe/Moscow')::date);
begin
  perform gn_login(101, 'Аня', 'anya', null, 10);
  perform gn_login(102, 'Боря', 'borya', 101, 10); -- Боря приглашён Аней
  perform gn_login(103, 'Вера', 'vera', null, 10);
  update gn_players set extra_slots = 10;

  -- история
  a := pg_temp.kept(101, '1234567', 'epic', 1640000, '{Лесенка}');
  b := pg_temp.kept(101, '5803917', 'common', 88000);
  r := gn_history(101);
  perform pg_temp.check(jsonb_array_length(r) = 2 and r->0->>'status' = 'kept' and (r->0) ? 'cost', 'история: номера со статусом и ценой');

  -- день
  r := gn_day_stats(101, v_day);
  perform pg_temp.check((r->>'spins')::int = 2 and (r->>'kept')::int = 2 and (r->'tiers'->>'epic')::int = 1, 'статистика дня');
  perform gn_claim(101, 'q:' || v_day || ':spins20', 150000, 0);
  r := gn_day_stats(101, v_day);
  perform pg_temp.check(r->'claimed' ? ('q:' || v_day || ':spins20'), 'задание дня отмечено полученным');
  r := gn_stats(101);
  perform pg_temp.check(not (r->'claimed' ? ('q:' || v_day || ':spins20')) and r->'tags' ? 'Лесенка', 'достижения не видят задания; узоры для альбомов');

  -- лента
  r := gn_feed(102);
  perform pg_temp.check(jsonb_array_length(r) = 1 and r->0->>'name' = 'Аня' and r->0->>'tier' = 'epic', 'лента: эпический номер Ани');

  -- значок «первый в игре»
  c := pg_temp.kept(103, '7654321', 'epic', 1500000, '{Лесенка}', now() + interval '1 second');
  r := gn_collection(103);
  perform pg_temp.check((r->0->>'first')::boolean = false, 'у Веры лесенка не первая');
  r := gn_collection(101);
  perform pg_temp.check((r->0->>'first')::boolean = true, 'у Ани лесенка первая в игре');

  -- неделя: прошлая неделя, Вера лучшая
  perform pg_temp.kept(103, '1111111', 'legend', 9000000, '{}', v_week - interval '2 days', 'sold');
  perform pg_temp.kept(101, '2222222', 'legend', 8000000, '{}', v_week - interval '3 days', 'sold');
  r := gn_week_board(101, v_week - interval '7 days');
  perform pg_temp.check(r->'top'->0->>'name' = 'Вера' and (r->'me'->>'place')::int = 2, 'рейтинг прошлой недели');
  r := gn_week_prize(103, v_week - interval '7 days', '{5000000,2500000,1000000}', '{5,3,1}');
  perform pg_temp.check((r->>'place')::int = 1 and (r->>'prize')::bigint = 5000000, 'приз за 1 место');
  r := gn_week_prize(103, v_week - interval '7 days', '{5000000,2500000,1000000}', '{5,3,1}');
  perform pg_temp.check(r is null, 'приз выдаётся один раз');
  r := gn_week_board(101, v_week);
  perform pg_temp.check((r->'me'->>'place')::int = 1, 'текущая неделя: Аня первая');

  -- улучшение
  perform pg_temp.kept(101, '1237878', 'nice', 118000, '{"Хвост 78-78"}');
  perform pg_temp.kept(101, '1237788', 'nice', 110000, '{"Хвост 77-88"}');
  perform pg_temp.kept(101, '1237887', 'nice', 105000);
  r := gn_merge_ctx(101, array(select id from gn_sims where tier = 'nice' and status = 'kept'));
  perform pg_temp.check(r->>'tier' = 'nice' and (r->>'bet')::bigint = 100000, 'улучшение: снимок');
  begin perform gn_merge_ctx(101, array[a, b, a]); raise exception 'нет ошибки';
  exception when others then perform pg_temp.check(sqlerrm like 'Выбери три%', 'улучшение: нужны три разных'); end;
  r := gn_merge(101, array(select id from gn_sims where tier = 'nice' and status = 'kept'), 'nice',
                'ru', 'МТС', '910', '5121212', '+7 (910) 512-12-12', 8, 'rare', '{"Повтор пар"}', 210000, 100000);
  perform pg_temp.check(r->'sim'->>'tier' = 'rare' and (r->'state'->>'collection_count')::int = 3
                        and (r->'state'->>'collection_value')::bigint = 1640000 + 88000 + 210000, 'улучшение: 3 Красивых → 1 Редкий');
  perform pg_temp.check((select count(*) from gn_sims where status = 'merged') = 3, 'старые номера помечены');

  -- обмен: Аня и Боря друзья, Вера — нет
  d := pg_temp.kept(102, '9876543', 'epic', 1200000, '{Лесенка}');
  r := gn_friends(102);
  perform pg_temp.check(r->'inviter'->>'name' = 'Аня', 'у Бори видно, кто пригласил');
  r := gn_friend_collection(101, (select id from gn_players where telegram_id = 102));
  perform pg_temp.check(jsonb_array_length(r->'list') = 1, 'Аня видит коллекцию Бори');
  begin perform gn_friend_collection(103, (select id from gn_players where telegram_id = 101)); raise exception 'нет ошибки';
  exception when others then perform pg_temp.check(sqlerrm = 'Это не твой друг', 'чужую коллекцию не видно'); end;
  begin perform gn_trade_offer(101, b, (select id from gn_players where telegram_id = 102), d, 2, 5, 3); raise exception 'нет ошибки';
  exception when others then perform pg_temp.check(sqlerrm like 'Слишком разные цены%', 'обмен: нельзя дешёвый на дорогой'); end;
  r := gn_trade_offer(101, a, (select id from gn_players where telegram_id = 102), d, 2, 5, 3);
  t := (r->'trade'->>'id')::uuid;
  perform pg_temp.check((select (gn_state(id)->>'trades_in')::int from gn_players where telegram_id = 102) = 1, 'Боре пришло предложение');
  perform pg_temp.check(exists (select 1 from gn_notices where kind = 'trade'), 'сообщение о предложении в очереди');
  r := gn_trades_list(102);
  perform pg_temp.check((r->0->>'incoming')::boolean and r->0->'get'->>'sub' = '1234567', 'Боря видит, что получит');
  begin perform gn_trade_answer(103, t, true); raise exception 'нет ошибки';
  exception when others then perform pg_temp.check(sqlerrm = 'Предложение не найдено', 'чужой не может ответить'); end;
  r := gn_trade_answer(102, t, true);
  perform pg_temp.check(r->>'status' = 'accepted', 'обмен принят');
  perform pg_temp.check((select player_id from gn_sims where id = a) = (select id from gn_players where telegram_id = 102)
                        and (select player_id from gn_sims where id = d) = (select id from gn_players where telegram_id = 101), 'номера поменялись');
  perform pg_temp.check((select collection_value from gn_players where telegram_id = 101) = 1200000 + 88000 + 210000
                        and (select collection_value from gn_players where telegram_id = 102) = 1640000, 'стоимость коллекций пересчитана');
  begin perform gn_trade_answer(102, t, true); raise exception 'нет ошибки';
  exception when others then perform pg_temp.check(sqlerrm = 'Предложение уже закрыто', 'повторно принять нельзя'); end;

  -- уведомления: касса полна
  update gn_players set kassa_acc = 0, kassa_at = now() - interval '13 hours', kassa_notified_at = null where telegram_id = 101;
  r := gn_notify_take(30, 100, 0.02, 12, '{13,20}', 2);
  perform pg_temp.check(exists (select 1 from jsonb_array_elements(r) x where (x->>'telegram_id')::bigint = 101 and x->>'kind' = 'kassa'), 'касса полна → сообщение');
  perform pg_temp.check(exists (select 1 from jsonb_array_elements(r) x where (x->>'telegram_id')::bigint = 101 and x->>'kind' = 'trade'), 'и сообщение об обмене');
  r := gn_notify_take(30, 100, 0.02, 12, '{13,20}', 2);
  perform pg_temp.check(jsonb_array_length(r) = 0, 'повторный вызов сразу — ничего');
  update gn_meta set updated_at = now() - interval '1 minute' where key = 'notify_tick';
  r := gn_notify_take(30, 100, 0.02, 12, '{13,20}', 2);
  perform pg_temp.check(jsonb_array_length(r) = 0, 'касса уже напомнена — второй раз не шлём');
  update gn_players set notify = false where telegram_id = 102;
  perform gn_notify_prefs(102, true, true);
  perform pg_temp.check((select notify_happy from gn_players where telegram_id = 102), 'настройки уведомлений');

  -- статистика
  r := gn_admin_stats();
  perform pg_temp.check((r->>'players')::int = 3 and (r->>'spins_7d')::int >= 5, 'статистика владельца');
end $$;

rollback;
