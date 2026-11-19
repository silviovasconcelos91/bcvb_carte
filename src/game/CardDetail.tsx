import { useEffect, useRef, useState, type TouchEvent } from 'react';
import { pad2, plural } from '../lib/format';
import { cardName, rClass, rarText, useLookup } from '../lib/lookup';
import { Avatar, CardBack, CardView, IconChevron, medalOf } from '../components/visuals';
import { Modal } from '../components/Modal';
import { qtyOf, useGame } from './context';

interface Props {
  id: number;
  /** Cartes voisines (ordre du classeur) : swipe, flèches du clavier ou boutons pour passer de l'une à l'autre */
  list?: number[];
  onNavigate?: (id: number) => void;
  onClose: () => void;
}

export function CardDetail({ id, list = [], onNavigate, onClose }: Props) {
  const { d, uid, openComposer } = useGame();
  const L = useLookup();
  const idx = onNavigate ? list.indexOf(id) : -1;
  const prevId = idx > 0 ? list[idx - 1] : null;
  const nextId = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null;
  // Sens du dernier déplacement, pour faire entrer la carte du bon côté
  const [dir, setDir] = useState<'prev' | 'next' | null>(null);
  const go = (to: number | null, way: 'prev' | 'next') => { if (to != null && onNavigate) { setDir(way); onNavigate(to); } };
  const keyNav = useRef<(k: string) => void>(() => {});
  keyNav.current = k => { if (k === 'ArrowLeft') go(prevId, 'prev'); else if (k === 'ArrowRight') go(nextId, 'next'); };
  useEffect(() => {
    if (!onNavigate) return;
    const onKey = (e: KeyboardEvent) => { if (!e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) keyNav.current(e.key); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onNavigate]);
  // Swipe horizontal au doigt ; un geste surtout vertical reste un défilement de la fiche
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: TouchEvent) => { touch.current = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; };
  const onTouchEnd = (e: TouchEvent) => {
    const t0 = touch.current;
    touch.current = null;
    if (!t0) return;
    const dx = e.changedTouches[0].clientX - t0.x, dy = e.changedTouches[0].clientY - t0.y;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0) go(nextId, 'next'); else go(prevId, 'prev');
  };

  const c = d.cardById.get(id);
  if (!c) return null;
  const q = qtyOf(d, uid, id);
  const set = L.setById.get(c.set_id);
  const owners = d.profiles.filter(p => p.id !== uid).map(p => [p, qtyOf(d, p.id, id)] as const).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  // Membres à qui je peux la proposer : seulement si je l'ai (comptes en attente exclus, ils n'ont pas accès au jeu)
  const missing = q ? d.profiles.filter(p => p.id !== uid && p.status !== 'pending' && !qtyOf(d, p.id, id)) : [];
  const own = q
    ? (q > 1 ? `Tu en as ${q}, dont ${plural(q - 1, 'double', 'doubles')} à échanger.` : 'Tu en as 1.')
    : "Tu ne l'as pas : son nom et son illustration apparaîtront quand tu l'auras.";
  const medal = medalOf(q);
  return (
    <Modal title={cardName(c)} onClose={onClose} footer={idx >= 0 && list.length > 1 ? (
      <div className="detail-nav">
        <button className="btn small" onClick={() => go(prevId, 'prev')} disabled={prevId == null} aria-label="Carte précédente"><IconChevron dir="left" /><span>Précédente</span></button>
        <span className="detail-pos" aria-live="polite">{idx + 1} / {list.length}</span>
        <button className="btn small" onClick={() => go(nextId, 'next')} disabled={nextId == null} aria-label="Carte suivante"><span>Suivante</span><IconChevron dir="right" /></button>
      </div>
    ) : undefined}>
      <div className="detail" onTouchStart={idx >= 0 ? onTouchStart : undefined} onTouchEnd={idx >= 0 ? onTouchEnd : undefined}>
        <div className={`detail-card${dir ? ` from-${dir}` : ''}`} key={id}>{c.masked ? <CardBack /> : <CardView card={c} copies={q} tilt size="full" />}</div>
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
          {q > 0 && <>
            <h3 className="h3">Qui ne l'a pas&nbsp;?</h3>
            {missing.length ? (
              <ul className="owners">
                {missing.map(p => (
                  <li key={p.id}>
                    <Avatar name={p.username} small />
                    <span className="owner-name grow">{p.username}</span>
                    <button className="btn small" onClick={() => { onClose(); openComposer({ to: p.id, give: [[c.id, 1]] }); }}>Lui proposer</button>
                  </li>
                ))}
              </ul>
            ) : <p className="muted">Tous les membres l'ont déjà.</p>}
          </>}
        </div>
      </div>
    </Modal>
  );
}
