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
export const rClass = (c: Pick<Card, 'rarity_id'>) => (c.rarity_id ? `r${c.rarity_id}` : 'rx');
export const cardStats = (c: Pick<Card, 'stats'>) =>
  Object.entries(c.stats || {}).filter(([k, v]) => k !== 'numero' && typeof v === 'number').slice(0, 4);
