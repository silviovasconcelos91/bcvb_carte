import { useState, type FormEvent } from 'react';
import { fmtDuration, initial, intervalMs, sumValues } from '../lib/format';
import { useRunner } from '../components/Toasts';
import { nameOf, useAdmin } from './context';

export function MembersAdmin() {
  const { api, d, refresh } = useAdmin();
  const run = useRunner();
  const released = d.cards.filter(c => c.is_released).length;
  const cooldown = intervalMs(d.settings.free_booster_cooldown);
  return (
    <>
      <div className="view-head"><h2 className="h2">Membres</h2></div>
      <p className="lead">Pour ajouter un membre, invite-le depuis Supabase : Authentication, Users, Invite user. Il apparaît ici dès l'invitation.</p>
      <div className="table-wrap"><table className="tbl">
        <thead><tr><th>Membre</th><th className="num">Cartes</th><th className="num">Différentes</th><th>Booster gratuit</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>
          {d.profiles.map(p => {
            const inv = d.owned.get(p.id) ?? new Map<number, number>();
            const distinct = [...inv.keys()].filter(id => d.cardById.get(id)?.is_released).length;
            const wait = p.last_free_booster_at ? Date.parse(p.last_free_booster_at) + cooldown - Date.now() : 0;
            return (
              <tr key={p.id}>
                <td><span className="cell-card"><span className="avatar sm" aria-hidden="true">{initial(p.username)}</span><strong>{p.username}</strong>{d.adminSet.has(p.id) && <span className="pill">Admin</span>}</span></td>
                <td className="num">{sumValues(inv)}</td>
                <td className="num">{distinct} / {released}</td>
                <td>{wait > 0 ? `Dans ${fmtDuration(wait)}` : 'Disponible'}</td>
                <td className="actions">{wait > 0 && (
                  <button className="btn small" onClick={async () => { if (await run(() => api.resetFreeBooster(p.id), `Booster gratuit de ${nameOf(d, p.id)} débloqué`)) await refresh(); }}>Débloquer</button>
                )}</td>
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
    </>
  );
}
