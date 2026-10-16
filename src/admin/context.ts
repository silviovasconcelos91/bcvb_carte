import { createContext, useContext } from 'react';
import type { AdminApi, AdminData } from '../api/admin';
import type { BoosterCode, Card, Profile } from '../lib/types';
import { makeLookup, type Lookup } from '../lib/lookup';

export interface AdminIndex extends AdminData {
  cardById: Map<number, Card>;
  profileById: Map<string, Profile>;
  owned: Map<string, Map<number, number>>;
  owners: Map<number, number>; // carte -> nombre de membres qui l'ont
  adminSet: Set<string>;
  me: Profile | undefined;
  lookup: Lookup;
}

export function indexAdmin(d: AdminData, uid: string, urls: Record<string, string>): AdminIndex {
  d.cards.sort((a, b) => a.set_id - b.set_id || (a.number ?? 0) - (b.number ?? 0));
  const owned = new Map<string, Map<number, number>>();
  const owners = new Map<number, number>();
  for (const u of d.userCards) {
    if (!owned.has(u.user_id)) owned.set(u.user_id, new Map());
    owned.get(u.user_id)!.set(u.card_id, u.quantity);
    owners.set(u.card_id, (owners.get(u.card_id) ?? 0) + 1);
  }
  const profileById = new Map(d.profiles.map(p => [p.id, p]));
  return {
    ...d, owned, owners, profileById, adminSet: new Set(d.admins), me: profileById.get(uid),
    cardById: new Map(d.cards.map(c => [c.id, c])), lookup: makeLookup(d.rarities, d.sets, d.cards, urls),
  };
}

export type AdminTab = 'dashboard' | 'cards' | 'sets' | 'rarities' | 'codes' | 'members' | 'settings';

export interface AdminCtx {
  api: AdminApi;
  d: AdminIndex;
  refresh: () => Promise<void>;
  setTab: (t: AdminTab) => void;
}
export const AdminContext = createContext<AdminCtx | null>(null);
export function useAdmin(): AdminCtx {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error('AdminContext manquant');
  return ctx;
}

export const nameOf = (d: AdminIndex, uid: string) => d.profileById.get(uid)?.username ?? 'Membre';

export function codeStatus(c: BoosterCode): 'active' | 'expired' | 'used' {
  if (c.expires_at && Date.parse(c.expires_at) < Date.now()) return 'expired';
  if (c.max_uses != null && c.uses_count >= c.max_uses) return 'used';
  return 'active';
}
export const CODE_STATUS = { active: 'Actif', expired: 'Expiré', used: 'Épuisé' } as const;

// Cartes qui peuvent tomber dans un booster standard
export function boosterPool(d: AdminIndex) {
  const sets = d.lookup.setById;
  return d.cards.filter(c => c.is_released && c.in_boosters !== false && sets.get(c.set_id)?.in_boosters);
}
