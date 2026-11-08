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

export function verifyPayload(p, reports, selectedAgency = null) {
  const claimed = {
    reportId: String(p.report_id),
    agency: p.agency ?? '—',
    period: p.period ?? '—',
    reportDate: p.report_date ?? '—',
    code: p.control_code ?? '',
  };
  const rec = reports.find(r => String(r.report_id) === String(p.report_id));

  if (!selectedAgency) {
    return {
      kind: 'invalid',
      reason: 'agency_required',
      title: 'Agence obligatoire',
      summary: 'Sélectionnez l’agence concernée avant de scanner ce rapport.',
      details: claimed,
      checks: [{ key: 'agency', label: 'Agence sélectionnée', ok: false }],
    };
  }

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
  const qrAgency = p.agency_id ?? p.agency;
  const recordAgencyOk = same(rec.agency_id, qrAgency) || same(rec.agency_name, p.agency);
  const selectedAgencyOk = same(selectedAgency.agency_id, rec.agency_id)
    || same(selectedAgency.agency_name, rec.agency_name);
  const agencyOk = recordAgencyOk && selectedAgencyOk;
  const periodOk = same(rec.month, p.period);
  const regCode = String(rec.control_code ?? '').trim();
  const codeOk = regCode !== '' && regCode === String(p.control_code ?? '').trim();

  // Pour les écarts, on montre la valeur du QR et celle du registre,
  // sauf pour le code de contrôle (jamais divulgué par le registre).
  const diff = (qr, reg) => `QR : ${qr ?? '—'} · Registre : ${reg ?? '—'}`;
  const checks = [
    { key: 'registry', label: 'Présent dans le registre', ok: true },
    { key: 'status', label: 'Rapport en vigueur', ok: !revoked, detail: revoked ? `Statut : ${status}` : null },
    { key: 'agency', label: 'Agence sélectionnée', ok: agencyOk,
      detail: agencyOk ? null : `Sélectionnée : ${selectedAgency.agency_name} · QR enregistré pour : ${rec.agency_name || rec.agency_id}` },
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
  if (!selectedAgencyOk) {
    return { kind: 'invalid', reason: 'agency_mismatch', title: 'Agence incorrecte',
      summary: `ATTENTION : ce code QR ne correspond pas à l’agence sélectionnée (${selectedAgency.agency_name}). Il est enregistré pour ${rec.agency_name || rec.agency_id}.`, details, checks };
  }
  if (failed) {
    return { kind: 'invalid', reason: 'mismatch', title: 'Rapport non conforme',
      summary: `${failed} information${failed > 1 ? 's' : ''} du QR ne correspond${failed > 1 ? 'ent' : ''} pas au registre. Le document a peut-être été modifié.`,
      details: { ...details, agency: claimed.agency, period: claimed.period, reportDate: claimed.reportDate }, checks };
  }
  return { kind: 'valid', title: 'Rapport authentique',
    summary: 'Toutes les informations du QR correspondent au registre officiel.', details, checks };
}

export function verifyRaw(raw, reports, selectedAgency = null) {
  const parsed = parseQr(raw);
  return parsed.ok ? verifyPayload(parsed.data, reports, selectedAgency) : foreignResult(parsed.raw);
}
