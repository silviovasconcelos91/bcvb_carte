import { CONFIG } from '../config';
import { getSupabase } from './supabase';

// Comptes pseudo + mot de passe. Supabase identifie un compte par une adresse e-mail :
// chaque pseudo devient une adresse interne, cartes-<identifiant>@<VITE_LOGIN_EMAIL_DOMAIN>,
// à laquelle aucun e-mail n'est jamais envoyé (confirmation désactivée dans Supabase).
const PREFIX = 'cartes-';

export const PSEUDO_MIN = 3;
export const PSEUDO_MAX = 30;
export const PASSWORD_MIN = 8;

// Diacritiques séparés des lettres par normalize('NFD') : U+0300 à U+036F
const ACCENTS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, 'g');

// « Léa Martin » -> « lea.martin »
export function loginId(pseudo: string): string {
  return pseudo
    .normalize('NFD').replace(ACCENTS, '') // accents retirés
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]+/g, '.')
    .replace(/\.{2,}/g, '.')
    .replace(/^[._-]+|[._-]+$/g, '');
}

// Une saisie avec @ est une vraie adresse (comptes administrateurs) : utilisée telle quelle
export function loginEmail(pseudo: string): string {
  const v = pseudo.trim();
  if (v.includes('@')) return v.toLowerCase();
  return `${PREFIX}${loginId(v)}@${CONFIG.loginDomain}`;
}

// Inverse de loginEmail : identifiant à saisir pour se connecter, d'après l'adresse de la session
export function loginIdOf(email: string | null | undefined): string {
  if (!email) return '';
  const suffix = `@${CONFIG.loginDomain}`.toLowerCase();
  const e = email.toLowerCase();
  return e.startsWith(PREFIX) && e.endsWith(suffix) ? e.slice(PREFIX.length, -suffix.length) : e;
}

// Vérifications avant envoi ; renvoie le message d'erreur ou null
export function checkPseudo(pseudo: string): string | null {
  const v = pseudo.trim();
  if (v.length < PSEUDO_MIN || v.length > PSEUDO_MAX) return `Le pseudo doit faire entre ${PSEUDO_MIN} et ${PSEUDO_MAX} caractères.`;
  if (loginId(v).length < PSEUDO_MIN) return `Le pseudo doit contenir au moins ${PSEUDO_MIN} lettres ou chiffres.`;
  return null;
}
export function checkPassword(password: string, confirm: string): string | null {
  if (password.length < PASSWORD_MIN) return `Le mot de passe doit faire au moins ${PASSWORD_MIN} caractères.`;
  if (password !== confirm) return 'Les deux mots de passe ne sont pas identiques.';
  return null;
}

// Erreurs d'authentification de Supabase traduites en français
interface AuthErr { message: string; code?: string; status?: number }
export function authMessage({ message, code, status }: AuthErr): string {
  if (code === 'user_already_exists' || /already registered/i.test(message)) return 'Ce pseudo est déjà pris.';
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(message)) return 'Pseudo ou mot de passe incorrect.';
  if (code === 'weak_password' || /weak|at least \d+ characters/i.test(message)) return `Mot de passe trop faible (${PASSWORD_MIN} caractères minimum).`;
  if (code === 'signup_disabled' || /signups? not allowed/i.test(message)) return 'Les inscriptions sont fermées pour le moment.';
  if (code === 'email_address_invalid' || /email address .* is invalid/i.test(message)) {
    return 'Configuration : le domaine VITE_LOGIN_EMAIL_DOMAIN est refusé par Supabase (il doit avoir des enregistrements MX).';
  }
  if (status === 429 || code?.startsWith('over_') || /rate limit/i.test(message)) return 'Trop de tentatives, réessaie dans quelques minutes.';
  if (code === 'same_password') return "Le nouveau mot de passe doit être différent de l'ancien.";
  if (code === 'reauthentication_needed' || /reauthenticat/i.test(message)) {
    return 'Supabase demande de te reconnecter avant de changer de mot de passe : déconnecte-toi, reconnecte-toi, puis recommence.';
  }
  return message;
}

export async function signIn(identifiant: string, password: string): Promise<void> {
  if (!identifiant.trim() || !password) throw new Error('Saisis ton pseudo et ton mot de passe.');
  const { error } = await getSupabase().auth.signInWithPassword({ email: loginEmail(identifiant), password });
  if (error) throw new Error(authMessage(error));
}

// La confirmation du mot de passe est vérifiée par le formulaire
export async function signUp(pseudo: string, password: string, code: string): Promise<void> {
  const invalid = checkPseudo(pseudo) ?? checkPassword(password, password);
  if (invalid) throw new Error(invalid);
  const { data, error } = await getSupabase().auth.signUp({
    email: loginEmail(pseudo),
    password,
    options: { data: { username: pseudo.trim(), signup_code: code.trim() || undefined } },
  });
  if (error) throw new Error(authMessage(error));
  if (!data.session) throw new Error('La confirmation par e-mail est encore activée dans Supabase : désactive-la (Authentication).');
}

export async function changePassword(password: string, confirm: string): Promise<void> {
  const invalid = checkPassword(password, confirm);
  if (invalid) throw new Error(invalid);
  const { error } = await getSupabase().auth.updateUser({ password });
  if (error) throw new Error(authMessage(error));
}

// Identifiant de connexion du compte connecté
export async function currentLoginId(): Promise<string> {
  const { data } = await getSupabase().auth.getSession();
  return loginIdOf(data.session?.user?.email);
}
