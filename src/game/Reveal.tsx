import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { partialCard } from '../api/game';
import type { Card, DrawnCard } from '../lib/types';
import { plural, reduceMotion, sleep } from '../lib/format';
import { cardName, colorOf, effectOf, fxOf, rarClass, rarityLabel, rClass, useLookup } from '../lib/lookup';
import { CardBack, CardView, MiniArt, Pack } from '../components/visuals';
import { useGame } from './context';
import { packOf } from './BoosterView';

type Phase = 'pack' | 'deck' | 'recap';
type PackStep = '' | 'drop' | 'charge' | 'torn';
interface Fx { r: number; id: number; e: number; key: number; x: number; y: number; cracks?: { w: number; h: number; d: string[] } }
// Effets de rareté qui ont leur propre ouverture
const FX_GLASS = 16, FX_DARK = 17;

// Ouverture du paquet : il tombe, tremble de plus en plus fort, puis se déchire dans un flash
const PACK_STEPS: [PackStep, number][] = [['drop', 550], ['charge', 1050], ['torn', 800]];
// Suspense avant de retourner une carte très rare (la carte tremble et s'illumine)
const SUSPENSE: Record<number, number> = { 5: 500, 6: 1100 };

// Mélange une couleur #rrggbb avec du blanc (t > 0) ou du noir (t < 0)
const shade = (hex: string, t: number) => '#' + [1, 3, 5].map(i => {
  const v = parseInt(hex.slice(i, i + 2), 16);
  return Math.round(t > 0 ? v + (255 - v) * t : v * (1 + t)).toString(16).padStart(2, '0');
}).join('');
const sparkColors = (r: number, hex: string) => (r >= 6 ? ['#FF4DA6', '#FFD600', '#00E0FF', '#8660FF', '#3DFF9E'] : [shade(hex, 0.35), shade(hex, 0.75), hex]);

function burst(el: HTMLElement, r: number, hex: string) {
  const colors = sparkColors(r, hex);
  const count = r >= 6 ? 40 : r === 5 ? 28 : 18;
  const reach = r >= 6 ? 150 : r === 5 ? 120 : 70;
  for (let i = 0; i < count; i++) {
    const s = document.createElement('span');
    const a = (Math.PI * 2 * i) / count + Math.random() * 0.3;
    const dist = reach + Math.random() * reach;
    s.className = 'spark';
    s.style.cssText = `--dx:${(Math.cos(a) * dist).toFixed(0)}px;--dy:${(Math.sin(a) * dist).toFixed(0)}px;background:${colors[i % colors.length]}`;
    el.appendChild(s);
    setTimeout(() => s.remove(), 900);
  }
}

// Pluie de pièces d'or (légendaire) ou de confettis (secrète) sur tout l'écran
function rain(el: HTMLElement, r: number, hex: string) {
  const colors = sparkColors(r, hex);
  const count = r >= 6 ? 80 : 40;
  for (let i = 0; i < count; i++) {
    const s = document.createElement('span');
    const dur = 1.8 + Math.random() * 1.4;
    s.className = r >= 6 ? 'confetti' : 'confetti coin';
    s.style.cssText = `left:${(Math.random() * 100).toFixed(1)}%;--x:${(Math.random() * 120 - 60).toFixed(0)}px;--rot:${(Math.random() * 900 - 450).toFixed(0)}deg;animation-duration:${dur.toFixed(2)}s;animation-delay:${(Math.random() * 0.7).toFixed(2)}s;background:${colors[i % colors.length]}`;
    el.appendChild(s);
    setTimeout(() => s.remove(), (dur + 0.8) * 1000);
  }
}

