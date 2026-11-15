import { useEffect, useState } from 'react';

// Thème d'affichage : « auto » suit le réglage du téléphone ou de l'ordinateur,
// « light » et « dark » le forcent. Le CSS lit l'attribut data-theme posé sur <html>
// (index.html le pose avant le premier affichage pour éviter un flash de la mauvaise couleur).
export type Theme = 'auto' | 'light' | 'dark';

const KEY = 'theme';
const media = () => window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set<(t: Theme) => void>();

export function storedTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'light' || t === 'dark' ? t : 'auto';
  } catch { return 'auto'; }
}

export function setTheme(t: Theme) {
  try { if (t === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, t); } catch { /* choix gardé pour cette visite seulement */ }
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  listeners.forEach(fn => fn(t));
}

/** Choix du membre et thème réellement affiché (le choix « auto » résolu) */
export function useTheme() {
  const [theme, setState] = useState<Theme>(storedTheme);
  const [systemDark, setSystemDark] = useState(() => media().matches);
  useEffect(() => {
    const m = media();
    const onSystem = () => setSystemDark(m.matches);
    m.addEventListener('change', onSystem);
    listeners.add(setState);
    return () => { m.removeEventListener('change', onSystem); listeners.delete(setState); };
  }, []);
  const dark = theme === 'dark' || (theme === 'auto' && systemDark);
  return { theme, dark, setTheme };
}
