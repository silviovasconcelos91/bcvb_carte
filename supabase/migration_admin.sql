-- =====================================================================
--  Migration : console d'administration
--
--  À exécuter si ton projet a été créé avec une version précédente de
--  schema.sql (y compris après migration_cartes_cachees.sql). Sur un
--  projet neuf, le nouveau schema.sql contient déjà tout ceci.
--  Elle peut être relancée sans risque.
-- =====================================================================

-- Retirer une carte des boosters sans la cacher à ceux qui l'ont
alter table public.cards add column if not exists in_boosters boolean not null default true;

-- Tirage : ignore les cartes retirées des boosters
create or replace function private.draw_card(p_set_id int)
returns bigint
language plpgsql volatile set search_path = ''
as $$
declare
  v_rarity smallint;
  v_card   bigint;
begin
  select r.id into v_rarity
  from public.rarities r
  where r.weight > 0
    and exists (
      select 1
      from public.cards c
      join public.card_sets s on s.id = c.set_id
      where c.rarity_id = r.id
        and c.is_released
        and c.in_boosters
        and (case when p_set_id is null then s.in_boosters else c.set_id = p_set_id end)
    )
  order by -ln(1.0 - random()) / r.weight::float8   -- P(rareté) = poids / somme des poids
  limit 1;

  if v_rarity is null then
    raise exception 'Aucune carte disponible pour ce booster';
  end if;

  select c.id into v_card
  from public.cards c
  join public.card_sets s on s.id = c.set_id
  where c.rarity_id = v_rarity
    and c.is_released
    and c.in_boosters
    and (case when p_set_id is null then s.in_boosters else c.set_id = p_set_id end)
  order by random()
  limit 1;

  return v_card;
end $$;

-- ---------------------------------------------------------------------
-- Administration (console admin.html)
--    Un administrateur garde les mêmes droits qu'un membre, plus
--    l'écriture sur le catalogue, les séries, les raretés, les codes
--    et les réglages, et la lecture de toutes les données du jeu.
--    Pour te nommer administrateur, voir en fin de fichier.
-- ---------------------------------------------------------------------

create table if not exists public.admins (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;
grant select on public.admins to authenticated;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- Rend à un membre son booster gratuit (événement, bug...)
create or replace function public.admin_reset_free_booster(p_user uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Réservé aux administrateurs';
  end if;
  update public.profiles set last_free_booster_at = null where id = p_user;
end $$;

revoke execute on function public.is_admin(), public.admin_reset_free_booster(uuid) from public, anon;
grant execute on function public.is_admin(), public.admin_reset_free_booster(uuid) to authenticated;

-- Droits d'écriture : accordés à tous les comptes connectés, mais les
-- policies ci-dessous ne laissent passer que les administrateurs.
grant insert, update, delete on public.cards, public.card_sets to authenticated;
grant insert, update on public.rarities to authenticated;
grant update on public.game_settings to authenticated;
grant select, insert, update, delete on public.booster_codes to authenticated;
grant select on public.booster_code_redemptions to authenticated;

drop policy if exists "Admin : lire les admins" on public.admins;
create policy "Admin : lire les admins" on public.admins
  for select to authenticated using ((select public.is_admin()));

drop policy if exists "Admin : lire toutes les cartes" on public.cards;
drop policy if exists "Admin : créer des cartes" on public.cards;
drop policy if exists "Admin : modifier les cartes" on public.cards;
drop policy if exists "Admin : supprimer des cartes" on public.cards;
create policy "Admin : lire toutes les cartes" on public.cards
  for select to authenticated using ((select public.is_admin()));
create policy "Admin : créer des cartes" on public.cards
  for insert to authenticated with check ((select public.is_admin()));
create policy "Admin : modifier les cartes" on public.cards
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "Admin : supprimer des cartes" on public.cards
  for delete to authenticated using ((select public.is_admin()));

drop policy if exists "Admin : créer des séries" on public.card_sets;
drop policy if exists "Admin : modifier les séries" on public.card_sets;
drop policy if exists "Admin : supprimer des séries" on public.card_sets;
create policy "Admin : créer des séries" on public.card_sets
  for insert to authenticated with check ((select public.is_admin()));
create policy "Admin : modifier les séries" on public.card_sets
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "Admin : supprimer des séries" on public.card_sets
  for delete to authenticated using ((select public.is_admin()));

drop policy if exists "Admin : créer des raretés" on public.rarities;
drop policy if exists "Admin : modifier les raretés" on public.rarities;
create policy "Admin : créer des raretés" on public.rarities
  for insert to authenticated with check ((select public.is_admin()));
create policy "Admin : modifier les raretés" on public.rarities
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "Admin : modifier les réglages" on public.game_settings;
create policy "Admin : modifier les réglages" on public.game_settings
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "Admin : gérer les codes" on public.booster_codes;
create policy "Admin : gérer les codes" on public.booster_codes
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "Admin : lire les utilisations de codes" on public.booster_code_redemptions;
create policy "Admin : lire les utilisations de codes" on public.booster_code_redemptions
  for select to authenticated using ((select public.is_admin()));

drop policy if exists "Admin : lire toutes les ouvertures" on public.booster_openings;
create policy "Admin : lire toutes les ouvertures" on public.booster_openings
  for select to authenticated using ((select public.is_admin()));

drop policy if exists "Admin : lire tous les échanges" on public.trades;
drop policy if exists "Admin : lire le contenu de tous les échanges" on public.trade_items;
create policy "Admin : lire tous les échanges" on public.trades
  for select to authenticated using ((select public.is_admin()));
create policy "Admin : lire le contenu de tous les échanges" on public.trade_items
  for select to authenticated using ((select public.is_admin()));

drop policy if exists "Admin : lire toutes les découvertes" on public.card_discoveries;
create policy "Admin : lire toutes les découvertes" on public.card_discoveries
  for select to authenticated using ((select public.is_admin()));

drop policy if exists "Admin : gérer les images des cartes" on storage.objects;
create policy "Admin : gérer les images des cartes" on storage.objects
  for all to authenticated
  using (bucket_id = 'card-images' and (select public.is_admin()))
  with check (bucket_id = 'card-images' and (select public.is_admin()));

-- ---------------------------------------------------------------------
-- Pour te nommer administrateur, remplace l'adresse et exécute :
--
--   insert into public.admins (user_id)
--   select id from auth.users where email = 'toi@exemple.fr';
-- ---------------------------------------------------------------------
