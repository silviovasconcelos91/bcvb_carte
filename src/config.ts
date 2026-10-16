// Réglages lus dans les variables d'environnement (fichier .env en local, réglages du projet sur Vercel).
// Sans URL ni clé Supabase, l'application tourne en mode démo avec des données fictives.
const env = import.meta.env;

export const CONFIG = {
  supabaseUrl: env.VITE_SUPABASE_URL?.trim() ?? '',
  supabaseKey: env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '',
  clubName: env.VITE_CLUB_NAME?.trim() || 'BCVB',
  clubShort: env.VITE_CLUB_SHORT?.trim() || 'BCVB',
  // Adresse du jeu imprimée dans les QR codes ; vide = adresse du site courant
  appUrl: env.VITE_APP_URL?.trim() ?? '',
  bucket: 'card-images',
};

export const DEMO = !(CONFIG.supabaseUrl && CONFIG.supabaseKey);
