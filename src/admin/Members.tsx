import { useState, type FormEvent } from 'react';
import { CONFIG } from '../config';
import type { MemberStatus, Profile } from '../lib/types';
import { fmtDuration, initial, intervalMs, sumValues } from '../lib/format';
import { useRunner } from '../components/Toasts';
import { nameOf, useAdmin } from './context';

export function MembersAdmin() {
  const { api, d, refresh } = useAdmin();
  const run = useRunner();
  const released = d.cards.filter(c => c.is_released).length;
  const cooldown = intervalMs(d.settings.free_booster_cooldown);
  // Comptes en attente en premier, puis ordre alphabétique (celui du chargement)
  const list = [...d.profiles].sort((a, b) => +(b.status === 'pending') - +(a.status === 'pending'));
  const setStatus = async (p: Profile, status: MemberStatus) => {
    const msg = status === 'active' ? `Compte de ${p.username} validé` : `Compte de ${p.username} suspendu`;
    if (await run(() => api.setMemberStatus(p.id, status), msg)) await refresh();
  };
  return (
    <>
      <div className="view-head"><h2 className="h2">Membres</h2></div>
      <p className="lead">Les membres créent eux-mêmes leur compte depuis le site, avec un pseudo et un mot de passe. Avec le code du club (onglet Réglages), leur compte est actif tout de suite ; sinon, il apparaît ici « En attente » jusqu'à ce que tu le valides. Un compte suspendu repasse en attente et n'a plus accès au jeu.</p>
      <div className="table-wrap"><table className="tbl">
        <thead><tr><th>Membre</th><th>Statut</th><th className="num">Cartes</th><th className="num">Différentes</th><th>Booster gratuit</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>
          {list.map(p => {
            const inv = d.owned.get(p.id) ?? new Map<number, number>();
            const distinct = [...inv.keys()].filter(id => d.cardById.get(id)?.is_released).length;
            const wait = p.last_free_booster_at ? Date.parse(p.last_free_booster_at) + cooldown - Date.now() : 0;
            const isPending = p.status === 'pending';
            return (
              <tr key={p.id}>
                <td><span className="cell-card"><span className="avatar sm" aria-hidden="true">{initial(p.username)}</span><strong>{p.username}</strong>{d.adminSet.has(p.id) && <span className="pill">Admin</span>}</span></td>
                <td><span className={`pill ${isPending ? 'warn' : 'ok'}`}>{isPending ? 'En attente' : 'Actif'}</span></td>
                <td className="num">{sumValues(inv)}</td>
                <td className="num">{distinct} / {released}</td>
                <td>{wait > 0 ? `Dans ${fmtDuration(wait)}` : 'Disponible'}</td>
                <td className="actions">
                  {isPending && <button className="btn small primary" onClick={() => void setStatus(p, 'active')}>Valider</button>}
                  {!isPending && wait > 0 && (
                    <button className="btn small" onClick={async () => { if (await run(() => api.resetFreeBooster(p.id), `Booster gratuit de ${nameOf(d, p.id)} débloqué`)) await refresh(); }}>Débloquer</button>
                  )}
                  {!isPending && p.id !== d.me?.id && <>{' '}<button className="btn small ghost" onClick={() => void setStatus(p, 'pending')}>Suspendre</button></>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
    </>
  );
}

export function SettingsAdmin() {
  const { api, d, refresh } = useAdmin();
  const run = useRunner();
  const [size, setSize] = useState(String(d.settings.booster_size));
  const [hours, setHours] = useState(String(Math.round(intervalMs(d.settings.free_booster_cooldown) / 36e5)));
  const [busy, setBusy] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const st = { booster_size: Math.max(1, Math.min(20, +size)), free_booster_cooldown: `${Math.max(1, +hours)} hours` };
    if (await run(() => api.saveSettings(st), 'Réglages enregistrés')) await refresh();
    setBusy(false);
  }
  return (
    <>
      <div className="view-head"><h2 className="h2">Réglages</h2></div>
      <form className="settings" onSubmit={save}>
        <label className="field"><span>Cartes par booster</span><input className="input narrow" type="number" min={1} max={20} value={size} onChange={e => setSize(e.target.value)} required /></label>
        <label className="field"><span>Délai entre deux boosters gratuits (heures)</span><input className="input narrow" type="number" min={1} max={720} value={hours} onChange={e => setHours(e.target.value)} required /></label>
        <p className="muted">Le nouveau délai s'applique à partir du prochain booster ouvert par chaque membre.</p>
        <div><button className="btn primary" disabled={busy}>Enregistrer</button></div>
      </form>
      <SignupCode />
    </>
  );
}

// Code d'inscription du club : lisible et modifiable par les administrateurs seulement
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans I, O, 0 ni 1, faciles à confondre
function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const chars = [...bytes].map(b => CODE_CHARS[b % CODE_CHARS.length]).join('');
  return `${CONFIG.clubShort.toUpperCase()}-${chars.slice(0, 4)}-${chars.slice(4)}`;
}

function SignupCode() {
  const { api, d, refresh } = useAdmin();
  const run = useRunner();
  const [code, setCode] = useState(d.signupCode ?? '');
  const [busy, setBusy] = useState(false);
  const value = code.trim();
  const invalid = value !== '' && (value.length < 4 || value.length > 40);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (invalid) return;
    setBusy(true);
    if (await run(() => api.saveSignupCode(value || null), value ? "Code d'inscription enregistré" : "Code d'inscription retiré")) await refresh();
    setBusy(false);
  }
  return (
    <>
      <h3 className="h3">Code d'inscription</h3>
      <form className="settings" onSubmit={save}>
        <p className="muted">Avec ce code, un nouveau compte est actif tout de suite. Sans code, ou avec un mauvais code, il attend ta validation. Change-le si tu penses qu'il a circulé hors du club.</p>
        <label className="field"><span>Code du club</span>
          <span className="with-btn">
            <input className="input mono" value={code} maxLength={40} onChange={e => setCode(e.target.value)} placeholder="Aucun code" aria-invalid={invalid} spellCheck={false} />
            <button type="button" className="btn" onClick={() => setCode(randomCode())}>Générer</button>
          </span>
        </label>
        <p className="hint">{invalid ? 'Le code doit faire entre 4 et 40 caractères.' : "Majuscules et espaces autour sont ignorés à l'inscription. Laisse vide pour que tout nouveau compte attende ta validation."}</p>
        <div><button className="btn primary" disabled={busy || invalid || value === (d.signupCode ?? '')}>Enregistrer</button></div>
      </form>
    </>
  );
}
