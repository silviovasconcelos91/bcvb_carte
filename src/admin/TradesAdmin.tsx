import { useState } from 'react';
import type { Trade, TradeSide } from '../lib/types';
import { fmtDateLong } from '../lib/format';
import { rClass, rarityLabel } from '../lib/lookup';
import { Avatar } from '../components/visuals';
import { nameOf, useAdmin, type AdminIndex } from './context';

const STATUS: Record<string, [string, string]> = {
  accepted: ['Accepté', 'ok'], pending: ['En attente', 'warn'], declined: ['Refusé', ''], cancelled: ['Annulé', ''],
  failed: ['Échoué', ''], countered: ['Contre-proposé', ''],
};

type Show = 'accepted' | 'all';

// Cartes données par un côté de l'échange : offer = celles du proposant, request = celles du destinataire
function Given({ d, t, side }: { d: AdminIndex; t: Trade; side: TradeSide }) {
  const items = t.trade_items.filter(it => it.side === side);
  if (!items.length) return <span className="muted">Rien</span>;
  return (
    <ul className="given">
      {items.map(it => {
        const c = d.cardById.get(it.card_id);
        return (
          <li key={it.card_id}>
            {c && <i className={`dot ${rClass(d.lookup, c)}`} title={rarityLabel(d.lookup, c.rarity_id)} />}
            {c ? c.name : 'Carte supprimée'}{it.quantity > 1 && ` ×${it.quantity}`}
            {c && <span className="muted"> · {d.lookup.setById.get(c.set_id)?.name ?? ''}</span>}
          </li>
        );
      })}
    </ul>
  );
}

const Member = ({ d, uid }: { d: AdminIndex; uid: string }) => (
  <span className="cell-card"><Avatar name={nameOf(d, uid)} small /><strong>{nameOf(d, uid)}</strong></span>
);

export function TradesAdmin() {
  const { d } = useAdmin();
  const [show, setShow] = useState<Show>('accepted');
  const list = show === 'all' ? d.trades : d.trades.filter(t => t.status === 'accepted');
  return (
    <>
      <div className="view-head"><h2 className="h2">Échanges</h2></div>
      <p className="lead">Les échanges entre membres, du plus récent au plus ancien. Le proposant donne ses cartes au destinataire, qui lui donne les siennes en retour.</p>
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Afficher">
          <button aria-pressed={show === 'accepted'} onClick={() => setShow('accepted')}>Acceptés</button>
          <button aria-pressed={show === 'all'} onClick={() => setShow('all')}>Tous</button>
        </div>
      </div>
      <div className="table-wrap"><table className="tbl">
        <thead><tr><th>Date</th><th>Proposant</th><th>Donne</th><th>Destinataire</th><th>Donne en retour</th>{show === 'all' && <th>Statut</th>}</tr></thead>
        <tbody>
          {!list.length && <tr><td className="empty-cell" colSpan={show === 'all' ? 6 : 5}>{show === 'all' ? "Aucun échange pour l'instant." : "Aucun échange accepté pour l'instant."}</td></tr>}
          {list.map(t => {
            const [label, tone] = STATUS[t.status] ?? [t.status, ''];
            return (
              <tr key={t.id}>
                <td className="date-cell">{fmtDateLong(t.resolved_at ?? t.created_at)}</td>
                <td><Member d={d} uid={t.proposer_id} /></td>
                <td><Given d={d} t={t} side="offer" /></td>
                <td><Member d={d} uid={t.recipient_id} /></td>
                <td><Given d={d} t={t} side="request" /></td>
                {show === 'all' && <td><span className={`pill ${tone}`}>{label}</span></td>}
              </tr>
            );
          })}
        </tbody>
      </table></div>
    </>
  );
}
