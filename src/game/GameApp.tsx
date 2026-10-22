import { useCallback, useEffect, useMemo, useState } from 'react';
import { createGameApi, type GameApi } from '../api/game';
import { CONFIG } from '../config';
import { LookupContext, RarityStyles, artPaths } from '../lib/lookup';
import { errMsg } from '../lib/format';
import type { DrawnCard, Profile } from '../lib/types';
import { Logo } from '../components/visuals';
import { useToast } from '../components/Toasts';
import { GameContext, indexGame, type GameCtx, type GameIndex, type Tab } from './context';
import { Login } from './Login';
import { Header, DemoStrip } from './Header';
import { BoosterView } from './BoosterView';
import { CollectionView } from './CollectionView';
import { TradesView } from './TradesView';
import { LeaderboardView } from './LeaderboardView';
import { CardDetail } from './CardDetail';
import { Composer, type ComposerOpts } from './Composer';
import { Reveal } from './Reveal';
import { Account } from './Account';

let apiSingleton: GameApi | null = null;
const getApi = () => (apiSingleton ??= createGameApi());

// Code reçu par QR (?code=XXXX) : gardé jusqu'à son utilisation, même après la connexion
const CODE_KEY = 'cartes-club-code';
function readPendingCode(): string {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('code');
  if (fromUrl) {
    const code = fromUrl.trim().toUpperCase().slice(0, 40);
    try { localStorage.setItem(CODE_KEY, code); } catch { /* gardé en mémoire */ }
    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    return code;
  }
  try { return localStorage.getItem(CODE_KEY) ?? ''; } catch { return ''; }
}

export default function GameApp() {
  const api = getApi();
  const toast = useToast();
  const [booting, setBooting] = useState(true);
  const [uid, setUid] = useState<string | null>(null);
  const [d, setD] = useState<GameIndex | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<Profile | null>(null); // compte en attente de validation
  const [account, setAccount] = useState(false);
  const [tab, setTabState] = useState<Tab>('booster');
  const [detailId, setDetailId] = useState<number | null>(null);
  const [composer, setComposer] = useState<ComposerOpts | null>(null);
  const [drawn, setDrawn] = useState<DrawnCard[] | null>(null);
  const [pendingCode, setPendingCodeState] = useState(readPendingCode);

  useEffect(() => { document.title = `Cartes du ${CONFIG.clubName}`; }, []);

  // Le profil est lu d'abord : un compte en attente ne voit ni le catalogue ni les autres membres
  const load = useCallback(async (who: string): Promise<'ready' | 'pending' | 'error'> => {
    try {
      const me = await api.myProfile(who);
      if (me?.status === 'pending') {
        setPending(me);
        setD(null);
        setLoadError(null);
        return 'pending';
      }
      setPending(null);
      const raw = await api.load(who);
      const paths = artPaths(raw.cards);
      const urls = paths.length ? await api.imageUrls(paths) : {};
      setD(indexGame(raw, who, urls));
      setLoadError(null);
      return 'ready';
    } catch (e) {
      setD(null);
      setPending(null); // sinon l'écran « en attente » masquerait l'erreur
      setLoadError(errMsg(e));
      return 'error';
    }
  }, [api]);

  useEffect(() => {
    let alive = true;
    api.init(next => {
      if (!alive) return;
      setUid(next);
      if (next) void load(next); else { setD(null); setPending(null); }
    }).then(async who => {
      if (!alive) return;
      setUid(who);
      if (who) await load(who);
      setBooting(false);
    }).catch(e => {
      setLoadError(errMsg(e));
      setBooting(false);
    });
    return () => { alive = false; };
  }, [api, load]);

  const setPendingCode = useCallback((code: string) => {
    setPendingCodeState(code);
    try { if (code) localStorage.setItem(CODE_KEY, code); else localStorage.removeItem(CODE_KEY); } catch { /* rien */ }
  }, []);

  const loginAs = async (who: string) => {
    await api.demo?.loginAs(who);
    setUid(who);
    setTabState('booster');
    await load(who);
  };
  const logout = async () => {
    setAccount(false);
    await api.logout();
    setUid(null);
    setD(null);
    setPending(null);
    setLoadError(null);
  };

  const ctx = useMemo<GameCtx | null>(() => (uid && d ? {
    api, uid, d, tab,
    setTab: (t: Tab) => { setTabState(t); window.scrollTo(0, 0); },
    refresh: async () => { await load(uid); },
    openCard: (id: number) => setDetailId(id),
    openComposer: (opts = {}) => setComposer(opts),
    showReveal: (cards: DrawnCard[]) => setDrawn(cards),
    pendingCode, setPendingCode,
  } : null), [api, uid, d, tab, load, pendingCode, setPendingCode]);

  if (booting) return <div className="loading">Chargement…</div>;
  if (!uid) return <Login api={api} onLogin={loginAs} />;
  if (pending) {
    return (
      <main className="login one"><div className="login-panel">
        <div className="login-brand"><Logo /><span>{CONFIG.clubName}</span></div>
        <h1 className="login-title">Presque prêt</h1>
        <p className="login-lead">Ton compte attend la validation d'un responsable du club.</p>
        <p>Compte créé : <strong>{pending.username}</strong>. Reviens un peu plus tard, ou préviens un responsable du club.</p>
        <div className="login-actions">
          <button className="btn primary" onClick={async () => { if (await load(uid) === 'pending') toast('Ton compte est toujours en attente de validation.'); }}>Actualiser</button>
          <button className="btn ghost" onClick={() => void logout()}>Se déconnecter</button>
        </div>
      </div></main>
    );
  }
  if (loadError) {
    return (
      <main className="main"><div className="empty">
        <h3>Impossible de charger le jeu</h3><p>{loadError}</p>
        <button className="btn" onClick={() => void load(uid)}>Réessayer</button>{' '}
        <button className="btn ghost" onClick={() => void logout()}>Se déconnecter</button>
      </div></main>
    );
  }
  if (!ctx) return <div className="loading">Chargement…</div>;

  return (
    <LookupContext.Provider value={ctx.d.lookup}>
      <RarityStyles />
      <GameContext.Provider value={ctx}>
        <Header onLogout={logout} onAccount={() => setAccount(true)} onSwitch={async who => { await loginAs(who); toast(`Tu joues maintenant avec le profil de ${ctx.d.profileById.get(who)?.username ?? ''}`); }} />
        {api.mode === 'demo' && <DemoStrip onReset={async () => { await api.demo?.reset(); setUid(null); setD(null); toast('Démo réinitialisée'); }} />}
        <main className="main" id="main">
          {tab === 'booster' && <BoosterView />}
          {tab === 'collection' && <CollectionView />}
          {tab === 'trades' && <TradesView />}
          {tab === 'leaderboard' && <LeaderboardView />}
        </main>
        {detailId != null && <CardDetail id={detailId} onClose={() => setDetailId(null)} />}
        {composer && <Composer opts={composer} onClose={() => setComposer(null)} />}
        {account && <Account onClose={() => setAccount(false)} onLogout={() => void logout()} />}
        {drawn && <Reveal drawn={drawn} onClose={goCollection => { setDrawn(null); if (goCollection) ctx.setTab('collection'); }} />}
      </GameContext.Provider>
    </LookupContext.Provider>
  );
}
