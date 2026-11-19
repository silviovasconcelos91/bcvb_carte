-- =====================================================================
--  Patch : cartes secrètes en double chez les autres membres
--
--  À exécuter une fois dans Supabase > SQL Editor sur une base existante.
--  Rejouable sans effet de bord. (schema.sql contient déjà ces changements
--  pour les nouvelles installations.)
-- =====================================================================

-- Cartes secrètes que d'autres membres actifs ont en double et que le membre connecté
-- n'a pas, pour lui permettre de proposer un échange contre l'une des siennes. Réservé à
-- qui possède au moins une carte secrète. Seul l'identifiant de la carte est renvoyé :
-- elle reste une carte mystère (ni nom, ni série, ni rareté) jusqu'à l'échange.
create or replace function public.secret_doubles()
returns table (user_id uuid, card_id bigint, quantity int)
language sql stable security definer set search_path = ''
as $$
  select uc.user_id, uc.card_id, uc.quantity
  from public.user_cards uc
  join public.cards c on c.id = uc.card_id
  join public.rarities r on r.id = c.rarity_id
  join public.profiles p on p.id = uc.user_id
  where r.is_secret
    and c.is_released
    and uc.quantity > 1
    and uc.user_id <> auth.uid()
    and p.status = 'active'
    and (select rls.is_active())
    and not exists (select 1 from public.user_cards m
                    where m.user_id = auth.uid() and m.card_id = uc.card_id)
    and exists (select 1 from public.user_cards m
                join public.cards mc on mc.id = m.card_id
                join public.rarities mr on mr.id = mc.rarity_id
                where m.user_id = auth.uid() and mr.is_secret)
  order by uc.user_id, uc.card_id;
$$;
revoke execute on function public.secret_doubles() from public, anon;
grant execute on function public.secret_doubles() to authenticated;
