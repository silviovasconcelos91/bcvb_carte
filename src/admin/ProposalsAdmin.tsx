import { useState } from 'react';
import type { Proposal } from '../lib/types';
import { relTime } from '../lib/format';
import { partialCard } from '../api/game';
import { CardView } from '../components/visuals';
import { useConfirm } from '../components/Confirm';
import { CardEditor } from './Cards';
import { nameOf, useAdmin, useRunRefresh } from './context';

export function ProposalsAdmin() {
  const { api, d } = useAdmin();
  const runRefresh = useRunRefresh();
  const confirm = useConfirm();
  const [integrating, setIntegrating] = useState<Proposal | null>(null);

  async function refuse(p: Proposal) {
    if (!(await confirm.ask('Refuser la proposition', `« ${p.name} » de ${nameOf(d, p.user_id)} sera supprimée, avec sa photo.`, 'Refuser'))) return;
    await runRefresh(() => api.refuseProposal(p), 'Proposition refusée');
  }

  return (
    <>
      <div className="view-head"><h2 className="h2">Propositions</h2></div>
      <p className="lead">Cartes proposées par les membres, de la plus ancienne à la plus récente. Une carte intégrée est créée en préparation ; un refus supprime la proposition et sa photo. Le membre n'est pas prévenu de ta décision.</p>
      {d.proposals.length ? (
        <ul className="prop-grid">
          {d.proposals.map(p => (
            <li key={p.id} className="prop-item">
              <CardView card={partialCard({ id: -p.id, name: p.name, subtitle: p.subtitle, description: p.description, stats: p.stats, rarity_id: p.rarity_id, image_path: p.image_path, thumb_path: p.thumb_path })} />
              <span className="prop-meta"><strong>{nameOf(d, p.user_id)}</strong><span className="muted">{relTime(p.created_at)}</span></span>
              <span className="prop-actions">
                <button className="btn small primary" onClick={() => setIntegrating(p)}>Intégrer</button>
                <button className="btn small" onClick={() => void refuse(p)}>Refuser</button>
              </span>
            </li>
          ))}
        </ul>
      ) : <p className="empty-cell">Aucune proposition en attente.</p>}
      {integrating && <CardEditor id={null} defaultSet={null} proposal={integrating} onClose={() => setIntegrating(null)} />}
      {confirm.element}
    </>
  );
}
