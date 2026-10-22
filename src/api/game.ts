import { CONFIG, DEMO } from '../config';
import type { BoosterCode, Card, CardRef, CardSet, CatalogRow, DrawnCard, LeaderRow, Photo, Profile, Proposal, ProposalInput, Rarity, Settings, Subtitle, Trade, TradeItem, TradeSide, TradeStatus, UserCard } from '../lib/types';
import { fetchAll, getSupabase, must, signOut, signedUrls, watchSession } from '../lib/supabase';
import { changePassword, currentLoginId, signIn, signUp } from '../lib/auth';
import { DEMO_CARDS, DEMO_MEMBERS, DEMO_MESSAGES, DEMO_RARITIES, DEMO_SETS, DEMO_SUBTITLES, clone, demoDraw, readStore, writeStore } from '../lib/demoData';
import { fmtDate, freeBoosters, intervalMs, slug } from '../lib/format';

export const PROPOSAL_MAX = 5;
export const PROPOSAL_LIMIT_MSG = "Tu as déjà 5 propositions en cours d'examen. Tu pourras en proposer d'autres quand l'une d'elles aura été examinée.";

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
  // uid : le compte connecté ; seuls ses propres échanges sont chargés, même pour un administrateur
  load(uid: string): Promise<GameData>;
  openBooster(code: string | null): Promise<DrawnCard[]>;
  createTrade(to: string, offer: CardRef[], request: CardRef[], message: string | null): Promise<number>;
  acceptTrade(id: number): Promise<TradeStatus>;
  declineTrade(id: number): Promise<void>;
  counterTrade(id: number, offer: CardRef[], request: CardRef[], message: string | null): Promise<number>;
  cancelTrade(id: number): Promise<void>;
  // Classement d'une série active : membres ayant au moins une carte, du meilleur au moins bon
  leaderboard(setId: number): Promise<LeaderRow[]>;
  imageUrls(paths: string[]): Promise<Record<string, string>>;
  // Propositions de cartes du membre connecté, les plus anciennes d'abord
  myProposals(): Promise<Proposal[]>;
  propose(uid: string, input: ProposalInput, photo: Photo): Promise<void>;
  subtitles(): Promise<Subtitle[]>;
  // mode démo uniquement
  demo?: {
    members(): { id: string; username: string; count: number }[];
    preview(): { cards: Card[]; rarities: Rarity[]; sets: CardSet[] };
    loginAs(id: string): Promise<void>;
    unlock(): Promise<void>;
    reset(): Promise<void>;
  };
}

// Carte dont on ne connaît que quelques champs (catalogue masqué, tirage, carte mystère d'un échange)
export const partialCard = (c: Pick<Card, 'id'> & Partial<Card>): Card => ({
  set_id: 0, number: null, name: '', subtitle: null, description: null, image_path: null, thumb_path: null,
  rarity_id: null, stats: {}, is_released: true, in_boosters: true, ...c,
});

// Catalogue : les cartes possédées (renvoyées par my_cards()) en entier, les autres réduites
// à leur série, leur numéro et leur rareté. Les cartes secrètes non possédées n'y sont pas.
export function mergeCatalog(catalog: CatalogRow[], known: Card[]): Card[] {
  const full = new Map(known.map(c => [c.id, c]));
  return catalog.map(r => full.get(r.id) ?? partialCard({ id: r.id, set_id: r.set_id, number: r.number, rarity_id: r.rarity_id, masked: true }));
}

const PROFILE_COLS = 'id, username, status, last_free_booster_at';
// Seule la contrainte de longueur du pseudo est traduite ; les autres erreurs (droits, réseau…) restent telles quelles
const renameError = (m: string) => (/check constraint/i.test(m) ? 'Le pseudo doit faire entre 2 et 30 caractères.' : m);

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
    async load(uid) {
      const [settings, rarities, sets, catalog, known, profiles, userCards, trades] = await Promise.all([
        sb.from('game_settings').select('*').single().then(r => must<Settings>(r)),
        sb.from('rarities').select('*').order('id').then(r => must<Rarity[]>(r)),
        sb.from('card_sets').select('*').order('id').then(r => must<CardSet[]>(r)),
        fetchAll<CatalogRow>(() => sb.rpc('card_catalog')),
        fetchAll<Card>(() => sb.rpc('my_cards')), // seules les cartes possédées, même pour un administrateur
        fetchAll<Profile>(() => sb.from('profiles').select(PROFILE_COLS).order('username')),
        fetchAll<UserCard>(() => sb.from('user_cards').select('user_id, card_id, quantity').order('user_id').order('card_id')),
        fetchAll<Trade>(() => sb.from('trades').select('*, trade_items(side, card_id, quantity)').or(`proposer_id.eq.${uid},recipient_id.eq.${uid}`).order('created_at', { ascending: false }).order('id')),
      ]);
      return { settings, rarities, sets, cards: mergeCatalog(catalog, known), profiles, userCards, trades };
    },
    openBooster: code => rpc<DrawnCard[]>('open_booster', { p_code: code || null }),
    createTrade: (to, offer, request, message) => rpc<number>('create_trade', { p_recipient: to, p_offer: offer, p_request: request, p_message: message || null }),
    acceptTrade: id => rpc<TradeStatus>('accept_trade', { p_trade_id: id }),
    declineTrade: async id => { await rpc('decline_trade', { p_trade_id: id }); },
    counterTrade: (id, offer, request, message) => rpc<number>('counter_trade', { p_trade_id: id, p_offer: offer, p_request: request, p_message: message || null }),
    cancelTrade: async id => { await rpc('cancel_trade', { p_trade_id: id }); },
    leaderboard: setId => rpc<LeaderRow[]>('leaderboard', { p_set_id: setId }),
    imageUrls: signedUrls,
    myProposals: async () => must<Proposal[]>(await sb.from('card_proposals').select('*').order('created_at')),
    async subtitles() {
      const r = await sb.from('card_subtitles').select('*').order('label');
      return r.error ? [] : (r.data as Subtitle[]);
    },
    async propose(uid, input, photo) {
      // Limite vérifiée avant tout envoi de fichier (la base la re-vérifie à l'insertion)
      const { count, error } = await sb.from('card_proposals').select('id', { count: 'exact', head: true }).eq('user_id', uid);
      if (error) throw new Error(error.message);
      if ((count ?? 0) >= PROPOSAL_MAX) throw new Error(PROPOSAL_LIMIT_MSG);
      const base = `proposals/${uid}/${slug(input.name)}-${Date.now().toString(36)}`;
      const image_path = `${base}.jpg`, thumb_path = `${base}.thumb.jpg`;
      const opts = { contentType: 'image/jpeg', upsert: false, cacheControl: '604800' };
      for (const [path, blob] of [[image_path, photo.full], [thumb_path, photo.thumb]] as const) {
        must(await sb.storage.from(CONFIG.bucket).upload(path, blob, opts));
      }
      // Si l'insertion échoue, l'erreur remonte telle quelle : les fichiers restent orphelins (le membre ne peut pas les supprimer)
      must(await sb.from('card_proposals').insert({ ...input, user_id: uid, image_path, thumb_path }));
    },
  };
}

