import { createContext, useContext } from 'react';
import type { GameApi, GameData } from '../api/game';
import type { Card, DrawnCard, Profile } from '../lib/types';
import type { ComposerOpts } from './Composer';
import { makeLookup, type Lookup } from '../lib/lookup';

export interface GameIndex extends GameData {
  cardById: Map<number, Card>;
  profileById: Map<string, Profile>;
  owned: Map<string, Map<number, number>>; // membre -> carte -> exemplaires
  mine: Map<number, number>;
  me: Profile;
  lookup: Lookup;
}

export function indexGame(d: GameData, uid: string, urls: Record<string, string>): GameIndex {
  const cards = [...d.cards].sort((a, b) => a.set_id - b.set_id || (a.number ?? 0) - (b.number ?? 0));
  const cardById = new Map(cards.map(c => [c.id, c]));
  const owned = new Map<string, Map<number, number>>();
  for (const u of d.userCards) {
    if (!cardById.has(u.card_id)) continue;
    if (!owned.has(u.user_id)) owned.set(u.user_id, new Map());
    owned.get(u.user_id)!.set(u.card_id, u.quantity);
  }
  const profileById = new Map(d.profiles.map(p => [p.id, p]));
  const me = profileById.get(uid);
  if (!me) throw new Error('Ton profil est introuvable. Vérifie que le script schema.sql a bien été exécuté.');
  return { ...d, cards, cardById, profileById, owned, mine: owned.get(uid) ?? new Map(), me, lookup: makeLookup(d.rarities, d.sets, cards, urls) };
}

export type Tab = 'booster' | 'collection' | 'trades' | 'leaderboard';

export interface GameCtx {
  api: GameApi;
  uid: string;
  d: GameIndex;
  tab: Tab;
  setTab: (t: Tab) => void;
  refresh: () => Promise<void>;
  openCard: (id: number) => void;
  openComposer: (opts?: ComposerOpts) => void;
  showReveal: (cards: DrawnCard[]) => void;
  pendingCode: string;
  setPendingCode: (c: string) => void;
}

export const GameContext = createContext<GameCtx | null>(null);
export function useGame(): GameCtx {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('GameContext manquant');
  return ctx;
}

export const qtyOf = (d: GameIndex, uid: string, cid: number) => d.owned.get(uid)?.get(cid) ?? 0;
export const nameOf = (d: GameIndex, uid: string) => d.profileById.get(uid)?.username ?? 'Un membre';
// Propositions d'échange en attente, reçues ou envoyées par le membre
export const pendingTrades = (d: GameIndex, uid: string, side: 'received' | 'sent') =>
  d.trades.filter(t => t.status === 'pending' && (side === 'received' ? t.recipient_id : t.proposer_id) === uid);
