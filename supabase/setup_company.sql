-- CAPITAL: аккаунт игрока (компания, логотип, девиз, обучение).
-- Вставьте весь этот текст в SQL Editor и нажмите Run один раз.
begin;

-- Аккаунт игрока: компания (название, логотип, цвет, девиз) и обучение.
-- Все проверки — на сервере: длина и символы, мат, уникальность, смена названия раз в сезон.

alter table public.players
  add column company_name        text,
  add column company_icon        text,
  add column company_color       text,
  add column company_motto       text not null default '',
  add column company_created_at  timestamptz,
  add column name_changed_season int,
  add column tutorial_step       int not null default 0;

-- Названия уникальны без учёта регистра (компании переживают смену сезона,
-- поэтому уникальность «в сезоне» обеспечивается уникальностью вообще).
create unique index players_company_name_unique on public.players (lower(company_name));

create function public.current_season() returns int
language sql stable set search_path = ''
as $$ select id from public.seasons where not finished order by id desc limit 1 $$;

-- Есть ли мат (русский, английский, транслит, замена букв цифрами и латиницей).
create function public.has_profanity(p_text text) returns boolean
language plpgsql immutable set search_path = ''
as $$
declare
  t  text := lower(coalesce(p_text, ''));
  ru text;
  en text;
begin
  -- Латиница и цифры, похожие на русские буквы → русские буквы.
  ru := translate(t, 'aeopcxykmtbh01346@ё', 'аеорсхукмтбноизчбае');
  -- Для английских слов: цифры и символы → буквы.
  en := translate(t, '01345@$', 'oieasas');
  -- Склеиваем повторы букв: «хууууй» → «хуй».
  ru := regexp_replace(ru, '(.)\1+', '\1', 'g');
  en := regexp_replace(en, '(.)\1+', '\1', 'g');

  return ru ~ '(пизд|пезд|гандон|залуп|шлюх|дроч|пидор|пидар|пидр|педераст|мудак|мудил|мудач|сучк|сучар|ебл|ебуч|ебан|ебат|ебал)'
      or ru ~ '\m(на|по|ни|от|за)?ху(й|е|ё|я|и|ю)'
      or ru ~ '\mбля'
      or ru ~ '\mсук(а|и|е|у|ой)\M'
      or ru ~ '\m(за|вы|по|от|на|у|до|рас|раз|об|съ|въ|при|подъ)?[её]б'
      or en ~ '(fuck|fuk|shit|bitch|cunt|whore|slut|nigg|asshole|pussy|porn|huy|hui|xuy|pizd|pezd|blya|ebat|eban|ebal|pidor|pidar|mudak|gandon|zalup)'
      or en ~ '\m(dick|cock)(s|head)?\M'
      or en ~ '\m(suka|suki)\M';
end;
$$;

create function public.clean_spaces(p_text text) returns text
language sql immutable set search_path = ''
as $$ select regexp_replace(btrim(coalesce(p_text, '')), '\s+', ' ', 'g') $$;

-- Проверка полей компании. Ошибки — понятным игроку текстом.
create function public.validate_company(p_name text, p_icon text, p_color text, p_motto text) returns void
language plpgsql immutable set search_path = ''
as $$
begin
  if char_length(p_name) < 3 or char_length(p_name) > 24 then
    raise exception 'Название — от 3 до 24 символов';
  end if;
  if p_name !~ '^[A-Za-zА-Яа-яЁё0-9 -]+$' then
    raise exception 'В названии можно использовать только буквы, цифры, пробел и дефис';
  end if;
  if p_name !~ '[A-Za-zА-Яа-яЁё]' then
    raise exception 'В названии должна быть хотя бы одна буква';
  end if;
  if char_length(p_motto) > 40 then
    raise exception 'Девиз — не длиннее 40 символов';
  end if;
  if public.has_profanity(p_name) or public.has_profanity(p_motto) then
    raise exception 'Выбери другое название или девиз — без грубых слов';
  end if;
  if p_icon not in ('crown', 'gem', 'rocket', 'landmark', 'briefcase', 'factory',
                    'anchor', 'mountain', 'flame', 'zap', 'shield', 'compass') then
    raise exception 'Неизвестный логотип';
  end if;
  if p_color not in ('gold', 'emerald', 'coral', 'amber', 'sky', 'violet', 'rose', 'silver') then
    raise exception 'Неизвестный цвет';
  end if;
end;
$$;

create function public.create_company(
  p_player_id uuid, p_name text, p_icon text, p_color text, p_motto text
) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_name  text := public.clean_spaces(p_name);
  v_motto text := public.clean_spaces(p_motto);
begin
  perform public.validate_company(v_name, p_icon, p_color, v_motto);
  perform 1 from public.players where id = p_player_id and company_name is null for update;
  if not found then raise exception 'Компания уже создана'; end if;
  if exists (select 1 from public.players where lower(company_name) = lower(v_name)) then
    raise exception 'Название «%» уже занято', v_name;
  end if;

  update public.players
     set company_name = v_name, company_icon = p_icon, company_color = p_color,
         company_motto = v_motto, company_created_at = now()
   where id = p_player_id;