/* -------------------------------- Démo -------------------------------- */
type DemoCode = Pick<BoosterCode, 'id' | 'code' | 'set_id' | 'card_count' | 'card_id' | 'max_uses' | 'uses_count' | 'expires_at'>;
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
  proposals: Proposal[];
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
      owned: {}, discovered: {}, redemptions: [], trades: [], nextTradeId: 1, proposals: [],
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
    db.proposals ??= []; // démo enregistrée avant les propositions
    for (const p of db.profiles) p.status ??= 'active'; // démo enregistrée avant les statuts
    for (const c of DEMO_CODES) if (!db.codes.some(x => x.code === c.code)) db.codes.push(clone(c)); // codes ajoutés depuis
  } else seed();

  const api: GameApi = {
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
      let row: DemoCode | undefined;
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
      } else drawn = Array.from({ length: row?.card_count ?? db.settings.booster_size }, () => draw(row?.set_id ?? null));
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
      const newId = await api.createTrade(t.proposer_id, offer, request, message);
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
    // Comme leaderboard() : cartes publiées d'une série active, secrètes comprises, membres actifs seulement
    async leaderboard(setId) {
      if (!db.sets.some(s => s.id === setId && s.in_boosters)) return [];
      const inSet = new Set(db.cards.filter(c => c.set_id === setId && c.is_released).map(c => c.id));
      return db.profiles
        .filter(p => p.status === 'active')
        .map(p => ({ user_id: p.id, username: p.username, distinct_count: Object.keys(inv(p.id)).filter(cid => inSet.has(+cid)).length }))
        .filter(r => r.distinct_count > 0)
        .sort((a, b) => b.distinct_count - a.distinct_count || a.username.localeCompare(b.username));
    },
    async imageUrls() { return {}; },
    async myProposals() { return clone(db.proposals.filter(p => p.user_id === db.current)); },
    async subtitles() { return DEMO_SUBTITLES.map((label, i) => ({ id: i + 1, label })); },
    async propose(uid, input) {
      const me = db.current ?? fail('Connexion requise');
      if (uid !== me) fail('Connexion requise');
      if (db.proposals.filter(p => p.user_id === me).length >= PROPOSAL_MAX) fail(PROPOSAL_LIMIT_MSG);
      const rarity = db.rarities.find(r => r.id === input.rarity_id);
      if (!rarity || rarity.is_secret) fail('Rareté invalide');
      // Chemins fictifs : la démo n'affiche pas les photos
      const base = `proposals/${me}/${slug(input.name)}-${Date.now().toString(36)}`;
      db.proposals.push({
        ...clone(input), id: Math.max(0, ...db.proposals.map(p => p.id)) + 1, user_id: me, created_at: nowIso(),
        image_path: `${base}.jpg`, thumb_path: `${base}.thumb.jpg`,
      });
      save();
    },
    demo: {
      members: () => db.profiles.map(p => ({ id: p.id, username: p.username, count: Object.values(inv(p.id)).reduce((a, b) => a + b, 0) })),
      preview: () => clone({ cards: db.cards.filter(c => c.is_released), rarities: db.rarities, sets: db.sets }),
      async loginAs(id) { db.current = id; save(); },
      async unlock() { const p = profile(db.current); if (p) p.last_free_booster_at = null; save(); },
      async reset() { try { localStorage.removeItem(KEY); } catch { /* rien à effacer */ } seed(); },
    },
  };
  return api;
}

export const createGameApi = (): GameApi => (DEMO ? createDemoGameApi() : createSupabaseGameApi());
