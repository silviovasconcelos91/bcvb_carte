-- =====================================================================
--  Patch : onglet « Classement » (cartes différentes par série)
--
--  À exécuter une fois dans Supabase > SQL Editor sur une base existante.
--  Rejouable sans effet de bord. (schema.sql contient déjà ces changements
--  pour les nouvelles installations.)
-- =====================================================================

-- Classement d'une série active : nombre de cartes différentes de chaque membre actif
-- (doublons ignorés, cartes secrètes comprises). Seuls les comptes s'affichent, jamais
-- les cartes elles-mêmes. Les membres sans carte de la série n'y figurent pas.
create or replace function public.leaderboard(p_set_id int)
returns table (user_id uuid, username text, distinct_count int)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.username, count(*)::int
  from public.user_cards uc
  join public.cards c on c.id = uc.card_id
  join public.card_sets s on s.id = c.set_id
  join public.profiles p on p.id = uc.user_id
  where c.set_id = p_set_id
    and c.is_released
    and s.in_boosters
    and p.status = 'active'
    and (select rls.is_active())
  group by p.id, p.username
  order by 3 desc, p.username;
$$;
revoke execute on function public.leaderboard(int) from public, anon;
grant execute on function public.leaderboard(int) to authenticated;
