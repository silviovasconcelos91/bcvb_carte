-- =====================================================================
--  Cartes du club : toute la logique SQL (Supabase / PostgreSQL)
--
--  Script complet et rejouable, à exécuter dans Supabase > SQL Editor :
--    - sur un projet neuf, il installe tout ;
--    - sur une base existante, quelle que soit sa version précédente,
--      il la met à niveau sans toucher aux données (comptes, cartes,
--      collections, échanges, codes) ;
--    - relancé une deuxième fois, il ne change rien.
--
--  Ce qu'il met en place :
--    - catalogue (séries, raretés, cartes, photos), collections, échanges ;
--    - boosters gratuits et codes (booster, N cartes, carte précise) ;
--    - cartes cachées : on ne lit en entier que les cartes qu'on possède ;
--      les cartes secrètes qu'on n'a pas n'existent pas pour soi ;
--    - inscriptions depuis le site, actives avec le code du club,
--      sinon en attente de validation ;
--    - console d'administration (table admins).
--
--  Principe de sécurité : le navigateur ne fait que LIRE les tables.
--  Toutes les écritures passent par des fonctions (RPC) qui vérifient
--  les règles côté base : open_booster, create_trade, accept_trade,
--  decline_trade, counter_trade, cancel_trade. Un membre peut seulement modifier son
--  pseudo. Les administrateurs ont des droits d'écriture sur le catalogue.
--
--  Réglages à faire dans Supabase (Authentication) :
--    - autoriser les nouvelles inscriptions ;
--    - désactiver la confirmation par e-mail ;
--    - mots de passe de 8 caractères minimum.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------

create table if not exists public.profiles (
  id                   uuid primary key references auth.users (id) on delete cascade,
  username             text not null check (char_length(username) between 2 and 30),
  status               text not null default 'active' check (status in ('active', 'pending')),
  last_free_booster_at timestamptz,  -- horloge de recharge des boosters gratuits (voir open_booster), null = stock plein
  created_at           timestamptz not null default now()
);

-- Réglages du jeu : une seule ligne, à modifier dans le Table Editor
create table if not exists public.game_settings (
  id                    boolean primary key default true check (id),
  booster_size          int not null default 5 check (booster_size between 1 and 20),
  free_booster_cooldown interval not null default interval '1 day',
  free_booster_max      int not null default 2 check (free_booster_max between 1 and 10)  -- boosters gratuits cumulables
);

create table if not exists public.rarities (
  id     smallint primary key,                    -- 1 = la plus commune
  code   text not null unique,
  label  text not null,
  weight numeric not null check (weight >= 0),     -- poids relatif au tirage (0 = jamais)
  is_secret boolean not null default false,        -- true = rareté masquée tant que la carte n'est pas obtenue
  effect smallint not null default 1 check (effect between 1 and 17),  -- effet visuel, voir EFFECTS dans src/lib/lookup.tsx
  color  text check (color ~ '^#[0-9A-Fa-f]{6}$'),  -- couleur de l'effet (null = couleur par défaut de l'effet)
  gems   smallint check (gems between 0 and 10),   -- nombre de losanges (null = selon l'effet)
  badge  text check (char_length(badge) between 1 and 12)  -- texte affiché à la place des losanges (★, SR…)
);

-- Séries / extensions : "Saison 2026-27", "Tournoi de Noël"...
create table if not exists public.card_sets (
  id          int generated always as identity primary key,
  name        text not null unique,
  in_boosters boolean not null default true,       -- false = ne tombe plus dans les boosters standards
  created_at  timestamptz not null default now()
);

create table if not exists public.cards (
  id          bigint generated always as identity primary key,
  set_id      int not null references public.card_sets (id),
  number      int,                                 -- numéro dans la série ("12/40")
  name        text not null,
  subtitle    text,                                -- poste ("Passeuse") ou type ("Moment")
  description text,
  image_path  text,                                -- chemin de la photo (720 px) dans le bucket "card-images"
  thumb_path  text,                                -- chemin de la vignette (240 px) ; null = on affiche la photo
  rarity_id   smallint not null references public.rarities (id),
  stats       jsonb not null default '{}'::jsonb,  -- ex. {"service": 7, "attaque": 8}
  is_released boolean not null default false,      -- false = en préparation : invisible et jamais tirée
  in_boosters boolean not null default true,       -- false = reste visible mais ne tombe plus dans les boosters
  created_at  timestamptz not null default now(),
  unique (set_id, number)
);

-- Collection : une ligne par (joueur, carte), avec le nombre d'exemplaires
create table if not exists public.user_cards (
  user_id           uuid not null references public.profiles (id) on delete cascade,
  card_id           bigint not null references public.cards (id),
  quantity          int not null check (quantity > 0),
  first_obtained_at timestamptz not null default now(),
  primary key (user_id, card_id)
);
create index if not exists user_cards_card_idx on public.user_cards (card_id);

-- Cartes déjà obtenues au moins une fois (elles restent connues même après un échange)
create table if not exists public.card_discoveries (
  user_id       uuid not null references public.profiles (id) on delete cascade,
  card_id       bigint not null references public.cards (id) on delete cascade,
  discovered_at timestamptz not null default now(),
  primary key (user_id, card_id)
);

do $$
begin
  if not exists (select 1 from pg_type where typname = 'trade_status' and typnamespace = 'public'::regnamespace) then
    create type public.trade_status as enum ('pending', 'accepted', 'declined', 'cancelled', 'failed');
  end if;
  if not exists (select 1 from pg_type where typname = 'trade_side' and typnamespace = 'public'::regnamespace) then
    create type public.trade_side as enum ('offer', 'request');
  end if;
