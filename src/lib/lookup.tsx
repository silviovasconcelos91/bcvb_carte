import { createContext, useContext } from 'react';
import type { Card, CardSet, Rarity } from './types';
import { pad2 } from './format';

// Ce dont les visuels de cartes ont besoin, fourni par le jeu comme par la console
export interface Lookup {
  rarityById: Map<number, Rarity>;
  setById: Map<number, CardSet>;
  setCount: Map<number, number>; // total affiché d'une série : cartes secrètes non comptées
  urls: Record<string, string>;
}

export const EMPTY_LOOKUP: Lookup = { rarityById: new Map(), setById: new Map(), setCount: new Map(), urls: {} };
export const LookupContext = createContext<Lookup>(EMPTY_LOOKUP);
export const useLookup = () => useContext(LookupContext);

// Comme dans un vrai jeu de cartes, une carte secrète porte un numéro au-delà du total de sa série (« 19/18 »)
export function makeLookup(rarities: Rarity[], sets: CardSet[], cards: Pick<Card, 'set_id' | 'rarity_id'>[], urls: Record<string, string> = {}): Lookup {
  const rarityById = new Map(rarities.map(r => [r.id, r]));
  const setCount = new Map<number, number>();
  for (const c of cards) if (!isSecret({ rarityById }, c)) setCount.set(c.set_id, (setCount.get(c.set_id) ?? 0) + 1);
  return { rarityById, setById: new Map(sets.map(s => [s.id, s])), setCount, urls };
}

// Rareté inconnue comptée comme secrète : elle n'entre pas dans les totaux
export const isSecret = (L: Pick<Lookup, 'rarityById'>, c: Pick<Card, 'rarity_id'>) => (c.rarity_id ? L.rarityById.get(c.rarity_id)?.is_secret ?? false : true);

// Vignette pour les petits affichages, photo complète en grand.
// Sans vignette (photo envoyée avant leur création) ou sans URL signée pour elle, on prend la photo.
export type ArtSize = 'thumb' | 'full';
type Art = Pick<Card, 'image_path' | 'thumb_path'>;
export function artUrl(L: Pick<Lookup, 'urls'>, c: Art, size: ArtSize = 'thumb'): string | undefined {
  const thumb = size === 'thumb' && c.thumb_path ? L.urls[c.thumb_path] : undefined;
  return thumb ?? (c.image_path ? L.urls[c.image_path] : undefined);
}
// Photos et vignettes à signer : signer ne télécharge rien, seul l'affichage coûte de la bande passante
export const artPaths = (cards: Art[]) => cards.flatMap(c => [c.image_path, c.thumb_path]).filter((p): p is string => !!p);

