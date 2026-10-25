export const STATUS = {
  NOT_STARTED: "not-started",
  PARTIAL: "partial",
  TOTALIZED: "totalized",
};

export function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value).trim();
  if (!text || !/^-?\d[\d.,]*$/.test(text)) return null;
  const normalized = text.includes(",")
    ? text.replace(/\./g, "").replace(",", ".")
    : text;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

export function inferStatus({ sectionsDone, sectionsTotal, progressPercent }) {
  if (
    sectionsDone === null &&
    sectionsTotal === null &&
    progressPercent === null
  )
    return STATUS.NOT_STARTED;
  if (sectionsTotal && sectionsDone !== null) {
    if (sectionsDone <= 0) return STATUS.NOT_STARTED;
    if (sectionsDone >= sectionsTotal) return STATUS.TOTALIZED;
    return STATUS.PARTIAL;
  }
  if (progressPercent === null) return STATUS.NOT_STARTED;
  if (progressPercent <= 0) return STATUS.NOT_STARTED;
  if (progressPercent >= 100) return STATUS.TOTALIZED;
  return STATUS.PARTIAL;
}

export function candidate(name, votes, percent) {
  return {
    candidato: name ?? "Desconhecido",
    votos: votes,
    percentual: percent,
  };
}

export function buildUnavailable(provider, sourceUrl, message) {
  const now = new Date().toISOString();
  return {
    provider,
    sourceUrl,
    sourceKind: "unavailable",
    status: STATUS.NOT_STARTED,
    updatedAt: null,
    retrievedAt: now,
    votosValidos: null,
    secoesApuradas: null,
    secoesTotais: null,
    candidatos: [],
    consolidationWarning: message || "Dados indisponíveis na fonte.",
  };
}

export function buildNormalized({
  provider,
  sourceUrl,
  sourceKind,
  updatedAt,
  votosValidos,
  secoesApuradas,
  secoesTotais,
  candidatos,
  progressPercent,
  consolidationWarning,
}) {
  const status = inferStatus({
    sectionsDone: secoesApuradas,
    sectionsTotal: secoesTotais,
    progressPercent,
  });

  return {
    provider,
    sourceUrl,
    sourceKind,
    status,
    updatedAt,
    retrievedAt: new Date().toISOString(),
    votosValidos,
    secoesApuradas,
    secoesTotais,
    progressPercent: progressPercent ?? null,
    candidatos,
    consolidationWarning: consolidationWarning || null,
  };
}

export function ensureNoInventedNumbers(payload) {
  if (!payload) return false;
  if (payload.sourceKind === "unavailable") return true;
  return payload.candidatos.every(
    (c) => c.votos !== 0 || payload.status !== STATUS.NOT_STARTED,
  );
}
