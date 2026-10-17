import { useEffect, useState, type FormEvent } from 'react';
import { Modal } from '../components/Modal';
import { useRunner, useToast } from '../components/Toasts';
import { useGame } from './context';

// « Mon compte » : pseudo affiché, identifiant de connexion, mot de passe
export function Account({ onClose, onLogout }: { onClose: () => void; onLogout: () => void }) {
  const { api, uid, d, refresh } = useGame();
  const run = useRunner();
  const toast = useToast();
  const [name, setName] = useState(d.me.username);
  const [login, setLogin] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { void api.loginId().then(setLogin); }, [api]);

  async function rename(e: FormEvent) {
    e.preventDefault();
    const username = name.trim();
    if (username.length < 2 || username.length > 30) { toast('Le pseudo doit faire entre 2 et 30 caractères.', true); return; }
    setBusy(true);
    if (await run(() => api.rename(uid, username), 'Pseudo modifié')) await refresh();
    setBusy(false);
  }

  async function password(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setBusy(true);
    if (await run(() => api.changePassword(String(f.get('password') || ''), String(f.get('confirm') || '')), 'Mot de passe modifié')) form.reset();
    setBusy(false);
  }

  return (
    <Modal title="Mon compte" onClose={onClose} footer={<button className="btn ghost" onClick={onLogout}>Se déconnecter</button>}>
      <form className="account" onSubmit={rename}>
        <h3>Pseudo affiché</h3>
        <label htmlFor="acc-name" className="sr-only">Pseudo affiché</label>
        <div className="row">
          <input id="acc-name" className="input" maxLength={30} value={name} onChange={e => setName(e.target.value)} required />
          <button className="btn" disabled={busy || name.trim() === d.me.username}>Enregistrer</button>
        </div>
        <p className="form-help">C'est le nom que voient les autres membres. Ton identifiant de connexion, lui, ne change pas.</p>
      </form>
      {api.mode === 'supabase' && (
        <>
          <div className="account">
            <h3>Identifiant de connexion</h3>
            <input className="input" value={login} readOnly aria-label="Identifiant de connexion" />
          </div>
          <form className="account" onSubmit={password}>
            <h3>Nouveau mot de passe</h3>
            <label htmlFor="acc-pw">Nouveau mot de passe</label>
            <input id="acc-pw" name="password" type="password" className="input" autoComplete="new-password" minLength={8} required />
            <label htmlFor="acc-pw2">Confirme le mot de passe</label>
            <input id="acc-pw2" name="confirm" type="password" className="input" autoComplete="new-password" minLength={8} required />
            <div><button className="btn primary" disabled={busy}>Changer le mot de passe</button></div>
          </form>
        </>
      )}
    </Modal>
  );
}
