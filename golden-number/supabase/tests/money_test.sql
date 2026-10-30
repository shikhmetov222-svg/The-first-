-- Проверка денежных операций на настоящем Postgres (в транзакции, всё откатывается).
-- Запуск: psql "<строка подключения>" -v ON_ERROR_STOP=1 -f supabase/tests/money_test.sql
begin;

create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin if not ok then raise exception 'FAIL: %', msg; end if; raise notice 'ok: %', msg; end $$;

create or replace function pg_temp.spin(tg bigint, cost bigint, value bigint, lvl int default 1, xp int default 10)
returns jsonb language sql as $$
  select gn_spin(tg, lvl, cost, xp, 'ru', 'МТС', '910', '1234567', '+7 (910) 123-45-67', 1, 'common', '{}', 1, value);
$$;

do $$
declare r jsonb; s jsonb;
begin
  r := gn_login(1, 'Тест', 'test');
  perform pg_temp.check((r->>'balance')::bigint = 1000000, 'стартовый баланс 10 000 ₽');

  r := pg_temp.spin(1, 100000, 38000);
  perform pg_temp.check((r->'state'->>'balance')::bigint = 900000, 'ставка списана');
  perform pg_temp.check(r->'state'->'pending' is not null, 'номер ждёт решения');

  r := pg_temp.spin(1, 100000, 50000);
  perform pg_temp.check((r->>'auto_sold')::bigint = 38000, 'прошлый номер продан автоматически');
  perform pg_temp.check((r->'state'->>'balance')::bigint = 900000 + 38000 - 100000, 'баланс после автопродажи');

  r := gn_keep(1);
  perform pg_temp.check((r->'state'->>'collection_value')::bigint = 50000, 'номер в коллекции');
  perform pg_temp.check(r->'state'->'pending' = 'null'::jsonb, 'решение принято');

  begin perform gn_keep(1); perform pg_temp.check(false, 'повторный keep'); exception when raise_exception then
    perform pg_temp.check(sqlerrm = 'Нет номера', 'нельзя положить в коллекцию дважды'); end;
  begin perform gn_sell_pending(1); perform pg_temp.check(false, 'продажа без номера'); exception when raise_exception then
    perform pg_temp.check(true, 'нельзя продать то, чего нет'); end;

  -- касса: сдвигаем время на 3 часа назад → 3% × 3 ч
  update gn_players set kassa_at = now() - interval '3 hours' where telegram_id = 1;
  r := gn_state((select id from gn_players where telegram_id = 1));
  perform pg_temp.check(abs((r->>'kassa_acc')::numeric - 50000 * 0.03 * 3) < 0.01, 'касса 3 часа');
  -- 20 часов → не больше 8
  update gn_players set kassa_at = now() - interval '20 hours' where telegram_id = 1;
  r := gn_collect(1);
  perform pg_temp.check((r->>'collected')::bigint = 50000 * 0.03 * 8, 'касса ограничена 8 часами');
  begin perform gn_collect(1); perform pg_temp.check(false, 'двойной сбор'); exception when raise_exception then
    perform pg_temp.check(true, 'дважды кассу не забрать'); end;

  -- продажа из коллекции фиксирует кассу и уменьшает доход
  update gn_players set kassa_at = now() - interval '1 hour' where telegram_id = 1;
  s := gn_collection(1);
  r := gn_sell_number(1, (s->0->>'id')::uuid);
  perform pg_temp.check((r->'state'->>'collection_value')::bigint = 0, 'коллекция пуста после продажи');
  perform pg_temp.check(abs((r->'state'->>'kassa_acc')::numeric - 1500) < 0.01, 'касса за час сохранена после продажи');
  begin perform gn_sell_number(1, (s->0->>'id')::uuid); perform pg_temp.check(false, 'двойная продажа'); exception when raise_exception then
    perform pg_temp.check(true, 'номер не продать дважды'); end;

  -- не хватает денег: ничего не меняется
  update gn_players set balance = 500 where telegram_id = 1;
  begin perform pg_temp.spin(1, 100000, 1); perform pg_temp.check(false, 'минус'); exception when raise_exception then
    perform pg_temp.check(sqlerrm = 'Не хватает денег', 'в минус крутить нельзя'); end;

  -- уровень страны
  update gn_players set balance = 10000000 where telegram_id = 1;
  begin perform pg_temp.spin(1, 100, 1, 5); perform pg_temp.check(false, 'уровень'); exception when raise_exception then
    perform pg_temp.check(true, 'закрытая страна недоступна'); end;

  -- опыт: 100 на 1-й уровень, 200 на 2-й
  update gn_players set xp = 0, level = 1 where telegram_id = 1;
  r := pg_temp.spin(1, 100, 1, 1, 250);
  perform pg_temp.check((r->'state'->>'level')::int = 2 and (r->'state'->>'xp')::int = 150 and (r->>'levels_gained')::int = 1, 'уровень и остаток опыта');
  perform gn_sell_pending(1);

  -- помощь: только когда денег нет и продавать нечего
  begin perform gn_bailout(1, 100000, 500000, 4); perform pg_temp.check(false, 'помощь богатому'); exception when raise_exception then
    perform pg_temp.check(true, 'помощь не выдаётся, если деньги есть'); end;
  update gn_players set balance = 0, kassa_acc = 0 where telegram_id = 1;
  r := gn_bailout(1, 100000, 500000, 4);
  perform pg_temp.check((r->'state'->>'balance')::bigint = 500000, 'помощь выдана');
  update gn_players set balance = 0 where telegram_id = 1;
  begin perform gn_bailout(1, 100000, 500000, 4); perform pg_temp.check(false, 'помощь дважды'); exception when raise_exception then
    perform pg_temp.check(true, 'помощь не чаще раза в 4 часа'); end;

  -- рейтинг
  perform gn_login(2, 'Второй', null);
  perform pg_temp.spin(2, 100, 900000); perform gn_keep(2);
  r := gn_leaderboard(1);
  perform pg_temp.check((r->'top'->0->>'name') = 'Второй', 'рейтинг по стоимости коллекции');
  perform pg_temp.check(r->'me' = 'null'::jsonb, 'игрок без коллекции вне рейтинга');
end $$;

-- клиентские роли ничего не могут
set local role anon;
do $$ begin
  begin perform * from gn_players; raise exception 'FAIL: anon читает таблицу'; exception when insufficient_privilege then raise notice 'ok: anon не видит таблицы'; end;
  begin perform gn_collect(1); raise exception 'FAIL: anon вызывает функции'; exception when insufficient_privilege then raise notice 'ok: anon не вызывает функции'; end;
end $$;
reset role;

rollback;
