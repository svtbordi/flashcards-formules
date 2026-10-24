'use strict';
/* Flashcards formules BCPST : répétition espacée (FSRS) sur les théorèmes, définitions et formules du programme.
   Toutes les données restent dans le navigateur de l'élève (localStorage). Même code de base que l'application
   de définitions de SVT, sans suivi par l'enseignant. */

const { fsrs, generatorParameters, createEmptyCard, Rating, State } = window.FSRS;

// Une matière par jeu de cartes, chacune avec sa propre progression. Les clés sont propres à cette application :
// les applications publiées sur svtbordi.github.io partagent le même stockage.
const MATIERES = {
  maths: {
    nom: 'Mathématiques', court: 'Maths', data: 'data/', store: 'fc-formules-maths-v1', deck: 'fc-formules-maths-deck-v1',
    formTitre: 'Formulaire (une égalité par carte)', formUnite: ['égalité', 'égalités'], formDesc: 'trigonométrie, primitives, développements limités',
    exemples: 'Bayes, rang, primitive…', raccourcis: [],
  },
  physique: {
    nom: 'Physique-chimie', court: 'Physique', data: 'data/physique/', store: 'fc-formules-physique-v1', deck: 'fc-formules-physique-deck-v1',
    formTitre: 'Formulaire', formUnite: ['carte', 'cartes'], formDesc: 'formules, unités, constantes, ordres de grandeur',
    exemples: 'Snell-Descartes, photon, indice…',
    raccourcis: [{ id: 'go-og', label: 'Ordres de grandeur', desc: 'à connaître et à retrouver · à volonté, sans limite', sel: ['F-OGC', 'F-OGR'] }],
  },
};
const MATIERE_KEY = 'fc-formules-matiere-v1';
let matiere = null;
try {
  matiere = localStorage.getItem(MATIERE_KEY);
  // élèves qui utilisaient l'application avant l'arrivée de la physique : ils restent en mathématiques
  if (!MATIERES[matiere] && localStorage.getItem(MATIERES.maths.store)) localStorage.setItem(MATIERE_KEY, matiere = 'maths');
} catch (e) { /* stockage bloqué */ }
const M = MATIERES[matiere] || MATIERES.maths;
const STORE_KEY = M.store;
const DECK_KEY = M.deck;
const DAY_START_HOUR = 4; // une « journée » de révision commence à 4 h, comme dans Anki
const MASTERED_DAYS = 21; // carte considérée comme acquise au-delà de 21 jours de stabilité
const APP_NAME = 'Formules BCPST';
const QCM_SIZE = 10; // questions de l'échauffement

const DEFAULT_SETTINGS = {
  newPerDay: 15,
  dailyGoal: 30,
  buttons: 2,
  retention: 0.9,
  reminderTime: '18:00',
  vus: [], // chapitres vus en cours, choisis par l'élève : source des nouvelles cartes des révisions du jour
};

/* ---------- Stockage ---------- */

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    toast('Impossible d’enregistrer : stockage plein ou bloqué.');
    return false;
  }
}

const store = Object.assign(
  { cards: {}, log: [], days: {}, settings: {}, selection: [], qcmLog: [], pendingReports: [] },
  loadJSON(STORE_KEY, {})
);
store.settings = Object.assign({}, DEFAULT_SETTINGS, store.settings);
const persist = () => saveJSON(STORE_KEY, store);

/* ---------- Dates ---------- */

