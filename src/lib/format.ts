export const pad2 = (n: number | null | undefined) => (n == null ? '–' : String(n).padStart(2, '0'));
export const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
export const initial = (name: string | null | undefined) => (String(name || '?').trim().charAt(0) || '?').toUpperCase();
export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
export const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export const sumValues = (m: Map<unknown, number>) => [...m.values()].reduce((a, b) => a + b, 0);

// Intervalle Postgres ("1 day", "12:00:00", "1 day 02:00:00", "24 hours") en millisecondes
export function intervalMs(v: string | number | null | undefined): number {
  if (typeof v === 'number') return v;
  const s = String(v || '');
  let ms = 0;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/(\d+)\s*days?/))) ms += +m[1] * 864e5;
  if ((m = s.match(/(\d+):(\d+):(\d+(?:\.\d+)?)/))) ms += (+m[1] * 3600 + +m[2] * 60 + +m[3]) * 1000;
  if ((m = s.match(/(\d+)\s*hours?/))) ms += +m[1] * 36e5;
  if ((m = s.match(/(\d+)\s*mins?/))) ms += +m[1] * 6e4;
  return ms || 864e5;
}

export function fmtDuration(ms: number): string {
  const min = Math.max(1, Math.floor(ms / 6e4));
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    return plural(d, 'jour', 'jours') + (h % 24 ? ` ${h % 24} h` : '');
  }
  return h ? `${h} h ${pad2(m)}` : `${m} min`;
}

export function fmtDate(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)} à ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function fmtDateLong(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}

export function relTime(iso: string): string {
  const d = new Date(iso);
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  if (s < 172800) return 'hier';
  return 'le ' + d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}

export const slug = (s: string) =>
  String(s || 'carte').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'carte';

const STAT_LABELS: Record<string, string> = {
  service: 'Service', attaque: 'Attaque', reception: 'Réception', bloc: 'Bloc', passe: 'Passe',
  defense: 'Défense', tactique: 'Tactique', temps_morts: 'Temps morts', patience: 'Patience',
};
export const statLabel = (k: string) => STAT_LABELS[k] || k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' ');
