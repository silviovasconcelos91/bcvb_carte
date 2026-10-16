import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Card, DrawnCard } from '../lib/types';
import { plural, reduceMotion, sleep } from '../lib/format';
import { cardName, rarityLabel, rClass, useLookup } from '../lib/lookup';
import { CardBack, CardView, MiniArt, Pack } from '../components/visuals';
import { useGame } from './context';
import { boosterSetLabel } from './BoosterView';

type Phase = 'pack' | 'deck' | 'recap';

function burst(el: HTMLElement, r: number) {
  const colors = r >= 6 ? ['#FF4DA6', '#FFD600', '#00E0FF', '#8660FF'] : r === 5 ? ['#FFD34E', '#FFF4C2', '#F2B01E'] : ['#B79CFF', '#E3D7FF', '#8B5CF6'];
  for (let i = 0; i < 18; i++) {
    const s = document.createElement('span');
    const a = (Math.PI * 2 * i) / 18 + Math.random() * 0.3;
    const dist = 70 + Math.random() * 70;
    s.className = 'spark';
    s.style.cssText = `--dx:${(Math.cos(a) * dist).toFixed(0)}px;--dy:${(Math.sin(a) * dist).toFixed(0)}px;background:${colors[i % colors.length]}`;
    el.appendChild(s);
    setTimeout(() => s.remove(), 900);
  }
}

