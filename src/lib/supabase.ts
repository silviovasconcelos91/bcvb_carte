import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { CONFIG, DEMO } from '../config';

// Un seul client pour tout le site (jeu et console)
let client: SupabaseClient | null = null;
export function getSupabase(): SupabaseClient {
  if (DEMO) throw new Error("Supabase n'est pas configuré (mode démo).");
  client ??= createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);
  return client;
}

interface Result<T> {
  data: T | null;
  error: { message: string } | null;
}
export function must<T>({ data, error }: Result<T>, translate: (m: string) => string = m => m): T {
  if (error) throw new Error(translate(error.message));
  return data as T;
}

// L'API renvoie 1000 lignes au maximum par requête : on pagine
interface Ranged<T> {
  range: (from: number, to: number) => PromiseLike<Result<T[]>>;
}
export async function fetchAll<T>(build: () => Ranged<T>): Promise<T[]> {
  const out: T[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const rows = must(await build().range(from, from + size - 1)) ?? [];
    out.push(...rows);
    if (rows.length < size) return out;
  }
}

// Photos du bucket privé : URL signées valables 7 jours, demandées en un seul appel.
// Elles sont gardées dans le navigateur, par utilisateur : la même photo garde la même URL
// d'une visite à l'autre et le navigateur la sert depuis son cache au lieu de la retélécharger.
const URL_TTL = 604800; // 7 jours, en secondes
const URL_MIN_LEFT = 864e5; // en dessous d'un jour de validité restante, on redemande l'URL
const URL_KEY = 'cartes-club-urls-v1:';
type UrlCache = Record<string, { url: string; exp: number }>;
let urlCache: { uid: string; urls: UrlCache } | null = null;

function readUrls(uid: string): UrlCache {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(URL_KEY + uid) ?? '{}');
    return v && typeof v === 'object' ? (v as UrlCache) : {};
  } catch { return {}; }
}
function writeUrls(uid: string, urls: UrlCache) {
  try { localStorage.setItem(URL_KEY + uid, JSON.stringify(urls)); } catch { /* stockage plein ou désactivé : pas de cache */ }
}
function forgetUrls(uid: string) {
  if (urlCache?.uid === uid) urlCache = null;
  try { localStorage.removeItem(URL_KEY + uid); } catch { /* rien à effacer */ }
}

export async function signedUrls(paths: string[]): Promise<Record<string, string>> {
  const sb = getSupabase();
  const { data: { session } } = await sb.auth.getSession();
  const uid = session?.user?.id ?? '';
  if (urlCache?.uid !== uid) urlCache = { uid, urls: uid ? readUrls(uid) : {} };
  const { urls } = urlCache;
  const now = Date.now();
  const missing = [...new Set(paths)].filter(p => (urls[p]?.exp ?? 0) - now <= URL_MIN_LEFT);
  if (missing.length) {
    const { data, error } = await sb.storage.from(CONFIG.bucket).createSignedUrls(missing, URL_TTL);
    if (!error) {
      for (const r of data ?? []) if (r.signedUrl && r.path) urls[r.path] = { url: r.signedUrl, exp: now + URL_TTL * 1000 - 6e4 };
      for (const [p, v] of Object.entries(urls)) if (!(v?.exp > now)) delete urls[p];
      if (uid) writeUrls(uid, urls);
    }
  }
  return Object.fromEntries(paths.filter(p => urls[p]).map(p => [p, urls[p].url]));
}

// Connexion par lien magique, réservée aux membres invités
export async function sendLoginLink(email: string) {
  const { error } = await getSupabase().auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: window.location.origin + window.location.pathname },
  });
  if (!error) return;
  if (/signups? not allowed/i.test(error.message)) throw new Error("Cette adresse n'est pas inscrite au jeu. Demande une invitation au club.");
  const wait = error.message.match(/after (\d+) seconds?/i);
  throw new Error(wait ? `Attends ${wait[1]} secondes avant de redemander un lien.` : error.message);
}

// Session courante, puis suivi des connexions et déconnexions
export async function watchSession(onChange: (uid: string | null) => void): Promise<string | null> {
  const sb = getSupabase();
  const { data } = await sb.auth.getSession();
  let current = data.session?.user?.id ?? null;
  sb.auth.onAuthStateChange((_event, session) => {
    const next = session?.user?.id ?? null;
    if (next !== current) {
      if (current) forgetUrls(current); // déconnexion ou changement de compte
      current = next;
      setTimeout(() => onChange(next), 0); // jamais d'appel Supabase directement dans ce callback
    }
  });
  return current;
}

export async function signOut() {
  const sb = getSupabase();
  const { data } = await sb.auth.getSession();
  if (data.session) forgetUrls(data.session.user.id);
  await sb.auth.signOut();
}
