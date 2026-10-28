import type { Card, Rarity } from '../lib/types';
import { CONFIG } from '../config';
import { initial, pad2, statLabel } from '../lib/format';
import { artUrl, cardStats, effectOf, fxInfo, fxOf, rarClass, rarityLabel, useLookup, type ArtSize } from '../lib/lookup';
import { useTilt } from './useTilt';

// Ballon aux couleurs du club : cercle blanc et trois bandes courbes
function Ball({ cx, cy, r }: { cx: number; cy: number; r: number }) {
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
const LOGO_URL = '/logo.png';
export const Logo = () => (
  <img className="logo" src={LOGO_URL} alt="" aria-hidden="true" />
);

// Pastille avec l'initiale d'un membre, décorative : le nom est toujours écrit à côté
export const Avatar = ({ name, small = false }: { name: string | null | undefined; small?: boolean }) => (
  <span className={small ? 'avatar sm' : 'avatar'} aria-hidden="true">{initial(name)}</span>
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
function CardArtSvg({ card }: { card: Pick<Card, 'subtitle' | 'stats' | 'name'> }) {
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

// Losanges d'une rareté : texte libre s'il y en a un, sinon le nombre choisi, sinon selon le niveau de l'effet
export function Gems({ r }: { r: Pick<Rarity, 'id'> & Partial<Pick<Rarity, 'effect' | 'gems' | 'badge'>> | undefined }) {
  if (!r) return null;
  const badge = r.badge?.trim();
  if (badge) return <b>{badge}</b>;
  const level = fxInfo(fxOf(r)).level;
  if (r.gems == null) return level >= 6 ? <i className="secret" /> : <>{Array.from({ length: level }, (_, i) => <i key={i} />)}</>;
  return <>{Array.from({ length: r.gems }, (_, i) => <i key={i} className={level >= 6 ? 'prism' : undefined} />)}</>;
}
export const RarityGems = ({ id }: { id: number | null | undefined }) => {
  const L = useLookup();
  return <Gems r={id ? L.rarityById.get(id) ?? { id } : undefined} />;
};

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

// Médaille cachée : récompense discrète des membres qui accumulent une même carte (jamais annoncée dans le jeu)
const MEDALS = [
  { min: 200, tier: 'diamond', label: 'Médaille de diamant' },
  { min: 100, tier: 'platinum', label: 'Médaille de platine' },
  { min: 50, tier: 'gold', label: "Médaille d'or" },
  { min: 25, tier: 'silver', label: "Médaille d'argent" },
  { min: 10, tier: 'bronze', label: 'Médaille de bronze' },
] as const;
export const medalOf = (copies: number) => MEDALS.find(m => copies >= m.min) ?? null;

interface CardViewProps {
  card: Card;
  qty?: number;
  copies?: number; // exemplaires possédés, pour la médaille (par défaut qty)
  isNew?: boolean;
  tilt?: boolean;
  size?: ArtSize; // 'full' pour les grands affichages : carte retournée, fiche, aperçu de l'éditeur
}

export function CardView({ card, qty = 0, copies = qty, isNew = false, tilt = false, size = 'thumb' }: CardViewProps) {
  const L = useLookup();
  const tiltProps = useTilt(tilt);
  const set = L.setById.get(card.set_id);
  const stats = cardStats(card);
  const url = artUrl(L, card, size);
  const r = effectOf(L, card.rarity_id);
  const medal = medalOf(copies);
  return (
    <div className={`card ${rarClass(L, card.rarity_id ?? 1)}${medal ? ` tier-${medal.tier}` : ''}`} {...tiltProps}>
      {medal && <span className="card-aura" aria-hidden="true" />}
      <div className="card-body">
        <div className="card-face">
          <div className="card-top">
            <span className="card-name">{card.name}</span>
            <span className="gems" title={rarityLabel(L, card.rarity_id)}><RarityGems id={card.rarity_id ?? 1} /></span>
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
        {medal && <div className="card-tier" aria-hidden="true" />}
      </div>
      {qty > 1 && <span className="qty">×{qty}</span>}
      {isNew && <span className="new-badge">Nouvelle</span>}
      {medal && <span className={`medal ${medal.tier}`} title={`${medal.label} : ${medal.min} exemplaires`}><span>{medal.min}</span></span>}
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

// tone : couleurs de la pochette (0 = couleurs du club, voir .pack.tone1 et suivants) ; ribbon : bandeau en coin
export function Pack({ setLabel, tone = 0, ribbon }: { setLabel: string; tone?: number; ribbon?: string }) {
  return (
    <div className={tone ? `pack tone${tone}` : 'pack'} aria-hidden="true">
      <div className="pack-crimp" />
      <div className="pack-body">
        <div className="pack-bands" />
        <img className="pack-logo" src={LOGO_URL} alt="" />
        <div className="pack-name">Booster</div>
        <div className="pack-set">{setLabel}</div>
      </div>
      <div className="pack-crimp bottom" />
      <div className="pack-foil" />
      {ribbon && <div className="pack-ribbon">{ribbon}</div>}
    </div>
  );
}
