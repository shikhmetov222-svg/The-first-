-- «Золотой номер»: касса 2% цены номера в час (было 1%), лимит по-прежнему 12 часов.
-- Вместе с новой ценой номеров (обычный = 75% ставки) — чтобы в плюс выходили за счёт коллекции.
create or replace function gn_kassa_total(p gn_players, p_now timestamptz default now())
returns numeric language sql stable as $$
  select greatest(
    p.kassa_acc,
    least(
      p.kassa_acc + p.collection_value * 0.02 * greatest(0, extract(epoch from (p_now - p.kassa_at)) / 3600),
      p.collection_value * 0.02 * 12
    )
  );
$$;

revoke all on function gn_kassa_total(gn_players, timestamptz) from public, anon, authenticated;
grant execute on function gn_kassa_total(gn_players, timestamptz) to service_role;
