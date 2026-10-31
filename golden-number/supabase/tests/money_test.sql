-- Проверка денежных операций (баланс v2, друзья, достижения, рынок) на настоящем Postgres. Всё в транзакции и откатывается.
-- Запуск: psql "<строка подключения>" -v ON_ERROR_STOP=1 -f supabase/tests/money_test.sql
begin;

create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin if not ok then raise exception 'FAIL: %', msg; end if; raise notice 'ok: %', msg; end $$;

-- Прокрутка так, как её делает Edge Function: снимок → решение об удаче → gn_spin.
create or replace function pg_temp.spin(tg bigint, cost bigint, value bigint, use_free boolean default false,
  autosell_ok boolean default false, tier text default 'common', xp int default 10, lvl int default 1,
  spin_no_override int default null, lucky_override boolean default null, use_bonus boolean default false)
returns jsonb language plpgsql as $$
declare c jsonb := gn_spin_context(tg, 4, 2, '{13,20}', 10); n int; lucky boolean; happy boolean;
begin
  n := coalesce(spin_no_override, (c->>'spin_no')::int);
  lucky := coalesce(lucky_override, n % 100 = 0);
  happy := not lucky and (c->>'happy_left')::int > 0;
  return gn_spin(tg, n, lvl, use_free, use_bonus, lucky, happy, 1, case when use_free or use_bonus then 0 else cost end, cost, xp, autosell_ok,
    'ru', 'МТС', '910', '1234567', '+7 (910) 123-45-67', 1, tier, '{}', 1, value,
    80, 1.5, 0.01, 100, 4, 2, '{13,20}', 10, 30, 500000, 3);
end $$;

