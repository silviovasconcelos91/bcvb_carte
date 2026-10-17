import { CONFIG, DEMO } from '../config';
import type { BoosterCode, Card, CardSet, MemberStatus, Opening, Profile, Rarity, Settings, UserCard } from '../lib/types';
import { fetchAll, getSupabase, must, signOut, signedUrls, watchSession } from '../lib/supabase';
import { signIn } from '../lib/auth';
import { DEMO_CARDS, DEMO_MEMBERS, DEMO_RARITIES, DEMO_SETS, clone, demoDraw, readStore, writeStore } from '../lib/demoData';
import { slug } from '../lib/format';

export interface AdminData {
  settings: Settings;
  rarities: Rarity[];
  sets: CardSet[];
  cards: Card[];
  profiles: Profile[];
  userCards: UserCard[];
  codes: BoosterCode[];
  admins: string[];
  recent: Opening[];
  signupCode: string | null; // code du club : un compte créé avec lui est actif tout de suite
  stats: { nOpen: number; nOpenWeek: number; nAccepted: number; nPending: number };
}

export type CardInput = Omit<Card, 'id' | 'masked'> & { id?: number };
// Photo recadrée prête à l'envoi : 720 px pour les grands affichages, vignette 240 px pour les petits
export interface Photo { full: Blob; thumb: Blob }
export type CardPaths = Pick<Card, 'image_path' | 'thumb_path'>;

// Même suffixe pour la photo et sa vignette
function photoPaths(card: Pick<Card, 'set_id' | 'name'>) {
  const base = `${card.set_id}/${slug(card.name)}-${Date.now().toString(36)}`;
  return { image_path: `${base}.jpg`, thumb_path: `${base}.thumb.jpg` };
}
const filesOf = (c: CardPaths) => [c.image_path, c.thumb_path].filter((p): p is string => !!p);

export type CodeInput = Partial<Omit<BoosterCode, 'uses_count' | 'created_at'>>;

export interface AdminApi {
  mode: 'supabase' | 'demo';
  init(onChange: (uid: string | null) => void): Promise<string | null>;
  signIn(identifiant: string, password: string): Promise<void>;
  logout(): Promise<void>;
  isAdmin(): Promise<boolean>;
  load(): Promise<AdminData>;
  saveCard(card: CardInput, photo: Photo | null, old: CardPaths | null): Promise<void>;
  deleteCard(card: Card): Promise<void>;
  saveSet(set: Partial<CardSet> & { name: string; in_boosters: boolean }): Promise<void>;
  deleteSet(id: number): Promise<void>;
  saveRarities(list: Pick<Rarity, 'id' | 'label' | 'weight' | 'is_secret'>[]): Promise<void>;
  saveSettings(st: Settings): Promise<void>;
  saveCode(code: CodeInput): Promise<void>;
  deleteCode(id: number): Promise<void>;
  resetFreeBooster(uid: string): Promise<void>;
  setMemberStatus(uid: string, status: MemberStatus): Promise<void>;
  saveSignupCode(code: string | null): Promise<void>;
  imageUrls(paths: string[]): Promise<Record<string, string>>;
  reset?(): Promise<void>;
}

// Messages d'erreur de la base traduits en français
export function friendly(msg: string): string {
  if (/cards_set_id_number_key/.test(msg)) return 'Ce numéro est déjà pris dans cette série.';
  if (/card_sets_name_key/.test(msg)) return 'Une série porte déjà ce nom.';
  if (/booster_codes_code_idx/.test(msg)) return 'Ce code existe déjà.';
  if (/signup_settings_code_check/.test(msg)) return "Le code d'inscription doit faire entre 4 et 40 caractères.";
  if (/delete on table "card_sets"/.test(msg)) return 'Cette série contient encore des cartes.';
  if (/delete on table "cards"/.test(msg)) return 'Cette carte est déjà dans des collections ou des échanges : retire-la plutôt des boosters.';
  if (/row-level security|JSON object requested|Réservé/i.test(msg)) return 'Action réservée aux administrateurs.';
  return msg;
}

