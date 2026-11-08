import { el, icon, fmtTime, fmtDateTime, dayLabel, relTime } from './ui.js';
import { store, onChange } from './store.js';
import { verifyRaw, verifyPayload, parseQr, dateKey } from './verify.js';
import { Scanner, cameraSupported, decodeImageFile } from './scanner.js';

const VERSION = '2.0.0';
const CFG = window.EXTRACTOR_PWA_CONFIG || {};
const $ = s => document.querySelector(s);
const screens = {
  scan: $('#screen-scan'), history: $('#screen-history'), registry: $('#screen-registry'),
  result: $('#screen-result'), settings: $('#screen-settings'),
};
const video = $('#video'), vf = $('#viewfinder'), hintEl = $('#scanHint');
const torchBtn = $('#torchBtn'), flipBtn = $('#flipBtn'), fileInput = $('#fileInput');
const DEFAULT_HINT = 'Placez le QR code du rapport dans le cadre';

let current = null, prevRoute = null, handling = false, starting = false;
let lastRaw = null, lastRawAt = 0; // évite de relire le même QR juste après un résultat
let histFilter = 'all', regAgency = 'all', regLimit = 40, deferredInstall = null;

/* ───────────── Retours sensoriels (son + vibration) ───────────── */
let audioCtx = null;
const ensureAudio = () => {
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch {}
};
document.addEventListener('pointerdown', ensureAudio, { passive: true });

function beep(ok) {
  if (!store.settings.sound || !audioCtx) return;
  const t0 = audioCtx.currentTime;
  (ok ? [[880, 0], [1320, 0.09]] : [[280, 0], [200, 0.12]]).forEach(([f, d]) => {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0 + d);
    g.gain.exponentialRampToValueAtTime(0.2, t0 + d + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.16);
    o.connect(g).connect(audioCtx.destination);
    o.start(t0 + d); o.stop(t0 + d + 0.18);
  });
}
function feedback(kind) {
  beep(kind === 'valid');
  if (store.settings.vibrate) navigator.vibrate?.(kind === 'valid' ? 45 : [70, 50, 70]);
}

/* ───────────── Toast + feuille de confirmation ───────────── */
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2800);
}

function confirmSheet({ title, text, confirm = 'Confirmer', danger = false }) {
  return new Promise(resolve => {
    const ov = $('#overlay');
    const close = v => { ov.hidden = true; ov.replaceChildren(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = e => { if (e.key === 'Escape') close(false); };
    document.addEventListener('keydown', onKey);
    ov.replaceChildren(
      el('div', { class: 'scrim', onClick: () => close(false) }),
      el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        el('div', { class: 'sheet-grip' }),
        el('h3', { text: title }), el('p', { text }),
        el('div', { class: 'sheet-actions' },
          el('button', { class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary'), text: confirm, onClick: () => close(true) }),
          el('button', { class: 'btn btn-ghost', text: 'Annuler', onClick: () => close(false) }))));
    ov.hidden = false;
  });
}

/* ───────────── Synchronisation du registre ───────────── */
const net = { syncing: false, error: null };
let syncPromise = null;

function sync() {
  if (syncPromise) return syncPromise;
  if (!navigator.onLine) return Promise.resolve({ ok: false, error: 'Pas de connexion Internet' });
  net.syncing = true; net.error = null; refresh();
  syncPromise = (async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(`${CFG.apiUrl}?action=syncReports`, { signal: ctrl.signal, cache: 'no-store' });
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || !contentType.toLowerCase().includes('application/json')) {
        throw new Error(`Réponse du pilote invalide (HTTP ${res.status})`);
      }
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Registre indisponible');
      if (data.service && data.service !== CFG.expectedService) {
        throw new Error('Cette URL correspond au mauvais pilote Apps Script.');
      }
      if (!Array.isArray(data.reports)) {
        throw new Error('Le pilote n’a pas renvoyé la liste des rapports.');
      }
      store.setReports(data.reports || []);
      return { ok: true };
    } catch (e) {
      const error = e.name === 'AbortError' ? 'Délai dépassé' : (e instanceof TypeError ? 'Serveur injoignable' : e.message);
      net.error = error;
      return { ok: false, error };
    } finally {
      clearTimeout(timer); syncPromise = null; net.syncing = false; refresh();
    }
  })();
  return syncPromise;
}

