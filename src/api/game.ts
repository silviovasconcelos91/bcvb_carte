import { DEMO } from '../config';
import type { Card, CardRef, CardSet, CatalogRow, DrawnCard, Profile, Rarity, Settings, Trade, TradeItem, TradeSide, TradeStatus, UserCard } from '../lib/types';
import { fetchAll, getSupabase, must, sendLoginLink, signOut, signedUrls, watchSession } from '../lib/supabase';
import { DEMO_CARDS, DEMO_MEMBERS, DEMO_MESSAGES, DEMO_RARITIES, DEMO_SETS, clone, demoDraw, readStore, writeStore } from '../lib/demoData';
import { fmtDate, intervalMs } from '../lib/format';

export interface GameData {
  settings: Settings;
  rarities: Rarity[];
  sets: CardSet[];
  cards: Card[]; // catalogue : cartes possédées en entier, les autres masquées, secrètes non possédées absentes
  profiles: Profile[];
  userCards: UserCard[];
  trades: Trade[];
}

export interface GameApi {
  mode: 'supabase' | 'demo';
  init(onChange: (uid: string | null) => void): Promise<string | null>;
  sendLoginLink(email: string): Promise<void>;
  logout(): Promise<void>;
  load(): Promise<GameData>;
  openBooster(code: string | null): Promise<DrawnCard[]>;
  createTrade(to: string, offer: CardRef[], request: CardRef[], message: string | null): Promise<number>;
  acceptTrade(id: number): Promise<TradeStatus>;
  declineTrade(id: number): Promise<void>;
  cancelTrade(id: number): Promise<void>;
  imageUrls(paths: string[]): Promise<Record<string, string>>;
  // mode démo uniquement
  demo?: {
    members(): { id: string; username: string; count: number }[];
    preview(): { cards: Card[]; rarities: Rarity[]; sets: CardSet[] };
    loginAs(id: string): Promise<void>;
    unlock(): Promise<void>;
    reset(): Promise<void>;
  };
}

// Catalogue : les cartes possédées (renvoyées par my_cards()) en entier, les autres réduites
// à leur série, leur numéro et leur rareté. Les cartes secrètes non possédées n'y sont pas.
export function mergeCatalog(catalog: CatalogRow[], known: Card[]): Card[] {
  const full = new Map(known.map(c => [c.id, c]));
  return catalog.map(r => full.get(r.id) ?? {
    id: r.id, set_id: r.set_id, number: r.number, rarity_id: r.rarity_id, masked: true,
    name: '', subtitle: null, description: null, stats: {}, image_path: null, thumb_path: null, is_released: true, in_boosters: true,
  });
}

/* ------------------------------ Supabase ------------------------------ */
function createSupabaseGameApi(): GameApi {
  const sb = getSupabase();
  const rpc = async <T,>(name: string, params: Record<string, unknown>) => must<T>(await sb.rpc(name, params));
  return {
    mode: 'supabase',
    init: watchSession,
    sendLoginLink,
    logout: signOut,
    async load() {
      const [settings, rarities, sets, catalog, known, profiles, userCards, trades] = await Promise.all([
        sb.from('game_settings').select('*').single().then(r => must<Settings>(r)),
        sb.from('rarities').select('*').order('id').then(r => must<Rarity[]>(r)),
        sb.from('card_sets').select('*').order('id').then(r => must<CardSet[]>(r)),
        fetchAll<CatalogRow>(() => sb.rpc('card_catalog')),
        fetchAll<Card>(() => sb.rpc('my_cards')), // seules les cartes possédées, même pour un administrateur
        fetchAll<Profile>(() => sb.from('profiles').select('id, username, last_free_booster_at').order('username')),
        fetchAll<UserCard>(() => sb.from('user_cards').select('user_id, card_id, quantity').order('user_id').order('card_id')),
        fetchAll<Trade>(() => sb.from('trades').select('*, trade_items(side, card_id, quantity)').order('created_at', { ascending: false }).order('id')),
      ]);
      return { settings, rarities, sets, cards: mergeCatalog(catalog, known), profiles, userCards, trades };
    },
    openBooster: code => rpc<DrawnCard[]>('open_booster', { p_code: code || null }),
    createTrade: (to, offer, request, message) => rpc<number>('create_trade', { p_recipient: to, p_offer: offer, p_request: request, p_message: message || null }),
    acceptTrade: id => rpc<TradeStatus>('accept_trade', { p_trade_id: id }),
    declineTrade: async id => { await rpc('decline_trade', { p_trade_id: id }); },
    cancelTrade: async id => { await rpc('cancel_trade', { p_trade_id: id }); },
    imageUrls: signedUrls,
  };
}

