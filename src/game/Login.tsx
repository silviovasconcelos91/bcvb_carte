import { useState, type FormEvent } from 'react';
import type { GameApi } from '../api/game';
import { CONFIG } from '../config';
import { initial, plural } from '../lib/format';
import { LookupContext, makeLookup } from '../lib/lookup';
import { CardBack, CardView, Court, Logo } from '../components/visuals';
import { useToast } from '../components/Toasts';

export function Login({ api, onLogin }: { api: GameApi; onLogin: (uid: string) => Promise<void> }) {
  const toast = useToast();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const preview = api.demo?.preview();
  const pick = (id: number) => preview?.cards.find(c => c.rarity_id === id);
  const fan = preview ? [pick(3), pick(5), pick(4)].filter(c => !!c) : [];

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get('email') || '').trim();
    setBusy(true);
    try {
      await api.sendLoginLink(email);
      setSentTo(email);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <div className="login-hero fan" aria-hidden="true">
        <Court />
        {preview ? (
          <LookupContext.Provider value={makeLookup(preview.rarities, preview.sets, preview.cards)}>
            {fan.map(c => <CardView key={c!.id} card={c!} />)}
          </LookupContext.Provider>
        ) : (<><CardBack /><CardBack /><CardBack /></>)}
      </div>
      <div className="login-panel">
        <div className="login-brand"><Logo /><span>{CONFIG.clubName}</span></div>
        <h1 className="login-title">Les cartes du club</h1>
        <p className="login-lead">Ouvre des boosters, complète ta collection et échange tes doubles avec les autres membres.</p>
        {api.demo ? (
          <>
            <p className="muted">Mode démo : choisis un membre fictif pour essayer le jeu.</p>
            <ul className="members">
              {api.demo.members().map(m => (
                <li key={m.id}>
                  <button className="pick" onClick={() => void onLogin(m.id)}>
                    <span className="avatar">{initial(m.username)}</span>
                    <span className="pick-main"><span className="pick-name">{m.username}</span><span className="pick-meta">{plural(m.count, 'carte', 'cartes')}</span></span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : sentTo ? (
          <>
            <p className="detail-own">Lien envoyé à {sentTo}.</p>
            <p className="muted">Ouvre-le depuis cet appareil pour te connecter. Pense à vérifier tes courriers indésirables.</p>
            <button className="btn ghost" onClick={() => setSentTo(null)}>Utiliser une autre adresse</button>
          </>
        ) : (
          <>
            <form className="login-form" onSubmit={submit}>
              <label htmlFor="email">Ton adresse e-mail</label>
              <input id="email" name="email" type="email" className="input" autoComplete="email" required />
              <button className="btn primary big" disabled={busy}>Recevoir mon lien de connexion</button>
            </form>
            <p className="login-note">Seuls les membres invités par le club peuvent se connecter.</p>
          </>
        )}
      </div>
    </main>
  );
}
