import { useState, type FormEvent } from 'react';
import { CONFIG_ERROR } from '../config';
import { useToast } from './Toasts';

// Formulaire de connexion par identifiant (pseudo ou adresse e-mail) et mot de passe, commun au jeu et à la console
export function SignInForm({ onSubmit, label = 'Se connecter' }: { onSubmit: (id: string, password: string) => Promise<void>; label?: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await onSubmit(String(f.get('login') || ''), String(f.get('password') || ''));
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="login-form" onSubmit={submit}>
      <label htmlFor="login">Pseudo (ou adresse e-mail)</label>
      <input id="login" name="login" className="input" autoComplete="username" autoCapitalize="none" spellCheck={false} required />
      <label htmlFor="password">Mot de passe</label>
      <input id="password" name="password" type="password" className="input" autoComplete="current-password" required />
      <button className="btn primary big" disabled={busy}>{label}</button>
    </form>
  );
}

// Réglage manquant : message à la place du formulaire
export function ConfigError() {
  return CONFIG_ERROR ? <p className="form-error" role="alert">{CONFIG_ERROR}</p> : null;
}
