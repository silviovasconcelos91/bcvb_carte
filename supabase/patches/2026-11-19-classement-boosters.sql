-- =====================================================================
--  Patch : classement au nombre de boosters ouverts (sans le nombre)
--
--  À exécuter une fois dans Supabase > SQL Editor sur une base existante.
--  Rejouable sans effet de bord. (schema.sql contient déjà ces changements
--  pour les nouvelles installations.)
-- =====================================================================

-- Classement d'une série active au nombre de boosters ouverts (ceux qui contenaient des
-- cartes de la série, comme my_booster_stats). Seul le rang est renvoyé, jamais le nombre :
-- les ex-aequo partagent le même rang. Membres actifs ayant ouvert au moins un booster.
create or replace function public.booster_leaderboard(p_set_id int)
returns table (user_id uuid, username text, rank int)
language sql stable security definer set search_path = ''
as $$
  select t.id, t.username, (rank() over (order by t.n desc))::int
  from (
    select p.id, p.username, count(distinct o.id) as n
    from public.booster_openings o
    cross join lateral unnest(o.card_ids) as u(card_id)
    join public.cards c on c.id = u.card_id
    join public.card_sets s on s.id = c.set_id
    join public.profiles p on p.id = o.user_id
    where c.set_id = p_set_id
      and s.in_boosters
      and p.status = 'active'
      and (select rls.is_active())
    group by p.id, p.username
  ) t
  order by t.n desc, t.username;
$$;
revoke execute on function public.booster_leaderboard(int) from public, anon;
grant execute on function public.booster_leaderboard(int) to authenticated;
