import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { createAdminApi, type AdminApi } from '../api/admin';
import { CONFIG } from '../config';
import { initial } from '../lib/format';
import { LookupContext, artPaths } from '../lib/lookup';
import { Logo } from '../components/visuals';
import { useRunner, useToast } from '../components/Toasts';
import { AdminContext, indexAdmin, type AdminCtx, type AdminIndex, type AdminTab } from './context';
import { Dashboard } from './Dashboard';
import { CardsAdmin } from './Cards';
import { RaritiesAdmin, SetsAdmin } from './Catalog';
import { CodesAdmin } from './Codes';
import { MembersAdmin, SettingsAdmin } from './Members';
import '../styles/admin.css';

const TABS: [AdminTab, string][] = [['dashboard', 'Tableau de bord'], ['cards', 'Cartes'], ['sets', 'Séries'], ['rarities', 'Raretés'], ['codes', 'Codes'], ['members', 'Membres'], ['settings', 'Réglages']];

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
      const paths = artPaths(raw.cards);
      const urls = paths.length ? await api.imageUrls(paths) : {};
      setD(indexAdmin(raw, who, urls));
      setLoadError(null);
    } catch (e) {
      setD(null);
      setLoadError(e instanceof Error ? e.message : String(e));
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
    api.init(next => { if (alive) void enter(next); })
      .then(async who => { if (alive) await enter(who); })
      .catch(e => setLoadError(e instanceof Error ? e.message : String(e)))
      .finally(() => { if (alive) setBooting(false); });
    return () => { alive = false; };
  }, [api, enter]);

  const logout = async () => { await api.logout(); await enter(null); };

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
      <AdminContext.Provider value={ctx}>
        <header className="top"><div className="top-in">
          <div className="brand"><Logo /><h1 className="brand-name">Administration {CONFIG.clubName}</h1></div>
          <div className="who">
            {api.mode === 'demo' ? <span className="pill">Démo</span> : (
              <>
                <span className="avatar sm" aria-hidden="true">{initial(ctx.d.me?.username)}</span>
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
          {tab === 'rarities' && <RaritiesAdmin />}
          {tab === 'codes' && <CodesAdmin />}
          {tab === 'members' && <MembersAdmin />}
          {tab === 'settings' && <SettingsAdmin />}
        </main>
      </AdminContext.Provider>
    </LookupContext.Provider>
  );
}

function AdminLogin({ api }: { api: AdminApi }) {
  const run = useRunner();
  const [sentTo, setSentTo] = useState<string | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get('email') || '').trim();
    if (await run(() => api.sendLoginLink(email))) setSentTo(email);
  }
  return (
    <main className="login one"><div className="login-panel">
      <div className="login-brand"><Logo /><span>{CONFIG.clubName}</span></div>
      <h1 className="login-title">Administration</h1>
      <p className="login-lead">Gère les cartes, les séries, les raretés et les codes du jeu.</p>
      {sentTo ? (
        <><p className="detail-own">Lien envoyé à {sentTo}.</p><p className="muted">Ouvre-le depuis cet appareil pour accéder à la console.</p>
          <button className="btn ghost" onClick={() => setSentTo(null)}>Utiliser une autre adresse</button></>
      ) : (
        <form className="login-form" onSubmit={submit}>
          <label htmlFor="email">Ton adresse e-mail</label>
          <input id="email" name="email" type="email" className="input" autoComplete="email" required />
          <button className="btn primary big">Recevoir mon lien de connexion</button>
        </form>
      )}
    </div></main>
  );
}