export const rarityLabel =(L: Lookup, id: number | null | undefined) => (id ? L.rarityById.get(id)?.label ?? '' : '');
export const rarText = (L: Lookup, c: Pick<Card, 'rarity_id'>) => (c.rarity_id ? rarityLabel(L, c.rarity_id) : 'Rareté inconnue');
export const cardName = (c: Pick<Card, 'masked' | 'number' | 'name'>) => (c.masked ? `Carte ${pad2(c.number)}` : c.name);
// Catalogue des effets de cartes. Chaque effet s'appuie sur un niveau (1 à 6, classes .r1 à .r6 du CSS)
// qui règle les calques de base, les gemmes et l'ampleur de la révélation du booster ; les effets 7 et plus
// ajoutent leur propre habillage (classe .fxN). La couleur de la rareté teinte l'effet.
export const EFFECTS = [
  { id: 1, level: 1, label: 'Mat', desc: 'Carte sobre, sans brillance', color: '#8C97A6' },
  { id: 2, level: 2, label: 'Reflet', desc: 'Un reflet balaie le cadre', color: '#2E9E6B' },
  { id: 3, level: 3, label: 'Holo', desc: "Holo sur l'illustration et halo coloré", color: '#2F6FE0' },
  { id: 7, level: 3, label: 'Givré', desc: "Cadre glacé, cristaux de givre sur l'illustration", color: '#5BC0EB' },
  { id: 12, level: 3, label: 'Vitrail', desc: "Mosaïque de verre coloré sur l'illustration", color: '#18A999' },
  { id: 4, level: 4, label: 'Irisé', desc: 'Cadre irisé, gravure et arc-en-ciel, révélation avec flash', color: '#8B5CF6' },
  { id: 8, level: 4, label: 'Néon', desc: 'Cadre noir et tube néon qui grésille', color: '#FF2E88' },
  { id: 11, level: 4, label: 'Chrome', desc: 'Métal poli aux reflets mouvants, illustration brossée', color: '#8A9BB0' },
  { id: 14, level: 4, label: 'Glitch', desc: "Lignes de balayage, l'illustration se dédouble par instants", color: '#00C2E0' },
  { id: 16, level: 4, label: 'Verre brisé', desc: "Vitre étoilée depuis un point d'impact, reflet qui court dans les fissures", color: '#7FB8E6' },
  { id: 5, level: 5, label: 'Éclat', desc: 'Bande holo sur toute la carte, paillettes, pluie de pièces', color: '#E3A008' },
  { id: 9, level: 5, label: 'Galaxie', desc: 'Cadre étoilé, nébuleuse qui dérive, étoiles scintillantes', color: '#6A4CFF' },
  { id: 10, level: 5, label: 'Flamme', desc: 'Flammes qui dansent au pied de la carte, braises qui montent', color: '#FF5A1F' },
  { id: 13, level: 5, label: 'Aurore', desc: "Voiles d'aurore boréale qui ondulent sur un ciel de nuit", color: '#22D3A6' },
  { id: 15, level: 5, label: 'Obsidienne', desc: 'Pierre noire veinée de lumière, halo qui pulse', color: '#B026FF' },
  { id: 17, level: 5, label: 'Côté obscur', desc: "Une ombre gagne la moitié du visage, l'illustration s'assombrit, fumée sur les bords", color: '#C1121F' },
  { id: 6, level: 6, label: 'Prisme', desc: 'Cadre sombre, prisme arc-en-ciel animé, confettis', color: '#8660FF' },
] as const;
export const MAX_EFFECT = 17;
const effectById = new Map<number, (typeof EFFECTS)[number]>(EFFECTS.map(e => [e.id, e]));
export const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

// Effet et couleur d'une rareté ; une base pas encore mise à jour retombe sur l'ancien rendu (effet = numéro)
export const fxOf = (r: Pick<Rarity, 'id'> & Partial<Pick<Rarity, 'effect'>>) => {
  const id = r.effect ?? Math.min(6, r.id);
  return effectById.has(id) ? id : 1;
};
export const fxInfo = (fx: number) => effectById.get(fx) ?? EFFECTS[0];
export const colorOf = (r: Pick<Rarity, 'id'> & Partial<Pick<Rarity, 'effect' | 'color'>>) => (isHex(r.color) ? r.color : fxInfo(fxOf(r)).color);
// Niveau (1 à 6) d'une rareté : calques de base, gemmes, ampleur de la révélation
export const effectOf = (L: Pick<Lookup, 'rarityById'>, id: number | null | undefined) => {
  if (!id) return 1;
  const r = L.rarityById.get(id);
  return r ? fxInfo(fxOf(r)).level : Math.min(6, id);
};
// Classes d'une rareté : niveau (r1 à r6), effet (fxN) et couleur (ridN, voir RarityStyles)
export const fxClass = (fx: number, rid: number) => `r${fxInfo(fx).level} fx${fx} rid${rid}`;
export const rarClass = (L: Pick<Lookup, 'rarityById'>, id: number | null | undefined) => {
  if (!id) return 'rx';
  const r = L.rarityById.get(id);
  return r ? fxClass(fxOf(r), id) : `r${Math.min(6, id)} rid${id}`;
};
export const rClass = (L: Pick<Lookup, 'rarityById'>, c: Pick<Card, 'rarity_id'>) => rarClass(L, c.rarity_id);

// Couleur de chaque rareté pour le CSS (sélecteur doublé : passe devant la couleur par défaut de l'effet)
export const rarityCss = (rarities: Iterable<Pick<Rarity, 'id' | 'effect' | 'color'>>) =>
  [...rarities].map(r => `.rid${r.id}.rid${r.id}{--hc:${colorOf(r)}}`).join('');
export function RarityStyles({ rarities }: { rarities?: Iterable<Pick<Rarity, 'id' | 'effect' | 'color'>> }) {
  const L = useLookup();
  return <style>{rarityCss(rarities ?? L.rarityById.values())}</style>;
}
export const cardStats = (c: Pick<Card, 'stats'>) =>
  Object.entries(c.stats || {}).filter(([k, v]) => k !== 'numero' && typeof v === 'number').slice(0, 4);