/* ------------------------------ Supabase ------------------------------ */
function createSupabaseAdminApi(): AdminApi {
  const sb = getSupabase();
  const ok = <T,>(r: { data: T | null; error: { message: string } | null }) => must(r, friendly);
  const count = ({ count: n, error }: { count: number | null; error: { message: string } | null }) => {
    if (error) throw new Error(friendly(error.message));
    return n ?? 0;
  };
  const store = () => sb.storage.from(CONFIG.bucket);
  return {
    mode: 'supabase',
    init: watchSession,
    signIn,
    logout: signOut,
    isAdmin: async () => ok<boolean>(await sb.rpc('is_admin')) === true,
    async load() {
      const week = new Date(Date.now() - 7 * 864e5).toISOString();
      const openings = () => sb.from('booster_openings').select('id', { count: 'exact', head: true });
      const trades = () => sb.from('trades').select('id', { count: 'exact', head: true });
      const [settings, rarities, sets, cards, profiles, userCards, codes, admins, recent, signup, nOpen, nOpenWeek, nAccepted, nPending] = await Promise.all([
        sb.from('game_settings').select('*').single().then(r => ok<Settings>(r)),
        sb.from('rarities').select('*').order('id').then(r => ok<Rarity[]>(r)),
        sb.from('card_sets').select('*').order('id').then(r => ok<CardSet[]>(r)),
        fetchAll<Card>(() => sb.from('cards').select('*').order('set_id').order('number')),
        fetchAll<Profile>(() => sb.from('profiles').select('id, username, status, last_free_booster_at, created_at').order('username')),
        fetchAll<UserCard>(() => sb.from('user_cards').select('user_id, card_id, quantity').order('user_id').order('card_id')),
        fetchAll<BoosterCode>(() => sb.from('booster_codes').select('*').order('created_at', { ascending: false })),
        sb.from('admins').select('user_id').then(r => ok<{ user_id: string }[]>(r)),
        sb.from('booster_openings').select('id, user_id, code_id, card_ids, opened_at').order('opened_at', { ascending: false }).limit(12).then(r => ok<Opening[]>(r)),
        sb.from('signup_settings').select('code').single().then(r => ok<{ code: string | null }>(r)),
        openings().then(count),
        openings().gte('opened_at', week).then(count),
        trades().eq('status', 'accepted').then(count),
        trades().eq('status', 'pending').then(count),
      ]);
      return { settings, rarities, sets, cards, profiles, userCards, codes, admins: admins.map(a => a.user_id), recent, signupCode: signup.code, stats: { nOpen, nOpenWeek, nAccepted, nPending } };
    },
    // La photo et sa vignette éventuelles sont envoyées d'abord, les anciennes supprimées une fois la carte enregistrée
    async saveCard(card, photo, old) {
      const fresh = photo && photoPaths(card);
      const paths: CardPaths = fresh ?? { image_path: card.image_path, thumb_path: card.thumb_path };
      const sent: string[] = [];
      try {
        if (photo && fresh) {
          const opts = { contentType: 'image/jpeg', upsert: false, cacheControl: '604800' }; // 7 jours de cache navigateur
          for (const [path, blob] of [[fresh.image_path, photo.full], [fresh.thumb_path, photo.thumb]] as const) {
            ok(await store().upload(path, blob, opts));
            sent.push(path);
          }
        }
        const { id, ...row } = { ...card, ...paths };
        if (id) ok(await sb.from('cards').update(row).eq('id', id).select().single());
        else ok(await sb.from('cards').insert(row).select().single());
      } catch (e) {
        if (sent.length) await store().remove(sent);
        throw e;
      }
      const stale = old ? filesOf(old).filter(p => !filesOf(paths).includes(p)) : [];
      if (stale.length) await store().remove(stale);
    },
    async deleteCard(card) {
      ok(await sb.from('cards').delete().eq('id', card.id));
      const files = filesOf(card);
      if (files.length) await store().remove(files);
    },
    async saveSet({ id, name, in_boosters }) {
      if (id) ok(await sb.from('card_sets').update({ name, in_boosters }).eq('id', id).select().single());
      else ok(await sb.from('card_sets').insert({ name, in_boosters }).select().single());
    },
    deleteSet: async id => { ok(await sb.from('card_sets').delete().eq('id', id)); },
    async saveRarities(list) {
      for (const { id, label, weight, is_secret } of list) ok(await sb.from('rarities').update({ label, weight, is_secret }).eq('id', id).select().single());
    },
    saveSettings: async st => { ok(await sb.from('game_settings').update(st).eq('id', true).select().single()); },
    async saveCode({ id, ...row }) {
      if (id) ok(await sb.from('booster_codes').update(row).eq('id', id).select().single());
      else ok(await sb.from('booster_codes').insert(row).select().single());
    },
    deleteCode: async id => { ok(await sb.from('booster_codes').delete().eq('id', id)); },
    resetFreeBooster: async uid => { ok(await sb.rpc('admin_reset_free_booster', { p_user: uid })); },
    setMemberStatus: async (uid, status) => { ok(await sb.rpc('admin_set_member_status', { p_user: uid, p_status: status })); },
    saveSignupCode: async code => { ok(await sb.from('signup_settings').update({ code }).eq('id', true).select().single()); },
    imageUrls: signedUrls,
  };
}