// Verre brisé : fissures qui partent du point d'impact (x, y) jusqu'aux bords de l'écran (w × h),
// avec quelques branches et deux anneaux qui relient les fissures autour de l'impact
function cracks(x: number, y: number, w: number, h: number) {
  const reach = Math.hypot(Math.max(x, w - x), Math.max(y, h - y));
  const n = 9 + Math.floor(Math.random() * 4);
  const rays: string[] = [], branches: string[] = [];
  const rings: [number, number][][] = [[], []];
  const pt = (px: number, py: number) => `${px.toFixed(0)} ${py.toFixed(0)}`;
  for (let i = 0; i < n; i++) {
    let a = (Math.PI * 2 * i) / n + Math.random() * 0.4;
    let px = x, py = y, dist = 0;
    let d = `M${pt(px, py)}`;
    while (dist < reach) {
      const step = 25 + Math.random() * 55;
      a += (Math.random() - 0.5) * 0.35;
      px += Math.cos(a) * step;
      py += Math.sin(a) * step;
      const before = dist;
      dist += step;
      d += `L${pt(px, py)}`;
      [70, 170].forEach((r, k) => { if (before < r && dist >= r) rings[k].push([px, py]); });
      if (dist > 60 && Math.random() < 0.18) {
        const b = a + (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.5);
        const len = 40 + Math.random() * 80;
        branches.push(`M${pt(px, py)}L${pt(px + Math.cos(b) * len * 0.5, py + Math.sin(b) * len * 0.5)}L${pt(px + Math.cos(b + 0.2) * len, py + Math.sin(b + 0.2) * len)}`);
      }
    }
    rays.push(d);
  }
  const links = rings.flatMap(ring => ring.flatMap(([ax, ay], i) => {
    const [bx, by] = ring[(i + 1) % ring.length];
    return Math.random() < 0.75 ? [`M${pt(ax, ay)}L${pt((ax + bx) / 2 + (Math.random() - 0.5) * 14, (ay + by) / 2 + (Math.random() - 0.5) * 14)}L${pt(bx, by)}`] : [];
  }));
  return { w, h, d: [...rays, ...links, ...branches] };
}

