import { buildNormalized, buildUnavailable, candidate, toNumber } from "../lib/model.mjs";
import { fetchWithPolicy } from "../lib/http-cache.mjs";

// The CNN election page exposes this public JSON path through its client code:
// year/round/scope/uf/office.json. Keep this adapter limited to the exterior
// total until country/city contracts are published by CNN.
const BASE = "https://djwnrcncpvp8z.cloudfront.net/oficial";
const PAGE = "https://www.cnnbrasil.com.br/eleicoes/2026/apuracao/zz/segundo-turno/";
const SOURCE = `${BASE}/2026/2t/resume/zz/presidente.json`;

function numeric(value) {
  const direct = toNumber(value);
  if (direct !== null) return direct;
  if (typeof value !== "string") return null;
  const localized = value.trim().replace(/\./g, "").replace(",", ".");
  return /^\d+(?:\.\d+)?$/.test(localized) ? Number(localized) : null;
}

function percent(value) {
  if (typeof value === "string") value = value.replace("%", "").trim();
  const parsed = numeric(value);
  return parsed !== null && parsed >= 0 && parsed <= 100 ? parsed : null;
}

function isCandidate(candidate, number, namePattern) {
  const ballotNumber = String(candidate?.number ?? candidate?.number_candidate ?? "");
  const name = candidate?.ballot_name ?? candidate?.name ?? "";
  return ballotNumber === number || namePattern.test(name);
}

export function parseCnnAbroad(json, sourceUrl = SOURCE) {
  const records = Array.isArray(json) ? json : Array.isArray(json?.results) ? json.results : [];
  const record = records.find((item) => String(item?.uf || "").toLowerCase() === "zz");
  if (!record || !Array.isArray(record.candidates))
    throw new Error("CNN não publicou totalização do exterior no formato esperado.");

  const candidates = [
    ["22", "Flávio Bolsonaro", /fl[aá]vio/i],
    ["13", "Lula", /\blula\b/i],
  ].map(([number, fallback, pattern]) => {
    const item = record.candidates.find((candidate) =>
      isCandidate(candidate, number, pattern),
    );
    if (!item) return null;
    const votes = numeric(item.votes?.total ?? item.votes?.total_formated ?? item.total_votes);
    if (votes === null || votes < 0) return null;
    return candidate(item.ballot_name || item.name || fallback, votes,
      percent(item.votes?.percent ?? item.percent));
  }).filter(Boolean);

  if (candidates.length !== 2)
    throw new Error("CNN ainda não publicou votos válidos para os dois candidatos no exterior.");

  const progress = percent(record.resume?.counted_ballot_box?.percent);
  const validVotes = numeric(record.resume?.valid?.total ?? record.resume?.valid?.total_formated);
  return buildNormalized({
    provider: "cnn-brasil",
    sourceUrl,
    sourceKind: "independent-tse-derived",
    updatedAt: record.updated_at || null,
    votosValidos: validVotes,
    secoesApuradas: numeric(record.resume?.counted_ballot_box?.total),
    secoesTotais: null,
    candidatos: candidates,
    progressPercent: progress,
    consolidationWarning:
      "Espelho público do painel eleitoral da CNN Brasil, que credita os resultados ao TSE. Pode atualizar depois da fonte oficial; esta resposta não é uma contagem independente de boletins.",
  });
}

export async function fetchCnnAbroad(scope, fetchImpl = fetch) {
  if (scope.kind !== "exterior-geral" || scope.uf !== "zz")
    return buildUnavailable(
      "cnn-brasil",
      PAGE,
      "A CNN publica este feed somente para o total geral do exterior; não há resultado validado por país/cidade neste painel.",
    );
  try {
    const { data, fetchedAt } = await fetchWithPolicy({
      key: `cnn-brasil:${SOURCE}`,
      url: SOURCE,
      cacheTtlMs: 15000,
      timeoutMs: 5000,
      fetchImpl,
    });
    return { ...parseCnnAbroad(data), retrievedAt: fetchedAt };
  } catch (error) {
    return buildUnavailable(
      "cnn-brasil",
      PAGE,
      `Feed público da CNN Brasil indisponível: ${error.message}`,
    );
  }
}

