-- =====================================================================
--  Patch : réinitialisation du mot de passe d'un membre depuis la console
--
--  À exécuter une fois dans Supabase > SQL Editor sur une base existante.
--  Rejouable sans effet de bord. (schema.sql contient déjà ces changements
--  pour les nouvelles installations.)
-- =====================================================================

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
