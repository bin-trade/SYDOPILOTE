// Stockage local : registre synchronisé, historique, réglages.
const K = {
  reports: 'extractor_reports',        // même clé que la v1 : le registre existant est conservé
  history: 'extractor_history_v2',
  settings: 'extractor_settings',
  lastSync: 'extractor_last_sync',
};

function read(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; }
  catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota / navigation privée */ }
}

const listeners = new Set();
const emit = what => listeners.forEach(fn => fn(what));
export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };

const HISTORY_MAX = 100;

export const store = {
  reports: Array.isArray(read(K.reports, [])) ? read(K.reports, []) : [],
  history: Array.isArray(read(K.history, [])) ? read(K.history, []) : [],
  settings: { sound: true, vibrate: true, autoSync: true, ...read(K.settings, {}) },
  lastSync: (() => { try { return localStorage.getItem(K.lastSync); } catch { return null; } })(),

  setReports(list) {
    this.reports = Array.isArray(list) ? list : [];
    this.lastSync = new Date().toISOString();
    write(K.reports, this.reports);
    try { localStorage.setItem(K.lastSync, this.lastSync); } catch {}
    emit('reports');
  },
  clearReports() {
    this.reports = []; this.lastSync = null;
    write(K.reports, []);
    try { localStorage.removeItem(K.lastSync); } catch {}
    emit('reports');
  },
  addHistory(entry) {
    this.history = [entry, ...this.history].slice(0, HISTORY_MAX);
    write(K.history, this.history);
    emit('history');
  },
  updateHistory(uid, patch) {
    this.history = this.history.map(h => h.uid === uid ? { ...h, ...patch } : h);
    write(K.history, this.history);
    emit('history');
  },
  clearHistory() {
    this.history = [];
    write(K.history, []);
    emit('history');
  },
  setSetting(key, value) {
    this.settings = { ...this.settings, [key]: value };
    write(K.settings, this.settings);
    emit('settings');
  },
};
