import { plural, relTime } from '../lib/format';
import { Avatar } from '../components/visuals';
import { rClass, rarityLabel } from '../lib/lookup';
import { boosterPool, boosterSets, codeCard, codeCardUnreleased, codeStatus, nameOf, useAdmin, type AdminTab } from './context';

const PLAYER = /passe|libéro|central|pointu|récept|capitaine|entraîn|joueu/i;

export function Dashboard() {
  const { d, setTab } = useAdmin();
  const st = d.stats;
  const released = d.cards.filter(c => c.is_released);
  const drafts = d.cards.length - released.length;
  const waiting = d.profiles.filter(p => p.status === 'pending').length;
  const activeCodes = d.codes.filter(c => codeStatus(c) === 'active');
  const active = activeCodes.length;
  const figures: [number, string, string][] = [
    [d.profiles.length, 'membres', waiting ? `dont ${waiting} en attente` : ''],
    [released.length, 'cartes publiées', drafts ? `${drafts} en préparation` : 'aucune en préparation'],
    [st.nOpen, 'boosters ouverts', `${st.nOpenWeek} ces 7 derniers jours`],
    [st.nAccepted, 'échanges acceptés', `${st.nPending} en attente`],
    [active, active > 1 ? 'codes actifs' : 'code actif', `${d.codes.length} au total`],
  ];
  // Points à vérifier
  const checks: ['err' | 'info', string, AdminTab][] = [];
  if (waiting) checks.push(['info', `${plural(waiting, 'compte en attente', 'comptes en attente')} de validation.`, 'members']);
  const pool = boosterPool(d);
  if (!d.sets.some(s => s.in_boosters)) checks.push(['err', "Aucune série n'est dans les boosters standards : l'ouverture des boosters gratuits échouera.", 'sets']);
  else if (!pool.length) checks.push(['err', 'Aucune carte ne peut tomber dans un booster standard : publie des cartes dans une série active.', 'cards']);
  // Le membre choisit la série de son booster : chaque série active est vérifiée à part
  const dead = d.sets.filter(s => s.in_boosters && !pool.some(c => c.set_id === s.id));
  if (pool.length && dead.length) checks.push(['err', `${dead.length > 1 ? 'Séries actives' : 'Série active'} sans carte à tirer : ${dead.map(s => s.name).join(', ')}. Publie des cartes dans ${dead.length > 1 ? 'ces séries' : 'cette série'} ou retire-${dead.length > 1 ? 'les' : 'la'} des boosters standards.`, 'sets']);
  const sets = boosterSets(d);
  const gaps = sets.map(s => ({ s, empty: d.rarities.filter(r => r.weight > 0 && !pool.some(c => c.set_id === s.id && c.rarity_id === r.id)) })).filter(g => g.empty.length);
  const labels = (rs: { label: string }[]) => rs.map(r => r.label).join(', ');
  if (sets.length === 1 && gaps.length) checks.push(['info', `Aucune carte à tirer en ${labels(gaps[0].empty)} : ces raretés sont ignorées au tirage pour l'instant.`, 'rarities']);
  else if (gaps.length) checks.push(['info', `Raretés sans carte à tirer, ignorées au tirage pour l'instant : ${gaps.map(g => `${g.s.name} (${labels(g.empty)})`).join(' ; ')}.`, 'rarities']);
  const noPhoto = released.filter(c => !c.image_path && PLAYER.test(c.subtitle || '')).length;
  if (noPhoto) checks.push(['info', `${plural(noPhoto, 'carte de joueur publiée est', 'cartes de joueurs publiées sont')} encore sans photo.`, 'cards']);
  if (d.proposals.length) checks.push(['info', plural(d.proposals.length, 'proposition de carte attend', 'propositions de cartes attendent') + ' ton avis.', 'proposals']);
  if (drafts) checks.push(['info', `${plural(drafts, 'carte est', 'cartes sont')} en préparation, ${drafts > 1 ? 'invisibles' : 'invisible'} pour les membres.`, 'cards']);
  const unreleased = activeCodes.filter(c => codeCardUnreleased(d, c));
  if (unreleased.length) checks.push(['err', `${plural(unreleased.length, 'code actif donne', 'codes actifs donnent')} une carte non publiée, ${unreleased.length > 1 ? 'ils ne fonctionneront' : 'il ne fonctionnera'} pas : ${unreleased.map(c => `${c.code} (${codeCard(d, c)!.name})`).join(', ')}.`, 'codes']);
  const soon = activeCodes.filter(c => c.expires_at && Date.parse(c.expires_at) - Date.now() < 864e5);
  if (soon.length) checks.push(['info', `${plural(soon.length, 'code expire', 'codes expirent')} dans moins de 24 h : ${soon.map(c => c.code).join(', ')}.`, 'codes']);

  return (
    <>
      <h2 className="h2">Tableau de bord</h2>
      <div className="figures">
        {figures.map(([n, l, sub]) => <div className="figure" key={l}><span className="figure-num">{n}</span><span className="figure-lbl">{l}</span><span className="figure-sub">{sub}</span></div>)}
      </div>
      <div className="dash-cols">
        <section>
          <h3 className="h3">À vérifier</h3>
          {checks.length ? (
            <ul className="checks">{checks.map(([k, t, tab]) => <li key={t} className={`check-${k}`}><span>{t}</span><button className="btn small" onClick={() => setTab(tab)}>Voir</button></li>)}</ul>
          ) : <p className="muted">Rien à signaler.</p>}
        </section>
        <section>
          <h3 className="h3">Derniers boosters ouverts</h3>
          {d.recent.length ? (
            <ul className="activity">
              {d.recent.map(o => {
                const code = o.code_id ? d.codes.find(c => c.id === o.code_id) : undefined;
                return (
                  <li key={o.id}>
                    <Avatar name={nameOf(d, o.user_id)} small />
                    <span className="act-main"><strong>{nameOf(d, o.user_id)}</strong><span className="muted">{relTime(o.opened_at)}{code ? `, code ${code.code}` : ''}{o.god_pack ? ', god pack' : ''}</span></span>
                    <span className="act-cards">
                      {o.card_ids.map((id, i) => { const c = d.cardById.get(id); return c ? <i key={i} className={`dot ${rClass(d.lookup, c)}`} title={`${c.name}, ${rarityLabel(d.lookup, c.rarity_id)}`} /> : null; })}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : <p className="muted">Aucun booster ouvert pour l'instant.</p>}
        </section>
      </div>
    </>
  );
}