/* -------------------------------- Démo -------------------------------- */
interface DemoDb {
  version: number;
  settings: Settings;
  rarities: Rarity[];
  sets: CardSet[];
  cards: Card[];
  profiles: Profile[];
  owned: Record<string, Record<number, number>>;
  openings: Opening[];
  codes: BoosterCode[];
  images: Record<string, string>;
  admins: string[];
  signupCode: string | null;
  nextId: number;
  accepted: number;
  pending: number;
}

function createDemoAdminApi(): AdminApi {
  const KEY = 'cartes-club-admin-demo-react-v1';
  const VERSION = 2; // 2 : statut des membres et code d'inscription
  const fail = (msg: string): never => { throw new Error(msg); };
  let db: DemoDb;
  const save = () => writeStore(KEY, db);
  const toDataUrl = (blob: Blob) => new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
  const ago = (days: number) => new Date(Date.now() - days * 864e5).toISOString();
  function seed() {
    db = {
      version: VERSION, settings: { booster_size: 5, free_booster_cooldown: '1 day' },
      rarities: clone(DEMO_RARITIES), sets: clone(DEMO_SETS), cards: clone(DEMO_CARDS),
      profiles: [
        ...[{ id: 'demo-admin', username: 'Toi' }, ...DEMO_MEMBERS].map((p, i): Profile => ({
          ...p, status: 'active', last_free_booster_at: i % 2 ? new Date(Date.now() - (i + 2) * 36e5).toISOString() : null, created_at: ago(30 - i),
        })),
        // Inscrits sans le code du club : en attente de validation
        { id: 'demo-pending-1', username: 'Jules', status: 'pending', last_free_booster_at: null, created_at: ago(0.1) },
        { id: 'demo-pending-2', username: 'Manon R.', status: 'pending', last_free_booster_at: null, created_at: ago(1.5) },
      ],
      owned: {}, openings: [], images: {}, admins: ['demo-admin'], signupCode: 'BCVB-7K3Q-M2PX', nextId: 100, accepted: 7, pending: 3,
      codes: [
        { id: 1, code: 'MATCH-14NOV', label: 'Match à domicile du 14/11', set_id: null, max_uses: null, uses_count: 18, expires_at: ago(-5), created_at: ago(2) },
        { id: 2, code: 'NOEL26', label: 'Tournoi de Noël', set_id: 2, max_uses: 60, uses_count: 41, expires_at: null, created_at: ago(1) },
        { id: 3, code: 'RENTREE', label: 'Fête de rentrée', set_id: null, max_uses: null, uses_count: 33, expires_at: ago(20), created_at: ago(30) },
      ],
    };
    db.cards.push({ id: db.nextId++, set_id: 1, number: 20, name: 'Nouvelle recrue', subtitle: 'Centrale', rarity_id: 2, stats: { numero: 14, bloc: 8, attaque: 7, service: 5 }, description: null, image_path: null, thumb_path: null, is_released: false, in_boosters: true });
    let id = 1;
    for (const p of db.profiles.filter(x => x.status === 'active')) {
      const n = 2 + Math.floor(Math.random() * 6);
      for (let k = 0; k < n; k++) {
        const cards = Array.from({ length: 5 }, () => demoDraw(db.cards, db.sets, db.rarities, null).id);
        for (const cid of cards) { const o = (db.owned[p.id] ??= {}); o[cid] = (o[cid] ?? 0) + 1; }
        db.openings.push({ id: id++, user_id: p.id, code_id: k === 0 ? 1 : null, card_ids: cards, opened_at: ago(Math.random() * 10) });
      }
    }
    save();
  }
  const stored = readStore<DemoDb>(KEY);
  if (stored?.version === VERSION) db = stored; else seed();
  const used = (cid: number) => Object.values(db.owned).some(o => o[cid]);

  return {
    mode: 'demo',
    async init() { return 'demo-admin'; },
    async signIn() {},
    async logout() {},
    async isAdmin() { return true; },
    async load() {
      const userCards: UserCard[] = [];
      for (const [uid, o] of Object.entries(db.owned)) for (const [cid, q] of Object.entries(o)) userCards.push({ user_id: uid, card_id: +cid, quantity: q });
      const week = Date.now() - 7 * 864e5;
      return clone({
        settings: db.settings, rarities: db.rarities, sets: db.sets, cards: db.cards, profiles: db.profiles, userCards, admins: db.admins,
        codes: [...db.codes].sort((a, b) => b.created_at.localeCompare(a.created_at)),
        recent: [...db.openings].sort((a, b) => b.opened_at.localeCompare(a.opened_at)).slice(0, 12),
        signupCode: db.signupCode,
        stats: { nOpen: db.openings.length, nOpenWeek: db.openings.filter(o => Date.parse(o.opened_at) > week).length, nAccepted: db.accepted, nPending: db.pending },
      });
    },
    async saveCard(card, photo, old) {
      if (db.cards.some(c => c.set_id === card.set_id && c.number === card.number && c.id !== card.id)) fail('Ce numéro est déjà pris dans cette série.');
      const fresh = photo && photoPaths(card);
      const paths: CardPaths = fresh ?? { image_path: card.image_path, thumb_path: card.thumb_path };
      if (photo && fresh) {
        db.images[fresh.image_path] = await toDataUrl(photo.full);
        db.images[fresh.thumb_path] = await toDataUrl(photo.thumb);
      }
      if (old) for (const p of filesOf(old)) if (!filesOf(paths).includes(p)) delete db.images[p];
      const row = { ...clone(card), ...paths };
      const existing = card.id ? db.cards.find(c => c.id === card.id) : undefined;
      if (existing) Object.assign(existing, row); else db.cards.push({ ...row, id: db.nextId++ });
      save();
    },
    async deleteCard(card) {
      if (used(card.id)) fail(friendly('delete on table "cards"'));
      db.cards = db.cards.filter(c => c.id !== card.id);
      for (const p of filesOf(card)) delete db.images[p];
      save();
    },
    async saveSet(set) {
      if (db.sets.some(s => s.name.toLowerCase() === set.name.toLowerCase() && s.id !== set.id)) fail('Une série porte déjà ce nom.');
      const existing = set.id ? db.sets.find(s => s.id === set.id) : undefined;
      if (existing) Object.assign(existing, set); else db.sets.push({ name: set.name, in_boosters: set.in_boosters, id: db.nextId++ });
      save();
    },
    async deleteSet(id) {
      if (db.cards.some(c => c.set_id === id)) fail('Cette série contient encore des cartes.');
      db.sets = db.sets.filter(s => s.id !== id);
      save();
    },
    async saveRarities(list) {
      for (const r of list) { const x = db.rarities.find(y => y.id === r.id); if (x) Object.assign(x, r); }
      save();
    },
    async saveSettings(st) { Object.assign(db.settings, st); save(); },
    async saveCode(code) {
      if (code.code && db.codes.some(c => c.code.toUpperCase() === code.code!.toUpperCase() && c.id !== code.id)) fail('Ce code existe déjà.');
      const existing = code.id ? db.codes.find(c => c.id === code.id) : undefined;
      if (existing) Object.assign(existing, code);
      else db.codes.push({ code: '', label: null, set_id: null, max_uses: null, expires_at: null, ...code, id: db.nextId++, uses_count: 0, created_at: new Date().toISOString() });
      save();
    },
    async deleteCode(id) { db.codes = db.codes.filter(c => c.id !== id); save(); },
    async resetFreeBooster(uid) { const p = db.profiles.find(x => x.id === uid); if (p) p.last_free_booster_at = null; save(); },
    async setMemberStatus(uid, status) {
      if (uid === 'demo-admin' && status === 'pending') fail('Tu ne peux pas suspendre ton propre compte');
      const p = db.profiles.find(x => x.id === uid) ?? fail('Membre introuvable');
      p.status = status;
      save();
    },
    async saveSignupCode(code) {
      if (code != null && (code.trim().length < 4 || code.trim().length > 40)) fail("Le code d'inscription doit faire entre 4 et 40 caractères.");
      db.signupCode = code;
      save();
    },
    async imageUrls(paths) { return Object.fromEntries(paths.filter(p => db.images[p]).map(p => [p, db.images[p]])); },
    async reset() { try { localStorage.removeItem(KEY); } catch { /* rien à effacer */ } seed(); },
  };
}

export const createAdminApi = (): AdminApi => (DEMO ? createDemoAdminApi() : createSupabaseAdminApi());
