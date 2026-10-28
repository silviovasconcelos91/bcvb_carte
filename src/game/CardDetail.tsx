import { pad2, plural } from '../lib/format';
import { cardName, rClass, rarText, useLookup } from '../lib/lookup';
import { Avatar, CardBack, CardView, medalOf } from '../components/visuals';
import { Modal } from '../components/Modal';
import { qtyOf, useGame } from './context';

export function CardDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const { d, uid, openComposer } = useGame();
  const L = useLookup();
  const c = d.cardById.get(id);
  if (!c) return null;
  const q = qtyOf(d, uid, id);
  const set = L.setById.get(c.set_id);
  const owners = d.profiles.filter(p => p.id !== uid).map(p => [p, qtyOf(d, p.id, id)] as const).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const own = q
    ? (q > 1 ? `Tu en as ${q}, dont ${plural(q - 1, 'double', 'doubles')} à échanger.` : 'Tu en as 1.')
    : "Tu ne l'as pas : son nom et son illustration apparaîtront quand tu l'auras.";
  const medal = medalOf(q);
  return (
    <Modal title={cardName(c)} onClose={onClose}>
      <div className="detail">
        <div className="detail-card">{c.masked ? <CardBack /> : <CardView card={c} copies={q} tilt size="full" />}</div>
        <div>
          <p className="detail-meta">
            <span className={`rlabel ${rClass(L, c)}`}>{c.rarity_id ? <i /> : null}{rarText(L, c)}</span>
            <span>{set?.name}, carte {pad2(c.number)} sur {pad2(L.setCount.get(c.set_id))}</span>
          </p>
          {c.description && <p className="detail-desc">{c.description}</p>}
          <p className="detail-own">{own}{medal && ` ${medal.label} obtenue pour ${medal.min} exemplaires.`}</p>
          <h3 className="h3">Qui l'a&nbsp;?</h3>
          {owners.length ? (
            <ul className="owners">
              {owners.map(([p, n]) => (
                <li key={p.id}>
                  <Avatar name={p.username} small />
                  <span className="owner-name">{p.username}</span>
                  <span className="owner-q">{plural(n, 'exemplaire', 'exemplaires')}</span>
                  <button className="btn small" onClick={() => { onClose(); openComposer({ to: p.id, want: [[c.id, 1]] }); }}>Lui demander</button>
                </li>
              ))}
            </ul>
          ) : <p className="muted">Aucun autre membre ne l'a pour l'instant.</p>}
        </div>
      </div>
    </Modal>
  );
}
