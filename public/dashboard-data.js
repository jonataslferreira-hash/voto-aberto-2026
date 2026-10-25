export const REGIONS = ["Norte", "Nordeste", "Centro-Oeste", "Sudeste", "Sul"];
export const STATES = [
  ["ac", "Acre", 0],
  ["al", "Alagoas", 1],
  ["am", "Amazonas", 0],
  ["ap", "Amapá", 0],
  ["ba", "Bahia", 1],
  ["ce", "Ceará", 1],
  ["df", "Distrito Federal", 2],
  ["es", "Espírito Santo", 3],
  ["go", "Goiás", 2],
  ["ma", "Maranhão", 1],
  ["mg", "Minas Gerais", 3],
  ["ms", "Mato Grosso do Sul", 2],
  ["mt", "Mato Grosso", 2],
  ["pa", "Pará", 0],
  ["pb", "Paraíba", 1],
  ["pe", "Pernambuco", 1],
  ["pi", "Piauí", 1],
  ["pr", "Paraná", 4],
  ["rj", "Rio de Janeiro", 3],
  ["rn", "Rio Grande do Norte", 1],
  ["ro", "Rondônia", 0],
  ["rr", "Roraima", 0],
  ["rs", "Rio Grande do Sul", 4],
  ["sc", "Santa Catarina", 4],
  ["se", "Sergipe", 1],
  ["sp", "São Paulo", 3],
  ["to", "Tocantins", 0],
].map(([uf, name, region]) => ({ uf, name, region: REGIONS[region] }));
export const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const numeric = (value) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
export const percent = (value) =>
  numeric(value) !== null && value >= 0 && value <= 100 ? value : null;
export const count = (value) =>
  numeric(value) !== null && Number.isInteger(value) && value >= 0
    ? value
    : null;
export const int = (value) =>
  count(value) === null ? "—" : value.toLocaleString("pt-BR");
export const pct = (value) =>
  percent(value) === null
    ? "—"
    : `${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
export function candidates(payload) {
  const list =
    payload?.sourceKind === "unavailable"
      ? []
      : Array.isArray(payload?.candidatos)
        ? payload.candidatos
        : [];
  const get = (pattern) => {
    const c = list.find((c) => pattern.test(c.candidato || ""));
    return { votes: count(c?.votos), pct: percent(c?.percentual) };
  };
  return { flavio: get(/fl[aá]vio/i), lula: get(/lula/i) };
}
export function comparison(payload) {
  const { flavio, lula } = candidates(payload);
  const valid =
    flavio.pct !== null &&
    lula.pct !== null &&
    flavio.pct + lula.pct > 0 &&
    flavio.pct + lula.pct <= 100.1;
  const diff =
    flavio.votes !== null &&
    lula.votes !== null &&
    flavio.votes + lula.votes > 0
      ? Math.abs(flavio.votes - lula.votes)
      : null;
  const leader =
    diff === null
      ? "unknown"
      : diff === 0
        ? "tie"
        : flavio.votes > lula.votes
          ? "blue"
          : "red";
  return {
    flavio,
    lula,
    valid,
    diff,
    leader,
    split: valid ? (flavio.pct / (flavio.pct + lula.pct)) * 100 : null,
  };
}
export function progress(payload) {
  if (payload?.sourceKind === "unavailable") return null;
  const done = count(payload?.secoesApuradas),
    total = count(payload?.secoesTotais);
  return total !== null && total > 0 && done !== null && done <= total
    ? (done / total) * 100
    : percent(payload?.progressPercent);
}
export function statusLabel(payload) {
  if (!payload || payload.sourceKind === "unavailable")
    return "Dados indisponíveis";
  return payload.status === "totalized"
    ? "Totalização finalizada"
    : payload.status === "partial"
      ? "Apuração parcial"
      : "Aguardando apuração";
}
export function regionGroups(snapshots) {
  return REGIONS.map((name) => {
    const members = STATES.filter((s) => s.region === name);
    const groups = new Map();
    for (const s of members) {
      const p = snapshots.get(s.uf);
      const { flavio, lula } = candidates(p);
      if (flavio.votes === null || lula.votes === null || !p?.provider)
        continue;
      const key = `${p.provider}:${p.sourceKind}`;
      if (!groups.has(key))
        groups.set(key, {
          provider: p.provider,
          sourceKind: p.sourceKind,
          flavio: 0,
          lula: 0,
          valid: 0,
          completeDenominator: true,
          states: 0,
          times: [],
          statuses: [],
        });
      const g = groups.get(key);
      g.flavio += flavio.votes;
      g.lula += lula.votes;
      g.states++;
      g.statuses.push(p.status);
      const vv = count(p.votosValidos);
      if (vv === null || vv < flavio.votes + lula.votes)
        g.completeDenominator = false;
      else g.valid += vv;
      if (p.updatedAt) g.times.push(p.updatedAt);
    }
    return {
      name,
      total: members.length,
      groups: [...groups.values()].map((g) => ({
        ...g,
        flavioPct:
          g.completeDenominator && g.valid > 0
            ? (g.flavio / g.valid) * 100
            : null,
        lulaPct:
          g.completeDenominator && g.valid > 0
            ? (g.lula / g.valid) * 100
            : null,
      })),
    };
  });
}
export function historyPoints(points) {
  return (Array.isArray(points) ? points : [])
    .map((p) => ({
      at: Date.parse(p.at),
      flavio: percent(p.flavioPercent),
      lula: percent(p.lulaPercent),
    }))
    .filter((p) => Number.isFinite(p.at))
    .sort((a, b) => a.at - b.at);
}
export function linePath(points, key, x, y) {
  let open = false,
    d = "";
  for (const p of points) {
    if (p[key] === null) {
      open = false;
      continue;
    }
    d += `${open ? "L" : "M"}${x(p.at).toFixed(2)},${y(p[key]).toFixed(2)} `;
    open = true;
  }
  return d.trim();
}
