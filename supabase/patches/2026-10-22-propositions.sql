-- =====================================================================
--  Patch : propositions de cartes (table, règles, photos, sous-titres)
--
--  À exécuter une fois dans Supabase > SQL Editor sur une base existante.
--  Rejouable sans effet de bord. (schema.sql contient déjà ces changements
--  pour les nouvelles installations.)
-- =====================================================================

create table if not exists public.card_proposals (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  name        text not null check (char_length(name) between 1 and 40),
  subtitle    text check (char_length(subtitle) <= 40),
  description text check (char_length(description) <= 160),
  stats       jsonb not null default '{}',
  rarity_id   smallint not null references public.rarities (id),
  image_path  text not null,                       -- photo (720 px) : proposals/<uid>/...
  thumb_path  text not null                        -- vignette : proposals/<uid>/...
);
create index if not exists card_proposals_user_idx on public.card_proposals (user_id);

revoke all on public.card_proposals from anon, authenticated;
grant select, insert, delete on public.card_proposals to authenticated;
alter table public.card_proposals enable row level security;

drop policy if exists "Membres : proposer une carte" on public.card_proposals;
create policy "Membres : proposer une carte" on public.card_proposals
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "Membres : lire ses propositions" on public.card_proposals;
create policy "Membres : lire ses propositions" on public.card_proposals
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "Admin : lire les propositions" on public.card_proposals;
create policy "Admin : lire les propositions" on public.card_proposals
  for select to authenticated using ((select public.is_admin()));
drop policy if exists "Admin : supprimer les propositions" on public.card_proposals;
create policy "Admin : supprimer les propositions" on public.card_proposals
  for delete to authenticated using ((select public.is_admin()));

-- Règles d'une proposition : compte actif, rareté non secrète, 5 en attente
-- au plus, statistiques bien formées, photos rangées dans le dossier du
-- membre. La date est imposée.
create or replace function private.check_card_proposal()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_prefix text := 'proposals/' || new.user_id || '/';
begin
  -- Un envoi à la fois par membre : deux insertions simultanées ne peuvent
  -- pas dépasser la limite de 5 (verrou levé à la fin de la transaction)
  perform pg_advisory_xact_lock(hashtext(new.user_id::text));
  if not exists (select 1 from public.profiles where id = new.user_id and status = 'active') then
    raise exception 'Compte en attente de validation';
  end if;
  if not exists (select 1 from public.rarities where id = new.rarity_id and not is_secret) then
    raise exception 'Cette rareté ne peut pas être proposée';
  end if;
  if (select count(*) from public.card_proposals where user_id = new.user_id) >= 5 then
    raise exception 'Tu as déjà 5 propositions en cours d''examen. Tu pourras en proposer d''autres quand l''une d''elles aura été examinée.';
  end if;
  -- Statistiques : un objet de 5 nombres au plus, clés de 20 caractères au
  -- plus ; n° de maillot (numero) de 0 à 99, autres statistiques de 0 à 10
  if jsonb_typeof(new.stats) is distinct from 'object' then
    raise exception 'Statistiques invalides';
  end if;
  if (select count(*) from jsonb_object_keys(new.stats)) > 5 or exists (
    select 1 from jsonb_each(new.stats) as s (k, v)
    where char_length(s.k) > 20
       or case when jsonb_typeof(s.v) = 'number'
               then s.v::numeric not between 0 and (case when s.k = 'numero' then 99 else 10 end)
               else true end
  ) then
    raise exception 'Statistiques invalides';
  end if;
  if (starts_with(new.image_path, v_prefix) and starts_with(new.thumb_path, v_prefix)) is not true then
    raise exception 'Photo invalide';
  end if;
  new.created_at := now();
  return new;
end $$;

drop trigger if exists check_card_proposal on public.card_proposals;
create trigger check_card_proposal
  before insert on public.card_proposals
  for each row execute function private.check_card_proposal();

-- Nombre de fichiers dans le dossier de propositions du membre connecté,
-- hors photos des cartes intégrées (elles restent dans ce dossier mais ne
-- doivent pas empêcher de proposer à nouveau).
-- En security definer pour compter aussi les fichiers orphelins (photos d'un
-- envoi refusé), que la RLS lui cache.
create or replace function rls.proposal_file_count()
returns bigint
language sql stable security definer set search_path = ''
as $$
  select count(*) from storage.objects o
  where o.bucket_id = 'card-images'
    and starts_with(o.name, 'proposals/' || auth.uid() || '/')
    and not exists (
      select 1 from public.cards c where o.name in (c.image_path, c.thumb_path)
    );
$$;
revoke execute on function rls.proposal_file_count() from public, anon;
grant execute on function rls.proposal_file_count() to authenticated;

-- Dépôt dans son seul dossier, 10 fichiers au plus (5 propositions × 2 fichiers)
drop policy if exists "Membres : déposer les photos de leurs propositions" on storage.objects;
create policy "Membres : déposer les photos de leurs propositions" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'card-images'
    and (storage.foldername(name))[1] = 'proposals'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and (select rls.is_active())
    and (select rls.proposal_file_count()) < 10
  );

-- Lecture des seules photos rattachées à une de ses propositions
drop policy if exists "Membres : voir les photos de leurs propositions" on storage.objects;
create policy "Membres : voir les photos de leurs propositions" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'card-images'
    and exists (
      select 1 from public.card_proposals p
      where p.user_id = (select auth.uid()) and objects.name in (p.image_path, p.thumb_path)
    )
  );

-- Le formulaire de proposition reprend la liste des sous-titres de l'éditeur
drop policy if exists "Membres : lire les sous-titres" on public.card_subtitles;
create policy "Membres : lire les sous-titres" on public.card_subtitles
  for select to authenticated using ((select rls.is_active()));

