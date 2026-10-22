import { useState, type FormEvent } from 'react';
import type { GameApi } from '../api/game';
import { CONFIG, CONFIG_ERROR } from '../config';
import { checkPassword, checkPseudo, loginId } from '../lib/auth';
import { errMsg, initial, plural } from '../lib/format';
import { LookupContext, RarityStyles, makeLookup } from '../lib/lookup';
import { CardBack, CardView, Court, Logo } from '../components/visuals';
import { ConfigError, SignInForm } from '../components/AuthForms';
import { useToast } from '../components/Toasts';

type Mode = 'signin' | 'signup';

export function Login({ api, onLogin }: { api: GameApi; onLogin: (uid: string) => Promise<void> }) {
  const [mode, setMode] = useState<Mode>('signin');
  const preview = api.demo?.preview();
  const pick = (id: number) => preview?.cards.find(c => c.rarity_id === id);
  const fan = preview ? [pick(3), pick(5), pick(4)].filter(c => !!c) : [];

  return (
    <main className="login">
      <div className="login-hero fan" aria-hidden="true">
        <Court />
        {preview ? (
          <LookupContext.Provider value={makeLookup(preview.rarities, preview.sets, preview.cards)}>
            <RarityStyles />
            {fan.map(c => <CardView key={c!.id} card={c!} />)}
          </LookupContext.Provider>
        ) : (<><CardBack /><CardBack /><CardBack /></>)}
      </div>
      <div className="login-panel">
        <div className="login-brand"><Logo /><span>{CONFIG.clubName}</span></div>
        <h1 className="login-title">Les cartes du club</h1>
        <p className="login-lead">Ouvre des boosters, complète ta collection et échange tes doubles avec les autres membres.</p>
        {CONFIG_ERROR ? <ConfigError /> : (
          <>
            <div className="seg login-seg" role="group" aria-label="Connexion ou inscription">
              <button type="button" aria-pressed={mode === 'signin'} onClick={() => setMode('signin')}>Se connecter</button>
              <button type="button" aria-pressed={mode === 'signup'} onClick={() => setMode('signup')}>Créer mon compte</button>
            </div>
            {mode === 'signin' ? (
              api.demo ? (
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
              ) : (
                <>
                  <SignInForm onSubmit={api.signIn} />
                  <p className="login-note">Pas encore de compte ? Choisis « Créer mon compte ».</p>
                </>
              )
            ) : api.demo ? (
              <p className="muted">Mode démo : la création de compte fonctionne une fois le site relié à Supabase. Pour essayer le jeu, choisis un membre fictif dans « Se connecter ».</p>
            ) : <SignUpForm api={api} />}
          </>
        )}
      </div>
    </main>
  );
}

function SignUpForm({ api }: { api: GameApi }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [pseudo, setPseudo] = useState('');
  const id = loginId(pseudo);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const password = String(f.get('password') || '');
    const invalid = checkPseudo(pseudo) ?? checkPassword(password, String(f.get('confirm') || ''));
    if (invalid) { toast(invalid, true); return; }
    setBusy(true);
    try {
      await api.signUp(pseudo, password, String(f.get('code') || ''));
      // la session ouverte par l'inscription est prise en charge par le suivi de session
    } catch (err) {
      toast(errMsg(err), true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="login-form" onSubmit={submit}>
      <label htmlFor="pseudo">Pseudo</label>
      <input id="pseudo" className="input" autoComplete="username" maxLength={30} value={pseudo} onChange={e => setPseudo(e.target.value)} required />
      <p className="form-help">{id.length >= 3 ? <>Pour te connecter : <strong>{id}</strong> (majuscules et accents sans importance)</> : 'Le nom affiché aux autres membres, de 3 à 30 caractères.'}</p>
      <label htmlFor="password">Mot de passe</label>
      <input id="password" name="password" type="password" className="input" autoComplete="new-password" minLength={8} required />
      <label htmlFor="confirm">Confirme le mot de passe</label>
      <input id="confirm" name="confirm" type="password" className="input" autoComplete="new-password" minLength={8} required />
      <label htmlFor="code">Code du club (facultatif)</label>
      <input id="code" name="code" className="input" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={40} />
      <p className="form-help">Sans code, ton compte devra être validé par un responsable du club.</p>
      <button className="btn primary big" disabled={busy}>Créer mon compte</button>
    </form>
  );
}
