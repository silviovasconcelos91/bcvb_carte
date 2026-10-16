import { useState } from 'react';
import type { Card, Trade, TradeItem } from '../lib/types';
import { relTime } from '../lib/format';
import { cardName, rClass, rarText, useLookup } from '../lib/lookup';
import { IconSwap, MiniArt } from '../components/visuals';
import { useToast } from '../components/Toasts';
import { nameOf, qtyOf, useGame } from './context';

// Carte absente du catalogue (secrète, pas encore possédée) : affichée de dos, sans aucune information
const mystery = (id: number): Card => ({
  id, set_id: 0, number: null, name: 'Carte mystère', subtitle: null, description: null, image_path: null, thumb_path: null,
  rarity_id: null, stats: {}, is_released: true, in_boosters: true, masked: true,
});

const STATUS: Record<string, string> = { accepted: 'Accepté', declined: 'Refusé', cancelled: 'Annulé', failed: 'Échoué' };

export function TradesView() {
  const { d, uid, openComposer } = useGame();
  const received = d.trades.filter(t => t.status === 'pending' && t.recipient_id === uid);
  const sent = d.trades.filter(t => t.status === 'pending' && t.proposer_id === uid);
  const done = d.trades.filter(t => t.status !== 'pending').slice(0, 15);
  return (
    <section aria-labelledby="trades-title">
      <div className="trades-head"><h2 className="h2" id="trades-title">Échanges</h2><button className="btn primary" onClick={() => openComposer()}>Nouvel échange</button></div>
      <h3 className="h3">Propositions reçues <span className="count">{received.length}</span></h3>
      {received.length ? received.map(t => <TradeRow key={t.id} t={t} kind="received" />) : <p className="empty-line">Aucune proposition reçue pour le moment.</p>}
      <h3 className="h3">Propositions envoyées <span className="count">{sent.length}</span></h3>
      {sent.length ? sent.map(t => <TradeRow key={t.id} t={t} kind="sent" />) : <p className="empty-line">Repère les cartes qui te manquent dans ta collection, puis demande-les à un membre qui les a.</p>}
      {done.length > 0 && <><h3 className="h3">Historique</h3>{done.map(t => <TradeRow key={t.id} t={t} kind="done" />)}</>}
    </section>
  );
}

function TradeRow({ t, kind }: { t: Trade; kind: 'received' | 'sent' | 'done' }) {
  const { api, d, uid, refresh, openCard } = useGame();
  const L = useLookup();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const meProposer = t.proposer_id === uid;
  const other = meProposer ? t.recipient_id : t.proposer_id;
  const iGive = t.trade_items.filter(i => (i.side === 'offer') === meProposer);
  const iGet = t.trade_items.filter(i => (i.side === 'offer') !== meProposer);
  const short = kind === 'received' && iGive.some(i => qtyOf(d, uid, i.card_id) < i.quantity);
  const who = <strong>{nameOf(d, other)}</strong>;

  async function act(action: 'accept' | 'decline' | 'cancel') {
    setBusy(true);
    try {
      if (action === 'accept') {
        const status = await api.acceptTrade(t.id);
        await refresh();
        if (status === 'accepted') toast('Échange accepté. Les cartes sont dans ta collection.');
        else toast("Échange impossible : une des cartes n'est plus disponible. La proposition est close.", true);
      } else if (action === 'decline') {
        await api.declineTrade(t.id); await refresh(); toast('Proposition refusée');
      } else {
        await api.cancelTrade(t.id); await refresh(); toast('Proposition annulée');
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), true);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const chips = (list: TradeItem[], check: boolean) => list.length ? (
    <ul className="chips">
      {list.map(i => {
        const known = d.cardById.get(i.card_id);
        const c = known ?? mystery(i.card_id);
        const warn = check && qtyOf(d, uid, i.card_id) < i.quantity;
        const inner = (
          <>
            <span className="chip-art"><MiniArt card={c} /></span>
            <span className="chip-text"><span className="chip-name">{known ? cardName(c) : c.name}{i.quantity > 1 ? ` ×${i.quantity}` : ''}</span><span className="chip-meta">{warn ? "Tu ne l'as plus" : rarText(L, c)}</span></span>
          </>
        );
        const cls = `chip ${rClass(c)}${warn ? ' warn' : ''}`;
        return (
          <li key={`${i.side}-${i.card_id}`}>
            {known ? <button className={cls} onClick={() => openCard(c.id)}>{inner}</button> : <span className={`${cls} mystery`}>{inner}</span>}
          </li>
        );
      })}
    </ul>
  ) : <p className="nothing">Rien</p>;

  return (
    <article className="trade">
      <header className="trade-head">
        <p className="trade-title">{kind === 'received' ? <>{who} te propose un échange</> : kind === 'sent' ? <>En attente de la réponse de {who}</> : <>Échange avec {who}</>}</p>
        {kind === 'done' && <span className={`status s-${t.status}`}>{STATUS[t.status] ?? t.status}</span>}
        <time dateTime={t.created_at}>{relTime(t.resolved_at || t.created_at)}</time>
      </header>
      <div className="trade-swap">
        <div><p className="swap-label">Tu reçois</p>{chips(iGet, false)}</div>
        <span className="swap-icon"><IconSwap /></span>
        <div><p className="swap-label">Tu donnes</p>{chips(iGive, kind === 'received')}</div>
      </div>
      {t.message && <p className="trade-msg">{t.message}</p>}
      {short && <p className="trade-warn">Tu n'as plus toutes les cartes demandées : cet échange échouera si tu l'acceptes.</p>}
      {kind === 'received' && (
        <div className="trade-actions">
          <button className="btn" disabled={busy} onClick={() => void act('decline')}>Refuser</button>
          <button className="btn primary" disabled={busy} onClick={() => void act('accept')}>Accepter l'échange</button>
        </div>
      )}
      {kind === 'sent' && <div className="trade-actions"><button className="btn" disabled={busy} onClick={() => void act('cancel')}>Annuler la proposition</button></div>}
    </article>
  );
}
