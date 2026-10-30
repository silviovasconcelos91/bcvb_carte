import type { Card, CardSet, Rarity, Stats } from './types';

// Données fictives du mode démo (aucun lien avec de vrais membres)
export const DEMO_RARITIES: Rarity[] = [
  { id: 1, code: 'common', label: 'Commune', weight: 60, is_secret: false, effect: 1, color: null },
  { id: 2, code: 'uncommon', label: 'Peu commune', weight: 25, is_secret: false, effect: 2, color: null },
  { id: 3, code: 'rare', label: 'Rare', weight: 10, is_secret: false, effect: 3, color: null },
  { id: 4, code: 'ultra_rare', label: 'Ultra rare', weight: 4, is_secret: false, effect: 4, color: null, in_god_pack: true },
  { id: 5, code: 'legendary', label: 'Légendaire', weight: 1, is_secret: false, effect: 5, color: null, in_god_pack: true },
  { id: 6, code: 'secret', label: 'Secrète', weight: 0.5, is_secret: true, effect: 6, color: null, in_god_pack: true },
];

// Sous-titres de départ de la console (même liste que supabase/schema.sql)
export const DEMO_SUBTITLES = ['Passeur', 'Passeuse', 'Libéro', 'Central', 'Centrale', 'Pointu', 'Pointue', 'Réceptionneur-attaquant', 'Réceptionneuse-attaquante', 'Capitaine', 'Entraîneur', 'Entraîneuse', 'Action', 'Moment', 'Lieu', 'Équipement'];

export const DEMO_SETS: CardSet[] = [
  { id: 1, name: 'Saison 2026-27', in_boosters: true },
  { id: 2, name: 'Tournoi de Noël', in_boosters: true },
];

type Row = [number, number, string, string, number, Stats | null, string | null];
const ROWS: Row[] = [
  [1, 1, 'Ballon de match', 'Équipement', 1, null, 'Gonflé à 0,30 bar. Pas un gramme de plus.'],
  [1, 2, 'Le filet', 'Équipement', 1, null, '2,43 m chez les hommes, 2,24 m chez les femmes. Il ne pardonne rien.'],
  [1, 3, 'Manchette parfaite', 'Action', 1, null, 'Bras tendus, genoux fléchis, et le ballon arrive pile sur la passeuse.'],
  [1, 4, 'Service flottant', 'Action', 1, null, 'Aucune rotation, trajectoire imprévisible. En face, la réception transpire.'],
  [1, 5, 'Le gymnase un mardi soir', 'Lieu', 1, null, 'Néons à moitié allumés et odeur de résine.'],
  [1, 6, "L'échauffement", 'Moment', 1, null, "Trois tours de terrain, et c'est toujours trop court."],
  [1, 7, 'Léa', 'Passeuse', 2, { numero: 4, passe: 9, service: 6, defense: 7, attaque: 4 }, null],
  [1, 8, 'Malik', 'Central', 2, { numero: 11, bloc: 9, attaque: 8, service: 6, reception: 3 }, null],
  [1, 9, 'Sam', 'Libéro', 2, { numero: 1, reception: 9, defense: 9, passe: 6 }, null],
  [1, 10, 'Ace décisif', 'Action', 2, null, 'Balle de set, et le service tombe pile sur la ligne de fond.'],
  [1, 11, 'La buvette', 'Lieu', 2, null, 'Crêpes au sucre et café à un euro. Le vrai centre du club.'],
  [1, 12, 'Contre gagnant', 'Action', 3, null, 'Deux paires de mains au-dessus du filet, et le ballon redescend chez eux.'],
  [1, 13, 'Jade', 'Pointue', 3, { numero: 9, attaque: 9, service: 8, bloc: 6, reception: 4 }, null],
  [1, 14, 'Nora', 'Réceptionneuse-attaquante', 3, { numero: 7, reception: 8, attaque: 8, service: 7, defense: 7 }, null],
  [1, 15, 'Coach Martin', 'Entraîneur', 3, { tactique: 9, temps_morts: 8, patience: 3 }, null],
  [1, 16, 'Yanis', 'Capitaine', 4, { numero: 10, attaque: 8, reception: 8, service: 8, bloc: 7 }, null],
  [1, 17, 'Remontée historique', 'Moment', 4, null, 'Menés 14\u201122, ils remportent le set 26\u201124.'],
  [1, 18, 'Le trophée du club', 'Moment', 5, null, "Champions de la poule. Personne n'a oublié le tie-break."],
  [2, 1, 'Bonnet de Noël', 'Équipement', 1, null, 'Obligatoire pendant le tournoi, même au service.'],
  [2, 2, 'Match en pyjama', 'Moment', 2, null, 'Le règlement ne disait rien contre.'],
  [2, 3, 'Le Père Noël au service', 'Action', 3, null, 'Service smashé, hotte comprise.'],
  [1, 19, 'La mascotte', 'Moment', 6, null, 'Personne ne sait qui se cache dedans.'],
];

export const DEMO_CARDS: Card[] = ROWS.map(([set_id, number, name, subtitle, rarity_id, stats, description], i) => ({
  id: i + 1, set_id, number, name, subtitle, rarity_id, stats: stats ?? {}, description,
  image_path: null, thumb_path: null, is_released: true, in_boosters: true,
}));

export const DEMO_MEMBERS = [
  { id: 'demo-camille', username: 'Camille' },
  { id: 'demo-hugo', username: 'Hugo' },
  { id: 'demo-ines', username: 'Inès' },
  { id: 'demo-theo', username: 'Théo' },
];

export const DEMO_MESSAGES = ['Il me manque celle-là pour finir la série !', 'Je te donne mon double ?', null, 'Échange rapide avant le match de samedi ?'];

// Tirage identique à private.draw_card : rareté pondérée, puis carte au hasard dans cette rareté
// Cartes que peut donner un booster : publiées, dans les boosters, de la série demandée (null : séries in_boosters)
function boosterPool(cards: Card[], sets: CardSet[], setId: number | null) {
  const setById = new Map(sets.map(s => [s.id, s]));
  return cards.filter(c => c.is_released && c.in_boosters !== false && (setId == null ? setById.get(c.set_id)?.in_boosters : c.set_id === setId));
}

// Comme private.god_pack_possible : une carte disponible d'une rareté in_god_pack de poids non nul
export function demoGodPackPossible(cards: Card[], sets: CardSet[], rarities: Rarity[], setId: number | null) {
  const pool = boosterPool(cards, sets, setId);
  return rarities.some(r => r.in_god_pack && r.weight > 0 && pool.some(c => c.rarity_id === r.id));
}

export function demoDraw(cards: Card[], sets: CardSet[], rarities: Rarity[], setId: number | null, godPack = false): Card {
  const pool = boosterPool(cards, sets, setId);
  const rars = rarities.filter(r => r.weight > 0 && (!godPack || r.in_god_pack) && pool.some(c => c.rarity_id === r.id));
  if (!rars.length) throw new Error('Aucune carte disponible pour ce booster');
  let x = Math.random() * rars.reduce((s, r) => s + r.weight, 0);
  let pick = rars[rars.length - 1];
  for (const r of rars) {
    x -= r.weight;
    if (x < 0) { pick = r; break; }
  }
  const choices = pool.filter(c => c.rarity_id === pick.id);
  return choices[Math.floor(Math.random() * choices.length)];
}

export const readStore = <T,>(key: string): T | null => {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
};
export const writeStore = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // stockage plein ou indisponible : la démo continue en mémoire
  }
};
export const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o)) as T;
