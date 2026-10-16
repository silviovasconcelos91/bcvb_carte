-- =====================================================================
--  Cartes du club : schéma Supabase (PostgreSQL)
--
--  À exécuter une seule fois sur un projet neuf : Supabase > SQL Editor.
--
--  Principe : le navigateur ne fait que LIRE les tables. Toutes les
--  écritures passent par des fonctions appelées en RPC, qui vérifient
--  les règles côté base, dans une seule transaction :
--    open_booster, create_trade, accept_trade, decline_trade, cancel_trade
--  Seule exception : un membre peut modifier son propre pseudo.
--
--  Cartes cachées : un membre ne peut lire en entier (nom, description,
--  stats, photo) que les cartes qu'il a déjà obtenues au moins une fois.
--  Pour les autres, card_catalog() ne donne que la série, le numéro et
--  la rareté, et même pas la rareté si elle est secrète.
--
--  Administration : la console admin.html (réservée aux comptes listés
--  dans la table admins), ou le Table Editor du dashboard.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------

create table public.profiles (
  id                   uuid primary key references auth.users (id) on delete cascade,
  username             text not null check (char_length(username) between 2 and 30),
  last_free_booster_at timestamptz,
  created_at           timestamptz not null default now()
);

-- Réglages du jeu : une seule ligne, à modifier dans le Table Editor
create table public.game_settings (
  id                    boolean primary key default true check (id),
  booster_size          int not null default 5 check (booster_size between 1 and 20),
  free_booster_cooldown interval not null default interval '1 day'
);

create table public.rarities (
  id     smallint primary key,                    -- 1 = la plus commune
  code   text not null unique,
  label  text not null,
  weight numeric not null check (weight >= 0),     -- poids relatif au tirage (0 = jamais)
  is_secret boolean not null default false         -- true = rareté masquée tant que la carte n'est pas obtenue
);

-- Séries / extensions : "Saison 2026-27", "Tournoi de Noël"...
create table public.card_sets (
  id          int generated always as identity primary key,
  name        text not null unique,
  in_boosters boolean not null default true,       -- false = ne tombe plus dans les boosters standards
  created_at  timestamptz not null default now()
);

create table public.cards (
  id          bigint generated always as identity primary key,
  set_id      int not null references public.card_sets (id),
  number      int,                                 -- numéro dans la série ("12/40")
  name        text not null,
  subtitle    text,                                -- poste ("Passeuse") ou type ("Moment")
  description text,
  image_path  text,                                -- chemin dans le bucket "card-images"
  rarity_id   smallint not null references public.rarities (id),
  stats       jsonb not null default '{}'::jsonb,  -- ex. {"service": 7, "attaque": 8}
  is_released boolean not null default false,      -- false = en préparation : invisible et jamais tirée
  in_boosters boolean not null default true,       -- false = reste visible mais ne tombe plus dans les boosters
  created_at  timestamptz not null default now(),
  unique (set_id, number)
);

-- Collection : une ligne par (joueur, carte), avec le nombre d'exemplaires
create table public.user_cards (
  user_id           uuid not null references public.profiles (id) on delete cascade,
  card_id           bigint not null references public.cards (id),
  quantity          int not null check (quantity > 0),
  first_obtained_at timestamptz not null default now(),
  primary key (user_id, card_id)
);
create index user_cards_card_idx on public.user_cards (card_id);

-- Cartes déjà obtenues au moins une fois (elles restent connues même après un échange)
create table public.card_discoveries (
  user_id       uuid not null references public.profiles (id) on delete cascade,
  card_id       bigint not null references public.cards (id) on delete cascade,
  discovered_at timestamptz not null default now(),
  primary key (user_id, card_id)
);

create type public.trade_status as enum ('pending', 'accepted', 'declined', 'cancelled', 'failed');
-- offer = carte donnée par celui qui propose ; request = carte donnée par le destinataire
create type public.trade_side as enum ('offer', 'request');

create table public.trades (
  id           bigint generated always as identity primary key,
  proposer_id  uuid not null references public.profiles (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  status       public.trade_status not null default 'pending',
  message      text check (char_length(message) <= 280),
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  check (proposer_id <> recipient_id)
);
create index trades_proposer_idx on public.trades (proposer_id, status);
create index trades_recipient_idx on public.trades (recipient_id, status);

create table public.trade_items (
  trade_id bigint not null references public.trades (id) on delete cascade,
  side     public.trade_side not null,
  card_id  bigint not null references public.cards (id),
  quantity int not null check (quantity > 0),
  primary key (trade_id, side, card_id)
);

-- Codes à scanner (QR au gymnase, tournoi...) : un booster par personne et par code
create table public.booster_codes (
  id         bigint generated always as identity primary key,
  code       text not null,                        -- insensible à la casse
  label      text,                                 -- ex. "Match à domicile du 14/11"
  set_id     int references public.card_sets (id), -- null = tirage standard, sinon cette série uniquement
  max_uses   int check (max_uses > 0),             -- null = pas de limite globale
  uses_count int not null default 0,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index booster_codes_code_idx on public.booster_codes (upper(code));

create table public.booster_code_redemptions (
  code_id     bigint not null references public.booster_codes (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  primary key (code_id, user_id)
);

-- Historique des ouvertures (débogage, fil "derniers tirages"...)
create table public.booster_openings (
  id        bigint generated always as identity primary key,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  code_id   bigint references public.booster_codes (id) on delete set null,
  card_ids  bigint[] not null,
  opened_at timestamptz not null default now()
);
create index booster_openings_user_idx on public.booster_openings (user_id, opened_at desc);


-- ---------------------------------------------------------------------
-- 2. Profil créé automatiquement à l'inscription ou à l'invitation
-- ---------------------------------------------------------------------

create function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_name text := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'username'), ''),
    split_part(coalesce(new.email, ''), '@', 1)
  );
