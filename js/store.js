// Stockage local : registre synchronisé, historique, réglages.
const K = {
  reports: 'extractor_reports',        // même clé que la v1 : le registre existant est conservé
  agencies: 'extractor_agencies_v1',
  selectedAgency: 'extractor_selected_agency_v1',
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
  agencies: Array.isArray(read(K.agencies, [])) ? read(K.agencies, []) : [],
  selectedAgencyId: (() => { try { return localStorage.getItem(K.selectedAgency) || ''; } catch { return ''; } })(),
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
  setAgencies(list) {
    const next = Array.isArray(list) ? list.filter(a => a && a.agency_id).map(a => ({
      agency_id: String(a.agency_id),
      agency_name: String(a.agency_name || a.agency_id)
    })) : [];
    this.agencies = [...new Map(next.map(a => [a.agency_id, a])).values()]
      .sort((a, b) => a.agency_name.localeCompare(b.agency_name, 'fr'));
    write(K.agencies, this.agencies);
    if (this.selectedAgencyId && !this.agencies.some(a => a.agency_id === this.selectedAgencyId)) {
      this.setSelectedAgency('');
    }
    emit('agencies');
  },
  setSelectedAgency(id) {
    this.selectedAgencyId = String(id || '');
    try { localStorage.setItem(K.selectedAgency, this.selectedAgencyId); } catch {}
    emit('selectedAgency');
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
