-- =====================================================================
--  Patch : effet et couleur des raretés, ajout et suppression en admin
--
--  À exécuter une fois dans Supabase > SQL Editor sur une base existante.
--  Rejouable sans effet de bord. (schema.sql contient déjà ces changements
--  pour les nouvelles installations.)
-- =====================================================================

-- Effet visuel (1 à 15, voir EFFECTS dans src/lib/lookup.tsx) : les raretés
-- existantes gardent leur rendu actuel (effet = numéro de la rareté)
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'rarities' and column_name = 'effect') then
    alter table public.rarities add column effect smallint not null default 1 check (effect between 1 and 15);
    update public.rarities set effect = least(greatest(id, 1), 6);
  end if;
end $$;
-- 15 effets disponibles (une version précédente de ce script en autorisait 6)
alter table public.rarities drop constraint if exists rarities_effect_check;
alter table public.rarities add constraint rarities_effect_check check (effect between 1 and 15);

-- Couleur de l'effet (null = couleur par défaut de l'effet)
alter table public.rarities add column if not exists color text check (color ~ '^#[0-9A-Fa-f]{6}$');

-- Les administrateurs peuvent supprimer une rareté ; la base refuse tant que des cartes l'utilisent
grant delete on public.rarities to authenticated;
drop policy if exists "Admin : supprimer des raretés" on public.rarities;
create policy "Admin : supprimer des raretés" on public.rarities
  for delete to authenticated using ((select public.is_admin()));

-- Recharge le cache de l'API pour voir tout de suite les nouvelles colonnes
notify pgrst, 'reload schema';