function dayKey(date = new Date()) {
  const d = new Date(date.getTime() - DAY_START_HOUR * 3600e3);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function endOfStudyDay(now = new Date()) {
  const d = new Date(now.getTime() - DAY_START_HOUR * 3600e3);
  d.setHours(24 + DAY_START_HOUR, 0, 0, 0);
  return d;
}

function today() {
  const k = dayKey();
  if (!store.days[k]) store.days[k] = { reviews: 0, newCards: 0, again: 0 };
  return store.days[k];
}

function streak() {
  let n = 0;
  const d = new Date();
  if (!(store.days[dayKey(d)] && store.days[dayKey(d)].reviews)) d.setDate(d.getDate() - 1);
  while (store.days[dayKey(d)] && store.days[dayKey(d)].reviews > 0) {
    n += 1;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

/* ---------- FSRS ---------- */

let scheduler = makeScheduler();

function makeScheduler() {
  return fsrs(generatorParameters({
    request_retention: store.settings.retention,
    maximum_interval: 365,
    enable_fuzz: true,
    learning_steps: ['10m'],
    relearning_steps: ['10m'],
  }));
}

function toCard(saved) {
  return Object.assign({}, saved, {
    due: new Date(saved.due),
    last_review: saved.last_review ? new Date(saved.last_review) : undefined,
  });
}

function fromCard(card) {
  return Object.assign({}, card, {
    due: card.due.toISOString(),
    last_review: card.last_review ? new Date(card.last_review).toISOString() : undefined,
  });
}

function stateOf(id) {
  const s = store.cards[id];
  return s ? toCard(s) : null;
}

function retrievability(card, now = new Date()) {
  if (!card || card.state === State.New) return 0;
  try {
    return scheduler.get_retrievability(card, now, false);
  } catch (e) {
    return 0;
  }
}

/* ---------- Cartes et chapitres ---------- */

let deck = { version: '', cards: [] };
let chapters = [];
const chapterTitle = {};
const chapterGroup = {};
const chapterOrder = {};
const GROUPS = ['BCPST1', 'BCPST2', 'Autres', 'Formulaire'];
const GROUP_TITLE = { BCPST1: 'BCPST 1', BCPST2: 'BCPST 2', Autres: 'Hors des chapitres du programme', Formulaire: M.formTitre };

function normText(s) {
  return String(s).trim().toLowerCase()
    .replace(/œ/g, 'oe').replace(/’/g, "'").replace(/ /g, ' ')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

// Texte d'une carte sans LaTeX, pour la recherche et les signalements : « $\cos(a+b)$ » donne « cos(a+b) »
function plain(s) {
  return String(s).replace(/\$/g, '').replace(/\\(?:left|right|displaystyle|dfrac|frac|mathrm|,|;|!)/g, ' ')
    .replace(/\\([a-zA-Z]+)/g, '$1').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
}

// Une sélection contient des codes de chapitres (« A3 », « F-TRIG ») ou de groupes (« @Formulaire »)
function matchesSelection(card, selected) {
  return selected.includes(card.chap) || selected.includes('@' + chapterGroup[card.chap]);
}

const cardOrderKey = c => (chapterOrder[c.chap] ?? 9999) * 1e4 + deck.index.get(c.id);

async function loadDeck() {
  const [bundled, chaps, conf] = await Promise.all([
    fetch(M.data + 'cartes.json').then(r => r.json()),
    fetch(M.data + 'chapitres.json').then(r => r.json()),
    fetch('config.json', { cache: 'no-cache' }).then(r => r.json()).catch(() => ({})),
  ]);
  config = conf || {};
  chapters = chaps;
  chapters.forEach((c, i) => {
    chapterTitle[c.code] = c.title;
    chapterGroup[c.code] = c.group;
    chapterOrder[c.code] = i;
  });
  const saved = loadJSON(DECK_KEY, null);
  setDeck(saved && saved.version >= bundled.version ? saved : bundled, false);
  bundledVersion = bundled.version;
}
let bundledVersion = '';
let config = {};

function setDeck(newDeck, persistIt) {
  deck = newDeck;
  deck.cards = deck.cards.filter(c => chapterTitle[c.chap]);
  deck.index = new Map(deck.cards.map((c, i) => [c.id, i]));
  if (persistIt) saveJSON(DECK_KEY, { version: newDeck.version, cards: newDeck.cards });
}

const isStarted = c => { const st = store.cards[c.id]; return !!st && st.state !== State.New; };

/* ---------- Affichage des formules ---------- */

// Texte avec formules entre $…$ : les formules passent par KaTeX, le reste est échappé ;
// « ; » entre deux formules sépare des énoncés, affichés sur des lignes distinctes.
function tex(s) {
  return String(s).split(/(\$[^$]+\$)/).map((part, i) => {
    if (i % 2) {
      try {
        return katex.renderToString(part.slice(1, -1), { throwOnError: false, strict: false });
      } catch (e) {
        return esc(part);
      }
    }
    return esc(part).replace(/\s;\s/g, '<br>');
  }).join('');
}

/* ---------- Statistiques ---------- */

function cardStatus(c, now, endDay) {
  const st = stateOf(c.id);
  if (!st || st.state === State.New) return 'new';
  if (st.due <= endDay) return 'due';
  if (st.stability >= MASTERED_DAYS) return 'mastered';
  return 'learning';
}

function statsFor(cards) {
  const now = new Date();
  const endDay = endOfStudyDay(now);
  const s = { total: cards.length, new: 0, due: 0, learning: 0, mastered: 0 };
  for (const c of cards) s[cardStatus(c, now, endDay)] += 1;
  s.seen = s.total - s.new;
  return s;
}

function startedChapters() {
  const codes = new Set();
  for (const c of deck.cards) {
    const st = store.cards[c.id];
    if (st && st.reps > 0) codes.add(c.chap);
  }
  return [...codes];
}

function updateBadge() {
  const n = statsFor(deck.cards).due;
  try {
    if (navigator.setAppBadge) n ? navigator.setAppBadge(n) : navigator.clearAppBadge();
  } catch (e) { /* non pris en charge */ }
}

/* ---------- Séance ---------- */

let session = null;

// Révisions du jour : toute carte déjà commencée, selon son calendrier, et les nouvelles cartes des chapitres vus en cours.
function inScope(c, selected, reviews) {
  return matchesSelection(c, selected) || (reviews && isStarted(c));
}

function buildSession(selected, { ahead = false, label = '', reviews = false } = {}) {
  const now = new Date();
  const endDay = endOfStudyDay(now);
  const pool = deck.cards.filter(c => inScope(c, selected, reviews));
  const due = [];
  const fresh = [];
  const notDue = [];
  for (const c of pool) {
    const st = stateOf(c.id);
    if (!st || st.state === State.New) fresh.push(c);
    else if (st.due <= endDay) due.push({ c, r: retrievability(st, now) });
    else notDue.push({ c, r: retrievability(st, now) });
  }
  due.sort((a, b) => a.r - b.r);
  // Formulaire seul : entraînement à volonté, sans limite de nouvelles cartes ni attente du calendrier
  const free = !reviews && pool.length > 0 && pool.every(c => c.deck === 'formulaire');
  let queue;
  if (free) {
    fresh.sort((a, b) => cardOrderKey(a) - cardOrderKey(b));
    notDue.sort((a, b) => a.r - b.r);
    queue = due.map(x => x.c).concat(fresh, notDue.map(x => x.c));
  } else if (ahead) {
    notDue.sort((a, b) => a.r - b.r);
    queue = notDue.slice(0, store.settings.dailyGoal).map(x => x.c);
  } else {
    fresh.sort((a, b) => cardOrderKey(a) - cardOrderKey(b));
    const newLeft = Math.max(0, store.settings.newPerDay - today().newCards);
    queue = due.map(x => x.c).concat(fresh.slice(0, newLeft));
  }
  return {
    selected, label, ahead, reviews, free,
    pool, queue,
    relearn: [], // cartes ratées, à revoir dans la séance
    done: 0, again: 0,
    current: null, revealed: false, undo: null,
    poolStats: { due: due.length, fresh: fresh.length, notDue: notDue.length },
  };
}

function nextCard() {
  const s = session;
  const now = Date.now();
  // une carte ratée revient quand ses 10 minutes sont passées, ou au plus tard quand il n'y a plus rien d'autre
  const readyIdx = s.relearn.findIndex(x => x.due <= now);
  if (readyIdx >= 0) return s.relearn.splice(readyIdx, 1)[0].card;
  if (s.queue.length) return s.queue.shift();
  if (s.relearn.length) {
    s.relearn.sort((a, b) => a.due - b.due);
    return s.relearn.shift().card;
  }
  return null;
}

function answer(rating) {
  const s = session;
  const c = s.current;
  const now = new Date();
  const before = store.cards[c.id] ? JSON.parse(JSON.stringify(store.cards[c.id])) : null;
  const dayBefore = Object.assign({}, today());
  const card = stateOf(c.id) || createEmptyCard(now);
  const wasNew = card.state === State.New;
  const { card: next } = scheduler.next(card, now, rating);
  store.cards[c.id] = fromCard(next);
  const d = today();
  d.reviews += 1;
  if (wasNew && !s.free) d.newCards += 1; // le formulaire libre n'entame pas le quota de nouvelles fiches
  if (rating === Rating.Again) {
    d.again += 1;
    s.again += 1;
    s.relearn.push({ card: c, due: next.due.getTime() });
  }
  store.log.push({ id: c.id, t: now.toISOString(), g: rating });
  if (store.log.length > 20000) store.log.splice(0, store.log.length - 20000);
  s.done += 1;
  s.undo = { card: c, before, dayBefore, rating };
  persist();
  updateBadge();
  s.current = nextCard();
  s.revealed = false;
  render();
}

function undoLast() {
  const s = session;
  if (!s || !s.undo) return;
  const u = s.undo;
  if (u.before) store.cards[u.card.id] = u.before;
  else delete store.cards[u.card.id];
  store.days[dayKey()] = u.dayBefore;
  store.log.pop();
  if (u.rating === Rating.Again) {
    const i = s.relearn.findIndex(x => x.card.id === u.card.id);
    if (i >= 0) s.relearn.splice(i, 1);
    s.again -= 1;
  }
  if (s.current) s.queue.unshift(s.current);
  s.current = u.card;
  s.revealed = true;
  s.done -= 1;
  s.undo = null;
  persist();
  updateBadge();
  render();
}

/* ---------- Interface ---------- */

const app = document.getElementById('app');
const titleEl = document.getElementById('title');
const backBtn = document.getElementById('btn-back');
let view = 'home';
let viewStack = [];

function go(next, push = true) {
  if (push && view !== next) viewStack.push(view);
  view = next;
  if (next === 'home' && !session && updateReady) return location.reload();
  render();
  window.scrollTo(0, 0);
}

function back() {
  if (view === 'session') session = null;
  view = viewStack.pop() || 'home';
  if (view === 'home' && !session && updateReady) return location.reload();
  render();
}

backBtn.addEventListener('click', back);
document.getElementById('btn-settings').addEventListener('click', () => go('settings'));
document.getElementById('btn-search').addEventListener('click', () => go('search'));

function esc(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 3500);
}

function askConfirm(message, okLabel) {
  return new Promise(resolve => {
    const box = document.createElement('div');
    box.className = 'modal';
    box.innerHTML = `<div class="modal-box" role="dialog" aria-modal="true">
      <p>${esc(message).replace(/\n/g, '<br>')}</p>
      <div class="modal-actions"><button id="m-cancel">Annuler</button><button class="primary" id="m-ok">${esc(okLabel)}</button></div></div>`;
    document.body.appendChild(box);
    const done = v => { box.remove(); resolve(v); };
    box.querySelector('#m-cancel').onclick = () => done(false);
    box.querySelector('#m-ok').onclick = () => done(true);
    box.querySelector('#m-ok').focus();
  });
}

function plural(n, one, many) {
  return `${n} ${n > 1 ? many : one}`;
}

function bar(s) {
  const pct = x => (s.total ? (100 * x / s.total) : 0).toFixed(1);
  return `<div class="bar" aria-hidden="true">
    <span class="b-mastered" style="width:${pct(s.mastered)}%"></span><span class="b-learning" style="width:${pct(s.learning)}%"></span><span class="b-due" style="width:${pct(s.due)}%"></span>
  </div>`;
}

function render() {
  const firstLaunch = !MATIERES[matiere]; // choix de la matière avant tout chargement de cartes
  backBtn.hidden = view === 'home' || firstLaunch;
  document.getElementById('btn-settings').hidden = firstLaunch;
  // pas de recherche pendant une séance : chercher la réponse avant de la donner annule l'effet du test
  document.getElementById('btn-search').hidden = view === 'session' || view === 'search' || firstLaunch;
  // bascule de matière dans le bandeau : masquée pendant une séance (on ne quitte pas une séance par erreur)
  const sw = document.getElementById('switch');
  sw.hidden = firstLaunch || view === 'session';
  if (!sw.hidden && !sw.firstChild) {
    sw.innerHTML = Object.entries(MATIERES).map(([k, m]) => `<button type="button" data-matiere="${k}" aria-pressed="${k === matiere}" aria-label="${esc(m.nom)}"><span class="short">${k === 'physique' ? 'PC' : esc(m.court)}</span><span class="long">${esc(m.nom)}</span></button>`).join('');
    sw.querySelectorAll('button').forEach(b => { b.onclick = () => changerMatiere(b.dataset.matiere); });
  }
  const titles = { home: APP_NAME, matiere: APP_NAME, choose: 'Choisir des chapitres', vus: 'Mes chapitres vus en cours', session: 'Entraînement', progress: 'Ma progression', settings: 'Réglages', privacy: 'Données et confidentialité', install: 'Installer l’application', search: 'Rechercher une fiche' };
  titleEl.textContent = titles[view] || APP_NAME;
  ({ home: renderHome, matiere: renderMatiere, choose: renderChoose, vus: renderVus, session: renderSession, progress: renderProgress, settings: renderSettings, privacy: renderPrivacy, install: renderInstall, search: renderSearch })[view]();
}

const formCards = () => deck.cards.filter(c => c.deck === 'formulaire');

function selectionLabel(sel) {
  return sel.map(x => (x.startsWith('@') ? GROUP_TITLE[x.slice(1)] : (chapterTitle[x] || x).split(' – ')[0] + (chapterGroup[x] === 'BCPST2' ? ' (2e année)' : ''))).join(', ');
}

function renderHome() {
  const vus = store.settings.vus;
  const revs = statsFor(deck.cards.filter(c => inScope(c, vus, true)));
  const started = startedChapters();
  const startedStats = started.length ? statsFor(deck.cards.filter(c => matchesSelection(c, started))) : null;
  const d = today();
  const goal = store.settings.dailyGoal;
  const pct = Math.min(100, Math.round(100 * d.reviews / goal));
  const st = streak();
  const newToday = Math.min(revs.new, Math.max(0, store.settings.newPerDay - d.newCards));
  const lateWarning = d.reviews < goal && new Date().getHours() >= 18 && revs.due + newToday > 0;
  const nForm = formCards().length;
  app.innerHTML = `
    <section class="card hero">
      <p class="big">${plural(revs.due, 'carte à revoir', 'cartes à revoir')} aujourd’hui</p>
      <p class="muted">${!vus.length ? 'Cochez vos chapitres vus en cours pour recevoir de nouvelles cartes.' : newToday ? `+ ${plural(newToday, 'nouvelle carte disponible', 'nouvelles cartes disponibles')}` : revs.new ? 'Limite de nouvelles cartes atteinte pour aujourd’hui' : 'Toutes les cartes de vos chapitres vus en cours sont commencées'}</p>
      <div class="goal"><div class="goal-fill" style="width:${pct}%"></div></div>
      <p class="muted">Objectif du jour : ${Math.min(d.reviews, goal)} / ${goal} cartes${st ? ` · ${plural(st, 'jour', 'jours')} d’affilée` : ''}</p>
      ${lateWarning ? `<p class="warn">Il vous reste ${goal - d.reviews} cartes pour atteindre votre objectif du jour.</p>` : ''}
    </section>
    <div class="actions">
      <button class="primary" id="go-all" ${revs.due + newToday ? '' : 'disabled'}>Révisions espacées du jour
        <small>${vus.length ? `cartes commencées et ${plural(vus.length, 'chapitre vu', 'chapitres vus')} en cours` : 'cartes déjà commencées'}</small></button>
      <button id="go-vus">Mes chapitres vus en cours <small>${vus.length ? esc(selectionLabel(vus).slice(0, 80)) : 'aucun pour l’instant'}</small></button>
    </div>
    <h2 class="section">Entraînement libre</h2>
    <p class="muted small">N’importe quel chapitre, par exemple avant une colle ou un DS. Les cartes commencées ici entrent ensuite dans vos révisions espacées.</p>
    <div class="actions">
      <button id="go-choose">Choisir un ou plusieurs chapitres</button>
      ${nForm ? `<button id="go-form">Formulaire <small>${plural(nForm, ...M.formUnite)} : ${M.formDesc} · à volonté, sans limite</small></button>` : ''}
      ${raccourcis().map(r => `<button id="${r.id}">${esc(r.label)} <small>${plural(r.n, 'carte', 'cartes')} : ${esc(r.desc)}</small></button>`).join('')}
      ${store.selection.length ? `<button id="go-last">Reprendre ma dernière sélection <small>(${esc(selectionLabel(store.selection).slice(0, 60))})</small></button>` : ''}
      <button id="go-started" ${startedStats ? '' : 'disabled'}>Mes chapitres commencés${startedStats ? ` <small>(${startedStats.due} à revoir)</small>` : ''}</button>
    </div>
    <div class="actions secondary">
      <button id="go-progress">Ma progression</button>
      <button id="go-search">Rechercher une fiche</button>
      <button id="go-install">Installer l’application et les rappels</button>
      ${canReport() ? '<button id="go-suggest">Suggérer une amélioration ou faire une demande</button>' : ''}
    </div>
    <p class="muted small">${deck.cards.length - nForm} fiches et ${nForm} formules · version ${esc(deck.version)}</p>`;
  document.getElementById('go-all').onclick = () => startSession(vus, 'Révisions espacées', { reviews: true });
  document.getElementById('go-vus').onclick = () => go('vus');
  document.getElementById('go-started').onclick = () => startSession(started, 'Mes chapitres commencés');
  document.getElementById('go-choose').onclick = () => go('choose');
  const form = document.getElementById('go-form');
  if (form) form.onclick = () => startSession(['@Formulaire'], 'Formulaire');
  for (const r of raccourcis()) document.getElementById(r.id).onclick = () => startSession(r.sel, r.label);
  const last = document.getElementById('go-last');
  if (last) last.onclick = () => startSession(store.selection, 'Dernière sélection');
  document.getElementById('go-progress').onclick = () => go('progress');
  document.getElementById('go-search').onclick = () => go('search');
  document.getElementById('go-install').onclick = () => go('install');
  const suggest = document.getElementById('go-suggest');
  if (suggest) suggest.onclick = openSuggestion;
}

// Raccourcis d'entraînement propres à la matière (ordres de grandeur en physique-chimie), s'ils ont des cartes
function raccourcis() {
  return M.raccourcis.map(r => Object.assign({ n: deck.cards.filter(c => matchesSelection(c, r.sel)).length }, r)).filter(r => r.n);
}

// Choix de la matière : au premier lancement, puis par la bascule du bandeau. Chaque matière garde sa propre progression ;
// changer de matière recharge l'application sur le jeu de cartes choisi.
function renderMatiere() {
  const first = !MATIERES[matiere];
  app.innerHTML = `
    <section class="card hero">
      <p class="big">${first ? 'Bienvenue' : 'Changer de matière'}</p>
      <p>${first ? 'Choisissez la matière à réviser. Vous pourrez en changer à tout moment depuis le bandeau en haut de l’écran.' : 'Votre progression est conservée séparément dans chaque matière.'}</p>
    </section>
    <div class="actions">${Object.entries(MATIERES).map(([k, m]) => `<button class="${k === matiere ? 'primary' : ''}" data-matiere="${k}">${esc(m.nom)}${k === matiere ? ' <small>matière actuelle</small>' : ''}</button>`).join('')}</div>`;
  app.querySelectorAll('[data-matiere]').forEach(b => {
    b.onclick = () => (b.dataset.matiere === matiere ? back() : changerMatiere(b.dataset.matiere));
  });
}

function changerMatiere(k) {
  if (k === matiere) return;
  try { localStorage.setItem(MATIERE_KEY, k); } catch (e) { return toast('Impossible d’enregistrer : stockage bloqué.'); }
  location.reload();
}

// Liste de chapitres à cocher, groupés (BCPST 1, BCPST 2, autres, formulaire) ; un groupe se coche en entier.
function chapterChecklist(sel) {
  let html = '';
  for (const g of GROUPS) {
    const chs = chapters.filter(c => c.group === g);
    if (!chs.length) continue;
    const gs = statsFor(deck.cards.filter(c => chapterGroup[c.chap] === g));
    const all = sel.has('@' + g);
    html += `<div class="chap group">
      <label class="row"><input type="checkbox" data-code="@${g}" ${all ? 'checked' : ''}>
        <span class="chap-name"><b>${esc(GROUP_TITLE[g])}</b> <span class="muted small">(tout)</span></span>
        <span class="count">${gs.due ? `<em>${gs.due}</em> / ` : ''}${gs.total}</span></label>
      ${bar(gs)}
      <div class="subs">${chs.map(ch => {
        const s = statsFor(deck.cards.filter(c => c.chap === ch.code));
        return `<label class="row sub"><input type="checkbox" data-code="${ch.code}" ${all || sel.has(ch.code) ? 'checked' : ''} ${all ? 'disabled' : ''}>
          <span class="chap-name">${esc(ch.title)}</span>
          <span class="count">${s.due ? `<em>${s.due}</em> / ` : ''}${s.total}</span></label>`;
      }).join('')}</div>
    </div>`;
  }
  return html;
}

function bindChecklist(sel) {
  app.querySelectorAll('input[data-code]').forEach(cb => {
    cb.onchange = () => {
      const code = cb.dataset.code;
      if (cb.checked) {
        sel.add(code);
        if (code.startsWith('@')) [...sel].forEach(x => { if (chapterGroup[x] === code.slice(1)) sel.delete(x); });
      } else sel.delete(code);
      render();
    };
  });
}

let chooseSel = new Set();

function renderChoose() {
  if (!chooseSel.size && store.selection.length) chooseSel = new Set(store.selection);
  let html = '<p class="muted">Cochez un groupe entier ou des chapitres. Les nombres indiquent les cartes à revoir aujourd’hui et le total.</p>';
  html += chapterChecklist(chooseSel);
  const selected = [...chooseSel];
  const selCards = selected.length ? deck.cards.filter(c => matchesSelection(c, selected)) : [];
  const ss = statsFor(selCards);
  html += `<div class="sticky">
    <p>${selected.length ? `${plural(selCards.length, 'carte', 'cartes')} sélectionnées : ${ss.due} à revoir, ${ss.new} nouvelles` : 'Aucun chapitre sélectionné'}</p>
    <button class="primary" id="start" ${selected.length ? '' : 'disabled'}>Commencer</button>
    ${selected.length ? '<button class="link" id="clear">Tout décocher</button>' : ''}
  </div>`;
  app.innerHTML = html;
  bindChecklist(chooseSel);
  document.getElementById('start').onclick = () => {
    store.selection = [...chooseSel];
    persist();
    startSession(store.selection, selectionLabel(store.selection));
  };
  const clear = document.getElementById('clear');
  if (clear) clear.onclick = () => { chooseSel.clear(); render(); };
}

let vusSel = null;

function renderVus() {
  if (!vusSel) vusSel = new Set(store.settings.vus);
  app.innerHTML = `<p class="muted">Cochez les chapitres déjà traités en cours. Les révisions espacées du jour y prennent leurs nouvelles cartes (${store.settings.newPerDay} par jour au plus, dans l’ordre du programme). Les cartes déjà commencées continuent d’être révisées, cochées ou non.</p>
    ${chapterChecklist(vusSel)}
    <div class="sticky"><button class="primary" id="save-vus">Enregistrer</button></div>`;
  bindChecklist(vusSel);
  document.getElementById('save-vus').onclick = () => {
    store.settings.vus = [...vusSel];
    vusSel = null;
    persist();
    toast('Chapitres vus en cours enregistrés.');
    back();
  };
}

function startSession(selected, label, { ahead = false, reviews = false, offerWarmup = !ahead && !reviews } = {}) {
  session = buildSession(selected, { label, ahead, reviews });
  // l'échauffement précède toujours des flashcards : proposé seulement s'il y a des cartes à faire ensuite
  if (offerWarmup && session.queue.length && session.pool.length >= 4) session.phase = 'intro';
  else session.current = nextCard();
  go('session', view !== 'session');
}

/* ---------- Échauffement par QCM ----------
   La question montre le recto ; il faut retrouver le verso parmi quatre. Les leurres sont les versos d'autres cartes
   du même chapitre, de même type et de longueur voisine : pour le formulaire, ce sont des formules de la même famille
   (cos(a − b) pour cos(a + b), √2/2 pour √3/2…). Deux propositions identiques ne sont jamais proposées. */

function shuffle(a) {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

function pickDistractors(card, n = 3) {
  const seen = new Set([normText(card.verso)]);
  const len = plain(card.verso).length;
  const score = c => Math.abs(Math.log((plain(c.verso).length + 5) / (len + 5))) + (c.type === card.type ? 0 : 0.7) + Math.random() * 0.6;
  const out = [];
  const levels = [c => !!card.fam && c.fam === card.fam, c => c.chap === card.chap && (!card.type || c.type === card.type), c => c.chap === card.chap, c => chapterGroup[c.chap] === chapterGroup[card.chap] && c.deck === card.deck, c => c.deck === card.deck];
  for (const level of levels) {
    const cands = deck.cards.filter(c => c.id !== card.id && level(c)).map(c => [score(c), c]).sort((a, b) => a[0] - b[0]);
    for (const [, c] of cands.slice(0, 8 + n)) {
      if (out.length >= n) break;
      const k = normText(c.verso);
      if (seen.has(k) || Math.random() < 0.3 && cands.length > 2 * n) continue;
      seen.add(k);
      out.push(c);
    }
    for (const [, c] of cands) { // complète si le tirage aléatoire en a écarté trop
      if (out.length >= n) break;
      const k = normText(c.verso);
      if (!seen.has(k)) { seen.add(k); out.push(c); }
    }
    if (out.length >= n) break;
  }
  return out;
}

function makeQuestion(card) {
  return { card, options: shuffle([card, ...pickDistractors(card)]) };
}

// Cartes interrogées : celles de la séance qui suit, jamais vues ou ratées d'abord, puis le reste du thème.
function pickQcmCards(s, n = QCM_SIZE) {
  const inQueue = new Set(s.queue.map(c => c.id));
  const weak = c => {
    const st = stateOf(c.id);
    return !st || st.state !== State.Review || st.lapses > 0;
  };
  const rank = c => (inQueue.has(c.id) ? 0 : 2) + (weak(c) ? 0 : 1);
  return shuffle(s.pool).sort((a, b) => rank(a) - rank(b)).slice(0, n);
}

function firstTimeOn(s) {
  const ids = new Set(s.pool.map(c => c.id));
  return !s.pool.some(c => store.cards[c.id] && store.cards[c.id].reps > 0) && !store.qcmLog.some(x => ids.has(x.id));
}

function startQcm() {
  const s = session;
  s.qcm = { items: pickQcmCards(s).map(makeQuestion), i: 0, ok: 0, failed: [], chosen: null };
  s.phase = 'qcm';
  render();
}

// Une erreur au QCM compte comme « Raté » pour l'algorithme ; une bonne réponse ne compte pas comme « Su » :
// reconnaître une formule parmi quatre ne prouve pas qu'on saurait la retrouver.
function qcmChoose(k) {
  const s = session;
  const Q = s.qcm;
  const q = Q.items[Q.i];
  if (Q.chosen !== null) return;
  Q.chosen = k;
  const ok = q.options[k].id === q.card.id;
  const now = new Date();
  store.qcmLog.push({ id: q.card.id, t: now.toISOString(), ok: ok ? 1 : 0, pick: q.options[k].id });
  if (store.qcmLog.length > 5000) store.qcmLog.splice(0, store.qcmLog.length - 5000);
  if (ok) Q.ok += 1;
  else {
    Q.failed.push(q.card);
    const card = stateOf(q.card.id) || createEmptyCard(now);
    if (card.state === State.New && !session.free) today().newCards += 1;
    store.cards[q.card.id] = fromCard(scheduler.next(card, now, Rating.Again).card);
  }
  persist();
  updateBadge();
  render();
}

function qcmNext() {
  const Q = session.qcm;
  Q.i += 1;
  Q.chosen = null;
  if (Q.i >= Q.items.length) session.phase = 'qcmEnd';
  render();
  window.scrollTo(0, 0);
}

function qcmToCards() {
  const old = session;
  const failed = old.qcm.failed;
  const failedIds = new Set(failed.map(c => c.id));
  session = buildSession(old.selected, { label: old.label, reviews: old.reviews });
  // les cartes ratées au QCM reviennent après leur délai de 10 minutes, comme une carte ratée en séance
  session.queue = session.queue.filter(c => !failedIds.has(c.id));
  for (const c of failed) session.relearn.push({ card: c, due: stateOf(c.id).due.getTime() });
  session.phase = 'cards';
  session.current = nextCard();
  render();
  window.scrollTo(0, 0);
}

function renderWarmupIntro(s) {
  const first = firstTimeOn(s);
  const n = Math.min(QCM_SIZE, s.pool.length);
  const qcmBtn = `<button class="${first ? 'primary' : ''}" id="qcm-go">S’échauffer avec ${n} QCM, puis les flashcards</button>`;
  const cardsBtn = `<button class="${first ? '' : 'primary'}" id="cards-go">Commencer directement les flashcards</button>`;
  app.innerHTML = `
    <section class="card hero">
      <p class="big">${first ? 'Première fois sur ce thème' : 'Avant les flashcards'}</p>
      <p>${first
        ? 'Nous vous conseillons de commencer par un échauffement : pour chaque énoncé, retrouvez la bonne réponse parmi quatre propositions.'
        : 'Vous pouvez vous échauffer : pour chaque énoncé, retrouvez la bonne réponse parmi quatre propositions.'}</p>
    </section>
    <div class="actions">${first ? qcmBtn + cardsBtn : cardsBtn + qcmBtn}</div>
    <p class="muted small">Le QCM ne remplace pas les flashcards : elles suivent toujours l’échauffement.</p>`;
  document.getElementById('qcm-go').onclick = startQcm;
  document.getElementById('cards-go').onclick = () => {
    s.phase = 'cards';
    s.current = nextCard();
    render();
  };
}

function renderQcm(s) {
  const Q = s.qcm;
  const q = Q.items[Q.i];
  const c = q.card;
  const form = c.deck === 'formulaire';
  const answered = Q.chosen !== null;
  const ok = answered && q.options[Q.chosen].id === c.id;
  const last = Q.i + 1 >= Q.items.length;
  app.innerHTML = `
    <div class="progress-line"><span>Échauffement${s.label ? ' · ' + esc(s.label) : ''}</span><span>Question ${Q.i + 1} / ${Q.items.length}</span></div>
    <article class="flash qcm ${form ? 'formula' : ''}">
      ${answered && canReport() ? reportButton() : ''}
      ${cardTags(c, stateOf(c.id))}
      ${frontHtml(c)}
      <p class="hint muted">Choisissez la bonne réponse.</p>
    </article>
    <div class="options">${q.options.map((o, k) => {
      const cls = !answered ? '' : o.id === c.id ? 'right' : k === Q.chosen ? 'wrong' : 'dim';
      return `<button class="opt ${cls}" data-k="${k}" ${answered ? 'disabled' : ''}><small>${k + 1}</small><span>${tex(o.verso)}</span></button>`;
    }).join('')}</div>
    ${answered ? `<div class="feedback ${ok ? 'ok' : 'ko'}">
      ${ok ? '<p><b>Bonne réponse.</b></p>'
        : `<p><b>Mauvaise réponse.</b> La proposition choisie correspond à : ${tex(q.options[Q.chosen].recto)}.</p>`}
      ${c.orange ? ORANGE_NOTE : ''}
    </div>
    <button class="primary wide" id="qcm-next">${last ? 'Voir mon score' : 'Question suivante'} <small>Entrée</small></button>` : ''}`;
  app.querySelectorAll('.opt').forEach(b => { b.onclick = () => qcmChoose(Number(b.dataset.k)); });
  const next = document.getElementById('qcm-next');
  if (next) { next.onclick = qcmNext; next.focus({ preventScroll: true }); }
  const rep = app.querySelector('.report-btn');
  if (rep) rep.onclick = () => openReport(c, 'qcm', { propositions: q.options.map(o => plain(o.verso)), choisi: plain(q.options[Q.chosen].verso) });
}

function renderQcmEnd(s) {
  const Q = s.qcm;
  const n = Q.items.length;
  const nf = Q.failed.length;
  const verdict = Q.ok >= 0.8 * n ? 'Plutôt réussi.'
    : Q.ok >= 0.5 * n ? 'Résultat moyen : plusieurs énoncés sont encore fragiles.'
      : 'Ces énoncés ne sont pas encore connus. C’est normal au début d’un chapitre.';
  app.innerHTML = `
    <section class="card hero">
      <p class="big">${Q.ok} / ${n} bonnes réponses</p>
      <p>${verdict}</p>
    </section>
    <section class="card">
      <p>Reconnaître la bonne réponse parmi quatre est plus facile que la retrouver de mémoire : <b>ce score ne suffit pas à dire que vous savez ces énoncés.</b> Les flashcards vont le vérifier.</p>
      ${nf ? `<p class="muted">${nf > 1 ? `Les ${nf} cartes ratées reviendront` : 'La carte ratée reviendra'} en flashcard dans une dizaine de minutes.</p>` : ''}
    </section>
    <button class="primary wide" id="to-cards">Passer aux flashcards <small>Entrée</small></button>`;
  const b = document.getElementById('to-cards');
  b.onclick = qcmToCards;
  b.focus();
}

function ratingButtons() {
  if (store.settings.buttons === 4) {
    return `<div class="grade four">
      <button class="again" data-r="${Rating.Again}">Raté<small>1</small></button>
      <button class="hard" data-r="${Rating.Hard}">Difficile<small>2</small></button>
      <button class="good" data-r="${Rating.Good}">Su<small>3</small></button>
      <button class="easy" data-r="${Rating.Easy}">Facile<small>4</small></button></div>`;
  }
  return `<div class="grade">
    <button class="again" data-r="${Rating.Again}">Raté<small>1</small></button>
    <button class="good" data-r="${Rating.Good}">Su<small>2</small></button></div>`;
}

// Recto d'une carte : rappel des objets utilisés (contexte), puis la consigne (« Définir… », « Citer le théorème… »).
// Sans consigne dans le tableur, l'intitulé sert de question.
function frontHtml(c, tag = 'h2') {
  return `${c.ctx ? `<p class="ctx">${tex(c.ctx)}</p>` : ''}<${tag} class="term">${tex(c.q || c.recto)}</${tag}>`;
}

const ORANGE_NOTE = '<p class="orange-note">Place dans le programme à confirmer : signalez-le (⚠) si cette fiche vous semble hors programme.</p>';

function cardTags(c, st) {
  const tag = !st || st.state === State.New ? '<span class="tag new">nouvelle</span>'
    : (st.state === State.Relearning || st.state === State.Learning) ? '<span class="tag again">à retravailler</span>' : '';
  return `<div class="codes"><span>${esc(chapterTitle[c.chap] || c.chap)}</span>${c.type ? `<span>${esc(c.type)}</span>` : ''} ${tag}</div>`;
}

function renderSession() {
  const s = session;
  if (!s) return go('home', false);
  if (s.phase === 'intro') return renderWarmupIntro(s);
  if (s.phase === 'qcm') return renderQcm(s);
  if (s.phase === 'qcmEnd') return renderQcmEnd(s);
  if (!s.current) {
    const endDay = endOfStudyDay();
    s.poolStats.notDue = deck.cards.filter(c => {
      const st = stateOf(c.id);
      return st && st.state !== State.New && st.due > endDay && inScope(c, s.selected, s.reviews);
    }).length;
    app.innerHTML = `<section class="card hero">
      <p class="big">${s.done ? 'Séance terminée' : 'Rien à revoir pour l’instant'}</p>
      ${s.done ? `<p>${plural(s.done, 'réponse', 'réponses')}${s.again ? `, dont ${plural(s.again, 'carte ratée', 'cartes ratées')} et revues dans la séance` : ', aucune ratée'}.</p>` : ''}
      ${!s.done && !s.ahead ? `<p class="muted">Toutes les cartes de cette sélection sont à jour${s.poolStats.fresh ? ' et la limite de nouvelles cartes du jour est atteinte' : ''}.</p>` : ''}
    </section>
    <div class="actions">
      ${s.free ? '<button id="again-free">Recommencer un tour</button>' : ''}
      ${s.poolStats.notDue && !s.free ? '<button id="ahead">Réviser en avance (les cartes les moins sûres)</button>' : ''}
      <button class="primary" id="home">Retour à l’accueil</button>
    </div>
    ${s.poolStats.notDue && !s.free ? '<p class="muted small">Réviser en avance ne fausse pas le calendrier : une carte revue trop tôt est simplement moins repoussée.</p>' : ''}`;
    const af = document.getElementById('again-free');
    if (af) af.onclick = () => startSession(s.selected, s.label);
    const a = document.getElementById('ahead');
    if (a) a.onclick = () => startSession(s.selected, s.label, { ahead: true, reviews: s.reviews });
    document.getElementById('home').onclick = () => { session = null; viewStack = []; go('home', false); };
    return;
  }
  const c = s.current;
  const st = stateOf(c.id);
  const left = s.queue.length + s.relearn.length + 1;
  const form = c.deck === 'formulaire';
  app.innerHTML = `
    <div class="progress-line"><span>${s.label ? esc(s.label) : ''}${s.ahead ? ' · en avance' : ''}</span><span>${left} restantes</span></div>
    <article class="flash ${s.revealed ? 'revealed' : ''} ${form ? 'formula' : ''}">
      ${s.revealed && canReport() ? reportButton() : ''}
      ${cardTags(c, st)}
      ${frontHtml(c)}
      ${s.revealed ? `<div class="def">${tex(c.verso)}</div>${c.orange ? ORANGE_NOTE : ''}`
        : '<p class="hint muted">Répondez de tête (ou à l’écrit), puis retournez la carte.</p>'}
    </article>
    ${s.revealed ? ratingButtons() : '<button class="primary reveal" id="reveal">Voir la réponse <small>Espace</small></button>'}
    ${s.undo ? '<button class="link undo" id="undo">Annuler la dernière réponse</button>' : ''}`;
  const r = document.getElementById('reveal');
  if (r) r.onclick = () => { s.revealed = true; render(); };
  app.querySelectorAll('[data-r]').forEach(b => { b.onclick = () => answer(Number(b.dataset.r)); });
  const u = document.getElementById('undo');
  if (u) u.onclick = undoLast;
  const rep = app.querySelector('.report-btn');
  if (rep) rep.onclick = () => openReport(c, form ? 'formulaire' : 'flashcard');
}

document.addEventListener('keydown', e => {
  if (view !== 'session' || !session || e.target.tagName === 'INPUT' || document.querySelector('.modal')) return;
  if (session.phase === 'qcm') {
    const Q = session.qcm;
    if (Q.chosen === null && /^[1-4]$/.test(e.key) && Number(e.key) <= Q.items[Q.i].options.length) { e.preventDefault(); qcmChoose(Number(e.key) - 1); }
    else if (Q.chosen !== null && e.key === 'Enter') { e.preventDefault(); qcmNext(); }
    return;
  }
  if (session.phase === 'qcmEnd' && e.key === 'Enter') { e.preventDefault(); qcmToCards(); return; }
  if (!session.current) return;
  if (!session.revealed && (e.key === ' ' || e.key === 'Enter')) {
    e.preventDefault();
    session.revealed = true;
    render();
    return;
  }
  if (session.revealed) {
    const map = store.settings.buttons === 4
      ? { 1: Rating.Again, 2: Rating.Hard, 3: Rating.Good, 4: Rating.Easy }
      : { 1: Rating.Again, 2: Rating.Good };
    if (map[e.key]) { e.preventDefault(); answer(map[e.key]); }
  }
});

// Cartes classées par nombre de réponses « Raté ».
function mostFailed(entries) {
  const byId = new Map(deck.cards.map(c => [c.id, c]));
  const count = new Map();
  for (const r of entries) if (r.g === Rating.Again && byId.has(r.id)) count.set(r.id, (count.get(r.id) || 0) + 1);
  return [...count].map(([id, n]) => ({ c: byId.get(id), n })).sort((a, b) => b.n - a.n || a.c.id.localeCompare(b.c.id));
}

function renderProgress() {
  const all = statsFor(deck.cards);
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(dayKey(d));
  }
  const revs = k => (store.days[k] ? store.days[k].reviews : 0);
  const maxRev = Math.max(1, ...days.map(revs));
  const anyDay = days.some(k => revs(k) > 0);
  let html = `<section class="card">
    <div class="legend"><span class="l-mastered">acquises</span><span class="l-learning">en cours</span><span class="l-due">à revoir</span><span class="l-new">jamais vues</span></div>
    <p><b>Toutes les cartes</b> : ${all.mastered} acquises, ${all.learning} en cours, ${all.due} à revoir, ${all.new} jamais vues.</p>
    ${bar(all)}
  </section>`;
  if (anyDay) {
    html += `<section class="card"><h2>Réponses des 14 derniers jours</h2><div class="hist">${days.map(k => {
      const n = revs(k);
      return `<div class="hcol" title="${k} : ${n} réponses"><small>${n || ''}</small><div class="hbar" style="height:${Math.round(80 * n / maxRev)}%"></div><span>${Number(k.slice(8))}</span></div>`;
    }).join('')}</div></section>`;
  }
  for (const g of GROUPS) {
    const chs = chapters.filter(c => c.group === g);
    if (!chs.length) continue;
    html += `<section class="card"><h2>${esc(GROUP_TITLE[g])}</h2>`;
    for (const ch of chs) {
      const s = statsFor(deck.cards.filter(c => c.chap === ch.code));
      html += `<div class="prow"><div class="row"><span class="chap-name">${esc(ch.title)}</span><span class="count">${s.seen}/${s.total} vues</span></div>${bar(s)}</div>`;
    }
    html += '</section>';
  }
  const hard = mostFailed(store.log).slice(0, 10);
  if (hard.length) {
    html += `<section class="card"><h2>Les cartes que vous ratez le plus</h2><ol class="hard">${hard.map(x => `<li><button class="link term-link" data-id="${esc(x.c.id)}">${tex(x.c.recto)}</button> <span class="muted">(${plural(x.n, 'fois', 'fois')})</span></li>`).join('')}</ol></section>`;
  }
  app.innerHTML = html;
  const byId = new Map(deck.cards.map(c => [c.id, c]));
  app.querySelectorAll('.term-link').forEach(b => { b.onclick = () => showCard(byId.get(b.dataset.id)); });
}

/* ---------- Signalement d'une erreur ---------- */

// Le signalement part vers l'adresse configurée dans config.json (script Google de l'enseignant, qui le range dans son tableur).
// L'élève ne voit pas le destinataire. Hors connexion, il est gardé et envoyé plus tard.
const canReport = () => !!config.signalement;
const reportButton = () => '<button class="report-btn" aria-label="Signaler une erreur" title="Signaler une erreur">&#9888;&#xFE0E;</button>';

const REPORT_TYPES = {
  erreur: 'Erreur dans l’énoncé ou la formule',
  coquille: 'Coquille (faute de frappe, notation)',
  programme: 'Pas conforme au programme (hors programme, hypothèse ou notation différente)',
  affichage: 'Formule mal affichée',
  qcm: 'Question ambiguë (plusieurs bonnes réponses)',
  autre: 'Autre',
};

function openReport(card, context, extra = {}) {
  const box = document.createElement('div');
  box.className = 'modal';
  box.innerHTML = `<form class="modal-box report-box" role="dialog" aria-modal="true" aria-labelledby="rep-title">
    <h2 id="rep-title">Signaler un problème</h2>
    <p class="muted">Carte <b>${tex(card.recto)}</b></p>
    <fieldset>${Object.keys(REPORT_TYPES).filter(k => k !== 'qcm' || context === 'qcm').map(k => `<label class="radio"><input type="radio" name="rep-type" value="${k}"> ${esc(REPORT_TYPES[k])}</label>`).join('')}</fieldset>
    <label><span id="rep-label">Précisez si vous le souhaitez (facultatif)</span><input type="text" id="rep-text" maxlength="300" autocomplete="off"></label>
    <div class="modal-actions"><button type="button" id="rep-cancel">Annuler</button><button class="primary" id="rep-send" disabled>Envoyer</button></div>
  </form>`;
  document.body.appendChild(box);
  const form = box.querySelector('form');
  const text = box.querySelector('#rep-text');
  const send = box.querySelector('#rep-send');
  const type = () => (form.querySelector('input[name=rep-type]:checked') || {}).value;
  const check = () => {
    const needText = type() === 'autre' || type() === 'programme';
    box.querySelector('#rep-label').textContent = needText ? 'Précisez ce qui ne va pas' : 'Précisez si vous le souhaitez (facultatif)';
    send.disabled = !type() || (needText && !text.value.trim());
  };
  form.addEventListener('change', check);
  text.addEventListener('input', check);
  const before = document.activeElement;
  const close = () => { box.remove(); document.removeEventListener('keydown', onKey); if (before && before.isConnected) before.focus(); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  box.querySelector('#rep-cancel').onclick = close;
  form.onsubmit = async e => {
    e.preventDefault();
    if (send.disabled) return;
    // mêmes champs que l'application de SVT : le script de l'enseignant range la ligne sans modification ;
    // le préfixe de la matière ([Maths], [Physique]) et l'ID distinguent ces signalements dans l'onglet « Signalements »
    const mat = M.court.toLowerCase();
    store.pendingReports.push(Object.assign({
      terme: `[${M.court}] ${card.id} · ${plain(card.recto)}`,
      id: card.id,
      definition: `${card.ctx ? card.ctx + ' ' : ''}${card.q || card.recto} → ${card.verso}`,
      codes: chapterTitle[card.chap] || card.chap,
      type: REPORT_TYPES[type()],
      precision: text.value.trim(),
      contexte: `${mat} : ${{ flashcard: 'fiche', formulaire: 'formulaire', recherche: 'recherche', qcm: 'QCM' }[context] || context}`,
      version: mat + ' ' + deck.version,
      date: new Date().toISOString(),
    }, extra));
    persist();
    close();
    toast(await flushReports() ? 'Merci, votre signalement a été transmis.' : 'Pas de connexion : votre signalement sera transmis dès que possible.');
  };
}

const SUGGESTION_TYPES = {
  amelioration: 'Amélioration de l’application',
  demande: 'Demande (fiche ou chapitre à ajouter, autre)',
  bug: 'Problème technique',
};

// Suggestion ou demande sur l'application : même circuit que les signalements, rangée à part dans le tableur.
function openSuggestion() {
  const box = document.createElement('div');
  box.className = 'modal';
  box.innerHTML = `<form class="modal-box report-box" role="dialog" aria-modal="true" aria-labelledby="sug-title">
    <h2 id="sug-title">Suggestion ou demande</h2>
    <fieldset>${Object.keys(SUGGESTION_TYPES).map(k => `<label class="radio"><input type="radio" name="sug-type" value="${k}"> ${esc(SUGGESTION_TYPES[k])}</label>`).join('')}</fieldset>
    <label>Votre message<textarea id="sug-text" rows="5" maxlength="1000"></textarea></label>
    <div class="modal-actions"><button type="button" id="sug-cancel">Annuler</button><button class="primary" id="sug-send" disabled>Envoyer</button></div>
  </form>`;
  document.body.appendChild(box);
  const form = box.querySelector('form');
  const text = box.querySelector('#sug-text');
  const send = box.querySelector('#sug-send');
  const type = () => (form.querySelector('input[name=sug-type]:checked') || {}).value;
  const check = () => { send.disabled = !type() || !text.value.trim(); };
  form.addEventListener('change', check);
  text.addEventListener('input', check);
  const before = document.activeElement;
  const close = () => { box.remove(); document.removeEventListener('keydown', onKey); if (before && before.isConnected) before.focus(); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  box.querySelector('#sug-cancel').onclick = close;
  form.onsubmit = async e => {
    e.preventDefault();
    if (send.disabled) return;
    store.pendingReports.push({
      nature: 'suggestion',
      type: `[${M.court}] ` + SUGGESTION_TYPES[type()],
      message: text.value.trim(),
      version: M.court.toLowerCase() + ' ' + deck.version,
      date: new Date().toISOString(),
    });
    persist();
    close();
    toast(await flushReports() ? 'Merci, votre message a été transmis.' : 'Pas de connexion : votre message sera transmis dès que possible.');
  };
}

let flushing = null;
function flushReports() {
  if (!flushing) {
    flushing = (async () => {
      while (store.pendingReports.length && canReport()) {
        const item = store.pendingReports[0];
        try {
          // no-cors : la réponse du script n'est pas lisible, seule une panne réseau est détectée ;
          // keepalive : l'envoi aboutit même si l'élève ferme l'application juste après
          await fetch(config.signalement, { method: 'POST', mode: 'no-cors', keepalive: true, headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(item) });
        } catch (e) {
          return false;
        }
        const k = store.pendingReports.indexOf(item);
        if (k >= 0) store.pendingReports.splice(k, 1);
        persist();
      }
      return true;
    })().finally(() => { flushing = null; });
  }
  return flushing;
}

window.addEventListener('online', () => flushReports());

/* ---------- Recherche ---------- */

let searchQuery = '';
let searchShown = ''; // chapitre dont la liste des cartes est affichée

// Cartes qui correspondent à la saisie : début de l'intitulé, puis début d'un mot, puis n'importe où (intitulé puis contenu).
function searchCards(query, max = 12) {
  const q = normText(query);
  if (!q) return [];
  const rank = c => {
    const t = normText(plain(c.recto));
    if (t.startsWith(q)) return 0;
    if (t.split(/[\s'(–-]+/).some(w => w.startsWith(q))) return 1;
    if (t.includes(q)) return 2;
    return normText(plain(c.verso)).includes(q) ? 3 : 4;
  };
  return deck.cards.map(c => [rank(c), c]).filter(([r]) => r < 4)
    .sort((a, b) => a[0] - b[0] || cardOrderKey(a[1]) - cardOrderKey(b[1]))
    .slice(0, max).map(([, c]) => c);
}

function showCard(card) {
  const box = document.createElement('div');
  box.className = 'modal';
  const form = card.deck === 'formulaire';
  box.innerHTML = `<div class="modal-box def-box" role="dialog" aria-modal="true" aria-labelledby="def-term">
    <h2 id="def-term">${tex(card.recto)}</h2>
    ${frontHtml(card, 'p')}
    <div class="def">${tex(card.verso)}</div>
    ${card.orange ? ORANGE_NOTE : ''}
    <p class="muted small">${esc(GROUP_TITLE[chapterGroup[card.chap]] || '')} · ${esc(chapterTitle[card.chap] || '')}</p>
    ${canReport() ? reportButton() : ''}
    <button class="primary wide" id="def-close">Fermer</button></div>`;
  document.body.appendChild(box);
  const close = () => { box.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape' && !document.querySelector('.report-box')) close(); };
  document.addEventListener('keydown', onKey);
  box.addEventListener('click', e => { if (e.target === box) close(); });
  box.querySelector('#def-close').onclick = close;
  box.querySelector('#def-close').focus();
  const rep = box.querySelector('.report-btn');
  if (rep) rep.onclick = () => openReport(card, 'recherche');
}

function renderSearch() {
  const results = searchCards(searchQuery);
  let html = `<div class="search-box">
      <input type="search" id="q" placeholder="Tapez un mot : ${esc(M.exemples)}" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Chercher une fiche" value="${esc(searchQuery)}">
    </div>
    <div id="results">${resultsHtml(results)}</div>
    <h2>Sommaire</h2>
    <p class="muted small">Touchez un chapitre pour voir ses fiches dans l’ordre du programme.</p>`;
  for (const g of GROUPS) {
    const chs = chapters.filter(c => c.group === g);
    if (!chs.length) continue;
    html += `<h2 class="section">${esc(GROUP_TITLE[g])}</h2>`;
    for (const ch of chs) {
      const cards = deck.cards.filter(c => c.chap === ch.code);
      html += `<div class="chap"><button class="lex-item ${searchShown === ch.code ? 'open' : ''}" data-show="${ch.code}">
        <span class="chap-name">${esc(ch.title)}</span><span class="count">${cards.length}</span></button>
        ${searchShown === ch.code ? `<ul class="terms">${cards.map(c => `<li><button class="term-link" data-id="${esc(c.id)}">${tex(c.recto)}</button></li>`).join('')}</ul>` : ''}</div>`;
    }
  }
  app.innerHTML = html;
  const byId = new Map(deck.cards.map(c => [c.id, c]));
  const bindLinks = root => root.querySelectorAll('.term-link').forEach(b => { b.onclick = () => showCard(byId.get(b.dataset.id)); });
  bindLinks(app);
  app.querySelectorAll('[data-show]').forEach(b => {
    b.onclick = () => { searchShown = searchShown === b.dataset.show ? '' : b.dataset.show; render(); };
  });
  const input = document.getElementById('q');
  input.oninput = () => {
    searchQuery = input.value;
    const box = document.getElementById('results');
    box.innerHTML = resultsHtml(searchCards(searchQuery));
    bindLinks(box);
  };
  input.onkeydown = e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = searchCards(searchQuery)[0];
      if (first) showCard(first);
    }
  };
}

function resultsHtml(results) {
  if (!searchQuery.trim()) return '';
  if (!results.length) return '<p class="muted">Aucune fiche trouvée.</p>';
  return `<ul class="terms results">${results.map(c => `<li><button class="term-link" data-id="${esc(c.id)}">${tex(c.recto)} <small class="muted">${esc(chapterTitle[c.chap] || '')}</small></button></li>`).join('')}</ul>`;
}

/* ---------- Réglages, mise à jour, sauvegarde ---------- */

function renderSettings() {
  const s = store.settings;
  app.innerHTML = `
    <section class="card form">
      <h2>Entraînement</h2>
      <label>Nouvelles cartes par jour <input type="number" min="0" max="200" id="newPerDay" value="${s.newPerDay}"></label>
      <label>Objectif quotidien (réponses) <input type="number" min="5" max="500" id="dailyGoal" value="${s.dailyGoal}"></label>
      <label>Boutons de réponse
        <select id="buttons"><option value="2" ${s.buttons === 2 ? 'selected' : ''}>2 : Raté / Su</option><option value="4" ${s.buttons === 4 ? 'selected' : ''}>4 : Raté / Difficile / Su / Facile</option></select></label>
      <label>Exigence de mémorisation
        <select id="retention">
          <option value="0.85" ${s.retention === 0.85 ? 'selected' : ''}>Légère (85 %)</option>
          <option value="0.9" ${s.retention === 0.9 ? 'selected' : ''}>Normale (90 %, recommandé)</option>
          <option value="0.95" ${s.retention === 0.95 ? 'selected' : ''}>Concours proche (95 %, bien plus de révisions)</option>
        </select></label>
      <button id="set-vus">Mes chapitres vus en cours</button>
    </section>
    <section class="card form">
      <h2>Fiches</h2>
      <p class="muted">Version actuelle : ${esc(deck.version)} (${deck.cards.length} cartes). La progression est conservée lors d’une mise à jour.</p>
      <button id="check-update">Vérifier s’il existe une nouvelle version</button>
    </section>
    <section class="card form">
      <h2>Sauvegarde</h2>
      <p class="muted">Votre progression est enregistrée uniquement dans ce navigateur, sur cet appareil. Exportez-la de temps en temps, et avant de changer de téléphone.</p>
      <button id="export">Exporter ma progression</button>
      <label class="file">Restaurer une sauvegarde<input type="file" id="import" accept=".json,application/json"></label>
      <button class="danger" id="reset">Effacer toute ma progression</button>
    </section>
    <button class="link" id="privacy">Données et confidentialité</button>`;
  const num = (id, min, max) => {
    const el = document.getElementById(id);
    el.onchange = () => {
      const v = Math.round(Number(el.value));
      if (Number.isFinite(v)) { s[id] = Math.min(max, Math.max(min, v)); persist(); }
      el.value = s[id];
    };
  };
  num('newPerDay', 0, 200);
  num('dailyGoal', 5, 500);
  document.getElementById('buttons').onchange = e => { s.buttons = Number(e.target.value); persist(); };
  document.getElementById('retention').onchange = e => {
    s.retention = Number(e.target.value);
    persist();
    scheduler = makeScheduler();
    toast('Réglage pris en compte à partir des prochaines réponses.');
  };
  document.getElementById('set-vus').onclick = () => go('vus');
  document.getElementById('check-update').onclick = checkUpdate;
  document.getElementById('export').onclick = exportBackup;
  document.getElementById('import').onchange = e => e.target.files[0] && importBackup(e.target.files[0]);
  document.getElementById('reset').onclick = async () => {
    if (!await askConfirm('Effacer toute votre progression sur cet appareil ? Cette action est définitive.', 'Tout effacer')) return;
    store.cards = {}; store.log = []; store.days = {}; store.selection = [];
    persist();
    updateBadge();
    toast('Progression effacée.');
  };
  document.getElementById('privacy').onclick = () => go('privacy');
}

function describeChange(oldCards, newCards) {
  const oldIds = new Map(oldCards.map(c => [c.id, c]));
  const newIds = new Set(newCards.map(c => c.id));
  let added = 0, changed = 0;
  for (const c of newCards) {
    const o = oldIds.get(c.id);
    if (!o) added += 1;
    else if (o.recto !== c.recto || o.verso !== c.verso || o.chap !== c.chap || !o.orange !== !c.orange) changed += 1;
  }
  const removed = oldCards.filter(c => !newIds.has(c.id)).length;
  return { added, changed, removed };
}

async function checkUpdate() {
  try {
    const remote = await fetch(M.data + 'cartes.json', { cache: 'no-store' }).then(r => {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    });
    if (remote.version <= deck.version) return toast('Vous avez déjà la dernière version.');
    const ch = describeChange(deck.cards, remote.cards);
    if (!await askConfirm(`Nouvelle version disponible : ${remote.version}.\n\n${remote.cards.length} cartes : ${ch.added} nouvelles, ${ch.changed} modifiées, ${ch.removed} retirées.\n\nVotre progression est conservée.`, 'Mettre à jour')) return;
    setDeck(remote, true);
    toast('Fiches mises à jour.');
    render();
  } catch (e) {
    toast('Pas de connexion : impossible de vérifier pour l’instant.');
  }
}

async function download(filename, text, type) {
  // dans l'aperçu hébergé par Claude, les téléchargements passent par la plateforme
  if (window.claude && window.claude.use) {
    const dl = await window.claude.use('downloads').catch(() => null);
    if (dl) {
      try { await dl.save({ filename, data: new Blob([text], { type }) }); } catch (e) { /* refusé par l'utilisateur */ }
      return;
    }
  }
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function exportBackup() {
  const code = matiere || 'maths';
  const data = { app: 'flashcards-formules-' + code, exported: new Date().toISOString(), store };
  download(`formules-${code}-sauvegarde-${dayKey()}.json`, JSON.stringify(data), 'application/json');
}

async function importBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app === `flashcards-formules-${matiere === 'maths' ? 'physique' : 'maths'}`) throw new Error('sauvegarde d’une autre matière : changez de matière avant de la restaurer');
    if (data.app !== 'flashcards-formules-' + (matiere || 'maths') || !data.store || typeof data.store.cards !== 'object') throw new Error('fichier non reconnu');
    if (!await askConfirm(`Restaurer la sauvegarde du ${data.exported.slice(0, 10)} ? Elle remplace la progression actuelle de cet appareil.`, 'Restaurer')) return;
    Object.assign(store, { cards: {}, log: [], days: {}, selection: [] }, data.store);
    store.settings = Object.assign({}, DEFAULT_SETTINGS, store.settings);
    persist();
    scheduler = makeScheduler();
    updateBadge();
    toast('Sauvegarde restaurée.');
    render();
  } catch (e) {
    toast('Sauvegarde illisible : ' + (e.message || e));
  }
}

/* ---------- Installation et rappels ---------- */

let installPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; if (view === 'install') render(); });

function icsReminder(time) {
  const [h, m] = time.split(':').map(Number);
  const start = new Date();
  start.setHours(h, m, 0, 0);
  if (start < new Date()) start.setDate(start.getDate() + 1);
  const p = n => String(n).padStart(2, '0');
  const local = d => `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}00`;
  const end = new Date(start.getTime() + 15 * 60e3);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Formules BCPST//FR', 'BEGIN:VEVENT',
    `UID:formules-bcpst-${stamp}@local`, `DTSTAMP:${stamp}`, `DTSTART:${local(start)}`, `DTEND:${local(end)}`,
    'RRULE:FREQ=DAILY', 'SUMMARY:Formules BCPST : révisions du jour',
    'DESCRIPTION:Ouvrez l\'application Formules BCPST et faites vos cartes à revoir.',
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Formules BCPST', 'TRIGGER:PT0M', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}

function renderInstall() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  app.innerHTML = `
    <section class="card">
      <h2>Installer</h2>
      ${standalone ? '<p>L’application est déjà installée.</p>' : installPrompt
        ? '<button class="primary" id="install">Installer sur cet appareil</button>'
        : ios ? '<p>Sur iPhone ou iPad : ouvrez cette page dans <b>Safari</b>, touchez le bouton <b>Partager</b>, puis <b>Sur l’écran d’accueil</b>.</p>'
          : '<p>Sur Android, depuis votre navigateur habituel (Chrome, Samsung Internet, Firefox, Edge…) : ouvrez son menu (<b>⋮</b> ou <b>≡</b>), puis <b>Installer l’application</b> ou <b>Ajouter à l’écran d’accueil</b>.<br>Sur ordinateur (Chrome ou Edge) : icône d’installation à droite de la barre d’adresse.</p>'}
      <p class="muted small">Une fois installée, l’application fonctionne sans connexion. Sur iPhone, installez-la pour éviter que Safari efface vos données après plusieurs semaines sans visite.</p>
      <p class="warn"><b>Ouvrez toujours l’application par son icône.</b> Votre progression est enregistrée dans le navigateur qui a servi à l’installer : ouverte depuis un autre navigateur, l’application repart de zéro.</p>
    </section>
    <section class="card form">
      <h2>Rappel quotidien</h2>
      <p>Ajoutez un rappel répété chaque jour dans le calendrier de votre téléphone. ${'setAppBadge' in navigator ? 'L’icône de l’application affiche aussi le nombre de cartes à revoir.' : ''}</p>
      <label>Heure du rappel <input type="time" id="rtime" value="${store.settings.reminderTime}"></label>
      <button id="ics">Ajouter le rappel au calendrier</button>
      <p class="muted small">Le fichier téléchargé s’ouvre avec l’application Calendrier. Pour arrêter le rappel, supprimez l’événement dans votre calendrier.</p>
    </section>`;
  const i = document.getElementById('install');
  if (i) i.onclick = async () => { installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; render(); };
  document.getElementById('rtime').onchange = e => { store.settings.reminderTime = e.target.value || '18:00'; persist(); };
  document.getElementById('ics').onclick = () => download('rappel-formules-bcpst.ics', icsReminder(store.settings.reminderTime), 'text/calendar');
}

function renderPrivacy() {
  app.innerHTML = `<section class="card prose">
    <h2>En bref</h2>
    <p><b>Votre travail reste sur votre appareil.</b> L’application ne demande ni compte, ni nom, ni adresse e-mail, et n’utilise ni cookie, ni mesure d’audience, ni publicité. Votre progression n’est jamais envoyée.</p>

    <h2>Sur votre appareil</h2>
    <p>Le stockage de votre navigateur garde l’état de chaque carte (prochaine révision, stabilité, difficulté, oublis), l’historique de vos réponses, vos réglages et vos chapitres cochés. Personne d’autre n’y a accès.</p>

    <h2>Ce qui peut être envoyé à votre professeur</h2>
    <p>Seulement ce que vous choisissez d’envoyer : <b>un signalement d’erreur</b> (bouton &#9888;&#xFE0E;) ou <b>une suggestion</b>. Le message contient la carte concernée, le type de problème et ce que vous avez écrit, sans votre nom. Il est rangé dans un tableur Google de votre professeur (Google peut héberger ces données hors de l’Union européenne). L’application est hébergée par GitHub, qui ne reçoit pas vos réponses ; comme pour tout site, les serveurs de Google et de GitHub voient passer votre adresse IP.</p>

    <h2>Tout effacer</h2>
    <p>Réglages, puis « Effacer toute ma progression », ou supprimez l’application. Une sauvegarde exportée est un fichier qui vous appartient : vous choisissez où il va.</p>
  </section>`;
}

/* ---------- Démarrage ---------- */

async function main() {
  if (!MATIERES[matiere]) {
    view = 'matiere';
    render();
    registerWorker();
    return;
  }
  try {
    await loadDeck();
  } catch (e) {
    app.innerHTML = '<p class="warn">Impossible de charger les fiches. Vérifiez votre connexion au premier lancement.</p>';
    return;
  }
  render();
  updateBadge();
  flushReports();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  registerWorker();
}

function registerWorker() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').then(reg => { swReg = reg; }).catch(() => {});
    // nouvelle version installée : on recharge, mais jamais au milieu d'une séance
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.addEventListener('controllerchange', () => { updateReady = true; reloadIfIdle(); });
    }
  }
}

let swReg = null;
let updateReady = false;
function reloadIfIdle() {
  if (updateReady && !session && view === 'home') location.reload();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  // sur téléphone, l'application est souvent reprise sans être relancée : on cherche alors une mise à jour
  if (swReg) swReg.update().catch(() => {});
  if (view === 'home') render();
});

main();
