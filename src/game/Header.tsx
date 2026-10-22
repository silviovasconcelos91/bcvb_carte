import { CONFIG } from '../config';
import { initial, plural } from '../lib/format';
import { Logo } from '../components/visuals';
import { useGame, type Tab } from './context';

const TABS: [Tab, string][] = [['booster', 'Booster'], ['collection', 'Collection'], ['trades', 'Échanges'], ['leaderboard', 'Classement']];

export function Header({ onLogout, onSwitch, onAccount }: { onLogout: () => void; onSwitch: (uid: string) => void; onAccount: () => void }) {
  const { api, d, uid, tab, setTab } = useGame();
  const received = d.trades.filter(t => t.status === 'pending' && t.recipient_id === uid).length;
  return (
    <header className="top">
      <div className="top-in">
        <div className="brand"><Logo /><h1 className="brand-name">Cartes du {CONFIG.clubName}</h1></div>
        <div className="who">
          <span className="avatar sm" aria-hidden="true">{initial(d.me.username)}</span>
          {api.demo ? (
            <span className="select-wrap">
              <select className="select" value={uid} onChange={e => onSwitch(e.target.value)} aria-label="Changer de membre (démo)">
                {d.profiles.map(p => <option key={p.id} value={p.id}>{p.username}</option>)}
              </select>
            </span>
          ) : (
            <>
              <button className="who-btn" onClick={onAccount} title="Mon compte">{d.me.username}</button>
              <button className="btn small ghost" onClick={onLogout}>Se déconnecter</button>
            </>
          )}
        </div>
        <nav className="tabs" aria-label="Sections">
          {TABS.map(([k, label]) => (
            <button key={k} className="tab" aria-current={tab === k ? 'page' : undefined} onClick={() => setTab(k)}>
              {label}
              {k === 'trades' && received > 0 && <span className="badge" aria-label={plural(received, 'proposition reçue', 'propositions reçues')}>{received}</span>}
            </button>
          ))}
        </nav>
      </div>
    </header>
  );
}

export function DemoStrip({ onReset }: { onReset: () => void }) {
  const { api, refresh } = useGame();
  return (
    <div className="demo"><div className="demo-in">
      <p>Démo : membres et cartes fictifs, enregistrés dans ce navigateur. Change de membre en haut à droite pour répondre à tes propres propositions.</p>
      <div className="demo-actions">
        <button className="linkbtn" onClick={async () => { await api.demo?.unlock(); await refresh(); }}>Débloquer le booster gratuit</button>
        <button className="linkbtn" onClick={onReset}>Réinitialiser la démo</button>
      </div>
    </div></div>
  );
}
