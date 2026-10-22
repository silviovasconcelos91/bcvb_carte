import { useEffect, useState, type FormEvent } from 'react';
import { errMsg, fmtDuration, freeBoosters, intervalMs, plural } from '../lib/format';
import { Court, Pack } from '../components/visuals';
import { useToast } from '../components/Toasts';
import { useGame, type GameIndex } from './context';

export function boosterSetLabel(d: GameIndex) {
  const count = d.lookup.setCount;
  const sets = d.sets.filter(s => s.in_boosters && count.get(s.id));
  return sets.length === 1 ? sets[0].name : 'Toutes les séries';
}

export function BoosterView() {
  const { api, d, refresh, showReveal, pendingCode, setPendingCode } = useGame();
  const toast = useToast();
  const [busy, setBusy] = useState<'free' | 'code' | null>(null);
  const [code, setCode] = useState(pendingCode);
  const [, setTick] = useState(0); // re-rendu régulier pour le compte à rebours
  useEffect(() => { const t = setInterval(() => setTick(n => n + 1), 30000); return () => clearInterval(t); }, []);
  useEffect(() => { setCode(pendingCode); }, [pendingCode]);

  const st = d.settings;
  const cooldown = intervalMs(st.free_booster_cooldown);
  const hours = Math.round(cooldown / 36e5);
  const every = cooldown < 36e5 ? `toutes les ${Math.round(cooldown / 6e4)} min`
    : hours % 24 === 0 ? (hours === 24 ? 'par jour' : `tous les ${hours / 24} jours`) : `toutes les ${hours} h`;
  const { available, max, nextIn } = freeBoosters(d.me.last_free_booster_at, st);
  const status = !available ? `Le prochain sera disponible dans ${fmtDuration(nextIn)}.`
    : available >= max ? (max > 1 ? `Tes ${max} boosters sont prêts.` : 'Ton booster est prêt.')
    : `${available > 1 ? `${available} boosters prêts` : 'Ton booster est prêt'}, le suivant se recharge dans ${fmtDuration(nextIn)}.`;

  async function open(withCode: string | null) {
    setBusy(withCode ? 'code' : 'free');
    try {
      const cards = await api.openBooster(withCode);
      if (withCode) { setPendingCode(''); setCode(''); }
      await refresh();
      showReveal(cards);
    } catch (e) {
      toast(errMsg(e), true);
    } finally {
      setBusy(null);
    }
  }
  const submit = (e: FormEvent) => { e.preventDefault(); if (code.trim()) void open(code.trim()); };

  return (
    <section aria-labelledby="booster-title">
      <h2 id="booster-title" className="sr-only">Booster</h2>
      <div className="stage">
        <div className="stage-top"><Court /><div className="pack-spot"><Pack setLabel={boosterSetLabel(d)} /></div></div>
        <div className="stage-in">
          <button className="btn primary big" disabled={!available || busy !== null} onClick={() => void open(null)}>
            {busy === 'free' ? 'Ouverture…' : !available ? 'Booster déjà ouvert' : available > 1 ? `Ouvrir un booster (${available} dispo)` : 'Ouvrir mon booster'}
          </button>
          <p className="cooldown" aria-live="polite">{status}</p>
          {pendingCode && <p className="cooldown">Code scanné : il ne reste plus qu'à l'utiliser.</p>}
          <form className="code-form" onSubmit={submit}>
            <label htmlFor="code-input">Tu as un code&nbsp;?</label>
            <input id="code-input" className="input" placeholder="Saisis-le ici" value={code} onChange={e => setCode(e.target.value)}
              autoComplete="off" autoCapitalize="characters" spellCheck={false} required />
            <button className="btn on-dark" disabled={busy !== null}>{busy === 'code' ? 'Ouverture…' : 'Utiliser le code'}</button>
          </form>
        </div>
      </div>
      <div className="howto">
        <h3 className="h3">Comment gagner des cartes</h3>
        <p>Chaque booster contient {plural(st.booster_size, 'carte', 'cartes')}. Tu as droit à un booster {every}{max > 1 ? `, et tu peux en garder jusqu'à ${max} en réserve si tu ne passes pas` : ''}. Des codes sont affichés au gymnase pendant les matchs à domicile et les événements du club : chaque code donne un booster, une fois par personne.</p>
        {api.mode === 'demo' && <p>Codes de démo : <code>MATCH-14NOV</code> ; <code>NOEL26</code>, un booster de la série Tournoi de Noël ; <code>NOEL-1</code>, une carte de cette série ; <code>SOIREE</code>, la carte « Le trophée du club ».</p>}
      </div>
    </section>
  );
}
