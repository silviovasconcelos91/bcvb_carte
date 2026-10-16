import { useState, type FormEvent } from 'react';
import qrcode from 'qrcode-generator';
import type { BoosterCode } from '../lib/types';
import { CONFIG } from '../config';
import { fmtDateLong } from '../lib/format';
import { Logo } from '../components/visuals';
import { Modal } from '../components/Modal';
import { useConfirm } from '../components/Confirm';
import { useRunner } from '../components/Toasts';
import { CODE_STATUS, codeStatus, useAdmin } from './context';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode = () => `${CONFIG.clubShort}-` + Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
const appUrl = () => CONFIG.appUrl || `${window.location.origin}/`;

export function CodesAdmin() {
  const { api, d, refresh } = useAdmin();
  const run = useRunner();
  const confirm = useConfirm();
  const empty = { code: newCode(), label: '', set_id: '', max_uses: '', expires_at: '' };
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [poster, setPoster] = useState<BoosterCode | null>(null);
  const set = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }));

  async function create(e: FormEvent) {
    e.preventDefault();
    const row = {
      code: form.code.trim().toUpperCase(), label: form.label.trim() || null, set_id: form.set_id ? +form.set_id : null,
      max_uses: form.max_uses ? +form.max_uses : null, expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
    };
    setBusy(true);
    if (await run(() => api.saveCode(row), `Code ${row.code} créé`)) { setForm({ ...empty, code: newCode() }); await refresh(); }
    setBusy(false);
  }
  async function stop(c: BoosterCode) {
    if (await run(() => api.saveCode({ id: c.id, expires_at: new Date().toISOString() }), 'Code désactivé')) await refresh();
  }
  async function remove(c: BoosterCode) {
    if (!(await confirm.ask('Supprimer le code', `Le code ${c.code} ne fonctionnera plus et son historique d'utilisation sera effacé.`, 'Supprimer'))) return;
    if (await run(() => api.deleteCode(c.id), 'Code supprimé')) await refresh();
  }

  return (
    <>
      <div className="view-head"><h2 className="h2">Codes</h2></div>
      <p className="lead">Chaque code donne un booster, une fois par membre. Affiche-le au gymnase : le QR code ouvre le jeu avec le code déjà saisi.</p>
      <form className="code-new" onSubmit={create}>
        <label className="field"><span>Code</span><span className="with-btn">
          <input className="input mono" value={form.code} onChange={e => set('code', e.target.value)} required maxLength={30} pattern="[A-Za-z0-9\-]+" title="Lettres, chiffres et tirets" />
          <button type="button" className="btn small" onClick={() => set('code', newCode())}>Autre</button>
        </span></label>
        <label className="field"><span>Libellé</span><input className="input" placeholder="Match à domicile du 14/11" maxLength={80} value={form.label} onChange={e => set('label', e.target.value)} /></label>
        <label className="field"><span>Booster</span><span className="select-wrap"><select className="select" value={form.set_id} onChange={e => set('set_id', e.target.value)}>
          <option value="">Standard</option>{d.sets.map(s => <option key={s.id} value={s.id}>Série {s.name}</option>)}
        </select></span></label>
        <label className="field"><span>Utilisations max</span><input className="input" type="number" min={1} placeholder="Illimitées" value={form.max_uses} onChange={e => set('max_uses', e.target.value)} /></label>
        <label className="field"><span>Expire le</span><input className="input" type="datetime-local" value={form.expires_at} onChange={e => set('expires_at', e.target.value)} /></label>
        <button className="btn primary" disabled={busy}>Créer le code</button>
      </form>
      <div className="table-wrap"><table className="tbl">
        <thead><tr><th>Code</th><th>Libellé</th><th>Booster</th><th className="num">Utilisations</th><th>Expiration</th><th>Statut</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>
          {d.codes.length ? d.codes.map(c => {
            const status = codeStatus(c);
            return (
              <tr key={c.id}>
                <td><code>{c.code}</code></td>
                <td>{c.label}</td>
                <td>{c.set_id ? d.lookup.setById.get(c.set_id)?.name ?? 'Série supprimée' : 'Standard'}</td>
                <td className="num">{c.uses_count}{c.max_uses ? ` / ${c.max_uses}` : ''}</td>
                <td>{c.expires_at ? fmtDateLong(c.expires_at) : 'Jamais'}</td>
                <td><span className={`pill${status === 'active' ? ' ok' : ''}`}>{CODE_STATUS[status]}</span></td>
                <td className="actions">
                  <button className="btn small" onClick={() => setPoster(c)}>Affiche</button>
                  {status === 'active' && <> <button className="btn small" onClick={() => void stop(c)}>Désactiver</button></>}
                  {' '}<button className="btn small danger" onClick={() => void remove(c)}>Supprimer</button>
                </td>
              </tr>
            );
          }) : <tr><td colSpan={7} className="empty-cell">Aucun code pour l'instant.</td></tr>}
        </tbody>
      </table></div>
      {poster && <Poster code={poster} onClose={() => setPoster(null)} />}
      {confirm.element}
    </>
  );
}

// Affiche imprimable : QR code vers le jeu avec le code pré-rempli
function Poster({ code, onClose }: { code: BoosterCode; onClose: () => void }) {
  const url = `${appUrl()}?code=${encodeURIComponent(code.code)}`;
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  const svg = qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
  return (
    <Modal title={`Affiche du code ${code.code}`} onClose={onClose}
      footer={<><p className="hint poster-url">{url}</p><span className="foot-btns"><button className="btn primary" onClick={() => window.print()}>Imprimer l'affiche</button></span></>}>
      <div className="poster">
        <div className="poster-brand"><Logo /><span>{CONFIG.clubName}</span></div>
        <p className="poster-title">Un booster à gagner</p>
        <div className="poster-qr" role="img" aria-label={`QR code du code ${code.code}`} dangerouslySetInnerHTML={{ __html: svg }} />
        <p className="poster-code">{code.code}</p>
        <p className="poster-help">Scanne le QR code avec ton téléphone, ou saisis ce code dans l'onglet Booster du jeu.</p>
        {code.label && <p className="poster-label">{code.label}</p>}
        {code.expires_at && <p className="poster-label">Valable jusqu'au {fmtDateLong(code.expires_at)}</p>}
      </div>
    </Modal>
  );
}