/* ───────────── Composants communs ───────────── */
const KINDS = {
  valid:   { icon: 'check', cls: 'kind-valid',   badge: 'Authentique' },
  invalid: { icon: 'x',     cls: 'kind-invalid', badge: 'Non conforme' },
  unknown: { icon: 'help',  cls: 'kind-unknown', badge: 'Introuvable' },
  foreign: { icon: 'alert', cls: 'kind-foreign', badge: 'Non reconnu' },
};

const iconBtn = (name, label, onClick) =>
  el('button', { class: 'icon-btn', 'aria-label': label, onClick }, icon(name));
const iconLink = (name, label, href) =>
  el('a', { class: 'icon-btn', 'aria-label': label, href }, icon(name));

function pageHead(title, sub, ...actions) {
  return el('header', { class: 'page-head' },
    el('div', {}, el('h1', { text: title }), sub && el('p', { class: 'page-sub', text: sub })),
    el('div', { class: 'page-actions' }, actions));
}

function emptyState(ic, title, text, action) {
  return el('div', { class: 'empty' },
    el('div', { class: 'empty-ic' }, icon(ic)),
    el('h2', { text: title }), el('p', { text }), action);
}

const goScan = () => { location.hash = '#/scan'; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* ───────────── Écran 1 : Scanner ───────────── */
const scanner = new Scanner(video, raw => handleRaw(raw));

function hint(text) { hintEl.textContent = text; }

function setCamState(kind) {
  const box = $('#camState');
  screens.scan.classList.toggle('cam-off', !!kind);
  if (!kind) { box.hidden = true; box.replaceChildren(); return; }
  const C = {
    prompt:      { ic: 'camera', title: 'Activer la caméra', text: "EXTRACTOR utilise la caméra uniquement pour lire les QR codes. Aucune image n'est enregistrée ni envoyée.", act: ['Activer la caméra', () => startCamera(true)] },
    denied:      { ic: 'alert',  title: 'Caméra bloquée', text: 'Autorisez la caméra pour ce site dans les réglages de votre navigateur, puis réessayez.', act: ['Réessayer', () => startCamera(true)] },
    nocamera:    { ic: 'alert',  title: 'Aucune caméra détectée', text: 'Vous pouvez tout de même scanner une photo du QR code.' },
    unsupported: { ic: 'alert',  title: 'Caméra indisponible', text: 'Le scan en direct exige une connexion sécurisée (HTTPS) et un navigateur compatible. Scannez plutôt une photo du QR code.' },
    error:       { ic: 'alert',  title: 'Caméra inaccessible', text: "La caméra n'a pas pu démarrer. Fermez les autres applications qui l'utilisent puis réessayez.", act: ['Réessayer', () => startCamera(true)] },
  }[kind];
  box.replaceChildren(el('div', { class: 'cam-card' },
    el('div', { class: 'cam-ic' }, icon(C.ic)),
    el('h2', { text: C.title }), el('p', { text: C.text }),
    C.act && el('button', { class: 'btn btn-primary', text: C.act[0], onClick: C.act[1] }),
    el('button', { class: 'btn btn-ghost', onClick: () => fileInput.click() }, icon('image'), 'Scanner une photo')));
  box.hidden = false;
}

async function startCamera(force = false) {
  if (current !== 'scan' || starting) return;
  handling = false;
  vf.className = 'viewfinder'; hint(DEFAULT_HINT);
  if (!cameraSupported()) return setCamState('unsupported');

  let perm = null;
  try { perm = (await navigator.permissions?.query({ name: 'camera' }))?.state; } catch {}
  if (perm === 'denied') return setCamState('denied');
  const remembered = localStorage.getItem('extractor_cam_ok') === '1';
  if (!force && !remembered && perm !== 'granted') return setCamState('prompt');

  starting = true;
  try {
    setCamState(null);
    await scanner.start();
    if (current !== 'scan') { scanner.stop(); return; }
    localStorage.setItem('extractor_cam_ok', '1');
    torchBtn.hidden = !scanner.canTorch; torchBtn.setAttribute('aria-pressed', 'false');
    flipBtn.hidden = !scanner.multiCam;
  } catch (err) {
    const n = err && err.name;
    if (n === 'NotAllowedError' || n === 'SecurityError') { localStorage.removeItem('extractor_cam_ok'); setCamState('denied'); }
    else if (n === 'NotFoundError' || n === 'OverconstrainedError') setCamState('nocamera');
    else setCamState('error');
  } finally { starting = false; }
}

function stopCamera() { scanner.stop(); torchBtn.hidden = true; flipBtn.hidden = true; }

async function handleRaw(raw) {
  if (handling) return;
  if (raw === lastRaw && Date.now() - lastRawAt < 5000) { scanner.resume(); return; }
  handling = true;
  lastRaw = raw; lastRawAt = Date.now();
  scanner.pause();
  vf.classList.add('found');

  const parsed = parseQr(raw);
  let res = verifyRaw(raw, store.reports);

  // Rapport inconnu localement mais connexion disponible : on consulte le registre en ligne.
  if (res.kind === 'unknown' && navigator.onLine && store.settings.autoSync) {
    vf.classList.remove('found'); vf.classList.add('busy');
    hint('Consultation du registre en ligne…');
    const r = await sync();
    if (r.ok) res = verifyRaw(raw, store.reports);
    vf.classList.remove('busy'); vf.classList.add('found');
  }

  feedback(res.kind);
  const entry = { uid: uid(), at: new Date().toISOString(), qr: parsed.ok ? parsed.data : undefined, ...res };
  store.addHistory(entry);
  setTimeout(() => { location.hash = '#/result/' + entry.uid; }, 260);
}

torchBtn.addEventListener('click', async () => {
  const ok = await scanner.setTorch(!scanner.torchOn);
  torchBtn.setAttribute('aria-pressed', String(scanner.torchOn));
  if (!ok) toast("La lampe n'est pas disponible");
});
flipBtn.addEventListener('click', () => scanner.flip().catch(() => toast('Impossible de changer de caméra')));
$('#photoBtn').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const file = fileInput.files && fileInput.files[0];
  fileInput.value = '';
  if (!file || handling) return;
  try {
    const raw = await decodeImageFile(file);
    if (raw) handleRaw(raw); else toast('Aucun QR code détecté dans cette image');
  } catch { toast("Image illisible"); }
});

