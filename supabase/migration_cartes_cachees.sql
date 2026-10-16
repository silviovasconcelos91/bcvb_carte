-- =====================================================================
--  Migration : cartes manquantes masquées
--
--  À exécuter UNIQUEMENT si tu as déjà lancé l'ancienne version de
--  schema.sql sur ton projet. Sur un projet neuf, lance directement
--  le nouveau schema.sql, qui contient déjà tout ceci.
--
--  Après la migration, un membre ne lit en entier que les cartes qu'il
--  a déjà obtenues au moins une fois. Pour les autres, il ne voit que
--  la série, le numéro et la rareté (pas même la rareté si elle est secrète).
-- =====================================================================

-- Rareté secrète
alter table public.rarities add column if not exists is_secret boolean not null default false;
insert into public.rarities (id, code, label, weight, is_secret)
values (6, 'secret', 'Secrète', 0.5, true)
on conflict (id) do nothing;

-- Cartes déjà obtenues au moins une fois
create table if not exists public.card_discoveries (
  user_id       uuid not null references public.profiles (id) on delete cascade,
  card_id       bigint not null references public.cards (id) on delete cascade,
  discovered_at timestamptz not null default now(),
  primary key (user_id, card_id)
);

-- Reprise de l'existant : collections actuelles, boosters ouverts, échanges acceptés
insert into public.card_discoveries (user_id, card_id)
select user_id, card_id from public.user_cards
on conflict do nothing;

insert into public.card_discoveries (user_id, card_id)
select distinct o.user_id, x.card_id
from public.booster_openings o
cross join lateral unnest(o.card_ids) as x(card_id)
join public.cards c on c.id = x.card_id
on conflict do nothing;

insert into public.card_discoveries (user_id, card_id)
select distinct case ti.side when 'offer' then t.recipient_id else t.proposer_id end, ti.card_id
from public.trades t
join public.trade_items ti on ti.trade_id = t.id
where t.status = 'accepted'
on conflict do nothing;

-- Chaque ajout de carte enregistre la découverte ; "nouvelle" = jamais obtenue auparavant
create or replace function private.add_cards(p_user uuid, p_card bigint, p_qty int)
returns boolean
language plpgsql set search_path = ''
as $$
declare
  v_new boolean;
begin
  insert into public.card_discoveries (user_id, card_id)
  values (p_user, p_card)
  on conflict do nothing;
  v_new := found;
  insert into public.user_cards as uc (user_id, card_id, quantity)
  values (p_user, p_card, p_qty)
  on conflict (user_id, card_id) do update set quantity = uc.quantity + excluded.quantity;
  return v_new;
end $$;

-- Catalogue sans rien révéler des cartes jamais obtenues
create or replace function public.card_catalog()
returns table (id bigint, set_id int, number int, rarity_id smallint, discovered boolean)
language sql stable security definer set search_path = ''
as $$
  select c.id,
         c.set_id,
         c.number,
         case when d.card_id is not null or not r.is_secret then c.rarity_id end,
         d.card_id is not null
  from public.cards c
  join public.rarities r on r.id = c.rarity_id
  left join public.card_discoveries d on d.card_id = c.id and d.user_id = auth.uid()
  where c.is_released
  order by c.set_id, c.number, c.id;
$$;

-- Droits
revoke all on public.card_discoveries from anon, authenticated;
grant select on public.card_discoveries to authenticated;
revoke execute on function public.card_catalog() from public, anon;
grant execute on function public.card_catalog() to authenticated;

alter table public.card_discoveries enable row level security;
drop policy if exists "Membres : lire ses découvertes" on public.card_discoveries;
create policy "Membres : lire ses découvertes" on public.card_discoveries
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "Membres : lire les cartes publiées" on public.cards;
drop policy if exists "Membres : lire les cartes découvertes" on public.cards;
create policy "Membres : lire les cartes découvertes" on public.cards
  for select to authenticated
  using (
    is_released
    and exists (select 1 from public.card_discoveries d
                where d.card_id = cards.id and d.user_id = (select auth.uid()))
  );

drop policy if exists "Membres : voir les images des cartes publiées" on storage.objects;
drop policy if exists "Membres : voir les images des cartes découvertes" on storage.objects;
create policy "Membres : voir les images des cartes découvertes" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'card-images'
    and exists (
      select 1
      from public.cards c
      join public.card_discoveries d on d.card_id = c.id and d.user_id = (select auth.uid())
      where c.image_path = objects.name and c.is_released
    )
  );
