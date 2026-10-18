-- =====================================================================
--  Patch : boosters gratuits cumulables
--
--  À exécuter une fois dans Supabase > SQL Editor sur une base existante.
--  Rejouable sans effet de bord. (schema.sql contient déjà ces changements
--  pour les nouvelles installations.)
--
--  Un membre qui ne passe pas pendant plusieurs délais garde jusqu'à
--  free_booster_max boosters gratuits en réserve (2 par défaut, réglable
--  dans la console > Réglages). Le délai entre deux boosters ne change pas.
-- =====================================================================

alter table public.game_settings add column if not exists free_booster_max int not null default 2 check (free_booster_max between 1 and 10);
comment on column public.profiles.last_free_booster_at is 'Horloge de recharge des boosters gratuits (voir open_booster), null = stock plein';

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

-- Recharge le cache de l'API pour voir tout de suite la nouvelle colonne
notify pgrst, 'reload schema';