exception
  when unique_violation then raise exception 'Название «%» уже занято', v_name;
end;
$$;

-- Изменение компании. Логотип, цвет и девиз — когда угодно; название — раз в сезон.
create function public.update_company(
  p_player_id uuid, p_name text, p_icon text, p_color text, p_motto text
) returns void
language plpgsql
set search_path = ''
as $$
declare
  p       public.players;
  v_name  text := public.clean_spaces(p_name);
  v_motto text := public.clean_spaces(p_motto);
  v_season int := public.current_season();
begin
  perform public.validate_company(v_name, p_icon, p_color, v_motto);
  select * into p from public.players where id = p_player_id for update;
  if p.company_name is null then raise exception 'Сначала создай компанию'; end if;

  if lower(v_name) <> lower(p.company_name) then
    if p.name_changed_season = v_season then
      raise exception 'Название можно менять только раз в сезон';
    end if;
    if exists (select 1 from public.players where lower(company_name) = lower(v_name) and id <> p_player_id) then
      raise exception 'Название «%» уже занято', v_name;
    end if;
    update public.players set name_changed_season = v_season where id = p_player_id;
  end if;

  update public.players
     set company_name = v_name, company_icon = p_icon, company_color = p_color, company_motto = v_motto
   where id = p_player_id;
exception
  when unique_violation then raise exception 'Название «%» уже занято', v_name;
end;
$$;

-- Шаг обучения (0–3, 3 — пройдено). Только вперёд.
create function public.set_tutorial_step(p_player_id uuid, p_step int) returns void
language sql
set search_path = ''
as $$
  update public.players
     set tutorial_step = greatest(tutorial_step, least(3, greatest(0, p_step)))
   where id = p_player_id
$$;

-- Состояние экрана: добавлены компания и шаг обучения.
create or replace function public.get_state(p_player_id uuid) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  pd     public.player_decisions;
  result jsonb;
begin
  update public.players set last_seen_at = now() where id = p_player_id;
  pd := public.today_decision(p_player_id);

  select jsonb_build_object(
    'server_time', now(),
    'player', (select jsonb_build_object('id', id, 'first_name', first_name, 'cash', cash, 'created_at', created_at,
                                         'tutorial_step', tutorial_step)
               from public.players where id = p_player_id),
    'company', (select case when company_name is null then null else jsonb_build_object(
                  'name', company_name, 'icon', company_icon, 'color', company_color, 'motto', company_motto,
                  'can_rename', name_changed_season is distinct from public.current_season()) end
                from public.players where id = p_player_id),
    'catalog', (select jsonb_agg(to_jsonb(t.*) order by t.sort) from public.business_types t),
    'businesses', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', b.id, 'type', b.type, 'price', b.price, 'stock', b.stock,
               'raw_stock', b.raw_stock, 'pending_revenue', b.pending_revenue,
               'last_sold', coalesce((select l.sold from public.sales_log l
                                       where l.business_id = b.id and l.sold > 0
                                         and l.tick_at > now() - interval '5 minutes'
                                       order by l.tick_at desc limit 1), 0)) order by t.sort)
      from public.businesses b join public.business_types t using (type)
      where b.player_id = p_player_id), '[]'::jsonb),
    'markets', (
      select jsonb_agg(jsonb_build_object(
               'market', mk.market, 'name', mk.name, 'ref_price', mk.ref_price,
               'market_price', mk.market_price, 'demand_level', mk.demand_level,
               'sellers', mk.sellers, 'last_demand', mk.last_demand,
               'players', (select count(*) from public.businesses b join public.business_types t using (type)
                            where t.market = mk.market),
               'bots', coalesce((select jsonb_agg(jsonb_build_object(
                                   'name', n.name, 'kind', n.kind, 'price', n.price, 'last_sold', n.last_sold) order by n.id)
                                 from public.npc_sellers n where n.market = mk.market and n.active), '[]'::jsonb)))
      from public.markets mk),
    'capital', (select c.capital from public.capitals() c where c.player_id = p_player_id),
    'season', (select jsonb_build_object('number', s.id, 'starts_at', s.starts_at, 'ends_at', s.ends_at)
                 from public.seasons s where not s.finished order by s.id desc limit 1),
    'decision', (select jsonb_build_object(
                   'title', d.title, 'body', d.body,
                   'options', (select jsonb_agg(jsonb_build_object('label', o ->> 'label', 'hint', o ->> 'hint'))
                                 from jsonb_array_elements(d.options) o),
                   'choice', pd.choice, 'result', pd.result, 'success', pd.success)
                   from public.decisions d where d.id = pd.decision_id),
    'effects', coalesce((select jsonb_agg(jsonb_build_object(
                           'label', e.label, 'kind', e.kind, 'market', e.market, 'mult', e.mult, 'until', e.until)
                           order by e.until)
                         from public.player_effects e
                         where e.player_id = p_player_id and e.until > now()), '[]'::jsonb),
    'discount', public.effect_mult(p_player_id, 'discount', null)
  ) into result;
  return result;
end;
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

commit;
