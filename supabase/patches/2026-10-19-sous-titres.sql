-- =====================================================================
--  Patch : sous-titres des cartes gérés depuis la console
--
--  À exécuter une fois dans Supabase > SQL Editor sur une base existante.
--  Rejouable sans effet de bord. (schema.sql contient déjà ces changements
--  pour les nouvelles installations.)
-- =====================================================================

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

-- Recharge le cache de l'API pour voir tout de suite la nouvelle table
notify pgrst, 'reload schema';
