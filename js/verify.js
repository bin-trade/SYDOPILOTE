// Logique de vérification pure (sans DOM) : même contrat QR / registre que la v1.
const norm = v => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const same = (a, b) => norm(a) === norm(b);

export function dateKey(v) {
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return norm(s);
}

export function parseQr(raw) {
  const text = String(raw ?? '').trim();
  let data;
  try { data = JSON.parse(text); } catch { return { ok: false, raw: text }; }
  if (!data || typeof data !== 'object' || data.system !== 'EXTRACTOR' || !data.report_id) {
    return { ok: false, raw: text };
  }
  return { ok: true, data };
}

export function foreignResult(raw) {
  return {
    kind: 'foreign',
    title: 'QR non reconnu',
    summary: "Ce code n'a pas été émis par EXTRACTOR. Ne lui accordez aucune valeur documentaire.",
    details: { raw: String(raw || '').slice(0, 240) },
    checks: [],
  };
}

export function verifyPayload(p, reports) {
  const claimed = {
    reportId: String(p.report_id),
    agency: p.agency ?? '—',
    period: p.period ?? '—',
    reportDate: p.report_date ?? '—',
    code: p.control_code ?? '',
  };
  const rec = reports.find(r => String(r.report_id) === String(p.report_id));

  if (!rec) {
    return {
      kind: 'unknown',
      title: 'Rapport introuvable',
      summary: "Ce rapport n'est pas dans le registre de cet appareil. Synchronisez le registre puis revérifiez.",
      details: claimed,
      checks: [{ key: 'registry', label: 'Présent dans le registre', ok: false }],
    };
  }

  const status = String(rec.status || '').toUpperCase();
  const revoked = ['REVOKED', 'INVALID'].includes(status);
  const agencyOk = same(rec.agency_id, p.agency) || same(rec.agency_name, p.agency);
  const periodOk = same(rec.month, p.period);
  const regCode = String(rec.control_code ?? '').trim();
  const codeOk = regCode !== '' && regCode === String(p.control_code ?? '').trim();

  // Pour les écarts, on montre la valeur du QR et celle du registre,
  // sauf pour le code de contrôle (jamais divulgué par le registre).
  const diff = (qr, reg) => `QR : ${qr ?? '—'} · Registre : ${reg ?? '—'}`;
  const checks = [
    { key: 'registry', label: 'Présent dans le registre', ok: true },
    { key: 'status', label: 'Rapport en vigueur', ok: !revoked, detail: revoked ? `Statut : ${status}` : null },
    { key: 'agency', label: 'Agence', ok: agencyOk, detail: agencyOk ? null : diff(p.agency, rec.agency_name || rec.agency_id) },
    { key: 'period', label: 'Période', ok: periodOk, detail: periodOk ? null : diff(p.period, rec.month) },
    { key: 'date', label: 'Date du rapport (informatif)', ok: true, detail: null },
    { key: 'code', label: 'Code de contrôle', ok: codeOk, detail: codeOk ? null : 'Ne correspond pas au registre' },
  ];
  const failed = checks.filter(c => !c.ok).length;

  const details = {
    reportId: claimed.reportId,
    agency: rec.agency_name || rec.agency_id || claimed.agency,
    period: rec.month ?? claimed.period,
    reportDate: rec.report_date ?? claimed.reportDate,
    code: claimed.code,
  };

  if (revoked) {
    return { kind: 'invalid', reason: 'revoked', title: 'Rapport révoqué',
      summary: 'Ce rapport a été révoqué ou déclaré non conforme. Il ne doit plus être accepté.', details, checks };
  }
  if (failed) {
    return { kind: 'invalid', reason: 'mismatch', title: 'Rapport non conforme',
      summary: `${failed} information${failed > 1 ? 's' : ''} du QR ne correspond${failed > 1 ? 'ent' : ''} pas au registre. Le document a peut-être été modifié.`,
      details: { ...details, agency: claimed.agency, period: claimed.period, reportDate: claimed.reportDate }, checks };
  }
  return { kind: 'valid', title: 'Rapport authentique',
    summary: 'Toutes les informations du QR correspondent au registre officiel.', details, checks };
}

export function verifyRaw(raw, reports) {
  const parsed = parseQr(raw);
  return parsed.ok ? verifyPayload(parsed.data, reports) : foreignResult(parsed.raw);
}