end $$;
-- countered : le destinataire a répondu par une contre-proposition (nouvel échange lié)
alter type public.trade_status add value if not exists 'countered';
-- (trade_side : offer = carte donnée par celui qui propose ; request = carte donnée par le destinataire)

create table if not exists public.trades (
  id           bigint generated always as identity primary key,
  proposer_id  uuid not null references public.profiles (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  status       public.trade_status not null default 'pending',
  message      text check (char_length(message) <= 280),
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  check (proposer_id <> recipient_id)
);
-- Échange auquel celui-ci répond (contre-proposition)
alter table public.trades add column if not exists counter_of bigint references public.trades (id) on delete set null;
create index if not exists trades_proposer_idx on public.trades (proposer_id, status);
create index if not exists trades_recipient_idx on public.trades (recipient_id, status);

create table if not exists public.trade_items (
  trade_id bigint not null references public.trades (id) on delete cascade,
  side     public.trade_side not null,
  card_id  bigint not null references public.cards (id),
  quantity int not null check (quantity > 0),
  primary key (trade_id, side, card_id)
);

-- Codes à scanner (QR au gymnase, tournoi...) : un booster par personne et par code,
-- éventuellement limité à une série et à un nombre de cartes (une seule carte, par exemple),
-- ou une carte précise (la carte de la soirée du club pour les présents)
create table if not exists public.booster_codes (
  id         bigint generated always as identity primary key,
  code       text not null,                        -- insensible à la casse
  label      text,                                 -- ex. "Match à domicile du 14/11"
  set_id     int references public.card_sets (id), -- null = tirage standard, sinon cette série uniquement
  card_count int check (card_count between 1 and 20), -- null = taille normale d'un booster (réglages)
  card_id    bigint references public.cards (id) on delete cascade, -- carte précise offerte (soirée du club...)
  max_uses   int check (max_uses > 0),             -- null = pas de limite globale
  uses_count int not null default 0,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  -- un code « carte précise » donne cette carte et rien d'autre
  constraint booster_codes_card_only check (card_id is null or (set_id is null and card_count is null))
);
create unique index if not exists booster_codes_code_idx on public.booster_codes (upper(code));

create table if not exists public.booster_code_redemptions (
  code_id     bigint not null references public.booster_codes (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  primary key (code_id, user_id)
);

-- Historique des ouvertures (débogage, fil "derniers tirages"...)
create table if not exists public.booster_openings (
  id        bigint generated always as identity primary key,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  code_id   bigint references public.booster_codes (id) on delete set null,
  card_ids  bigint[] not null,
  opened_at timestamptz not null default now()
);
create index if not exists booster_openings_user_idx on public.booster_openings (user_id, opened_at desc);


-- ---------------------------------------------------------------------
-- 1 bis. Mise à niveau des bases créées avec une version précédente
--        (sans effet sur une base neuve)
-- ---------------------------------------------------------------------

alter table public.profiles      add column if not exists status text not null default 'active' check (status in ('active', 'pending'));
alter table public.rarities      add column if not exists is_secret boolean not null default false;
-- Effet et couleur des raretés : les raretés existantes gardent leur rendu (effet = numéro)
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'rarities' and column_name = 'effect') then
    alter table public.rarities add column effect smallint not null default 1 check (effect between 1 and 17);
    update public.rarities set effect = least(greatest(id, 1), 6);
  end if;
end $$;
-- 17 effets disponibles (des versions précédentes de ce script en autorisaient 6 puis 15)
alter table public.rarities drop constraint if exists rarities_effect_check;
alter table public.rarities add constraint rarities_effect_check check (effect between 1 and 17);
alter table public.rarities      add column if not exists color text check (color ~ '^#[0-9A-Fa-f]{6}$');
-- Losanges des raretés : nombre, ou texte à la place
alter table public.rarities      add column if not exists gems smallint check (gems between 0 and 10);
alter table public.rarities      add column if not exists badge text check (char_length(badge) between 1 and 12);
alter table public.game_settings add column if not exists free_booster_max int not null default 2 check (free_booster_max between 1 and 10);
alter table public.cards         add column if not exists thumb_path text;
alter table public.cards         add column if not exists in_boosters boolean not null default true;
alter table public.booster_codes add column if not exists card_count int check (card_count between 1 and 20);
alter table public.booster_codes add column if not exists card_id bigint references public.cards (id) on delete cascade;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'booster_codes_card_only') then
    alter table public.booster_codes add constraint booster_codes_card_only
      check (card_id is null or (set_id is null and card_count is null));
  end if;
end $$;

-- Cartes déjà obtenues avant l'existence de card_discoveries (badge « Nouvelle »)
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


-- ---------------------------------------------------------------------
-- 2. Profil créé automatiquement à l'inscription ou à l'invitation
--    (actif ou en attente selon le code du club, voir la section 8)
-- ---------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_name     text := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'username'), ''),
    split_part(coalesce(new.email, ''), '@', 1)
  );
  v_code     text := nullif(btrim(new.raw_user_meta_data ->> 'signup_code'), '');
  v_expected text;
  v_status   text := 'pending';
