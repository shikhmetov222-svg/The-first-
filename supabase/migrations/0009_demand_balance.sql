-- Баланс спроса: в 1,5 раза больше покупателей, город не «вымирает» ночью,
-- вечер (главное игровое время) почти как день; пекарня успевает снабжать магазин.

-- Покупателей за 5 минут на одного продавца днём: кофе 4 → 6, хлеб 6 → 9.
update public.markets set base_demand = 6 where market = 'coffee';
update public.markets set base_demand = 9 where market = 'bread';

-- Пекарня: 8 → 14 буханок за 5 минут, склад муки 600 → 1000.
update public.business_types set production_rate = 14, raw_capacity = 1000 where type = 'bakery';

-- Спрос по часам (Москва). Ночью не ниже 0,35; с 17 до 21 — почти как днём.
create or replace function public.hour_factor(p_market text, p_hour int) returns numeric
language sql immutable set search_path = ''
as $$
  select (case p_market
    when 'coffee' then array[0.4,0.35,0.35,0.35,0.4,0.5, 0.8,1.4,1.8,1.6,1.2,1.1, 1.3,1.3,1.0,1.0,1.1,1.2, 1.2,1.1,1.0,0.9,0.7,0.5]
    else               array[0.35,0.35,0.35,0.35,0.4,0.5, 0.7,1.1,1.3,1.1,0.9,0.9, 1.1,1.0,0.8,0.8,1.0,1.4, 1.6,1.5,1.3,1.0,0.7,0.5]
  end)[p_hour + 1]::numeric
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
