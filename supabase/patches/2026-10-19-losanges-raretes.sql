-- =====================================================================
--  Patch : nombre de losanges d'une rareté, ou texte à la place
--
--  À exécuter une fois dans Supabase > SQL Editor sur une base existante.
--  Rejouable sans effet de bord. (schema.sql contient déjà ces changements
--  pour les nouvelles installations.)
-- =====================================================================

-- Nombre de losanges (null = selon le niveau de l'effet, comme avant)
alter table public.rarities add column if not exists gems smallint check (gems between 0 and 10);

-- Texte affiché à la place des losanges, ex. ★★, SR, 🔥 (null = losanges)
alter table public.rarities add column if not exists badge text check (char_length(badge) between 1 and 12);

-- Recharge le cache de l'API pour voir tout de suite les nouvelles colonnes
notify pgrst, 'reload schema';
