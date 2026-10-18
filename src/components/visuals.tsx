import type { CSSProperties } from 'react';
import type { Card } from '../lib/types';
import { CONFIG } from '../config';
import { initial, pad2, statLabel } from '../lib/format';
import { artUrl, cardStats, effectOf, rarClass, rarityLabel, useLookup, type ArtSize } from '../lib/lookup';
import { useTilt } from './useTilt';

// Ballon aux couleurs du club : cercle blanc et trois bandes courbes
export function Ball({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  const k = r / 30;
  const p = (x: number, y: number) => `${(cx + (x - 50) * k).toFixed(1)} ${(cy + (y - 50) * k).toFixed(1)}`;
  const band = (a: [number, number], b: [number, number], c: [number, number], color: string) => (
    <path d={`M${p(...a)} Q${p(...b)} ${p(...c)}`} fill="none" stroke={color} strokeWidth={(8 * k).toFixed(1)} />
  );
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill="#fff" />
      {band([28, 34], [50, 23], [72, 34], '#1F5BD6')}
      {band([23, 52], [50, 40], [77, 52], '#0E2A66')}
      {band([28, 68], [50, 58], [72, 68], '#1F5BD6')}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#13213C" strokeOpacity={0.35} strokeWidth={(1.2 * k).toFixed(1)} />
    </g>
  );
}

// Blason du club (public/logo.png, fond détouré)
export const LOGO_URL = '/logo.png';
export const Logo = ({ className = 'logo' }: { className?: string }) => (
  <img className={className} src={LOGO_URL} alt="" aria-hidden="true" />
);

export const IconX = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
);
export const IconSwap = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8h15l-4-4M20 16H5l4 4" /></svg>
);

// Terrain vu de dessus, étiré à la zone : l'épaisseur des lignes reste constante
export const Court = () => (
  <svg className="stage-court" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
    <g fill="none" stroke="#fff" strokeOpacity={0.34} strokeWidth={1.5}>
      <rect x="5" y="9" width="90" height="82" vectorEffect="non-scaling-stroke" />
      <path d="M35 9v82M65 9v82" vectorEffect="non-scaling-stroke" />
    </g>
    <path d="M50 3v94" stroke="#fff" strokeOpacity={0.6} strokeWidth={3} vectorEffect="non-scaling-stroke" />
  </svg>
);

type ArtKind = 'ball' | 'court' | 'jersey';
function artKind(card: Pick<Card, 'subtitle'>): ArtKind {
  const s = (card.subtitle || '').toLowerCase();
  if (/équipement|equipement|action/.test(s)) return 'ball';
  if (/moment|lieu/.test(s)) return 'court';
  return 'jersey';
}

// Illustration de remplacement tant que la carte n'a pas de photo
export function CardArtSvg({ card }: { card: Pick<Card, 'subtitle' | 'stats' | 'name'> }) {
  const kind = artKind(card);
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <g fill="none" stroke="#fff" strokeOpacity={0.2} strokeWidth={0.8}>
        <rect x="14" y="8" width="72" height="84" />
        <path d="M14 50h72M14 36h72M14 64h72" />
      </g>
      {kind === 'jersey' && (
        <>
          <path d="M33 24 L43 18 Q50 24 57 18 L67 24 L82 35 L75 47 L67 42 L67 88 L33 88 L33 42 L25 47 L18 35 Z" fill="#fff" fillOpacity={0.95} />
          <text x="50" y="69" textAnchor="middle" fontFamily="'Barlow Condensed', 'Arial Narrow', sans-serif" fontWeight={800} fontSize={30} style={{ fill: 'var(--a1)' }}>
            {card.stats?.numero ?? initial(card.name)}
          </text>
        </>
      )}
      {kind === 'ball' && (
        <>
          <g stroke="#fff" strokeOpacity={0.75} strokeWidth={2.2} strokeLinecap="round"><path d="M12 40h16M8 50h18M12 60h16" /></g>
          <Ball cx={58} cy={50} r={25} />
        </>
      )}
      {kind === 'court' && (
        <>
          <g fill="none" stroke="#fff" strokeWidth={1.6}><rect x="24" y="16" width="52" height="68" rx="1" /><path d="M24 38.7h52M24 61.3h52" /></g>
          <path d="M18 50h64" stroke="#fff" strokeWidth={3} />
          <path d="M38 74 Q46 52 58 32" fill="none" stroke="#fff" strokeOpacity={0.6} strokeWidth={1.4} strokeDasharray="2 3" />
          <Ball cx={60} cy={28} r={8} />
        </>
      )}
    </svg>
  );
}

