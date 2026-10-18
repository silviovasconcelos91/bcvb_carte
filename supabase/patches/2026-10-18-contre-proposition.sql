-- =====================================================================
--  Patch : contre-propositions d'échange
--
--  À exécuter une fois dans Supabase > SQL Editor sur une base existante.
--  Rejouable sans effet de bord. (schema.sql contient déjà ces changements
--  pour les nouvelles installations.)
-- =====================================================================

-- countered : le destinataire a répondu par une contre-proposition (nouvel échange lié)
alter type public.trade_status add value if not exists 'countered';

-- Échange auquel celui-ci répond (contre-proposition)
alter table public.trades add column if not exists counter_of bigint references public.trades (id) on delete set null;

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

revoke execute on function public.counter_trade(bigint, jsonb, jsonb, text) from public, anon;
grant execute on function public.counter_trade(bigint, jsonb, jsonb, text) to authenticated;

-- Recharge le cache de l'API pour voir tout de suite la colonne et la fonction
notify pgrst, 'reload schema';
