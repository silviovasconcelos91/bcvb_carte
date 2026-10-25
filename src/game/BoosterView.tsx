import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import { errMsg, fmtDuration, freeBoosters, intervalMs, percent, plural } from '../lib/format';
import { isSecret } from '../lib/lookup';
import { Court, Pack } from '../components/visuals';
import { useToast } from '../components/Toasts';
import { useGame, type GameIndex } from './context';

// Séries qui tombent dans les boosters standards et ont au moins une carte publiée
export function boosterSets(d: GameIndex) {
  return d.sets.filter(s => s.in_boosters && d.lookup.setCount.get(s.id));
}

// Pochette d'une série : son nom et une teinte stable (rang de la série, voir .pack.tone1 et suivants).
// null : booster de toutes les séries, aux couleurs du club.
export function packOf(d: GameIndex, setId: number | null): { setLabel: string; tone: number } {
  if (setId == null) {
    const sets = boosterSets(d);
    return sets.length === 1 ? packOf(d, sets[0].id) : { setLabel: 'Toutes les séries', tone: 0 };
  }
  const i = d.sets.findIndex(s => s.id === setId);
  return { setLabel: d.lookup.setById.get(setId)?.name ?? '', tone: Math.max(0, i) % 4 };
}

// Série retenue d'une visite à l'autre ; à défaut, la plus récente
const SET_KEY = 'cartes-booster-set';
const readSet = () => { try { return Number(localStorage.getItem(SET_KEY)) || null; } catch { return null; } };

export function BoosterView() {
  const { api, d, refresh, showReveal, pendingCode, setPendingCode } = useGame();
  const toast = useToast();
  const [busy, setBusy] = useState<'free' | 'code' | null>(null);
  const [code, setCode] = useState(pendingCode);
  const [stored, setStored] = useState(readSet);
  const [, setTick] = useState(0); // re-rendu régulier pour le compte à rebours
  useEffect(() => { const t = setInterval(() => setTick(n => n + 1), 30000); return () => clearInterval(t); }, []);
  useEffect(() => { setCode(pendingCode); }, [pendingCode]);

  // Le choix n'apparaît qu'avec plusieurs séries ; avec une seule, le booster reste celui de toutes les séries
  const sets = boosterSets(d);
  const picking = sets.length > 1;
  const setId = !picking ? null : sets.some(s => s.id === stored) ? stored : sets[sets.length - 1].id;
  const choose = (id: number) => {
    setStored(id);
    try { localStorage.setItem(SET_KEY, String(id)); } catch { /* gardé en mémoire */ }
  };
  const chosen = setId == null ? null : d.lookup.setById.get(setId);

  const st = d.settings;
  const cooldown = intervalMs(st.free_booster_cooldown);
  const hours = Math.round(cooldown / 36e5);
  const every = cooldown < 36e5 ? `toutes les ${Math.round(cooldown / 6e4)} min`
    : hours % 24 === 0 ? (hours === 24 ? 'par jour' : `tous les ${hours / 24} jours`) : `toutes les ${hours} h`;
  const { available, max, nextIn } = freeBoosters(d.me.last_free_booster_at, st);
  const status = !available ? `Le prochain sera disponible dans ${fmtDuration(nextIn)}.`
    : available >= max ? (max > 1 ? `Tes ${max} boosters sont prêts.` : 'Ton booster est prêt.')
    : `${available > 1 ? `${available} boosters prêts` : 'Ton booster est prêt'}, le suivant se recharge dans ${fmtDuration(nextIn)}.`;

  // Cartes différentes possédées et total affiché d'une série (secrètes possédées comprises, comme le classeur)
  function progress(id: number) {
    const inSet = d.cards.filter(c => c.set_id === id);
    return { owned: inSet.filter(c => d.mine.get(c.id)).length, total: inSet.filter(c => !isSecret(d.lookup, c)).length };
  }

  async function open(withCode: string | null) {
    setBusy(withCode ? 'code' : 'free');
    try {
      const cards = await api.openBooster(withCode, setId);
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

  // Groupe de boutons radio : les flèches passent d'une série à l'autre
  function onPickerKey(e: KeyboardEvent<HTMLDivElement>) {
    const step = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as Record<string, number>)[e.key];
    if (!step || setId == null) return;
    e.preventDefault();
    const next = sets[(sets.findIndex(s => s.id === setId) + step + sets.length) % sets.length];
    choose(next.id);
    e.currentTarget.querySelector<HTMLElement>(`[data-set="${next.id}"]`)?.focus();
  }

  const chosenProgress = chosen && progress(chosen.id);
  const left = chosenProgress ? chosenProgress.total - chosenProgress.owned : 0;
  const openLabel = busy === 'free' ? 'Ouverture…' : !available ? 'Booster déjà ouvert'
    : chosen ? `Ouvrir un booster ${chosen.name}${available > 1 ? ` (${available} dispo)` : ''}`
    : available > 1 ? `Ouvrir un booster (${available} dispo)` : 'Ouvrir mon booster';

  return (
    <section aria-labelledby="booster-title">
      <h2 id="booster-title" className="sr-only">Booster</h2>
      <div className="stage">
        <div className="stage-top">
          <Court />
          {picking ? (
            <div className="set-picker" role="radiogroup" aria-label="Série du booster" onKeyDown={onPickerKey}>
              {sets.map(s => {
                const { owned, total } = progress(s.id);
                const on = s.id === setId;
                return (
                  <button key={s.id} type="button" className="set-opt" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} data-set={s.id} onClick={() => choose(s.id)}>
                    <span className="set-opt-pack"><Pack {...packOf(d, s.id)} ribbon={owned ? undefined : 'À découvrir'} /></span>
                    <span className="set-opt-label">
                      <span className="set-opt-name">{s.name}</span>
                      <span className="set-opt-count">{owned}/{total} cartes</span>
                      <span className="set-opt-bar" aria-hidden="true"><i style={{ width: `${percent(owned, total)}%` }} /></span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="pack-spot"><Pack {...packOf(d, null)} /></div>
          )}
        </div>
        <div className="stage-in">
          {chosen && (
            <p className="cooldown" aria-live="polite">
              {left <= 0 ? 'Série complète : tu peux encore y trouver des doubles à échanger.' : `Il te manque ${plural(left, 'carte', 'cartes')} de cette série.`}
            </p>
          )}
          <button className="btn primary big" disabled={!available || busy !== null} onClick={() => void open(null)}>{openLabel}</button>
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
        {picking && <p>Avant d'ouvrir un booster, choisis sa série : toutes ses cartes viendront de celle-ci. Un code prévu pour une série précise donne toujours un booster de cette série.</p>}
        {api.mode === 'demo' && <p>Codes de démo : <code>MATCH-14NOV</code> ; <code>NOEL26</code>, un booster de la série Tournoi de Noël ; <code>NOEL-1</code>, une carte de cette série ; <code>SOIREE</code>, la carte « Le trophée du club ».</p>}
      </div>
    </section>
  );
}