begin
  if char_length(v_name) < 2 then
    v_name := 'Joueur ' || left(new.id::text, 4);
  end if;
  -- Actif d'office : compte créé par un administrateur (app_metadata, que
  -- l'utilisateur ne peut pas modifier) ou inscription avec le bon code du club.
  -- Sinon, le compte attend la validation d'un administrateur.
  select nullif(btrim(code), '') into v_expected from public.signup_settings where id;
  if new.raw_app_meta_data ->> 'invited' = 'true'
     or (v_expected is not null and upper(v_code) = upper(v_expected)) then
    v_status := 'active';
  end if;
  insert into public.profiles (id, username, status) values (new.id, left(v_name, 30), v_status);
  return new;
end $$;

-- Créé une seule fois : la table auth.users appartient à Supabase Auth, on n'y supprime rien
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'on_auth_user_created' and tgrelid = 'auth.users'::regclass) then
    create trigger on_auth_user_created
      after insert on auth.users
      for each row execute function public.handle_new_user();
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 3. Fonctions internes (schéma "private", non exposé par l'API)
-- ---------------------------------------------------------------------

create schema if not exists private;

-- Ajoute des exemplaires ; renvoie true si le joueur découvre cette carte pour la première fois
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

-- Retire des exemplaires ; renvoie false si le joueur n'en a pas assez
create or replace function private.remove_cards(p_user uuid, p_card bigint, p_qty int)
returns boolean
language plpgsql set search_path = ''
as $$
begin
  delete from public.user_cards
   where user_id = p_user and card_id = p_card and quantity = p_qty;
  if found then
    return true;
  end if;
  update public.user_cards set quantity = quantity - p_qty
   where user_id = p_user and card_id = p_card and quantity > p_qty;
  return found;
end $$;

-- Tire une carte : une rareté selon les poids, puis une carte au hasard dans cette rareté.
-- Une rareté sans carte disponible est ignorée (son poids se répartit sur les autres).
-- p_set_id null = boosters standards (séries in_boosters), sinon uniquement cette série.
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
-- 4. Fonctions appelables depuis le front : supabase.rpc('nom', {...})
--    "security definer" = exécutées avec les droits du propriétaire
--    (comme un compte de service), d'où la vérification de auth.uid().
-- ---------------------------------------------------------------------

-- Catalogue des cartes publiées, sans rien révéler des cartes qu'on n'a pas :
-- série, numéro et rareté seulement. Les cartes secrètes qu'on n'a pas
-- n'y figurent pas du tout. Le détail des cartes possédées vient de my_cards().
drop function if exists public.card_catalog();  -- sa forme a changé au fil des versions
create or replace function public.card_catalog()
returns table (id bigint, set_id int, number int, rarity_id smallint, owned boolean)
language sql stable security definer set search_path = ''
as $$
  select c.id, c.set_id, c.number, c.rarity_id, uc.card_id is not null
  from public.cards c
  join public.rarities r on r.id = c.rarity_id
  left join public.user_cards uc on uc.card_id = c.id and uc.user_id = auth.uid()
  where c.is_released
    and (not r.is_secret or uc.card_id is not null)
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active')
  order by c.set_id, c.number, c.id;
$$;

-- Détail complet (nom, description, stats, photos) des cartes que l'on possède,
-- et d'elles seules, y compris pour un administrateur qui joue.
create or replace function public.my_cards()
returns setof public.cards
language sql stable security definer set search_path = ''
as $$
  select c.*
  from public.cards c
  join public.user_cards uc on uc.card_id = c.id and uc.user_id = auth.uid()
  where c.is_released
  order by c.set_id, c.number, c.id;
$$;

-- Ouvre un booster gratuit (selon le délai des réglages) ou via un code.
-- Renvoie [{card_id, name, rarity_id, image_path, is_new}, ...]
create or replace function public.open_booster(p_code text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_settings public.game_settings;
  v_profile  public.profiles;
  v_code     public.booster_codes;   -- reste vide (champs à null) pour un booster gratuit
  v_card     public.cards;
  v_card_id  bigint;
  v_is_new   boolean;
  v_ids      bigint[] := '{}';
  v_result   jsonb := '[]'::jsonb;
  v_clock    timestamptz;
begin
  if v_uid is null then
    raise exception 'Connexion requise';
  end if;

  select * into v_settings from public.game_settings where id;
  if not found then
    raise exception 'Réglages du jeu manquants (table game_settings)';
  end if;

  if nullif(btrim(p_code), '') is null then
    -- Booster gratuit. FOR UPDATE : deux clics simultanés ne donnent pas deux boosters.
    select * into v_profile from public.profiles where id = v_uid for update;
    if not found then
      raise exception 'Profil introuvable';
    end if;
    -- Un booster se recharge à chaque délai, jusqu'à free_booster_max en réserve.
    -- last_free_booster_at sert d'horloge : boosters disponibles = (maintenant - horloge) / délai.
    -- L'horloge ne remonte jamais au-delà du stock maximum, et chaque ouverture l'avance d'un délai.
    v_clock := greatest(coalesce(v_profile.last_free_booster_at, '-infinity'::timestamptz),
                        now() - v_settings.free_booster_cooldown * greatest(v_settings.free_booster_max, 1));
    if v_clock + v_settings.free_booster_cooldown > now() then
      raise exception 'Prochain booster gratuit le %',
        to_char((v_clock + v_settings.free_booster_cooldown)
                at time zone 'Europe/Paris', 'DD/MM "à" HH24:MI');
    end if;
    update public.profiles set last_free_booster_at = v_clock + v_settings.free_booster_cooldown where id = v_uid;
  else
    select * into v_code from public.booster_codes
     where upper(code) = upper(btrim(p_code))
       for update;
    if not found then
      raise exception 'Code inconnu';
    end if;
    if v_code.expires_at < now() then
      raise exception 'Code expiré';
    end if;
    if v_code.uses_count >= v_code.max_uses then
      raise exception 'Code épuisé';
    end if;
    insert into public.booster_code_redemptions (code_id, user_id)
    values (v_code.id, v_uid)
    on conflict do nothing;
    if not found then
      raise exception 'Code déjà utilisé';
    end if;
    update public.booster_codes set uses_count = uses_count + 1 where id = v_code.id;
  end if;

  -- Code « carte précise » : elle doit être publiée (les membres la verront dans leur collection)
  if v_code.card_id is not null
     and not exists (select 1 from public.cards where id = v_code.card_id and is_released) then
    raise exception 'La carte de ce code n''est pas encore disponible';
  end if;

  -- Un code peut donner une carte précise, ou moins (ou plus) de cartes qu'un booster normal
  for i in 1 .. case when v_code.card_id is not null then 1
                     else coalesce(v_code.card_count, v_settings.booster_size) end loop
    if v_code.card_id is not null then
      v_card_id := v_code.card_id;
    else
      v_card_id := private.draw_card(v_code.set_id);
    end if;
    v_is_new  := private.add_cards(v_uid, v_card_id, 1);
    select * into v_card from public.cards where id = v_card_id;
    v_ids    := v_ids || v_card_id;
    v_result := v_result || jsonb_build_object(
      'card_id',    v_card.id,
      'name',       v_card.name,
      'rarity_id',  v_card.rarity_id,
      'image_path', v_card.image_path,
      'is_new',     v_is_new
    );
  end loop;

  insert into public.booster_openings (user_id, code_id, card_ids)
  values (v_uid, v_code.id, v_ids);

  return v_result;
end $$;

-- Propose un échange. p_offer : cartes que tu donnes ; p_request : cartes que tu demandes.
-- Format : [{"card_id": 12, "quantity": 1}, ...] (quantity facultative, 1 par défaut).
-- Un des deux tableaux peut être vide : p_request vide = un don.
create or replace function public.create_trade(
  p_recipient uuid,
  p_offer     jsonb default '[]'::jsonb,
  p_request   jsonb default '[]'::jsonb,
  p_message   text default null
)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_offer   jsonb := coalesce(p_offer, '[]'::jsonb);
  v_request jsonb := coalesce(p_request, '[]'::jsonb);
  v_trade   bigint;
  v_missing bigint;
begin
  if v_uid is null then
    raise exception 'Connexion requise';
  end if;
  if p_recipient is null or p_recipient = v_uid
     or not exists (select 1 from public.profiles where id = p_recipient) then
    raise exception 'Destinataire invalide';
  end if;
  if jsonb_typeof(v_offer) <> 'array' or jsonb_typeof(v_request) <> 'array' then
    raise exception 'p_offer et p_request doivent être des tableaux JSON';
  end if;
  if jsonb_array_length(v_offer) + jsonb_array_length(v_request) = 0 then
    raise exception 'Échange vide';
  end if;
  if jsonb_array_length(v_offer) + jsonb_array_length(v_request) > 20 then
    raise exception 'Pas plus de 20 lignes par échange';
  end if;

  insert into public.trades (proposer_id, recipient_id, message)
  values (v_uid, p_recipient, nullif(btrim(p_message), ''))
  returning id into v_trade;

  insert into public.trade_items (trade_id, side, card_id, quantity)
  select v_trade, x.side, x.card_id, sum(x.quantity)
  from (
    select 'offer'::public.trade_side as side,
           (e ->> 'card_id')::bigint as card_id,
           coalesce((e ->> 'quantity')::int, 1) as quantity
    from jsonb_array_elements(v_offer) as e
    union all
    select 'request'::public.trade_side,
           (e ->> 'card_id')::bigint,
           coalesce((e ->> 'quantity')::int, 1)
    from jsonb_array_elements(v_request) as e
  ) as x
  group by x.side, x.card_id;

  -- Vérification immédiate (l'acceptation revérifiera de toute façon)
  select ti.card_id into v_missing
  from public.trade_items ti
  left join public.user_cards uc
    on uc.card_id = ti.card_id
   and uc.user_id = case ti.side when 'offer' then v_uid else p_recipient end
  where ti.trade_id = v_trade
    and coalesce(uc.quantity, 0) < ti.quantity
  limit 1;

  if v_missing is not null then
    raise exception 'Carte % : pas assez d''exemplaires pour cet échange', v_missing;
  end if;

  return v_trade;
end $$;

-- Accepte un échange (destinataire uniquement). Renvoie 'accepted', ou 'failed'
-- si l'un des deux n'a plus les cartes : dans ce cas rien n'est transféré.
create or replace function public.accept_trade(p_trade_id bigint)
returns public.trade_status
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_trade public.trades;
  v_item  record;
begin
  if v_uid is null then
    raise exception 'Connexion requise';
  end if;

  -- Verrou sur l'échange : deux acceptations simultanées passent l'une après l'autre
  select * into v_trade from public.trades where id = p_trade_id for update;
  if not found or v_trade.recipient_id <> v_uid then
    raise exception 'Échange introuvable';
  end if;
  if v_trade.status <> 'pending' then
    raise exception 'Échange déjà traité (%)', v_trade.status;
  end if;

  -- Verrou sur les cartes concernées des deux joueurs, toujours dans le même ordre
  -- (une même carte ne peut pas partir dans deux échanges acceptés en même temps)
  perform 1
  from public.user_cards uc
  where uc.user_id in (v_trade.proposer_id, v_trade.recipient_id)
    and uc.card_id in (select ti.card_id from public.trade_items ti where ti.trade_id = p_trade_id)
  order by uc.user_id, uc.card_id
  for update;

  -- Chacun possède-t-il encore ce qu'il doit donner ?
  if exists (
    select 1
    from public.trade_items ti
    left join public.user_cards uc
      on uc.card_id = ti.card_id
     and uc.user_id = case ti.side when 'offer' then v_trade.proposer_id else v_trade.recipient_id end
    where ti.trade_id = p_trade_id
      and coalesce(uc.quantity, 0) < ti.quantity
  ) then
    update public.trades set status = 'failed', resolved_at = now() where id = p_trade_id;
    return 'failed';
  end if;

  for v_item in
    select ti.side, ti.card_id, ti.quantity
    from public.trade_items ti
    where ti.trade_id = p_trade_id
  loop
    if not private.remove_cards(
         case v_item.side when 'offer' then v_trade.proposer_id else v_trade.recipient_id end,
         v_item.card_id, v_item.quantity) then
      raise exception 'Stock incohérent pour la carte %', v_item.card_id;  -- annule tout
    end if;
    perform private.add_cards(
      case v_item.side when 'offer' then v_trade.recipient_id else v_trade.proposer_id end,
      v_item.card_id, v_item.quantity);
  end loop;

  update public.trades set status = 'accepted', resolved_at = now() where id = p_trade_id;
  return 'accepted';
end $$;

-- Refuse un échange (destinataire uniquement)
create or replace function public.decline_trade(p_trade_id bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.trades set status = 'declined', resolved_at = now()
   where id = p_trade_id and recipient_id = auth.uid() and status = 'pending';
  if not found then
    raise exception 'Échange introuvable ou déjà traité';
  end if;
end $$;

-- Répond à un échange reçu par une contre-proposition (destinataire uniquement) :
-- l'échange d'origine passe en 'countered' et un nouvel échange part vers celui
-- qui l'avait proposé. p_offer / p_request : du point de vue de celui qui répond.
create or replace function public.counter_trade(
  p_trade_id bigint,
  p_offer    jsonb default '[]'::jsonb,
  p_request  jsonb default '[]'::jsonb,
  p_message  text default null
)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  v_trade public.trades;
  v_new   bigint;
begin
  select * into v_trade from public.trades where id = p_trade_id for update;
  if not found or v_trade.recipient_id is distinct from auth.uid() then
    raise exception 'Échange introuvable';
  end if;
  if v_trade.status <> 'pending' then
    raise exception 'Échange déjà traité (%)', v_trade.status;
  end if;

  v_new := public.create_trade(v_trade.proposer_id, p_offer, p_request, p_message);
  update public.trades set counter_of = p_trade_id where id = v_new;
  update public.trades set status = 'countered', resolved_at = now() where id = p_trade_id;
  return v_new;
end $$;

-- Annule sa propre proposition
create or replace function public.cancel_trade(p_trade_id bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.trades set status = 'cancelled', resolved_at = now()
   where id = p_trade_id and proposer_id = auth.uid() and status = 'pending';
  if not found then
    raise exception 'Échange introuvable ou déjà traité';
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 5. Droits et Row Level Security
-- ---------------------------------------------------------------------

-- Fonctions utilisées par les règles d'accès. Elles sont dans un schéma
-- que l'API n'expose pas : on ne peut pas les appeler depuis le site.
create schema if not exists rls;
grant usage on schema rls to authenticated;

-- Vrai si la carte est secrète et que l'utilisateur connecté ne l'a pas
create or replace function rls.card_hidden(p_card bigint)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
           select 1 from public.cards c join public.rarities r on r.id = c.rarity_id
           where c.id = p_card and r.is_secret)
     and not exists (
           select 1 from public.user_cards
           where user_id = auth.uid() and card_id = p_card);
$$;
revoke execute on function rls.card_hidden(bigint) from public, anon;
grant execute on function rls.card_hidden(bigint) to authenticated;

-- Supabase donne par défaut tous les droits aux rôles de l'API : on repart de zéro.
revoke all on
  public.profiles, public.game_settings, public.rarities, public.card_sets, public.cards,
  public.user_cards, public.card_discoveries, public.trades, public.trade_items,
  public.booster_codes, public.booster_code_redemptions, public.booster_openings
from anon, authenticated;

-- Membres connectés : lecture seule, plus leur pseudo. Visiteurs non connectés : rien.
grant select on
  public.profiles, public.game_settings, public.rarities, public.card_sets, public.cards,
  public.user_cards, public.card_discoveries, public.trades, public.trade_items,
  public.booster_openings
to authenticated;
grant update (username) on public.profiles to authenticated;

alter table public.profiles                 enable row level security;
alter table public.game_settings            enable row level security;
alter table public.rarities                 enable row level security;
alter table public.card_sets                enable row level security;
alter table public.cards                    enable row level security;
alter table public.user_cards               enable row level security;
alter table public.card_discoveries         enable row level security;
alter table public.trades                   enable row level security;
alter table public.trade_items              enable row level security;
alter table public.booster_codes            enable row level security;
alter table public.booster_code_redemptions enable row level security;
alter table public.booster_openings         enable row level security;

-- Règles des versions précédentes, remplacées par celles de ce script
drop policy if exists "Membres : lire les cartes publiées" on public.cards;
drop policy if exists "Membres : lire les cartes découvertes" on public.cards;
drop policy if exists "Membres : lire toutes les collections" on public.user_cards;
drop policy if exists "Membres : voir les images des cartes publiées" on storage.objects;
drop policy if exists "Membres : voir les images des cartes découvertes" on storage.objects;

-- « Membres : lire les profils » : voir la section 8 (dépend du statut du compte)
drop policy if exists "Membres : modifier son pseudo" on public.profiles;
create policy "Membres : modifier son pseudo" on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
drop policy if exists "Membres : lire les réglages" on public.game_settings;
create policy "Membres : lire les réglages" on public.game_settings
  for select to authenticated using (true);
drop policy if exists "Membres : lire les raretés" on public.rarities;
create policy "Membres : lire les raretés" on public.rarities
  for select to authenticated using (true);
drop policy if exists "Membres : lire les séries" on public.card_sets;
create policy "Membres : lire les séries" on public.card_sets
  for select to authenticated using (true);
drop policy if exists "Membres : lire les cartes possédées" on public.cards;
create policy "Membres : lire les cartes possédées" on public.cards
  for select to authenticated
  using (
    is_released
    and exists (select 1 from public.user_cards uc
                where uc.card_id = cards.id and uc.user_id = (select auth.uid()))
  );
drop policy if exists "Membres : lire ses découvertes" on public.card_discoveries;
create policy "Membres : lire ses découvertes" on public.card_discoveries
  for select to authenticated using (user_id = (select auth.uid()));
-- Les collections des autres sont visibles (pour les échanges), sauf leurs
-- cartes secrètes tant qu'on ne les a pas soi-même.
-- « Membres : lire les collections » : voir la section 8 (dépend du statut du compte)
drop policy if exists "Participants : lire leurs échanges" on public.trades;
create policy "Participants : lire leurs échanges" on public.trades
  for select to authenticated
  using ((select auth.uid()) in (proposer_id, recipient_id));
drop policy if exists "Participants : lire le contenu de leurs échanges" on public.trade_items;
create policy "Participants : lire le contenu de leurs échanges" on public.trade_items
  for select to authenticated
  using (exists (
    select 1 from public.trades t
    where t.id = trade_id
      and (select auth.uid()) in (t.proposer_id, t.recipient_id)
  ));
drop policy if exists "Membres : lire ses ouvertures de boosters" on public.booster_openings;
create policy "Membres : lire ses ouvertures de boosters" on public.booster_openings
  for select to authenticated using (user_id = (select auth.uid()));
-- booster_codes et booster_code_redemptions : aucune policy, donc invisibles depuis le front.

revoke execute on function
  public.card_catalog(),
  public.my_cards(),
  public.open_booster(text),
  public.create_trade(uuid, jsonb, jsonb, text),
  public.accept_trade(bigint),
  public.decline_trade(bigint),
  public.counter_trade(bigint, jsonb, jsonb, text),
  public.cancel_trade(bigint)
from public, anon;

grant execute on function
  public.card_catalog(),
  public.my_cards(),
  public.open_booster(text),
  public.create_trade(uuid, jsonb, jsonb, text),
  public.accept_trade(bigint),
  public.decline_trade(bigint),
  public.counter_trade(bigint, jsonb, jsonb, text),
  public.cancel_trade(bigint)
to authenticated;


-- ---------------------------------------------------------------------
-- 6. Photos des cartes : bucket privé. Un membre connecté ne peut lire
--    que la photo et la vignette des cartes qu'il possède.
--    Upload depuis le dashboard (Storage) ; côté front : createSignedUrls.
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('card-images', 'card-images', false)
on conflict (id) do nothing;

drop policy if exists "Membres : voir les images des cartes possédées" on storage.objects;
create policy "Membres : voir les images des cartes possédées" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'card-images'
    and exists (
      select 1
      from public.cards c
      join public.user_cards uc on uc.card_id = c.id and uc.user_id = (select auth.uid())
      where objects.name in (c.image_path, c.thumb_path) and c.is_released
    )
  );


-- ---------------------------------------------------------------------
-- 7. Administration (console admin.html)
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
grant insert, update, delete on public.rarities to authenticated;
grant update on public.game_settings to authenticated;
grant select, insert, update, delete on public.booster_codes to authenticated;
grant select on public.booster_code_redemptions to authenticated;

drop policy if exists "Admin : lire les admins" on public.admins;
create policy "Admin : lire les admins" on public.admins
  for select to authenticated using ((select public.is_admin()));

drop policy if exists "Admin : lire toutes les cartes" on public.cards;
create policy "Admin : lire toutes les cartes" on public.cards
  for select to authenticated using ((select public.is_admin()));
drop policy if exists "Admin : créer des cartes" on public.cards;
create policy "Admin : créer des cartes" on public.cards
  for insert to authenticated with check ((select public.is_admin()));
drop policy if exists "Admin : modifier les cartes" on public.cards;
create policy "Admin : modifier les cartes" on public.cards
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "Admin : supprimer des cartes" on public.cards;
create policy "Admin : supprimer des cartes" on public.cards
  for delete to authenticated using ((select public.is_admin()));

drop policy if exists "Admin : créer des séries" on public.card_sets;
create policy "Admin : créer des séries" on public.card_sets
  for insert to authenticated with check ((select public.is_admin()));
drop policy if exists "Admin : modifier les séries" on public.card_sets;
create policy "Admin : modifier les séries" on public.card_sets
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "Admin : supprimer des séries" on public.card_sets;
create policy "Admin : supprimer des séries" on public.card_sets
  for delete to authenticated using ((select public.is_admin()));

drop policy if exists "Admin : créer des raretés" on public.rarities;
create policy "Admin : créer des raretés" on public.rarities
  for insert to authenticated with check ((select public.is_admin()));
drop policy if exists "Admin : modifier les raretés" on public.rarities;
create policy "Admin : modifier les raretés" on public.rarities
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
-- Suppression bloquée par la base tant que des cartes utilisent la rareté
drop policy if exists "Admin : supprimer des raretés" on public.rarities;
create policy "Admin : supprimer des raretés" on public.rarities
  for delete to authenticated using ((select public.is_admin()));

-- Sous-titres proposés dans l'éditeur de cartes (réservés aux administrateurs).
-- La carte garde le texte : renommer un sous-titre met à jour ses cartes, le supprimer le leur retire.
create table if not exists public.card_subtitles (
  id    int generated always as identity primary key,
  label text not null unique check (char_length(label) between 1 and 40)
);
revoke all on public.card_subtitles from anon, authenticated;
grant select, insert, update, delete on public.card_subtitles to authenticated;
alter table public.card_subtitles enable row level security;
drop policy if exists "Admin : gérer les sous-titres" on public.card_subtitles;
create policy "Admin : gérer les sous-titres" on public.card_subtitles
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create or replace function public.card_subtitles_sync()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.label is distinct from old.label then
    update public.cards set subtitle = new.label where subtitle = old.label;
  elsif tg_op = 'DELETE' then
    update public.cards set subtitle = null where subtitle = old.label;
  end if;
  return null;
end $$;
drop trigger if exists card_subtitles_sync on public.card_subtitles;
create trigger card_subtitles_sync after update or delete on public.card_subtitles
  for each row execute function public.card_subtitles_sync();

-- Liste de départ : postes et types habituels, plus les sous-titres déjà utilisés
insert into public.card_subtitles (label)
select label from unnest(array['Passeur', 'Passeuse', 'Libéro', 'Central', 'Centrale', 'Pointu', 'Pointue',
  'Réceptionneur-attaquant', 'Réceptionneuse-attaquante', 'Capitaine', 'Entraîneur', 'Entraîneuse',
  'Action', 'Moment', 'Lieu', 'Équipement']) with ordinality as t(label, n)
where not exists (select 1 from public.card_subtitles)
order by n
on conflict (label) do nothing;
insert into public.card_subtitles (label)
select distinct trim(subtitle) from public.cards where char_length(trim(coalesce(subtitle, ''))) between 1 and 40
on conflict (label) do nothing;

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
create policy "Admin : lire tous les échanges" on public.trades
  for select to authenticated using ((select public.is_admin()));
drop policy if exists "Admin : lire le contenu de tous les échanges" on public.trade_items;
create policy "Admin : lire le contenu de tous les échanges" on public.trade_items
  for select to authenticated using ((select public.is_admin()));

drop policy if exists "Admin : lire toutes les collections" on public.user_cards;
create policy "Admin : lire toutes les collections" on public.user_cards
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
-- 8. Inscriptions libres, filtrées par un code du club
--    Un compte créé avec le bon code est actif tout de suite. Sans code,
--    ou avec un mauvais, il est créé « en attente » : il ne voit rien du
--    jeu tant qu'un administrateur ne l'a pas validé dans la console.
-- ---------------------------------------------------------------------

-- Code d'inscription : une seule ligne, lisible et modifiable par les admins seuls.
-- null ou vide = aucune activation automatique, tous les nouveaux comptes attendent.
create table if not exists public.signup_settings (
  id   boolean primary key default true check (id),
  code text check (code is null or char_length(btrim(code)) between 4 and 40)
);
insert into public.signup_settings default values on conflict (id) do nothing;
alter table public.signup_settings enable row level security;
revoke all on public.signup_settings from anon, authenticated;
grant select, update on public.signup_settings to authenticated;
drop policy if exists "Admin : lire le code d'inscription" on public.signup_settings;
create policy "Admin : lire le code d'inscription" on public.signup_settings
  for select to authenticated using ((select public.is_admin()));
drop policy if exists "Admin : modifier le code d'inscription" on public.signup_settings;
create policy "Admin : modifier le code d'inscription" on public.signup_settings
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- Vrai si l'utilisateur connecté a un compte actif
create or replace function rls.is_active()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'active');
$$;
revoke execute on function rls.is_active() from public, anon;
grant execute on function rls.is_active() to authenticated;

-- Un compte en attente ne voit que son propre profil, et aucune collection
drop policy if exists "Membres : lire les profils" on public.profiles;
create policy "Membres : lire les profils" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select rls.is_active()));
drop policy if exists "Admin : lire tous les profils" on public.profiles;
create policy "Admin : lire tous les profils" on public.profiles
  for select to authenticated using ((select public.is_admin()));