do $$
declare r jsonb; s jsonb; i int; tg bigint := 1;
begin
  r := gn_login(tg, 'Тест', 'test');
  perform pg_temp.check((r->>'balance')::bigint = 1000000, 'стартовый баланс 10 000 ₽');
  perform pg_temp.check((r->>'free_charges')::int = 2, 'две бесплатные прокрутки на старте');

  r := pg_temp.spin(tg, 100000, 38000, use_free => true);
  perform pg_temp.check((r->'state'->>'balance')::bigint = 1000000, 'бесплатная прокрутка не списывает деньги');
  perform pg_temp.check((r->'state'->>'free_charges')::int = 1, 'бесплатная прокрутка израсходована');
  perform pg_temp.check((r->'sim'->>'is_free')::boolean, 'номер помечен как бесплатный');

  r := pg_temp.spin(tg, 100000, 38000);
  perform pg_temp.check((r->>'auto_sold')::bigint = 38000, 'обычный прошлый номер продан автоматически');
  perform pg_temp.check((r->'state'->>'balance')::bigint = 1000000 + 38000 - 100000, 'ставка списана');
  perform pg_temp.check((r->'state'->>'avg_bet') is null, 'avg_bet не уходит клиенту');
  perform pg_temp.check((select avg_bet from gn_players where telegram_id = tg) = 100000, 'средняя ставка обновлена');

  -- редкий номер нельзя продать автоматически без подтверждения
  r := pg_temp.spin(tg, 100000, 456000, tier => 'rare');
  begin perform pg_temp.spin(tg, 100000, 1); perform pg_temp.check(false, 'автопродажа редкого');
  exception when raise_exception then
    perform pg_temp.check(sqlerrm = 'Сначала реши, что делать с прошлым номером', 'редкий без подтверждения не продаётся'); end;
  r := pg_temp.spin(tg, 100000, 1000, autosell_ok => true);
  perform pg_temp.check((r->>'auto_sold')::bigint = 456000, 'с подтверждением — продан');

  -- снимок устарел → GN_RETRY
  begin perform pg_temp.spin(tg, 100000, 1, spin_no_override => 1); perform pg_temp.check(false, 'старый снимок');
  exception when raise_exception then perform pg_temp.check(sqlerrm = 'GN_RETRY', 'устаревший номер прокрутки отклонён'); end;
  begin perform pg_temp.spin(tg, 100000, 1, lucky_override => true); perform pg_temp.check(false, 'ложная удача');
  exception when raise_exception then perform pg_temp.check(sqlerrm = 'GN_RETRY', 'нельзя объявить прокрутку «сотой»'); end;
  begin perform pg_temp.spin(tg, 100000, 1, use_free => true); perform pg_temp.spin(tg, 100000, 1, use_free => true);
    perform pg_temp.check(false, 'лишняя бесплатная');
  exception when raise_exception then perform pg_temp.check(sqlerrm = 'GN_RETRY', 'бесплатных не больше, чем накоплено'); end;

  -- витрина: 6 мест
  update gn_players set balance = 100000000 where telegram_id = tg;
  for i in 1..6 loop
    perform pg_temp.spin(tg, 100000, 10000 * i); perform gn_keep(tg, 6, 0.7);
  end loop;
  perform pg_temp.spin(tg, 100000, 99000);
  begin perform gn_keep(tg, 6, 0.7); perform pg_temp.check(false, 'седьмое место');
  exception when raise_exception then perform pg_temp.check(sqlerrm = 'Витрина заполнена', 'на полной витрине нужно выбрать замену'); end;
  s := gn_collection(tg);
  select balance into i from gn_players where telegram_id = tg;
  r := gn_keep(tg, 6, 0.7, (s->5->>'id')::uuid); -- самый дешёвый (10 000 коп.)
  perform pg_temp.check((r->>'replaced_sold')::bigint = 7000, 'заменённый номер продан за 70%');
  perform pg_temp.check((r->'state'->>'collection_count')::int = 6, 'на витрине по-прежнему 6');

  -- продажа из коллекции за 70%
  s := gn_collection(tg);
  r := gn_sell_number(tg, (s->0->>'id')::uuid, 0.7);
  perform pg_temp.check((r->>'sold')::bigint = floor(99000 * 0.7), 'продажа из коллекции — 70% цены');

  -- покупка места
  r := gn_buy_slot(tg, 0, 400000, 18);
  perform pg_temp.check((r->'state'->>'extra_slots')::int = 1, 'место на витрине куплено');
  begin perform gn_buy_slot(tg, 0, 400000, 18); perform pg_temp.check(false, 'двойная покупка');
  exception when raise_exception then perform pg_temp.check(sqlerrm = 'GN_RETRY', 'цена места сверяется со снимком'); end;

  -- касса: 1% в час, не больше 12 часов
  update gn_players set kassa_acc = 0, kassa_at = now() - interval '3 hours' where telegram_id = tg;
  r := gn_state((select id from gn_players where telegram_id = tg));
  perform pg_temp.check(abs((r->>'kassa_acc')::numeric - (r->>'collection_value')::bigint * 0.01 * 3) < 0.01, 'касса 1% в час');
  update gn_players set kassa_at = now() - interval '30 hours' where telegram_id = tg;
  r := gn_collect(tg);
  perform pg_temp.check((r->>'collected')::bigint = floor((r->'state'->>'collection_value')::bigint * 0.01 * 12), 'касса ограничена 12 часами');

  -- ежедневный бонус
  r := gn_daily(tg, 150000, 50000, 6);
  perform pg_temp.check((r->>'amount')::bigint = 150000, 'бонус первого дня 1 500 ₽');
  begin perform gn_daily(tg, 150000, 50000, 6); perform pg_temp.check(false, 'второй бонус');
  exception when raise_exception then perform pg_temp.check(true, 'бонус раз в день'); end;
  update gn_players set daily_day = daily_day - 1 where telegram_id = tg;
  r := gn_daily(tg, 150000, 50000, 6);
  perform pg_temp.check((r->>'amount')::bigint = 200000 and (r->>'streak')::int = 1, 'серия: второй день 2 000 ₽');
  update gn_players set daily_day = daily_day - 1, daily_streak = 20 where telegram_id = tg;
  r := gn_daily(tg, 150000, 50000, 6);
  perform pg_temp.check((r->>'amount')::bigint = 450000, 'серия ограничена 4 500 ₽');
  update gn_players set daily_day = daily_day - 3 where telegram_id = tg;
  r := gn_daily(tg, 150000, 50000, 6);
  perform pg_temp.check((r->>'streak')::int = 0, 'пропуск дня сбрасывает серию');

  -- опыт: 80 до 2-го уровня, 226 до 3-го
  update gn_players set xp = 0, level = 1 where telegram_id = tg;
  r := pg_temp.spin(tg, 100, 1, xp => 300);
  perform pg_temp.check((r->'state'->>'level')::int = 2 and (r->'state'->>'xp')::int = 220, 'кривая опыта 80·ур^1,5');
  begin perform pg_temp.spin(tg, 100, 1, lvl => 4); perform pg_temp.check(false, 'уровень ставки');
  exception when raise_exception then perform pg_temp.check(sqlerrm = 'Откроется на уровне 4', 'закрытая ставка/страна недоступна'); end;

  -- помощь
  perform gn_login(2, 'Бедный', null);
  update gn_players set balance = 0 where telegram_id = 2;
  begin perform gn_bailout(2, 100000, 300000, 24, 4, 2); perform pg_temp.check(false, 'помощь при бесплатных');
  exception when raise_exception then perform pg_temp.check(sqlerrm = 'У тебя есть бесплатная прокрутка', 'сначала бесплатные прокрутки'); end;
  update gn_players set free_charges = 0, free_at = now() where telegram_id = 2;
  r := gn_bailout(2, 100000, 300000, 24, 4, 2);
  perform pg_temp.check((r->'state'->>'balance')::bigint = 300000, 'помощь 3 000 ₽');
  update gn_players set balance = 0 where telegram_id = 2;
  begin perform gn_bailout(2, 100000, 300000, 24, 4, 2); perform pg_temp.check(false, 'помощь дважды');
  exception when raise_exception then perform pg_temp.check(true, 'помощь раз в сутки'); end;
  update gn_players set free_at = now() - interval '9 hours' where telegram_id = 2;
  perform pg_temp.check((gn_spin_context(2, 4, 2, '{13,20}', 10)->>'free')::int = 2, 'бесплатные копятся раз в 4 ч, не больше двух');

  -- в минус нельзя
  update gn_players set balance = 500, free_charges = 0, free_at = now() where telegram_id = 2;
  begin perform pg_temp.spin(2, 100000, 1); perform pg_temp.check(false, 'минус');
  exception when raise_exception then perform pg_temp.check(sqlerrm = 'Не хватает денег', 'в минус крутить нельзя'); end;


  -- ===== друзья =====
  r := gn_login(10, 'Пригласивший', null);
  r := gn_login(11, 'Друг', null, 10, 10);
  perform pg_temp.check((r->>'bonus_spins')::int = 10 and (r->>'is_new')::boolean, 'друг по ссылке получил 10 прокруток');
  r := gn_login(11, 'Друг', null, 99, 10);
  perform pg_temp.check((r->>'bonus_spins')::int = 10 and not (r->>'is_new')::boolean, 'повторный вход не даёт подарок второй раз');
  r := gn_login(12, 'Сам себе', null, 12, 10);
  perform pg_temp.check((r->>'bonus_spins')::int = 0, 'нельзя пригласить самого себя');
  update gn_players set free_charges = 0, free_at = now() where telegram_id = 11;
  r := pg_temp.spin(11, 100000, 1, use_bonus => true);
  perform pg_temp.check((r->'state'->>'bonus_spins')::int = 9 and (r->'state'->>'balance')::bigint = 1000000, 'подарочная прокрутка бесплатна');
  for i in 2..29 loop perform pg_temp.spin(11, 100, 1); end loop;
  perform pg_temp.check((select balance from gn_players where telegram_id = 10) = 1000000, 'до 30 прокруток друга награды нет');
  perform pg_temp.spin(11, 100, 1);
  r := gn_friends(10);
  perform pg_temp.check((r->>'active')::int = 1 and (r->>'earned')::bigint = 500000, 'друг засчитан после 30 прокруток');
  perform pg_temp.check((select balance from gn_players where telegram_id = 10) = 1500000, 'пригласивший получил 5 000 ₽');
  perform pg_temp.spin(11, 100, 1);
  perform pg_temp.check((select ref_count from gn_players where telegram_id = 10) = 1, 'награда за друга — один раз');

  -- ===== достижения =====
  r := gn_stats(11);
  perform pg_temp.check((r->>'total_spins')::int = 31 and r->'ops' ? 'ru:МТС', 'статистика прокруток');
  r := gn_claim(11, 'spins10', 50000, 0);
  perform pg_temp.check((r->>'reward')::bigint = 50000, 'награда за достижение');
  begin perform gn_claim(11, 'spins10', 50000, 0); perform pg_temp.check(false, 'двойная награда');
  exception when raise_exception then perform pg_temp.check(sqlerrm = 'Награда уже получена', 'награду не получить дважды'); end;
  perform pg_temp.check((gn_stats(11)->'claimed') ? 'spins10', 'полученные награды в статистике');

  -- ===== рынок =====
  update gn_players set balance = 100000000 where telegram_id in (10, 11);
  perform gn_sell_pending(11);
  perform pg_temp.spin(11, 100, 100000); perform gn_keep(11, 6, 0.7);
  s := gn_collection(11);
  begin perform gn_lot_create(11, (s->0->>'id')::uuid, 10, 0.5, 5, 5); perform pg_temp.check(false, 'слишком дешёво');
  exception when raise_exception then perform pg_temp.check(true, 'цена лота ограничена снизу'); end;
  r := gn_lot_create(11, (s->0->>'id')::uuid, 150000, 0.5, 5, 5);
  perform pg_temp.check((r->'state'->>'collection_count')::int = 0 and (r->'state'->>'listed_count')::int = 1, 'выставленный номер ушёл с витрины');
  begin perform gn_lot_buy(11, (r->'lot'->>'id')::uuid, 6, 0.05, 3); perform pg_temp.check(false, 'свой лот');
  exception when raise_exception then perform pg_temp.check(sqlerrm = 'Это твой лот', 'свой лот не купить'); end;
  perform pg_temp.check(jsonb_array_length(gn_market(10)) = 1, 'лот виден на рынке');
  perform set_config('t.seller', (select balance from gn_players where telegram_id = 11)::text, true);
  r := gn_lot_buy(10, (r->'lot'->>'id')::uuid, 6, 0.05, 3);
  perform pg_temp.check((r->'state'->>'balance')::bigint = 100000000 - 150000, 'покупатель заплатил цену');
  perform pg_temp.check((select balance from gn_players where telegram_id = 11) = current_setting('t.seller')::bigint + 142500, 'продавец получил цену минус 5%');
  perform pg_temp.check((r->'state'->>'collection_value')::bigint = (select sum(value) from gn_sims s join gn_players p on p.id = s.player_id where p.telegram_id = 10 and s.status = 'kept'), 'номер на витрине покупателя по оценке');
  perform pg_temp.check(jsonb_array_length(gn_market(10)) = 0, 'проданный лот исчез');
  -- снять с продажи
  perform pg_temp.spin(11, 100, 100000); perform gn_keep(11, 6, 0.7);
  s := gn_collection(11);
  r := gn_lot_create(11, (s->0->>'id')::uuid, 100000, 0.5, 5, 5);
  r := gn_lot_cancel(11, (r->'lot'->>'id')::uuid, 6);
  perform pg_temp.check((r->'state'->>'collection_count')::int = 1, 'снятый номер вернулся на витрину');
  -- лимит покупок у одного продавца
  for i in 1..3 loop
    perform pg_temp.spin(11, 100, 100000); perform gn_keep(11, 9, 0.7);
    s := gn_collection(11);
    r := gn_lot_create(11, (s->0->>'id')::uuid, 100000, 0.5, 5, 5);
    if i < 3 then perform gn_lot_buy(10, (r->'lot'->>'id')::uuid, 9, 0.05, 3); end if;
  end loop;
  begin perform gn_lot_buy(10, (r->'lot'->>'id')::uuid, 9, 0.05, 3); perform pg_temp.check(false, '4-я покупка');
  exception when raise_exception then perform pg_temp.check(sqlerrm like 'У одного продавца%', 'не больше 3 покупок у одного продавца в сутки'); end;

  r := gn_leaderboard(tg);
  perform pg_temp.check((r->'top'->0->>'value')::bigint >= (r->'top'->1->>'value')::bigint
    and (r->'top'->0->>'value')::bigint = (select max(collection_value) from gn_players), 'рейтинг по стоимости коллекции');
end $$;

-- клиентские роли ничего не могут
set local role anon;
do $$ begin
  begin perform * from gn_players; raise exception 'FAIL: anon читает таблицу'; exception when insufficient_privilege then raise notice 'ok: anon не видит таблицы'; end;
  begin perform gn_daily(1, 1, 1, 1); raise exception 'FAIL: anon вызывает функции'; exception when insufficient_privilege then raise notice 'ok: anon не вызывает функции'; end;
end $$;
reset role;

rollback;