/* ───────────── Écran 2 : Historique ───────────── */
function renderHistory() {
  const root = screens.history, h = store.history;
  const ok = h.filter(x => x.kind === 'valid').length;
  root.replaceChildren(pageHead('Historique', h.length ? `${h.length} vérification${h.length > 1 ? 's' : ''}` : 'Vos derniers scans',
    iconLink('settings', 'Réglages', '#/settings'),
    h.length && iconBtn('trash', "Effacer l'historique", async () => {
      if (await confirmSheet({ title: "Effacer l'historique ?", text: 'Les résultats enregistrés sur cet appareil seront supprimés. Le registre n’est pas touché.', confirm: 'Effacer', danger: true })) {
        store.clearHistory(); toast('Historique effacé');
      }
    })));

  if (!h.length) {
    root.append(emptyState('history', 'Aucune vérification', 'Scannez un rapport pour retrouver ici son résultat, même hors connexion.',
      el('button', { class: 'btn btn-primary', onClick: goScan }, icon('scan'), 'Scanner un rapport')));
    return;
  }

  const opts = [['all', 'Tous', h.length], ['valid', 'Authentiques', ok], ['check', 'À contrôler', h.length - ok]];
  root.append(el('div', { class: 'seg', role: 'tablist' }, opts.map(([key, label, n]) =>
    el('button', { class: 'seg-btn', role: 'tab', 'aria-selected': String(histFilter === key), onClick: () => { histFilter = key; renderHistory(); } },
      label, el('em', { text: n })))));

  const list = h.filter(x => histFilter === 'all' || (histFilter === 'valid' ? x.kind === 'valid' : x.kind !== 'valid'));
  if (!list.length) { root.append(el('p', { class: 'muted-center', text: 'Aucun résultat dans cette catégorie.' })); return; }

  let lastDay = '';
  for (const e of list) {
    const day = dayLabel(e.at);
    if (day !== lastDay) { root.append(el('h3', { class: 'group-title', text: day })); lastDay = day; }
    const k = KINDS[e.kind] || KINDS.foreign;
    const title = e.kind === 'foreign' ? 'QR non reconnu' : (e.details?.agency || 'Rapport');
    const sub = e.kind === 'foreign' ? fmtTime(e.at) : `${e.details?.period ?? '—'} · ${fmtTime(e.at)}`;
    root.append(el('button', { class: 'item', onClick: () => { location.hash = '#/result/' + e.uid; } },
      el('span', { class: 'item-ic ' + k.cls }, icon(k.icon)),
      el('span', { class: 'item-main' },
        el('b', { class: 'item-title', text: title }),
        el('span', { class: 'item-line' }, el('span', { class: 'badge ' + k.cls, text: k.badge }), el('small', { class: 'item-sub', text: sub }))),
      icon('next', 'chev')));
  }
}

