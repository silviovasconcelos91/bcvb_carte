import { useMemo, useState } from 'react';
import type { DrawnCard, Rarity } from '../lib/types';
import { DEMO_CARDS, DEMO_RARITIES, DEMO_SETS, clone } from '../lib/demoData';
import { LookupContext, RarityStyles } from '../lib/lookup';
import type { GameApi } from '../api/game';
import { CardView } from '../components/visuals';
import { GameContext, indexGame, type GameCtx } from './context';
import { Reveal } from './Reveal';

// Page /demo : ouverture de booster simulée, sans compte ni base, pour essayer les effets
// Verre brisé (blessures) et Côté obscur sur téléphone. Rien n'est enregistré.
const UID = 'demo-page';
const GLASS: Rarity = { id: 7, code: 'blessure', label: 'Blessure', weight: 0, is_secret: false, effect: 16, color: null };
const DARK: Rarity = { id: 8, code: 'dark_side', label: 'Dark side', weight: 0, is_secret: false, effect: 17, color: null };

// Quelques joueurs de la démo habillés en blessure ou en dark side
const cards = clone(DEMO_CARDS);
const players = cards.filter(c => Object.keys(c.stats ?? {}).length);
const glassCards = players.slice(0, 2).map(c => ({ ...c, rarity_id: GLASS.id }));
const darkCards = players.slice(2, 4).map(c => ({ ...c, rarity_id: DARK.id }));
const special = new Map([...glassCards, ...darkCards].map(c => [c.id, c]));
const catalog = cards.map(c => special.get(c.id) ?? c);
const commons = catalog.filter(c => (c.rarity_id ?? 1) <= 3);
const topRares = catalog.filter(c => (c.rarity_id ?? 1) >= 4 && (c.rarity_id ?? 1) <= 6);

const PACKS: { label: string; desc: string; ids: () => number[]; god?: boolean }[] = [
  { label: 'God pack', desc: "Cinq cartes ultra rares ou mieux, avec l'ouverture dorée", ids: () => Array.from({ length: 5 }, () => pick(topRares, 1)[0]), god: true },
  { label: 'Booster complet', desc: 'Trois cartes ordinaires, puis une blessure et un dark side', ids: () => [...pick(commons, 3), glassCards[0].id, darkCards[0].id] },
  { label: 'Blessures', desc: 'Deux cartes blessure', ids: () => glassCards.map(c => c.id) },
  { label: 'Dark side', desc: 'Deux cartes dark side', ids: () => darkCards.map(c => c.id) },
];

function pick<T extends { id: number }>(list: T[], n: number) {
  return [...list].sort(() => Math.random() - 0.5).slice(0, n).map(c => c.id);
}

export default function RevealDemo() {
  const [drawn, setDrawn] = useState<DrawnCard[] | null>(null);
  const ctx = useMemo<GameCtx>(() => {
    const d = indexGame({
      settings: { booster_size: 5, free_booster_cooldown: '1 day' },
      rarities: [...clone(DEMO_RARITIES), GLASS, DARK], sets: clone(DEMO_SETS), cards: catalog,
      profiles: [{ id: UID, username: 'Démo', status: 'active', last_free_booster_at: null }], userCards: [], trades: [],
    }, UID, {});
    const noop = () => {};
    return {
      api: { mode: 'demo' } as GameApi, uid: UID, d, tab: 'booster', setTab: noop, refresh: async () => {},
      openCard: noop, openComposer: noop, showReveal: setDrawn, pendingCode: '', setPendingCode: noop,
    };
  }, []);

  const open = (ids: number[], god = false) => setDrawn(ids.map(id => {
    const c = ctx.d.cardById.get(id)!;
    return { card_id: c.id, name: c.name, rarity_id: c.rarity_id ?? 1, image_path: c.image_path, is_new: true, god_pack: god };
  }));

  return (
    <LookupContext.Provider value={ctx.d.lookup}>
      <RarityStyles />
      <GameContext.Provider value={ctx}>
        <main className="main demo-page">
          <h1 className="h2">Démo d'ouverture</h1>
          <p className="muted">Ouverture simulée : rien n'est enregistré, tu peux recommencer autant que tu veux.</p>
          <div className="demo-packs">
            {PACKS.map(p => (
              <button key={p.label} className="btn primary demo-pack" onClick={() => open(p.ids(), p.god)}>
                <strong>{p.label}</strong><span>{p.desc}</span>
              </button>
            ))}
          </div>
          <h2 className="h3">Les cartes</h2>
          <div className="demo-cards">
            {[...glassCards, ...darkCards].map(c => <CardView key={c.id} card={c} tilt />)}
          </div>
        </main>
        {drawn && <Reveal drawn={drawn} onClose={() => setDrawn(null)} />}
      </GameContext.Provider>
    </LookupContext.Provider>
  );
}
