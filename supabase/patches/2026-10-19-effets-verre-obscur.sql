-- =====================================================================
--  Patch : effets « Verre brisé » (16) et « Côté obscur » (17)
--
--  À exécuter une fois dans Supabase > SQL Editor sur une base existante.
--  Rejouable sans effet de bord. (schema.sql contient déjà ces changements
--  pour les nouvelles installations.)
-- =====================================================================

alter table public.rarities drop constraint if exists rarities_effect_check;
alter table public.rarities add constraint rarities_effect_check check (effect between 1 and 17);
