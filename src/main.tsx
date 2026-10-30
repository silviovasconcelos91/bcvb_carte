import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow/700.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/barlow-condensed/800.css';
import './styles/base.css';
import { ToastProvider } from './components/Toasts';
import GameApp from './game/GameApp';

// Trois pages : le jeu (/), la console d'administration (/admin), chargée à part
// pour que les membres ne téléchargent pas son code, et la démo d'ouverture de booster (/demo).
const AdminApp = lazy(() => import('./admin/AdminApp'));
const RevealDemo = lazy(() => import('./game/RevealDemo'));
const path = window.location.pathname;
const isAdmin = /^\/admin\/?$/.test(path);
const isDemo = /^\/demo\/?$/.test(path);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      {isAdmin || isDemo ? (
        <Suspense fallback={<div className="loading">Chargement…</div>}>{isAdmin ? <AdminApp /> : <RevealDemo />}</Suspense>
      ) : <GameApp />}
    </ToastProvider>
  </StrictMode>,
);