begin
  if char_length(v_name) < 2 then
    v_name := 'Joueur ' || left(new.id::text, 4);
  end if;
  insert into public.profiles (id, username) values (new.id, left(v_name, 30));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ---------------------------------------------------------------------
-- 3. Fonctions internes (schéma "private", non exposé par l'API)
-- ---------------------------------------------------------------------

create schema if not exists private;

-- Ajoute des exemplaires ; renvoie true si le joueur découvre cette carte pour la première fois
create function private.add_cards(p_user uuid, p_card bigint, p_qty int)
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
create function private.remove_cards(p_user uuid, p_card bigint, p_qty int)
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
create function private.draw_card(p_set_id int)
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

-- Catalogue de toutes les cartes publiées, sans rien révéler des cartes jamais obtenues :
-- série, numéro et rareté seulement (rareté à null si elle est secrète).
-- Le détail des cartes découvertes se lit dans la table cards.
create function public.card_catalog()
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

-- Ouvre un booster gratuit (selon le délai des réglages) ou via un code.
-- Renvoie [{card_id, name, rarity_id, image_path, is_new}, ...]
create function public.open_booster(p_code text default null)
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
    if v_profile.last_free_booster_at + v_settings.free_booster_cooldown > now() then
      raise exception 'Prochain booster gratuit le %',
        to_char((v_profile.last_free_booster_at + v_settings.free_booster_cooldown)
                at time zone 'Europe/Paris', 'DD/MM "à" HH24:MI');
    end if;
    update public.profiles set last_free_booster_at = now() where id = v_uid;
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

  for i in 1 .. v_settings.booster_size loop
    v_card_id := private.draw_card(v_code.set_id);
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
create function public.create_trade(
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
create function public.accept_trade(p_trade_id bigint)
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
create function public.decline_trade(p_trade_id bigint)
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

-- Annule sa propre proposition
create function public.cancel_trade(p_trade_id bigint)
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

create policy "Membres : lire les profils" on public.profiles
  for select to authenticated using (true);
create policy "Membres : modifier son pseudo" on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "Membres : lire les réglages" on public.game_settings
  for select to authenticated using (true);
create policy "Membres : lire les raretés" on public.rarities
  for select to authenticated using (true);
create policy "Membres : lire les séries" on public.card_sets
  for select to authenticated using (true);
create policy "Membres : lire les cartes découvertes" on public.cards
  for select to authenticated
  using (
    is_released
    and exists (select 1 from public.card_discoveries d
                where d.card_id = cards.id and d.user_id = (select auth.uid()))
  );
create policy "Membres : lire ses découvertes" on public.card_discoveries
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Membres : lire toutes les collections" on public.user_cards
  for select to authenticated using (true);
create policy "Participants : lire leurs échanges" on public.trades
  for select to authenticated
  using ((select auth.uid()) in (proposer_id, recipient_id));
create policy "Participants : lire le contenu de leurs échanges" on public.trade_items
  for select to authenticated
  using (exists (
    select 1 from public.trades t
    where t.id = trade_id
      and (select auth.uid()) in (t.proposer_id, t.recipient_id)
  ));
create policy "Membres : lire ses ouvertures de boosters" on public.booster_openings
  for select to authenticated using (user_id = (select auth.uid()));
-- booster_codes et booster_code_redemptions : aucune policy, donc invisibles depuis le front.

revoke execute on function
  public.card_catalog(),
  public.open_booster(text),
  public.create_trade(uuid, jsonb, jsonb, text),
  public.accept_trade(bigint),
  public.decline_trade(bigint),
  public.cancel_trade(bigint)
from public, anon;

grant execute on function
  public.card_catalog(),
  public.open_booster(text),
  public.create_trade(uuid, jsonb, jsonb, text),
  public.accept_trade(bigint),
  public.decline_trade(bigint),
  public.cancel_trade(bigint)
to authenticated;


-- ---------------------------------------------------------------------
-- 6. Photos des cartes : bucket privé. Un membre connecté ne peut lire
--    que les images des cartes qu'il a déjà découvertes.
--    Upload depuis le dashboard (Storage) ; côté front : createSignedUrls.
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('card-images', 'card-images', false)
on conflict (id) do nothing;

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
-- 8. Données de départ
-- ---------------------------------------------------------------------

insert into public.game_settings default values;

insert into public.rarities (id, code, label, weight, is_secret) values
  (1, 'common',     'Commune',     60,   false),
  (2, 'uncommon',   'Peu commune', 25,   false),
  (3, 'rare',       'Rare',        10,   false),
  (4, 'ultra_rare', 'Ultra rare',   4,   false),
  (5, 'legendary',  'Légendaire',   1,   false),
  (6, 'secret',     'Secrète',      0.5, true);

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