drop policy if exists "Membres : lire les collections" on public.user_cards;
create policy "Membres : lire les collections" on public.user_cards
  for select to authenticated
  using ((select rls.is_active()) and (user_id = (select auth.uid()) or not rls.card_hidden(card_id)));

-- Ni booster, ni échange pour un compte en attente : ces déclencheurs
-- annulent l'opération entière, quelle que soit la fonction qui l'a lancée.
create or replace function private.require_active_members()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_table_name = 'booster_openings' then
    if not exists (select 1 from public.profiles where id = new.user_id and status = 'active') then
      raise exception 'Compte en attente de validation';
    end if;
  elsif tg_op = 'INSERT' or new.status = 'accepted' then
    if exists (select 1 from public.profiles
               where id in (new.proposer_id, new.recipient_id) and status <> 'active') then
      raise exception 'Compte en attente de validation';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists require_active_member on public.booster_openings;
create trigger require_active_member
  before insert on public.booster_openings
  for each row execute function private.require_active_members();
drop trigger if exists require_active_members on public.trades;
create trigger require_active_members
  before insert or update of status on public.trades
  for each row execute function private.require_active_members();

-- Validation ou suspension d'un compte par un administrateur
create or replace function public.admin_set_member_status(p_user uuid, p_status text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Réservé aux administrateurs';
  end if;
  if p_status not in ('active', 'pending') then
    raise exception 'Statut inconnu : %', p_status;
  end if;
  if p_user = auth.uid() and p_status <> 'active' then
    raise exception 'Tu ne peux pas suspendre ton propre compte';
  end if;
  update public.profiles set status = p_status where id = p_user;
  if not found then
    raise exception 'Membre introuvable';
  end if;
end $$;
revoke execute on function public.admin_set_member_status(uuid, text) from public, anon;
grant execute on function public.admin_set_member_status(uuid, text) to authenticated;

-- Nouveau mot de passe pour un membre qui a perdu le sien (pas d'e-mail de réinitialisation :
-- les adresses des membres sont internes). Ses sessions ouvertes sont fermées.
-- Les comptes administrateurs ne passent pas par ici : ils ont une vraie adresse e-mail.
-- Renvoie l'adresse du compte, dont la console tire l'identifiant de connexion.
create extension if not exists pgcrypto with schema extensions;
create or replace function public.admin_set_password(p_user uuid, p_password text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_email text;
begin
  if not public.is_admin() then
    raise exception 'Réservé aux administrateurs';
  end if;
  if char_length(coalesce(p_password, '')) < 8 then
    raise exception 'Le mot de passe doit faire au moins 8 caractères';
  end if;
  if exists (select 1 from public.admins where user_id = p_user) then
    raise exception 'Le mot de passe d''un administrateur se change depuis Supabase (Authentication > Users)';
  end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now()
   where id = p_user
  returning email into v_email;
  if not found then
    raise exception 'Membre introuvable';
  end if;
  delete from auth.sessions where user_id = p_user;
  return v_email;
end $$;
revoke execute on function public.admin_set_password(uuid, text) from public, anon;
grant execute on function public.admin_set_password(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 9. Données de départ
-- ---------------------------------------------------------------------

insert into public.game_settings default values on conflict (id) do nothing;

insert into public.rarities (id, code, label, weight, is_secret, effect) values
  (1, 'common',     'Commune',     60,   false, 1),
  (2, 'uncommon',   'Peu commune', 25,   false, 2),
  (3, 'rare',       'Rare',        10,   false, 3),
  (4, 'ultra_rare', 'Ultra rare',   4,   false, 4),
  (5, 'legendary',  'Légendaire',   1,   false, 5),
  (6, 'secret',     'Secrète',      0.5, true,  6)
on conflict (id) do nothing;

-- Séries et cartes de démo : seulement sur un projet neuf (aucune série encore)
do $$
begin
  if exists (select 1 from public.card_sets) then
    return;
  end if;
  insert into public.card_sets (name) values ('Saison 2026-27'), ('Démo');

  -- Cartes de démo pour tester tout de suite (à supprimer avant le lancement, voir plus bas)
  insert into public.cards (set_id, number, name, subtitle, rarity_id, stats, is_released)
  select s.id, v.number, v.name, v.subtitle, v.rarity_id, v.stats::jsonb, true
  from public.card_sets s
  cross join (values
    (1, 'Ballon de match',     'Équipement',              1, '{}'),
    (2, 'Le filet',            'Équipement',              1, '{}'),
    (3, 'Manchette parfaite',  'Action',                  1, '{}'),
    (4, 'Joueur mystère',      'Réceptionneur-attaquant', 2, '{"service": 6, "attaque": 7, "reception": 8, "bloc": 5}'),
    (5, 'Ace décisif',         'Action',                  2, '{}'),
    (6, 'Contre gagnant',      'Action',                  3, '{}'),
    (7, 'Remontée historique', 'Moment',                  4, '{}'),
    (8, 'Le trophée du club',  'Moment',                  5, '{}'),
    (9, 'La mascotte',         'Moment',                  6, '{}')
  ) as v(number, name, subtitle, rarity_id, stats)
  where s.name = 'Démo';
end $$;

-- Profils des comptes créés avant l'exécution de ce script (s'il y en a)
insert into public.profiles (id, username)
select u.id,
       case when char_length(split_part(coalesce(u.email, ''), '@', 1)) >= 2
            then left(split_part(u.email, '@', 1), 30)
            else 'Joueur ' || left(u.id::text, 4)
       end
from auth.users u
on conflict (id) do nothing;


-- ---------------------------------------------------------------------
-- Pour te nommer administrateur, une fois ton compte créé (invitation
-- puis première connexion), remplace l'adresse et exécute :
--
--   insert into public.admins (user_id)
--   select id from auth.users where email = 'toi@exemple.fr';
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- Avant d'ouvrir le jeu aux membres, pour effacer tes tests :
--
--   truncate public.trade_items, public.trades, public.user_cards, public.card_discoveries,
--            public.booster_openings, public.booster_code_redemptions;
--   update public.profiles set last_free_booster_at = null;
--   update public.booster_codes set uses_count = 0;
--   delete from public.cards where set_id = (select id from public.card_sets where name = 'Démo');
--   delete from public.card_sets where name = 'Démo';
-- ---------------------------------------------------------------------


-- L'API (PostgREST) recharge sa description de la base
notify pgrst, 'reload schema';
