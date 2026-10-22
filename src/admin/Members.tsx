import { useState, type FormEvent } from 'react';
import { CONFIG } from '../config';
import type { MemberStatus, Profile } from '../lib/types';
import { fmtDuration, freeBoosters, intervalMs, randomChars, sumValues } from '../lib/format';
import { Avatar } from '../components/visuals';
import { useRunner, useToast } from '../components/Toasts';
import { Modal } from '../components/Modal';
import { PASSWORD_MIN } from '../lib/auth';
import { nameOf, useAdmin, useRunRefresh } from './context';

export function MembersAdmin() {
  const { api, d } = useAdmin();
  const runRefresh = useRunRefresh();
  const released = d.cards.filter(c => c.is_released).length;
  // Comptes en attente en premier, puis ordre alphabétique (celui du chargement)
  const list = [...d.profiles].sort((a, b) => +(b.status === 'pending') - +(a.status === 'pending'));
  const [pwFor, setPwFor] = useState<Profile | null>(null);
  const setStatus = async (p: Profile, status: MemberStatus) => {
    const msg = status === 'active' ? `Compte de ${p.username} validé` : `Compte de ${p.username} suspendu`;
    await runRefresh(() => api.setMemberStatus(p.id, status), msg);
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
            const fb = freeBoosters(p.last_free_booster_at, d.settings);
            const isPending = p.status === 'pending';
            return (
              <tr key={p.id}>
                <td><span className="cell-card"><Avatar name={p.username} small /><strong>{p.username}</strong>{d.adminSet.has(p.id) && <span className="pill">Admin</span>}</span></td>
                <td><span className={`pill ${isPending ? 'warn' : 'ok'}`}>{isPending ? 'En attente' : 'Actif'}</span></td>
                <td className="num">{sumValues(inv)}</td>
                <td className="num">{distinct} / {released}</td>
                <td>{!fb.available ? `Dans ${fmtDuration(fb.nextIn)}` : fb.max > 1 ? `${fb.available} / ${fb.max} disponibles` : 'Disponible'}</td>
                <td className="actions">
                  {isPending && <button className="btn small primary" onClick={() => void setStatus(p, 'active')}>Valider</button>}
                  {!isPending && fb.available < fb.max && (
                    <button className="btn small" onClick={() => void runRefresh(() => api.resetFreeBooster(p.id), `Boosters gratuits de ${nameOf(d, p.id)} rechargés`)}>Recharger</button>
                  )}
                  {!d.adminSet.has(p.id) && <>{' '}<button className="btn small" onClick={() => setPwFor(p)}>Mot de passe</button></>}
                  {!isPending && p.id !== d.me?.id && <>{' '}<button className="btn small ghost" onClick={() => void setStatus(p, 'pending')}>Suspendre</button></>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
      {pwFor && <PasswordReset member={pwFor} onClose={() => setPwFor(null)} />}
    </>
  );
}

// Mot de passe perdu : l'administrateur en donne un nouveau, à transmettre au membre de vive voix
const PW_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789'; // sans i, l, o, 0 ni 1, faciles à confondre
function randomPassword(): string {
  const chars = randomChars(PW_CHARS, 12);
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
}

function PasswordReset({ member, onClose }: { member: Profile; onClose: () => void }) {
  const { api } = useAdmin();
  const run = useRunner();
  const toast = useToast();
  const [password, setPassword] = useState(randomPassword);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ login: string; password: string } | null>(null);
  const tooShort = password.trim().length < PASSWORD_MIN;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (tooShort) return;
    setBusy(true);
    let login = '';
    if (await run(async () => { login = await api.setPassword(member.id, password.trim()); }, `Mot de passe de ${member.username} changé`)) setDone({ login, password: password.trim() });
    setBusy(false);
  }
  async function copy() {
    if (!done) return;
    try {
      await navigator.clipboard.writeText(`Identifiant : ${done.login}\nMot de passe : ${done.password}`);
      toast('Copié');
    } catch {
      toast('Copie impossible : sélectionne le texte à la main.', true);
    }
  }

  return (
    <Modal title={`Mot de passe de ${member.username}`} onClose={onClose}
      footer={done
        ? <span className="foot-btns"><button className="btn" onClick={() => void copy()}>Copier</button><button className="btn primary" onClick={onClose}>Terminé</button></span>
        : <span className="foot-btns"><button className="btn" onClick={onClose}>Annuler</button><button className="btn primary" form="pw-form" disabled={busy || tooShort}>Changer le mot de passe</button></span>}>
      {done ? (
        <div className="settings">
          <p>Transmets ces informations au membre, qui pourra ensuite choisir son propre mot de passe en cliquant sur son pseudo, en haut du jeu.</p>
          <label className="field"><span>Identifiant de connexion</span><input className="input mono pw" value={done.login} readOnly /></label>
          <label className="field"><span>Nouveau mot de passe</span><input className="input mono pw" value={done.password} readOnly /></label>
        </div>
      ) : (
        <form id="pw-form" className="settings" onSubmit={save}>
          <p className="muted">Le mot de passe actuel ne fonctionnera plus et les sessions ouvertes de {member.username} seront fermées sur tous ses appareils.</p>
          <label className="field"><span>Nouveau mot de passe</span>
            <span className="with-btn">
              <input className="input mono pw" value={password} minLength={PASSWORD_MIN} maxLength={72} onChange={e => setPassword(e.target.value)} spellCheck={false} autoComplete="off" required aria-invalid={tooShort} />
              <button type="button" className="btn" onClick={() => setPassword(randomPassword())}>Générer</button>
            </span>
          </label>
          <p className="hint">{tooShort ? `Au moins ${PASSWORD_MIN} caractères.` : 'Un mot de passe généré est facile à dicter : pas de lettres ni de chiffres qui se ressemblent.'}</p>
        </form>
      )}
    </Modal>
  );
}