/* -------------------------------- Démo -------------------------------- */
interface DemoDb {
  version: number;
  current: string | null;
  settings: Settings;
  rarities: Rarity[];
  sets: CardSet[];
  cards: Card[];
  profiles: Profile[];
  owned: Record<string, Record<number, number>>;
  discovered: Record<string, Record<number, boolean>>; // sert seulement au badge « Nouvelle »
  codes: { id: number; code: string; set_id: number | null; max_uses: number | null; uses_count: number; expires_at: string | null }[];
  redemptions: { code_id: number; user_id: string }[];
  trades: Trade[];
  nextTradeId: number;
}

function createDemoGameApi(): GameApi {
  const KEY = 'cartes-club-demo-react-v1';
  const fail = (msg: string): never => { throw new Error(msg); };
  const nowIso = () => new Date().toISOString();
  let db: DemoDb;
  const save = () => writeStore(KEY, db);
  const inv = (uid: string) => (db.owned[uid] ??= {});
  // Comme private.add_cards : "nouvelle" = jamais obtenue auparavant
  const add = (uid: string, cid: number, n: number) => {
    const seen = (db.discovered[uid] ??= {});
    const isNew = !seen[cid];
    seen[cid] = true;
    inv(uid)[cid] = (inv(uid)[cid] ?? 0) + n;
    return isNew;
  };
  const take = (uid: string, cid: number, n: number) => {
    const o = inv(uid);
    o[cid] -= n;
    if (!o[cid]) delete o[cid];
  };
  const profile = (id: string | null) => db.profiles.find(p => p.id === id);
  const draw = (setId: number | null) => demoDraw(db.cards, db.sets, db.rarities, setId);

  function seed() {
    db = {
      version: 1, current: null, settings: { booster_size: 5, free_booster_cooldown: '1 day' },
      rarities: clone(DEMO_RARITIES), sets: clone(DEMO_SETS), cards: clone(DEMO_CARDS),
      profiles: DEMO_MEMBERS.map(m => ({ ...m, last_free_booster_at: null })),
      owned: {}, discovered: {}, redemptions: [], trades: [], nextTradeId: 1,
      codes: [
        { id: 1, code: 'MATCH-14NOV', set_id: null, max_uses: null, uses_count: 0, expires_at: null },
        { id: 2, code: 'NOEL26', set_id: 2, max_uses: null, uses_count: 0, expires_at: null },
      ],
    };
    for (const p of db.profiles) for (let i = 0; i < 14; i++) add(p.id, draw(null).id, 1);
    // Chaque membre reçoit une proposition d'échange du membre suivant
    db.profiles.forEach((rec, i) => {
      const pro = db.profiles[(i + 1) % db.profiles.length];
      const pInv = inv(pro.id), rInv = inv(rec.id);
      const offerId = +Object.keys(pInv).sort((a, b) => pInv[+b] - pInv[+a])[0];
      const wanted = Object.keys(rInv).map(Number).filter(c => !pInv[c] && c !== offerId);
      const requestId = wanted.length ? wanted[Math.floor(Math.random() * wanted.length)] : +(Object.keys(rInv).find(c => +c !== offerId) ?? 0);
      if (!offerId || !requestId) return;
      db.trades.push({
        id: db.nextTradeId++, proposer_id: pro.id, recipient_id: rec.id, status: 'pending',
        message: DEMO_MESSAGES[i % DEMO_MESSAGES.length], created_at: new Date(Date.now() - (i + 1) * 47 * 6e4).toISOString(), resolved_at: null,
        trade_items: [{ side: 'offer', card_id: offerId, quantity: 1 }, { side: 'request', card_id: requestId, quantity: 1 }],
      });
    });
    save();
  }
  const stored = readStore<DemoDb>(KEY);
  if (stored?.version === 1) db = stored; else seed();

  return {
    mode: 'demo',
    async init() { return db.current; },
    async sendLoginLink() {},
    async logout() { db.current = null; save(); },
    async load() {
      const me = db.current ?? '';
      const userCards: UserCard[] = [];
      for (const [uid, o] of Object.entries(db.owned)) for (const [cid, q] of Object.entries(o)) userCards.push({ user_id: uid, card_id: +cid, quantity: q });
      // Comme card_catalog(), my_cards() et la RLS : visibilité selon la possession actuelle,
      // cartes secrètes non possédées absentes du catalogue comme des collections des autres
      const mine = db.owned[me] ?? {};
      const secret = new Set(db.rarities.filter(r => r.is_secret).map(r => r.id));
      const hidden = (c: Card) => !mine[c.id] && secret.has(c.rarity_id ?? 0);
      const released = db.cards.filter(c => c.is_released && !hidden(c));
      const catalog = released.map(c => ({ id: c.id, set_id: c.set_id, number: c.number, rarity_id: c.rarity_id, owned: !!mine[c.id] }));
      const visible = new Set(released.map(c => c.id));
      return clone({
        settings: db.settings, rarities: db.rarities, sets: db.sets, profiles: db.profiles,
        userCards: userCards.filter(u => u.user_id === me || visible.has(u.card_id)),
        cards: mergeCatalog(catalog, released.filter(c => mine[c.id])),
        trades: db.trades.filter(t => t.proposer_id === me || t.recipient_id === me).sort((a, b) => b.created_at.localeCompare(a.created_at)),
      });
    },
    async openBooster(code) {
      const me = db.current ?? fail('Connexion requise');
      const p = profile(me) ?? fail('Profil introuvable');
      let row: DemoDb['codes'][number] | undefined;
      if (code && code.trim()) {
        row = db.codes.find(c => c.code.toUpperCase() === code.trim().toUpperCase()) ?? fail('Code inconnu');
        if (row.expires_at && Date.parse(row.expires_at) < Date.now()) fail('Code expiré');
        if (row.max_uses != null && row.uses_count >= row.max_uses) fail('Code épuisé');
        if (db.redemptions.some(r => r.code_id === row!.id && r.user_id === me)) fail('Code déjà utilisé');
      } else {
        const next = p.last_free_booster_at ? Date.parse(p.last_free_booster_at) + intervalMs(db.settings.free_booster_cooldown) : 0;
        if (next > Date.now()) fail(`Prochain booster gratuit le ${fmtDate(next)}`);
      }
      const drawn = Array.from({ length: db.settings.booster_size }, () => draw(row ? row.set_id : null));
      if (row) { db.redemptions.push({ code_id: row.id, user_id: me }); row.uses_count++; } else p.last_free_booster_at = nowIso();
      const result = drawn.map(c => ({ card_id: c.id, name: c.name, rarity_id: c.rarity_id ?? 1, image_path: c.image_path, is_new: add(me, c.id, 1) }));
      save();
      return clone(result);
    },
    async createTrade(to, offer, request, message) {
      const me = db.current ?? fail('Connexion requise');
      if (!to || to === me || !profile(to)) fail('Destinataire invalide');
      if (!offer.length && !request.length) fail('Échange vide');
      const items: TradeItem[] = [];
      for (const [side, list] of [['offer', offer], ['request', request]] as [TradeSide, CardRef[]][]) {
        const agg = new Map<number, number>();
        for (const x of list) agg.set(x.card_id, (agg.get(x.card_id) ?? 0) + (x.quantity || 1));
        for (const [card_id, quantity] of agg) items.push({ side, card_id, quantity });
      }
      for (const it of items) {
        if ((inv(it.side === 'offer' ? me : to)[it.card_id] ?? 0) < it.quantity) fail(`Carte ${it.card_id} : pas assez d'exemplaires pour cet échange`);
      }
      const t: Trade = { id: db.nextTradeId++, proposer_id: me, recipient_id: to, status: 'pending', message: message?.trim() || null, created_at: nowIso(), resolved_at: null, trade_items: items };
      db.trades.push(t);
      save();
      return t.id;
    },
    async acceptTrade(id) {
      const t = db.trades.find(x => x.id === id);
      if (!t || t.recipient_id !== db.current) return fail('Échange introuvable');
      if (t.status !== 'pending') fail(`Échange déjà traité (${t.status})`);
      const giver = (it: TradeItem) => (it.side === 'offer' ? t.proposer_id : t.recipient_id);
      const taker = (it: TradeItem) => (it.side === 'offer' ? t.recipient_id : t.proposer_id);
      t.resolved_at = nowIso();
      if (!t.trade_items.every(it => (inv(giver(it))[it.card_id] ?? 0) >= it.quantity)) { t.status = 'failed'; save(); return 'failed'; }
      for (const it of t.trade_items) { take(giver(it), it.card_id, it.quantity); add(taker(it), it.card_id, it.quantity); }
      t.status = 'accepted';
      save();
      return 'accepted';
    },
    async declineTrade(id) {
      const t = db.trades.find(x => x.id === id && x.recipient_id === db.current && x.status === 'pending') ?? fail('Échange introuvable ou déjà traité');
      Object.assign(t, { status: 'declined', resolved_at: nowIso() });
      save();
    },
    async cancelTrade(id) {
      const t = db.trades.find(x => x.id === id && x.proposer_id === db.current && x.status === 'pending') ?? fail('Échange introuvable ou déjà traité');
      Object.assign(t, { status: 'cancelled', resolved_at: nowIso() });
      save();
    },
    async imageUrls() { return {}; },
    demo: {
      members: () => db.profiles.map(p => ({ id: p.id, username: p.username, count: Object.values(inv(p.id)).reduce((a, b) => a + b, 0) })),
      preview: () => clone({ cards: db.cards.filter(c => c.is_released), rarities: db.rarities, sets: db.sets }),
      async loginAs(id) { db.current = id; save(); },
      async unlock() { const p = profile(db.current); if (p) p.last_free_booster_at = null; save(); },
      async reset() { try { localStorage.removeItem(KEY); } catch { /* rien à effacer */ } seed(); },
    },
  };
}

export const createGameApi = (): GameApi => (DEMO ? createDemoGameApi() : createSupabaseGameApi());