/* ───────────── Écran 3 : Registre ───────────── */
function renderRegistry() {
  const root = screens.registry, reps = store.reports, online = navigator.onLine;
  root.replaceChildren(pageHead('Registre', 'Disponible hors connexion', iconLink('settings', 'Réglages', '#/settings')));

  root.append(el('div', { class: 'stat-card' },
    el('div', { class: 'stat-top' },
      el('span', { class: 'stat-label', text: 'Rapports enregistrés' }),
      el('span', { class: 'chip chip-light' + (online ? ' online' : ''), }, el('i'), online ? 'Connecté' : 'Hors ligne')),
    el('div', { class: 'stat-num', text: String(reps.length) }),
    el('p', { class: 'stat-sub', text: net.error && !net.syncing ? `Échec : ${net.error}` : `Dernière synchronisation : ${relTime(store.lastSync)}` }),
    el('button', { class: 'btn btn-gold', disabled: net.syncing ? '' : null, onClick: doManualSync },
      icon('sync', net.syncing ? 'spin' : ''), net.syncing ? 'Synchronisation…' : 'Synchroniser')));

  if (!reps.length) {
    root.append(emptyState('registry', 'Registre vide', online
      ? 'Lancez une synchronisation pour télécharger les rapports et pouvoir vérifier sans connexion.'
      : 'Connectez-vous à Internet une première fois pour télécharger le registre.'));
    return;
  }

  const name = r => r.agency_name || r.agency_id || '—';
  const agencies = [...new Set(reps.map(name))].sort((a, b) => a.localeCompare(b, 'fr'));
  if (regAgency !== 'all' && !agencies.includes(regAgency)) regAgency = 'all';
  if (agencies.length > 1) {
    root.append(el('div', { class: 'chips', role: 'tablist' }, ['all', ...agencies].map(a =>
      el('button', { class: 'chip-filter', role: 'tab', 'aria-selected': String(regAgency === a), onClick: () => { regAgency = a; regLimit = 40; renderRegistry(); } }, a === 'all' ? 'Toutes les agences' : a))));
  }

  const rows = reps.filter(r => regAgency === 'all' || name(r) === regAgency)
    .sort((a, b) => dateKey(b.report_date).localeCompare(dateKey(a.report_date)));
  root.append(el('h3', { class: 'group-title', text: `${rows.length} rapport${rows.length > 1 ? 's' : ''}` }));
  for (const r of rows.slice(0, regLimit)) {
    const bad = ['REVOKED', 'INVALID'].includes(String(r.status).toUpperCase());
    root.append(el('div', { class: 'item item-static' },
      el('span', { class: 'item-ic ' + (bad ? 'kind-invalid' : 'kind-neutral') }, icon('doc')),
      el('span', { class: 'item-main' }, el('b', { class: 'item-title', text: name(r) }), el('small', { class: 'item-sub', text: `Période ${r.month ?? '—'} · émis le ${r.report_date ?? '—'}` })),
      el('span', { class: 'badge ' + (bad ? 'kind-invalid' : 'kind-valid'), text: bad ? 'Révoqué' : 'En vigueur' })));
  }
  if (rows.length > regLimit) root.append(el('button', { class: 'btn btn-ghost', onClick: () => { regLimit += 40; renderRegistry(); } }, 'Afficher plus'));
}

async function doManualSync() {
  const r = await sync();
  toast(r.ok ? `Registre à jour · ${store.reports.length} rapports` : `Échec : ${r.error}`);
}