export function SettingsAdmin() {
  const { api, d } = useAdmin();
  const runRefresh = useRunRefresh();
  const [size, setSize] = useState(String(d.settings.booster_size));
  const shownHours = String(Math.round(intervalMs(d.settings.free_booster_cooldown) / 36e5));
  const [hours, setHours] = useState(shownHours);
  const [stock, setStock] = useState(String(d.settings.free_booster_max ?? 1));
  const [busy, setBusy] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    // Délai non modifié : la valeur exacte de la base est gardée (ex. « 90 minutes »), sans arrondi en heures
    const cooldown = hours === shownHours ? d.settings.free_booster_cooldown : `${Math.max(1, +hours)} hours`;
    const st = { booster_size: Math.max(1, Math.min(20, +size)), free_booster_cooldown: cooldown, free_booster_max: Math.max(1, Math.min(10, +stock)) };
    await runRefresh(() => api.saveSettings(st), 'Réglages enregistrés');
    setBusy(false);
  }
  return (
    <>
      <div className="view-head"><h2 className="h2">Réglages</h2></div>
      <form className="settings" onSubmit={save}>
        <label className="field"><span>Cartes par booster</span><input className="input narrow" type="number" min={1} max={20} value={size} onChange={e => setSize(e.target.value)} required /></label>
        <label className="field"><span>Délai entre deux boosters gratuits (heures)</span><input className="input narrow" type="number" min={1} max={720} value={hours} onChange={e => setHours(e.target.value)} required /></label>
        <label className="field"><span>Boosters gratuits cumulables</span><input className="input narrow" type="number" min={1} max={10} value={stock} onChange={e => setStock(e.target.value)} required /></label>
        <p className="muted">Un booster se recharge à chaque délai. Un membre qui ne passe pas en garde jusqu'à ce nombre en réserve ; avec 1, le compteur s'arrête au premier booster. Les changements s'appliquent tout de suite.</p>
        <div><button className="btn primary" disabled={busy}>Enregistrer</button></div>
      </form>
      <SignupCode />
    </>
  );
}

// Code d'inscription du club : lisible et modifiable par les administrateurs seulement
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans I, O, 0 ni 1, faciles à confondre
function randomCode(): string {
  const chars = randomChars(CODE_CHARS, 8);
  return `${CONFIG.clubShort.toUpperCase()}-${chars.slice(0, 4)}-${chars.slice(4)}`;
}

function SignupCode() {
  const { api, d } = useAdmin();
  const runRefresh = useRunRefresh();
  const [code, setCode] = useState(d.signupCode ?? '');
  const [busy, setBusy] = useState(false);
  const value = code.trim();
  const invalid = value !== '' && (value.length < 4 || value.length > 40);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (invalid) return;
    setBusy(true);
    await runRefresh(() => api.saveSignupCode(value || null), value ? "Code d'inscription enregistré" : "Code d'inscription retiré");
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
