import { DEMO } from '../config';
import type { Card, CardRef, CardSet, CatalogRow, DrawnCard, Profile, Rarity, Settings, Trade, TradeItem, TradeSide, TradeStatus, UserCard } from '../lib/types';
import { fetchAll, getSupabase, must, signOut, signedUrls, watchSession } from '../lib/supabase';
import { changePassword, currentLoginId, signIn, signUp } from '../lib/auth';
import { DEMO_CARDS, DEMO_MEMBERS, DEMO_MESSAGES, DEMO_RARITIES, DEMO_SETS, clone, demoDraw, readStore, writeStore } from '../lib/demoData';
import { fmtDate, freeBoosters, intervalMs } from '../lib/format';

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
  signIn(identifiant: string, password: string): Promise<void>;
  signUp(pseudo: string, password: string, code: string): Promise<void>;
  logout(): Promise<void>;
  // Profil du compte connecté, lu seul : un compte en attente ne voit rien d'autre
  myProfile(uid: string): Promise<Profile | null>;
  loginId(): Promise<string>;
  rename(uid: string, username: string): Promise<void>;
  changePassword(password: string, confirm: string): Promise<void>;
  load(): Promise<GameData>;
  openBooster(code: string | null): Promise<DrawnCard[]>;
  createTrade(to: string, offer: CardRef[], request: CardRef[], message: string | null): Promise<number>;
  acceptTrade(id: number): Promise<TradeStatus>;
  declineTrade(id: number): Promise<void>;
  counterTrade(id: number, offer: CardRef[], request: CardRef[], message: string | null): Promise<number>;
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

const PROFILE_COLS = 'id, username, status, last_free_booster_at';
const renameError = (m: string) => (/check constraint|violates/i.test(m) ? 'Le pseudo doit faire entre 2 et 30 caractères.' : m);

/* ------------------------------ Supabase ------------------------------ */
function createSupabaseGameApi(): GameApi {
  const sb = getSupabase();
  const rpc = async <T,>(name: string, params: Record<string, unknown>) => must<T>(await sb.rpc(name, params));
  return {
    mode: 'supabase',
    init: watchSession,
    signIn,
    signUp,
    logout: signOut,
    myProfile: async uid => must<Profile | null>(await sb.from('profiles').select(PROFILE_COLS).eq('id', uid).maybeSingle()),
    loginId: currentLoginId,
    rename: async (uid, username) => { must(await sb.from('profiles').update({ username }).eq('id', uid).select('id').single(), renameError); },
    changePassword,
    async load() {
      const [settings, rarities, sets, catalog, known, profiles, userCards, trades] = await Promise.all([
        sb.from('game_settings').select('*').single().then(r => must<Settings>(r)),
        sb.from('rarities').select('*').order('id').then(r => must<Rarity[]>(r)),
        sb.from('card_sets').select('*').order('id').then(r => must<CardSet[]>(r)),
        fetchAll<CatalogRow>(() => sb.rpc('card_catalog')),
        fetchAll<Card>(() => sb.rpc('my_cards')), // seules les cartes possédées, même pour un administrateur
        fetchAll<Profile>(() => sb.from('profiles').select(PROFILE_COLS).order('username')),
        fetchAll<UserCard>(() => sb.from('user_cards').select('user_id, card_id, quantity').order('user_id').order('card_id')),
        fetchAll<Trade>(() => sb.from('trades').select('*, trade_items(side, card_id, quantity)').order('created_at', { ascending: false }).order('id')),
      ]);
      return { settings, rarities, sets, cards: mergeCatalog(catalog, known), profiles, userCards, trades };
    },
    openBooster: code => rpc<DrawnCard[]>('open_booster', { p_code: code || null }),
    createTrade: (to, offer, request, message) => rpc<number>('create_trade', { p_recipient: to, p_offer: offer, p_request: request, p_message: message || null }),
    acceptTrade: id => rpc<TradeStatus>('accept_trade', { p_trade_id: id }),
    declineTrade: async id => { await rpc('decline_trade', { p_trade_id: id }); },
    counterTrade: (id, offer, request, message) => rpc<number>('counter_trade', { p_trade_id: id, p_offer: offer, p_request: request, p_message: message || null }),
    cancelTrade: async id => { await rpc('cancel_trade', { p_trade_id: id }); },
    imageUrls: signedUrls,
  };
}

