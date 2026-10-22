import { useCallback, useEffect, useMemo, useState } from 'react';
import { createAdminApi, type AdminApi } from '../api/admin';
import { CONFIG, CONFIG_ERROR } from '../config';
import { errMsg } from '../lib/format';
import { LookupContext, RarityStyles, artPaths } from '../lib/lookup';
import { Avatar, Logo } from '../components/visuals';
import { useToast } from '../components/Toasts';
import { ConfigError, SignInForm } from '../components/AuthForms';
import { AdminContext, indexAdmin, type AdminCtx, type AdminIndex, type AdminTab } from './context';
import { Dashboard } from './Dashboard';
import { CardsAdmin } from './Cards';
import { RaritiesAdmin, SetsAdmin, SubtitlesAdmin } from './Catalog';
import { CodesAdmin } from './Codes';
import { MembersAdmin, SettingsAdmin } from './Members';
import { TradesAdmin } from './TradesAdmin';
import '../styles/admin.css';

const TABS: [AdminTab, string][] = [['dashboard', 'Tableau de bord'], ['cards', 'Cartes'], ['sets', 'Séries'], ['subtitles', 'Sous-titres'], ['rarities', 'Raretés'], ['codes', 'Codes'], ['trades', 'Échanges'], ['members', 'Membres'], ['settings', 'Réglages']];

let apiSingleton: AdminApi | null = null;
const getApi = () => (apiSingleton ??= createAdminApi());

export default function AdminApp() {
  const api = getApi();
  const toast = useToast();
  const [booting, setBooting] = useState(true);
  const [uid, setUid] = useState<string | null>(null);
  const [notAdmin, setNotAdmin] = useState(false);
  const [d, setD] = useState<AdminIndex | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTabState] = useState<AdminTab>('dashboard');

  useEffect(() => { document.title = `Administration ${CONFIG.clubName}`; }, []);

  const load = useCallback(async (who: string) => {
    try {
      const raw = await api.load();
      const paths = artPaths([...raw.cards, ...raw.proposals]);
      const urls = paths.length ? await api.imageUrls(paths) : {};
      setD(indexAdmin(raw, who, urls));
      setLoadError(null);
    } catch (e) {
      setD(null);
      setLoadError(errMsg(e));
    }
  }, [api]);

  const enter = useCallback(async (who: string | null) => {
    setUid(who);
    setNotAdmin(false);
    if (!who) { setD(null); return; }
    if (!(await api.isAdmin())) { setNotAdmin(true); return; }
    await load(who);
  }, [api, load]);

  useEffect(() => {
    let alive = true;
    api.init(next => { if (alive) enter(next).catch(e => setLoadError(errMsg(e))); })
      .then(async who => { if (alive) await enter(who); })
      .catch(e => setLoadError(errMsg(e)))
      .finally(() => { if (alive) setBooting(false); });
    return () => { alive = false; };
  }, [api, enter]);

  const logout = async () => {
    try { await api.logout(); await enter(null); } catch (e) { setLoadError(errMsg(e)); }
  };

  const ctx = useMemo<AdminCtx | null>(() => (uid && d ? {
    api, d, refresh: () => load(uid), setTab: (t: AdminTab) => { setTabState(t); window.scrollTo(0, 0); },
  } : null), [api, uid, d, load]);

  if (booting) return <div className="loading">Chargement…</div>;
  if (!uid) return <AdminLogin api={api} />;
  if (notAdmin) {
    return (
      <main className="login one"><div className="login-panel">
        <div className="login-brand"><Logo /><span>{CONFIG.clubName}</span></div>
        <h1 className="login-title">Accès réservé</h1>
        <p className="login-lead">Ce compte n'est pas administrateur. Un administrateur peut t'ajouter avec la requête indiquée à la fin de schema.sql.</p>
        <button className="btn" onClick={() => void logout()}>Se déconnecter</button>
      </div></main>
    );
  }
  if (loadError) {
    return <main className="main"><div className="empty"><h3>Impossible de charger la console</h3><p>{loadError}</p><button className="btn" onClick={() => void load(uid)}>Réessayer</button></div></main>;
  }
  if (!ctx) return <div className="loading">Chargement…</div>;

  return (
    <LookupContext.Provider value={ctx.d.lookup}>
      <RarityStyles />
      <AdminContext.Provider value={ctx}>
        <header className="top"><div className="top-in">
          <div className="brand"><Logo /><h1 className="brand-name">Administration {CONFIG.clubName}</h1></div>
          <div className="who">
            {api.mode === 'demo' ? <span className="pill">Démo</span> : (
              <>
                <Avatar name={ctx.d.me?.username} small />
                <span className="who-name">{ctx.d.me?.username}</span>
                <button className="btn small ghost" onClick={() => void logout()}>Se déconnecter</button>
              </>
            )}
          </div>
          <nav className="tabs" aria-label="Sections">
            {TABS.map(([k, l]) => <button key={k} className="tab" aria-current={tab === k ? 'page' : undefined} onClick={() => ctx.setTab(k)}>{l}</button>)}
          </nav>
        </div></header>
        {api.mode === 'demo' && (
          <div className="demo"><div className="demo-in">
            <p>Démo de la console : données fictives, enregistrées dans ce navigateur et indépendantes de la démo du jeu.</p>
            <div className="demo-actions"><button className="linkbtn" onClick={async () => { await api.reset?.(); await load(uid); toast('Démo réinitialisée'); }}>Réinitialiser la démo</button></div>
          </div></div>
        )}
        <main className="main admin" id="main">
          {tab === 'dashboard' && <Dashboard />}
          {tab === 'cards' && <CardsAdmin />}
          {tab === 'sets' && <SetsAdmin />}
          {tab === 'subtitles' && <SubtitlesAdmin />}
          {tab === 'rarities' && <RaritiesAdmin />}
          {tab === 'codes' && <CodesAdmin />}
          {tab === 'trades' && <TradesAdmin />}
          {tab === 'members' && <MembersAdmin />}
          {tab === 'settings' && <SettingsAdmin />}
        </main>
      </AdminContext.Provider>
    </LookupContext.Provider>
  );
}

function AdminLogin({ api }: { api: AdminApi }) {
  return (
    <main className="login one"><div className="login-panel">
      <div className="login-brand"><Logo /><span>{CONFIG.clubName}</span></div>
      <h1 className="login-title">Administration</h1>
      <p className="login-lead">Gère les cartes, les séries, les raretés et les codes du jeu.</p>
      {CONFIG_ERROR ? <ConfigError /> : <SignInForm onSubmit={api.signIn} />}
    </div></main>
  );
}