/* ───────────── Écran 4 : Résultat ───────────── */
function renderResult(id) {
  const root = screens.result;
  const e = store.history.find(x => x.uid === id);
  if (!e) {
    root.replaceChildren(emptyState('doc', 'Résultat introuvable', "Ce résultat n'est plus dans l'historique.",
      el('button', { class: 'btn btn-primary', onClick: goScan }, icon('scan'), 'Scanner un rapport')));
    return;
  }
  const k = KINDS[e.kind] || KINDS.foreign, d = e.details || {};
  const back = () => (prevRoute ? history.back() : (location.hash = '#/history'));

  const rows = e.kind === 'foreign'
    ? [['Contenu du QR', d.raw || '(vide)', 'mono']]
    : [['Agence', d.agency], ['Période', d.period], ['Date du rapport', d.reportDate], ['Référence', d.reportId, 'mono'], ['Code de contrôle', d.code, 'mono']]
        .filter(r => r[1] !== undefined && r[1] !== null && String(r[1]).trim() !== '');

  const hero = el('div', { class: 'res-hero ' + k.cls },
    el('button', { class: 'res-back', 'aria-label': 'Retour', onClick: back }, icon('back')),
    el('div', { class: 'res-seal' + (e.kind === 'valid' ? ' draw' : '') }, icon(k.icon)),
    el('h1', { text: e.title }), el('p', { text: e.summary }));

  const fromQr = e.kind === 'unknown' || (e.kind === 'invalid' && e.reason === 'mismatch');
  const detailsCard = el('section', { class: 'card' },
    el('h3', { class: 'card-title', text: e.kind === 'foreign' ? 'Contenu lu' : fromQr ? 'Informations lues dans le QR' : 'Informations du rapport' }),
    el('dl', { class: 'dl' }, rows.map(([t, v, c]) =>
      el('div', { class: 'dl-row' }, el('dt', { text: t }), el('dd', { class: c || '', text: String(v) })))));

  const checksCard = e.checks && e.checks.length ? el('section', { class: 'card' },
    el('h3', { class: 'card-title', text: 'Contrôles effectués' }),
    el('ul', { class: 'checks' }, e.checks.map(c =>
      el('li', { class: c.ok ? 'ok' : 'ko' },
        el('span', { class: 'check-ic' }, icon(c.ok ? 'check' : 'x')),
        el('span', { class: 'check-txt' }, el('b', { text: c.label }), c.detail && el('small', { text: c.detail })))))) : null;

  // En cas d'anomalie, ce qui a échoué passe avant le détail.
  const body = el('div', { class: 'res-body' },
    e.kind === 'invalid' ? [checksCard, detailsCard] : [detailsCard, checksCard]);
  body.append(el('p', { class: 'res-meta' }, `Vérifié le ${fmtDateTime(e.at)}` + (e.kind !== 'foreign' ? ` · registre : ${relTime(store.lastSync).toLowerCase()}` : '')));

  const actions = el('div', { class: 'res-actions' });
  if (e.kind === 'unknown' && e.qr) {
    actions.append(el('button', { class: 'btn btn-gold', onClick: async ev => {
      const btn = ev.currentTarget;
      btn.disabled = true;
      const r = await sync();
      if (!r.ok) { toast(`Échec : ${r.error}`); btn.disabled = false; return; }
      const res = verifyPayload(e.qr, store.reports);
      store.updateHistory(e.uid, res);
      feedback(res.kind);
      renderResult(e.uid);
    } }, icon('sync'), 'Synchroniser et revérifier'));
  }
  actions.append(el('button', { class: 'btn btn-primary', onClick: () => (prevRoute === 'scan' ? history.back() : goScan()) }, icon('scan'), 'Scanner un autre rapport'));

  root.replaceChildren(hero, body, actions);
}

/* ───────────── Écran 5 : Réglages ───────────── */
function toggleRow(title, desc, key) {
  const on = !!store.settings[key];
  return el('div', { class: 'row' },
    el('div', { class: 'row-main' }, el('b', { text: title }), desc && el('small', { text: desc })),
    el('button', { class: 'switch', role: 'switch', 'aria-checked': String(on), 'aria-label': title,
      onClick: () => { store.setSetting(key, !on); if (key === 'sound' && !on) { ensureAudio(); beep(true); } } }, el('i')));
}
const actionRow = (title, desc, onClick, danger) =>
  el('button', { class: 'row row-btn' + (danger ? ' danger' : ''), onClick },
    el('div', { class: 'row-main' }, el('b', { text: title }), desc && el('small', { text: desc })), icon('next', 'chev'));
const infoRow = (title, value) =>
  el('div', { class: 'row' }, el('div', { class: 'row-main' }, el('b', { text: title })), el('span', { class: 'row-val', text: value }));

