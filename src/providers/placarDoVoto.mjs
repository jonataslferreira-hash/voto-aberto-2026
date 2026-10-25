import {
  buildNormalized,
  buildUnavailable,
  candidate,
  toNumber,
} from "../lib/model.mjs";
import { fetchWithPolicy } from "../lib/http-cache.mjs";

const BASE = "https://placardovoto.com/api/public/v1";

function mapCandidates(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((item) => /lula|fl[aá]vio/i.test(item.nome || item.name || ""))
    .map((item) =>
      candidate(
        item.nome || item.name,
        toNumber(item.votos),
        toNumber(item.percentual),
      ),
    );
}

export function parsePlacarJson(json, sourceUrl) {
  const payload = json?.result || json?.data || json;
  const list =
    payload?.candidates ||
    payload?.candidatos ||
    payload?.resultado?.candidatos;
  const candidatos = mapCandidates(
    Array.isArray(list)
      ? list.map((c) => ({
          ...c,
          votos: c.votes ?? c.votos,
          percentual: c.percent ?? c.percentual,
        }))
      : [],
  );
  if (!candidatos.length)
    throw new Error("Formato Placar do Voto inválido: candidatos ausentes.");
  const denominator = toNumber(
    payload?.candidatePercentVotes ??
      payload?.votos_validos ??
      payload?.votosValidos,
  );
  if (denominator === 0) for (const c of candidatos) c.percentual = null;
  const rawDate = payload?.updatedAt ?? payload?.updated_at;
  return buildNormalized({
    provider: "placar-do-voto",
    sourceUrl,
    sourceKind: "independent-tse-derived",
    updatedAt:
      typeof rawDate === "number"
        ? new Date(rawDate).toISOString()
        : rawDate || null,
    votosValidos: toNumber(
      payload?.validVotes ?? payload?.votos_validos ?? payload?.votosValidos,
    ),
    secoesApuradas: toNumber(
      payload?.counted ?? payload?.secoes_apuradas ?? payload?.secoesApuradas,
    ),
    secoesTotais: toNumber(
      payload?.sections ?? payload?.secoes_totais ?? payload?.secoesTotais,
    ),
    candidatos,
    progressPercent: toNumber(
      payload?.progress ??
        payload?.percentual_apurado ??
        payload?.percentualApurado,
    ),
    consolidationWarning:
      json?.freshness?.warning ||
      "Resultado de provedor independente. Confirmar com TSE oficial.",
  });
}

function buildPath(scope) {
  const base = `${BASE}/resultados/2026/2/presidente/${scope.uf}`;
  if (scope.city) return `${base}/${scope.city}/`;
  return `${base}/`;
}

export async function fetchPlacar(scope, fetchImpl = fetch) {
  if (scope.kind === "exterior-pais" || scope.kind === "exterior-cidade")
    return buildUnavailable(
      "placar-do-voto",
      BASE,
      "Contrato do Placar por país/cidade não validado.",
    );
  const url = buildPath(scope);
  try {
    const { data, fetchedAt } = await fetchWithPolicy({
      key: `placar:${scope.uf}:${scope.city || ""}`,
      url,
      cacheTtlMs: 30000,
      timeoutMs: 6000,
      fetchImpl,
    });
    return { ...parsePlacarJson(data, url), retrievedAt: fetchedAt };
  } catch (error) {
    return buildUnavailable(
      "placar-do-voto",
      url,
      `Placar do Voto indisponível: ${error.message}`,
    );
  }
}

export async function fetchPlacarHistory(scope, fetchImpl = fetch) {
  const url = `${BASE}/historico/2026/2/presidente/${scope.uf}/`;
  try {
    const { data, fetchedAt } = await fetchWithPolicy({
      key: `placar-historico:${scope.uf}`,
      url,
      cacheTtlMs: 30000,
      timeoutMs: 6000,
      fetchImpl,
    });
    return Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data)
        ? data
        : [];
  } catch (error) {
    throw new Error(`Histórico do Placar: ${error.message}`);
  }
}
