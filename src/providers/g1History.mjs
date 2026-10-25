import { fetchWithPolicy } from "../lib/http-cache.mjs";

const BASE = "https://s.glbimg.com/jo/el";
const number = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).trim().replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null;
};

export function parseG1History(json, sourceUrl) {
  if (!Array.isArray(json?.MAPAS))
    throw new Error("Formato do histórico G1 inválido: MAPAS ausente.");
  return json.MAPAS.map((map) => {
    const rawAt = map?.DT_TOTALIZACAO;
    const at = typeof rawAt === "string" && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(rawAt)
      ? `${rawAt}-03:00`
      : rawAt;
    if (!at || !Number.isFinite(Date.parse(at))) return null;
    const candidates = {};
    for (const candidate of Array.isArray(map.CANDIDATOS) ? map.CANDIDATOS : []) {
      const id = String(candidate?.n ?? "");
      const percent = number(candidate?.pvap);
      if (/^\d{1,3}$/.test(id) && percent !== null) candidates[id] = percent;
    }
    return { updatedAt: new Date(at).toISOString(), candidatePercents: candidates };
  }).filter(Boolean).sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
}

export async function fetchG1History(scope, turn, fetchImpl = fetch) {
  if (!Number.isInteger(Number(turn)) || ![1, 2].includes(Number(turn)))
    throw new Error("Turno G1 inválido.");
  if (scope.city || !["brasil", "estado"].includes(scope.kind))
    throw new Error("Histórico G1 validado somente para Brasil e estados.");
  const location = scope.kind === "brasil" ? "BR" : scope.uf.toUpperCase();
  const url = `${BASE}/2026/apuracao/${turn}-turno/marcha-apuracao/HISTORICO_EXECUTIVO_PRESIDENTE_${location}.JSON`;
  const { data } = await fetchWithPolicy({
    key: `g1-history:2026:${turn}:${location}`,
    url,
    cacheTtlMs: Number(turn) === 1 ? 300000 : 15000,
    timeoutMs: 8000,
    fetchImpl,
  });
  const points = parseG1History(data, url);
  return { points, sourceUrl: url };
}
