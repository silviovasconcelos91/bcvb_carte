-- =====================================================================
--  Patch : compteur de boosters et de cartes par série (page Booster)
--
--  À exécuter une fois dans Supabase > SQL Editor sur une base existante.
--  Rejouable sans effet de bord. (schema.sql contient déjà ces changements
--  pour les nouvelles installations.)
-- =====================================================================

-- Boosters ouverts et cartes obtenues par le membre connecté, série par série, d'après
-- les cartes de chaque ouverture. Un booster de plusieurs séries compte dans chacune d'elles.
create or replace function public.my_booster_stats()
returns table (set_id int, boosters int, cards int)
language sql stable security definer set search_path = ''
as $$
  select c.set_id, count(distinct o.id)::int, count(*)::int
  from public.booster_openings o
  cross join lateral unnest(o.card_ids) as u(card_id)
  join public.cards c on c.id = u.card_id
  where o.user_id = auth.uid()
    and (select rls.is_active())
  group by c.set_id
  order by c.set_id;
$$;
revoke execute on function public.my_booster_stats() from public, anon;
grant execute on function public.my_booster_stats() to authenticated;
