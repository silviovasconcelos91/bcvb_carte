-- =====================================================================
--  Patch : god pack
--
--  À exécuter une fois dans Supabase > SQL Editor sur une base existante.
--  Rejouable sans effet de bord. (schema.sql contient déjà ces changements
--  pour les nouvelles installations.)
--
--  Un booster peut être un god pack : toutes ses cartes sont tirées parmi
--  les raretés cochées « god pack ». Par hasard (1 chance sur
--  game_settings.god_pack_odds, 0 = jamais) ou garanti par un code.
-- =====================================================================

-- God pack : les raretés Ultra rare, Légendaire et Secrète y sont éligibles au départ
-- (seulement à la création de la colonne, pour garder ensuite les réglages de l'admin)
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'rarities' and column_name = 'in_god_pack') then
    alter table public.rarities add column in_god_pack boolean not null default false;
    update public.rarities set in_god_pack = true where code in ('ultra_rare', 'legendary', 'secret');
  end if;
end $$;
alter table public.game_settings    add column if not exists god_pack_odds int not null default 0 check (god_pack_odds >= 0);
alter table public.booster_codes    add column if not exists god_pack boolean not null default false;
alter table public.booster_openings add column if not exists god_pack boolean not null default false;
alter table public.booster_codes drop constraint if exists booster_codes_god_pack_no_card;
alter table public.booster_codes add constraint booster_codes_god_pack_no_card check (not god_pack or card_id is null);

-- Tire une carte : une rareté selon les poids, puis une carte au hasard dans cette rareté.
-- Une rareté sans carte disponible est ignorée (son poids se répartit sur les autres).
-- p_set_id null = boosters standards (séries in_boosters), sinon uniquement cette série.
-- p_god_pack = tirage limité aux raretés in_god_pack (leurs poids restent les mêmes entre elles).
drop function if exists private.draw_card(int); -- ancienne signature, sans p_god_pack
create or replace function private.draw_card(p_set_id int, p_god_pack boolean default false)
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
    and (not p_god_pack or r.in_god_pack)
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

-- Vrai si un god pack peut être tiré dans ce périmètre (même règle de série que draw_card) :
-- au moins une carte disponible d'une rareté in_god_pack de poids non nul.
create or replace function private.god_pack_possible(p_set_id int)
returns boolean
language sql stable set search_path = ''
as $$
  select exists (
    select 1
    from public.cards c
    join public.card_sets s on s.id = c.set_id
    join public.rarities r on r.id = c.rarity_id
    where r.in_god_pack
      and r.weight > 0
      and c.is_released
      and c.in_boosters
      and (case when p_set_id is null then s.in_boosters else c.set_id = p_set_id end)
  );
$$;

-- Ouvre un booster gratuit (selon le délai des réglages) ou via un code.
-- p_set_id : série choisie par le membre (une série in_boosters), null = toutes les séries in_boosters.
-- Un code lié à une série ou à une carte précise l'emporte sur ce choix.
-- God pack : garanti par un code god_pack, sinon 1 chance sur game_settings.god_pack_odds
-- (jamais pour un code « carte précise ») ; toutes les cartes sont alors tirées parmi les raretés in_god_pack.
-- Renvoie [{card_id, name, rarity_id, image_path, is_new, god_pack}, ...]
drop function if exists public.open_booster(text); -- ancienne signature, sans p_set_id
create or replace function public.open_booster(p_code text default null, p_set_id int default null)
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
  v_god      boolean := false;
begin
  if v_uid is null then
    raise exception 'Connexion requise';
  end if;

  select * into v_settings from public.game_settings where id;
  if not found then
    raise exception 'Réglages du jeu manquants (table game_settings)';
  end if;

  if p_set_id is not null
     and not exists (select 1 from public.card_sets where id = p_set_id and in_boosters) then
    raise exception 'Cette série n''est pas disponible dans les boosters';
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

  -- God pack : sans carte éligible dans la série, le hasard retombe sur un booster normal,
  -- un code god pack échoue (l'exception annule tout, le code n'est pas consommé)
  if v_code.card_id is null then
    v_god := coalesce(v_code.god_pack, false)
             or (v_settings.god_pack_odds > 0 and random() < 1.0 / v_settings.god_pack_odds);
    if v_god and not private.god_pack_possible(coalesce(v_code.set_id, p_set_id)) then
      if coalesce(v_code.god_pack, false) then
        raise exception 'Aucune carte disponible pour un god pack dans cette série';
      end if;
      v_god := false;
    end if;
  end if;

  -- Un code peut donner une carte précise, ou moins (ou plus) de cartes qu'un booster normal
  for i in 1 .. case when v_code.card_id is not null then 1
                     else coalesce(v_code.card_count, v_settings.booster_size) end loop
    if v_code.card_id is not null then
      v_card_id := v_code.card_id;
    else
      v_card_id := private.draw_card(coalesce(v_code.set_id, p_set_id), v_god);
    end if;
    v_is_new  := private.add_cards(v_uid, v_card_id, 1);
    select * into v_card from public.cards where id = v_card_id;
    v_ids    := v_ids || v_card_id;
    v_result := v_result || jsonb_build_object(
      'card_id',    v_card.id,
      'name',       v_card.name,
      'rarity_id',  v_card.rarity_id,
      'image_path', v_card.image_path,
      'is_new',     v_is_new,
      'god_pack',   v_god
    );
  end loop;

  insert into public.booster_openings (user_id, code_id, card_ids, god_pack)
  values (v_uid, v_code.id, v_ids, v_god);

  return v_result;
end $$;

revoke execute on function public.open_booster(text, int) from public, anon;
grant execute on function public.open_booster(text, int) to authenticated;

-- Recharge le cache de l'API pour voir tout de suite les nouvelles colonnes
notify pgrst, 'reload schema';