/* -------------------------------- Démo -------------------------------- */
interface DemoCode { id: number; code: string; set_id: number | null; card_count?: number | null; card_id?: number | null; max_uses: number | null; uses_count: number; expires_at: string | null }
// Codes de la démo : booster complet, booster d'une série, une carte d'une série, une carte précise
const DEMO_CODES: DemoCode[] = [
  { id: 1, code: 'MATCH-14NOV', set_id: null, card_count: null, card_id: null, max_uses: null, uses_count: 0, expires_at: null },
  { id: 2, code: 'NOEL26', set_id: 2, card_count: null, card_id: null, max_uses: null, uses_count: 0, expires_at: null },
  { id: 3, code: 'NOEL-1', set_id: 2, card_count: 1, card_id: null, max_uses: null, uses_count: 0, expires_at: null },
  { id: 4, code: 'SOIREE', set_id: null, card_count: null, card_id: 18, max_uses: null, uses_count: 0, expires_at: null },
];

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
  codes: DemoCode[];
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
      version: 1, current: null, settings: { booster_size: 5, free_booster_cooldown: '1 day', free_booster_max: 2 },
      rarities: clone(DEMO_RARITIES), sets: clone(DEMO_SETS), cards: clone(DEMO_CARDS),
      profiles: DEMO_MEMBERS.map(m => ({ ...m, status: 'active', last_free_booster_at: null })),
      owned: {}, discovered: {}, redemptions: [], trades: [], nextTradeId: 1,
      codes: clone(DEMO_CODES),
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
  if (stored?.version === 1) {
    db = stored;
    for (const p of db.profiles) p.status ??= 'active'; // démo enregistrée avant les statuts
    for (const c of DEMO_CODES) if (!db.codes.some(x => x.code === c.code)) db.codes.push(clone(c)); // codes ajoutés depuis
  } else seed();

  return {
    mode: 'demo',
    async init() { return db.current; },
    async signIn() { fail('Mode démo : choisis un membre fictif.'); },
    async signUp() { fail('Mode démo : la création de compte fonctionne avec Supabase.'); },
    async logout() { db.current = null; save(); },
    async myProfile(uid) { return clone(profile(uid) ?? null); },
    async loginId() { return ''; },
    async rename(uid, username) { const p = profile(uid) ?? fail('Profil introuvable'); p.username = username; save(); },
    async changePassword() { fail('Mode démo : pas de mot de passe.'); },
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
        const fb = freeBoosters(p.last_free_booster_at, db.settings);
        if (!fb.available) fail(`Prochain booster gratuit le ${fmtDate(Date.now() + fb.nextIn)}`);
      }
      // Comme open_booster : carte précise (publiée, sinon échec sans consommer le code), nombre choisi ou booster complet
      let drawn: Card[];
      if (row?.card_id != null) {
        const card = db.cards.find(c => c.id === row!.card_id);
        if (!card || !card.is_released) return fail("La carte de ce code n'est pas encore disponible");
        drawn = [card];
      } else drawn = Array.from({ length: row?.card_count ?? db.settings.booster_size }, () => draw(row ? row.set_id : null));
      if (row) { db.redemptions.push({ code_id: row.id, user_id: me }); row.uses_count++; } else {
        // Avance l'horloge de recharge d'un délai (voir open_booster)
        const cd = intervalMs(db.settings.free_booster_cooldown);
        const max = Math.max(1, db.settings.free_booster_max ?? 1);
        const clock = Math.max(p.last_free_booster_at ? Date.parse(p.last_free_booster_at) : -Infinity, Date.now() - max * cd);
        p.last_free_booster_at = new Date(clock + cd).toISOString();
      }
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
    async counterTrade(id, offer, request, message) {
      const t = db.trades.find(x => x.id === id && x.recipient_id === db.current && x.status === 'pending') ?? fail('Échange introuvable ou déjà traité');
      const newId = await this.createTrade(t.proposer_id, offer, request, message);
      db.trades.find(x => x.id === newId)!.counter_of = id;
      Object.assign(t, { status: 'countered', resolved_at: nowIso() });
      save();
      return newId;
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