export const Gems = ({ n }: { n: number }) =>
  n >= 6 ? <i className="secret" /> : <>{Array.from({ length: n }, (_, i) => <i key={i} />)}</>;

const MASK_ART = (
  <svg viewBox="0 0 34 46" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <rect width="34" height="46" fill="#0E2A66" />
    <Ball cx={17} cy={23} r={8} />
  </svg>
);

// Petite vignette (listes, échanges) : vignette, illustration ou dos pour une carte masquée
export function MiniArt({ card }: { card: Card }) {
  const L = useLookup();
  if (card.masked) return MASK_ART;
  const url = artUrl(L, card);
  return url ? <img src={url} alt="" /> : <CardArtSvg card={card} />;
}

interface CardViewProps {
  card: Card;
  qty?: number;
  isNew?: boolean;
  tilt?: boolean;
  ghost?: boolean;
  size?: ArtSize; // 'full' pour les grands affichages : carte retournée, fiche, aperçu de l'éditeur
}

export function CardView({ card, qty = 0, isNew = false, tilt = false, ghost = false, size = 'thumb' }: CardViewProps) {
  const L = useLookup();
  const tiltProps = useTilt(tilt);
  const set = L.setById.get(card.set_id);
  const stats = cardStats(card);
  const url = artUrl(L, card, size);
  const r = effectOf(L, card.rarity_id);
  return (
    <div className={`card ${rarClass(L, card.rarity_id ?? 1)}${ghost ? ' is-ghost' : ''}`} {...tiltProps}>
      <div className="card-body">
        <div className="card-face">
          <div className="card-top">
            <span className="card-name">{card.name}</span>
            <span className="gems" title={rarityLabel(L, card.rarity_id)}><Gems n={r} /></span>
          </div>
          <div className="card-art">
            {url ? <img src={url} alt="" loading="lazy" /> : <CardArtSvg card={card} />}
            <span className="card-foil" aria-hidden="true" />
            {r >= 5 && <span className="card-sparkle" aria-hidden="true" />}
          </div>
          {card.subtitle && <p className="card-sub">{card.subtitle}</p>}
          {stats.length > 0 ? (
            <div className="card-stats">
              {stats.map(([k, v]) => (
                <div className="stat" key={k}>
                  <span>{statLabel(k)}</span>
                  <span className="stat-bar"><span style={{ width: `${Math.max(0, Math.min(10, v)) * 10}%` }} /></span>
                  <span className="stat-v">{v}</span>
                </div>
              ))}
            </div>
          ) : card.description ? <p className="card-desc">{card.description}</p> : null}
          <div className="card-foot">
            <span className="card-set">{set?.name ?? ''}</span>
            <span>{pad2(card.number)}/{pad2(L.setCount.get(card.set_id))}</span>
          </div>
        </div>
        {r >= 5 && <div className="card-holo" aria-hidden="true" />}
        <div className="card-fx" aria-hidden="true" />
        <div className="card-glare" aria-hidden="true" />
      </div>
      {qty > 1 && <span className="qty">×{qty}</span>}
      {isNew && <span className="new-badge">Nouvelle</span>}
    </div>
  );
}

export function CardBack() {
  return (
    <div className="card back">
      <div className="card-body">
        <svg className="back-art" viewBox="0 0 63 88" aria-hidden="true">
          <g fill="none" stroke="#fff" strokeOpacity={0.28} strokeWidth={0.5}>
            <rect x="5" y="5" width="53" height="78" rx="2" />
            <path d="M5 44h53M5 31h53M5 57h53" />
          </g>
          <path d="M2 44h59" stroke="#8DB8FF" strokeWidth={1.2} />
          <Ball cx={31.5} cy={44} r={11} />
          <text x="31.5" y="68" textAnchor="middle" fontFamily="'Barlow Condensed', 'Arial Narrow', sans-serif" fontWeight={800} fontSize={7} fill="#fff" letterSpacing=".4">
            {CONFIG.clubShort}
          </text>
        </svg>
      </div>
    </div>
  );
}

export function Pack({ setLabel, className = '', style }: { setLabel: string; className?: string; style?: CSSProperties }) {
  return (
    <div className={`pack ${className}`} style={style} aria-hidden="true">
      <div className="pack-crimp" />
      <div className="pack-body">
        <div className="pack-bands" />
        <img className="pack-logo" src={LOGO_URL} alt="" />
        <div className="pack-name">Booster</div>
        <div className="pack-set">{setLabel}</div>
      </div>
      <div className="pack-crimp bottom" />
      <div className="pack-foil" />
    </div>
  );
}