// Ouverture d'un booster : le paquet se déchire, puis les cartes arrivent en pile.
// On retourne celle du dessus, puis elle s'écarte (clic, bouton ou glissé sur mobile).
export function Reveal({ drawn, onClose }: { drawn: DrawnCard[]; onClose: (goCollection: boolean) => void }) {
  const { d } = useGame();
  const L = useLookup();
  const [phase, setPhase] = useState<Phase>('pack');
  const [step, setStep] = useState<PackStep>('');
  const [fx, setFx] = useState<Fx | null>(null);
  const [charging, setCharging] = useState(false);
  const [cur, setCur] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [leaving, setLeaving] = useState<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const lock = useRef(false);
  const swipe = useRef<{ x: number; at: number } | null>(null);
  const lastSwipe = useRef(0);
  const topRef = useRef<HTMLDivElement>(null);
  const deckRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const items = drawn.map(it => {
    const known = d.cardById.get(it.card_id);
    const card = known && !known.masked ? known : partialCard({
      id: it.card_id, set_id: known?.set_id ?? 0, number: known?.number ?? null, name: it.name, rarity_id: it.rarity_id, image_path: it.image_path,
    });
    return { it, card };
  });
  const n = items.length;
  const fresh = drawn.filter(x => x.is_new).length;
  // Pochette de la série tirée ; cartes de plusieurs séries : booster de toutes les séries
  const drawnSets = new Set(items.map(x => x.card.set_id));
  const pack = packOf(d, drawnSets.size === 1 ? [...drawnSets][0] || null : null);
  // Le halo du paquet prend la couleur de la meilleure carte (à partir de l'effet Irisé)
  const tier = (c: Card) => effectOf(L, c.rarity_id ?? 1);
  const bestCard = items.map(x => x.card).reduce<Card | null>((a, c) => (!a || tier(c) > tier(a) ? c : a), null);
  const best = bestCard ? tier(bestCard) : 1;
  const bestCls = rarClass(L, bestCard?.rarity_id ?? 1);

  useEffect(() => {
    document.body.classList.add('no-scroll');
    let alive = true;
    (async () => {
      if (!reduceMotion()) {
        for (const [s, ms] of PACK_STEPS) {
          if (!alive) return;
          setStep(s);
          await sleep(ms);
        }
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
      const id = items[cur].card.rarity_id ?? 1;
      const r = effectOf(L, id);
      const rarity = L.rarityById.get(id) ?? { id };
      const hex = colorOf(rarity);
      const e = fxOf(rarity);
      const show = r >= 4 && !reduceMotion();
      if (show && SUSPENSE[r]) {
        lock.current = true;
        setCharging(true);
        await sleep(SUSPENSE[r]);
        setCharging(false);
        lock.current = false;
      }
      setFlipped(true);
      if (show) {
        const b = deckRef.current?.getBoundingClientRect();
        if (b) {
          const x = b.left + b.width / 2, y = b.top + b.height / 2;
          setFx({ r, id, e, key: Date.now(), x, y, cracks: e === FX_GLASS ? cracks(x, y, window.innerWidth, window.innerHeight) : undefined });
        }
        // Les éclats partent quand la carte est à moitié retournée (pas de pluie de pièces pour le côté obscur)
        setTimeout(() => {
          if (topRef.current) burst(topRef.current, r, hex);
          if (r >= 5 && e !== FX_DARK && rootRef.current) rain(rootRef.current, r, hex);
        }, 280);
      }
      return;
    }
    lock.current = true;
    setLeaving(dir);
    setFx(null);
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
    <div className="reveal" ref={rootRef} role="dialog" aria-modal="true" aria-label="Ouverture du booster">
      {phase === 'pack' && step === 'torn' && <div className={`reveal-flash pack-flash fx-r${best} ${bestCls}`} aria-hidden="true" />}
      {fx && (
        <div key={fx.key} className={`reveal-fx fx-r${fx.r} ${rarClass(L, fx.id)}`} style={{ '--fx-x': `${fx.x}px`, '--fx-y': `${fx.y}px` } as CSSProperties} aria-hidden="true">
          {fx.r >= 5 && <span className="fx-rays" />}
          <span className="fx-shock" />
          {fx.r >= 6 && <span className="fx-shock late" />}
          {fx.e === FX_DARK && <span className="fx-flames" />}
          <span className="reveal-flash" />
        </div>
      )}
      {/* Par-dessus la carte : l'écran se fissure (verre brisé) ou l'ombre avance depuis les bords (côté obscur) */}
      {fx?.cracks && (
        <svg key={fx.key} className="fx-cracks" viewBox={`0 0 ${fx.cracks.w} ${fx.cracks.h}`} preserveAspectRatio="none" aria-hidden="true">
          {fx.cracks.d.map((d, i) => <path key={i} d={d} pathLength={1} style={{ '--i': i } as CSSProperties} />)}
        </svg>
      )}
      {fx?.e === FX_DARK && <div key={fx.key} className="fx-shade" style={{ '--fx-x': `${fx.x}px`, '--fx-y': `${fx.y}px` } as CSSProperties} aria-hidden="true" />}
      <div className={`reveal-stage${fx && fx.r >= 5 ? ` quake-r${fx.r}` : fx?.e === FX_GLASS ? ' quake-r5' : ''}`}>
        {phase === 'pack' && (
          <div className={`reveal-pack ${step} best-r${best >= 4 ? best : 0} ${bestCls}`}>
            <span className="pack-rays" aria-hidden="true" />
            <span className="pack-aura" aria-hidden="true" />
            <Pack {...pack} />
            <span className="pack-beam" aria-hidden="true" />
          </div>
        )}
        {phase === 'deck' && (
          <>
            <div className="deck" ref={deckRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
              {items.map(({ it, card }, i) => {
                const depth = i - cur;
                if (depth < 0) return null;
                const top = depth === 0;
                const style = { '--d': Math.min(depth, 3), '--s': i % 2 ? 1 : -1, zIndex: n - depth,
                  ...(top && leaving ? { '--out': leaving < 0 ? '-140%' : '140%', '--outr': leaving < 0 ? '-16deg' : '16deg' } : {}),
                  ...(top && drag != null ? { '--dx': `${drag}px`, '--dr': `${(drag / 18).toFixed(1)}deg` } : {}),
                } as CSSProperties;
                const cls = ['flip', rarClass(L, card.rarity_id ?? 1), top && 'is-top', depth > 3 && 'is-deep', top && flipped && 'is-flipped', top && leaving && 'leaving', top && drag != null && 'dragging', top && charging && 'charging'].filter(Boolean).join(' ');
                return (
                  <div key={i} ref={top ? topRef : undefined} className={cls} style={style}
                    {...(top ? {
                      role: 'button', tabIndex: 0, onClick: onTap,
                      onKeyDown: (e: ReactKeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void advance(-1); } },
                      'aria-label': flipped ? `${card.name}, ${rarityLabel(L, card.rarity_id)}. Carte suivante` : `Retourner la carte ${cur + 1}`,
                    } : { 'aria-hidden': true })}>
                    <span className="flip-inner">
                      <span className="flip-face"><CardBack /></span>
                      <span className="flip-face flip-front"><CardView card={card} copies={d.mine.get(card.id) ?? 0} isNew={it.is_new} tilt={top} size="full" /></span>
                    </span>
                  </div>
                );
              })}
              {fx && <span key={fx.key} className={`rare-banner ${rarClass(L, fx.id)}`}>{rarityLabel(L, fx.id)}</span>}
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
                <li key={i} className={`recap-item ${rClass(L, card)}`}>
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
