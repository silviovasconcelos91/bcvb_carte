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

// Deux pages : le jeu (/) et la console d'administration (/admin), chargée à part
// pour que les membres ne téléchargent pas son code.
const AdminApp = lazy(() => import('./admin/AdminApp'));
const isAdmin = /^\/admin\/?$/.test(window.location.pathname);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      {isAdmin ? (
        <Suspense fallback={<div className="loading">Chargement…</div>}><AdminApp /></Suspense>
      ) : <GameApp />}
    </ToastProvider>
  </StrictMode>,
);