// Ouverture d'un booster : le paquet se déchire, puis les cartes arrivent en pile.
// On retourne celle du dessus, puis elle s'écarte (clic, bouton ou glissé sur mobile).
export function Reveal({ drawn, onClose }: { drawn: DrawnCard[]; onClose: (goCollection: boolean) => void }) {
  const { d } = useGame();
  const L = useLookup();
  const [phase, setPhase] = useState<Phase>('pack');
  const [packClass, setPackClass] = useState('');
  const [cur, setCur] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [leaving, setLeaving] = useState<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const lock = useRef(false);
  const swipe = useRef<{ x: number; at: number } | null>(null);
  const lastSwipe = useRef(0);
  const topRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const items = drawn.map(it => {
    const known = d.cardById.get(it.card_id);
    const card: Card = known && !known.masked ? known : {
      id: it.card_id, set_id: known?.set_id ?? 0, number: known?.number ?? null, name: it.name, rarity_id: it.rarity_id,
      image_path: it.image_path, thumb_path: null, subtitle: null, description: null, stats: {}, is_released: true, in_boosters: true,
    };
    return { it, card };
  });
  const n = items.length;
  const fresh = drawn.filter(x => x.is_new).length;

  useEffect(() => {
    document.body.classList.add('no-scroll');
    let alive = true;
    (async () => {
      if (!reduceMotion()) {
        setPackClass('shake'); await sleep(620);
        setPackClass('shake torn'); await sleep(700);
      }
      if (alive) setPhase('deck');
    })();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(false); };
    document.addEventListener('keydown', onKey);
    return () => { alive = false; document.body.classList.remove('no-scroll'); document.removeEventListener('keydown', onKey); };
  }, []);
  useEffect(() => { if (phase === 'deck') topRef.current?.focus({ preventScroll: true }); }, [phase, cur]);

  async function advance(dir: -1 | 1 = -1) {
    if (lock.current || phase !== 'deck') return;
    if (!flipped) {
      setFlipped(true);
      const r = items[cur].card.rarity_id ?? 1;
      if (r >= 4 && !reduceMotion() && topRef.current) burst(topRef.current, r);
      return;
    }
    lock.current = true;
    setLeaving(dir);
    await sleep(reduceMotion() ? 0 : 340);
    setLeaving(null);
    setFlipped(false);
    lock.current = false;
    if (cur + 1 >= n) setPhase('recap'); else setCur(cur + 1);
  }
  const onTap = () => { if (Date.now() - lastSwipe.current > 450) void advance(-1); };
  const onDown = (e: PointerEvent) => { if (e.pointerType !== 'mouse' && flipped && !lock.current) swipe.current = { x: e.clientX, at: Date.now() }; };
  const onMove = (e: PointerEvent) => { if (swipe.current) setDrag(e.clientX - swipe.current.x); };
  const onUp = (e: PointerEvent) => {
    if (!swipe.current) return;
    const dx = e.clientX - swipe.current.x;
    swipe.current = null;
    setDrag(null);
    if (Math.abs(dx) > 70) { lastSwipe.current = Date.now(); void advance(dx < 0 ? -1 : 1); }
  };

  const nextLabel = !flipped ? 'Retourner la carte' : cur === n - 1 ? 'Voir le récapitulatif' : 'Carte suivante';

  return createPortal(
    <div className="reveal" role="dialog" aria-modal="true" aria-label="Ouverture du booster">
      <div className="reveal-stage">
        {phase === 'pack' && <div className="reveal-pack"><Pack setLabel={boosterSetLabel(d)} className={packClass} /></div>}
        {phase === 'deck' && (
          <>
            <div className="deck" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
              {items.map(({ it, card }, i) => {
                const depth = i - cur;
                if (depth < 0) return null;
                const top = depth === 0;
                const style = { '--d': Math.min(depth, 3), '--s': i % 2 ? 1 : -1, zIndex: n - depth,
                  ...(top && leaving ? { '--out': leaving < 0 ? '-140%' : '140%', '--outr': leaving < 0 ? '-16deg' : '16deg' } : {}),
                  ...(top && drag != null ? { '--dx': `${drag}px`, '--dr': `${(drag / 18).toFixed(1)}deg` } : {}),
                } as CSSProperties;
                const cls = ['flip', `r${card.rarity_id ?? 1}`, top && 'is-top', depth > 3 && 'is-deep', top && flipped && 'is-flipped', top && leaving && 'leaving', top && drag != null && 'dragging'].filter(Boolean).join(' ');
                return (
                  <div key={i} ref={top ? topRef : undefined} className={cls} style={style}
                    {...(top ? {
                      role: 'button', tabIndex: 0, onClick: onTap,
                      onKeyDown: (e: ReactKeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void advance(-1); } },
                      'aria-label': flipped ? `${card.name}, ${rarityLabel(L, card.rarity_id)}. Carte suivante` : `Retourner la carte ${cur + 1}`,
                    } : { 'aria-hidden': true })}>
                    <span className="flip-inner">
                      <span className="flip-face"><CardBack /></span>
                      <span className="flip-face flip-front"><CardView card={card} isNew={it.is_new} tilt={top} size="full" /></span>
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="deck-ui">
              <p className="deck-count" aria-live="polite">Carte {cur + 1} sur {n}</p>
              <div className="reveal-row">
                <button className="btn primary" onClick={() => void advance(-1)}>{nextLabel}</button>
                <button className="btn on-dark" onClick={() => setPhase('recap')}>Tout voir</button>
              </div>
            </div>
          </>
        )}
        {phase === 'recap' && (
          <div className="recap">
            <p className="reveal-sum">{fresh ? `${plural(fresh, 'nouvelle carte', 'nouvelles cartes')} dans ta collection` : 'Aucune nouvelle carte, mais des doubles à échanger'}</p>
            <ul className="recap-list">
              {items.map(({ it, card }, i) => (
                <li key={i} className={`recap-item ${rClass(card)}`}>
                  <span className="chip-art"><MiniArt card={card} /></span>
                  <span className="chip-text"><span className="chip-name">{cardName(card)}</span><span className="chip-meta">{rarityLabel(L, card.rarity_id)}</span></span>
                  {it.is_new && <span className="tag new">Nouvelle</span>}
                </li>
              ))}
            </ul>
            <div className="reveal-row">
              <button className="btn primary" autoFocus onClick={() => onClose(true)}>Voir ma collection</button>
              <button className="btn on-dark" onClick={() => onClose(false)}>Fermer</button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