function renderSettings() {
  const root = screens.settings;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);

  root.replaceChildren(
    el('header', { class: 'page-head' },
      el('div', { class: 'head-back' },
        el('button', { class: 'icon-btn', 'aria-label': 'Retour', onClick: () => (prevRoute ? history.back() : goScan()) }, icon('back')),
        el('h1', { text: 'Réglages' }))),

    el('h3', { class: 'group-title', text: 'Scanner' }),
    el('section', { class: 'group' },
      toggleRow('Son de confirmation', 'Un bip distinct selon le résultat', 'sound'),
      toggleRow('Vibration', 'Retour tactile après chaque scan', 'vibrate')),

    el('h3', { class: 'group-title', text: 'Registre' }),
    el('section', { class: 'group' },
      toggleRow('Synchronisation automatique', 'Au lancement et quand un rapport est inconnu', 'autoSync'),
      actionRow('Synchroniser maintenant', `Dernière : ${relTime(store.lastSync)}`, doManualSync)),

    el('h3', { class: 'group-title', text: 'Application' }),
    el('section', { class: 'group' },
      !standalone && deferredInstall && actionRow("Installer l'application", "Ajouter EXTRACTOR à l'écran d'accueil", async () => {
        deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; renderSettings();
      }),
      !standalone && !deferredInstall && ios && el('div', { class: 'row' }, el('div', { class: 'row-main' },
        el('b', { text: "Installer l'application" }), el('small', { text: 'Touchez Partager, puis « Sur l’écran d’accueil ».' }))),
      infoRow('Connexion', navigator.onLine ? 'En ligne' : 'Hors ligne'),
      infoRow('Version', VERSION)),

    el('h3', { class: 'group-title', text: 'Données sur cet appareil' }),
    el('section', { class: 'group' },
      actionRow("Effacer l'historique", `${store.history.length} résultat${store.history.length > 1 ? 's' : ''}`, async () => {
        if (await confirmSheet({ title: "Effacer l'historique ?", text: 'Cette action est définitive.', confirm: 'Effacer', danger: true })) { store.clearHistory(); toast('Historique effacé'); }
      }, true),
      actionRow('Vider le registre local', 'La vérification hors connexion ne sera plus possible tant que vous ne synchronisez pas', async () => {
        if (await confirmSheet({ title: 'Vider le registre ?', text: 'Les rapports téléchargés seront supprimés de cet appareil. Il faudra une connexion pour les récupérer.', confirm: 'Vider le registre', danger: true })) { store.clearReports(); toast('Registre vidé'); }
      }, true)),

    el('p', { class: 'foot', text: `EXTRACTOR · vérification documentaire · v${VERSION}` }));
}

/* ───────────── Routeur ───────────── */
const renderers = { history: renderHistory, registry: renderRegistry, settings: renderSettings, result: renderResult };

function route() {
  const [name, arg] = (location.hash.replace(/^#\/?/, '') || 'scan').split('/');
  show(screens[name] ? name : 'scan', arg);
}

function show(name, arg) {
  const leaving = current;
  if (leaving && leaving !== name) prevRoute = leaving;
  current = name;
  document.body.dataset.screen = name;
  Object.entries(screens).forEach(([k, n]) => { n.hidden = k !== name; });
  document.querySelectorAll('.tab').forEach(t => { if (t.dataset.tab === name) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); });

  if (leaving === 'scan' && name !== 'scan') stopCamera();
  if (name === 'scan') startCamera(); else { renderers[name](arg); screens[name].scrollTop = 0; }
}

function refresh() {
  if (current && current !== 'scan' && current !== 'result') renderers[current]();
  updateNet();
}

function updateNet() {
  const on = navigator.onLine, chip = $('#netChip');
  chip.classList.toggle('online', on);
  chip.lastElementChild.textContent = on ? 'Connecté' : 'Hors ligne';
}

/* ───────────── Démarrage ───────────── */
window.addEventListener('hashchange', route);
window.addEventListener('online', () => { refresh(); if (store.settings.autoSync) sync(); });
window.addEventListener('offline', refresh);
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; if (current === 'settings') renderSettings(); });
document.addEventListener('visibilitychange', () => {
  if (current !== 'scan') return;
  if (document.hidden) stopCamera(); else startCamera();
});
onChange(what => { if (what !== 'history' || current !== 'result') refresh(); });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
updateNet();
route();
if (navigator.onLine && store.settings.autoSync) sync();