/* =====================================================================
   Vérifications manuelles (à coller dans le SQL Editor, hors patch)

   0. Rejouer ce patch une seconde fois : aucune erreur attendue.

   Remplacer <uid M> par l'id d'un membre actif M, <autre uid> par l'id
   d'un autre membre. Chaque bloc s'exécute dans une transaction annulée.

   1. Limite : les 5 premiers insert passent, le 6ᵉ échoue avec
      « Tu as déjà 5 propositions en cours d'examen. Tu pourras en proposer
      d'autres quand l'une d'elles aura été examinée. »
      (si M a déjà des propositions, en faire d'autant moins)

   begin;
   set local role authenticated;
   set local request.jwt.claims = '{"sub":"<uid M>"}';
   insert into public.card_proposals (user_id, name, rarity_id, image_path, thumb_path)
   select '<uid M>', 'Test ' || i, 1, 'proposals/<uid M>/' || i || '.jpg', 'proposals/<uid M>/' || i || '-t.jpg'
   from generate_series(1, 5) as i;
   insert into public.card_proposals (user_id, name, rarity_id, image_path, thumb_path)
   values ('<uid M>', 'Test 6', 1, 'proposals/<uid M>/6.jpg', 'proposals/<uid M>/6-t.jpg');
   rollback;

   2. Rareté secrète : échoue avec « Cette rareté ne peut pas être proposée »

   begin;
   set local role authenticated;
   set local request.jwt.claims = '{"sub":"<uid M>"}';
   insert into public.card_proposals (user_id, name, rarity_id, image_path, thumb_path)
   values ('<uid M>', 'Test', (select id from public.rarities where is_secret limit 1),
           'proposals/<uid M>/a.jpg', 'proposals/<uid M>/a-t.jpg');
   rollback;

   3. Dossier d'un autre membre : échoue avec « Photo invalide »

   begin;
   set local role authenticated;
   set local request.jwt.claims = '{"sub":"<uid M>"}';
   insert into public.card_proposals (user_id, name, rarity_id, image_path, thumb_path)
   values ('<uid M>', 'Test', 1, 'proposals/<autre uid>/x.jpg', 'proposals/<uid M>/x-t.jpg');
   rollback;

   4. Lecture et suppression par un membre : le select ne renvoie que des
      lignes dont user_id = <uid M> ; le delete supprime 0 ligne.

   begin;
   set local role authenticated;
   set local request.jwt.claims = '{"sub":"<uid M>"}';
   select distinct user_id from public.card_proposals;
   delete from public.card_proposals;
   rollback;

   Photos (bucket "card-images") : les insertions dans storage.objects
   ci-dessous passent par les mêmes règles qu'un envoi depuis l'appli.
   Remplacer <uid P> par l'id d'un compte en attente. On suppose que M n'a
   encore aucun fichier dans proposals/<uid M>/ (sinon en déposer d'autant
   moins) et que <autre uid> a une proposition en attente.

   5. Dépôt simple (comme l'appli, upsert:false) avant que la proposition
      existe : passe. Dans le dossier d'un autre membre : échoue (RLS).

   begin;
   set local role authenticated;
   set local request.jwt.claims = '{"sub":"<uid M>","role":"authenticated"}';
   insert into storage.objects (bucket_id, name) values ('card-images', 'proposals/<uid M>/a.jpg');
   insert into storage.objects (bucket_id, name) values ('card-images', 'proposals/<autre uid>/a.jpg');
   rollback;

   6. Compte en attente : le dépôt dans son propre dossier échoue (RLS).

   begin;
   set local role authenticated;
   set local request.jwt.claims = '{"sub":"<uid P>","role":"authenticated"}';
   insert into storage.objects (bucket_id, name) values ('card-images', 'proposals/<uid P>/a.jpg');
   rollback;

   7. Limite de fichiers : 10 dépôts passent, le 11ᵉ échoue (RLS).

   begin;
   set local role authenticated;
   set local request.jwt.claims = '{"sub":"<uid M>","role":"authenticated"}';
   insert into storage.objects (bucket_id, name)
   select 'card-images', 'proposals/<uid M>/f' || i || '.jpg' from generate_series(1, 10) as i;
   insert into storage.objects (bucket_id, name) values ('card-images', 'proposals/<uid M>/f11.jpg');
   rollback;

   8. Les photos d'une carte intégrée ne comptent pas : même chose, mais
      une carte pointe vers l'un des 10 fichiers ; le 11ᵉ dépôt passe.

   begin;
   insert into storage.objects (bucket_id, name)
   select 'card-images', 'proposals/<uid M>/f' || i || '.jpg' from generate_series(1, 10) as i;
   update public.cards set image_path = 'proposals/<uid M>/f1.jpg'
   where id = (select min(id) from public.cards);
   set local role authenticated;
   set local request.jwt.claims = '{"sub":"<uid M>","role":"authenticated"}';
   insert into storage.objects (bucket_id, name) values ('card-images', 'proposals/<uid M>/f11.jpg');
   rollback;

   9. Photo d'une proposition d'un autre membre : invisible pour M (0 ligne),
      donc aucune URL signée possible. Dans l'appli, connecté en M :
      sb.storage.from('card-images').createSignedUrl('<image_path de la
      proposition de l'autre membre>', 60) renvoie une erreur.

   begin;
   set local role authenticated;
   set local request.jwt.claims = '{"sub":"<uid M>","role":"authenticated"}';
   select name from storage.objects
   where bucket_id = 'card-images' and starts_with(name, 'proposals/<autre uid>/');
   rollback;
   ===================================================================== */
