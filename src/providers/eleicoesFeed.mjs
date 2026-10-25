import { parsePackedExterior } from "./exterior-feed.mjs";
import {
  buildNormalized,
  buildUnavailable,
  candidate,
  toNumber,
} from "../lib/model.mjs";
import { fetchWithPolicy } from "../lib/http-cache.mjs";

const BASE = "https://eleicoes2026brasil.com/feed";

function pickCandidate(obj) {
  if (!obj) return null;
  const name = obj.nome || obj.name;
  if (!name) return null;
  if (!/lula|fl[aá]vio/i.test(name)) return null;
  return candidate(name, toNumber(obj.votos), toNumber(obj.percentual));
}

function extractCandidates(json) {
  if (Array.isArray(json?.candidatos)) {
    return json.candidatos.map(pickCandidate).filter(Boolean);
  }
  if (Array.isArray(json?.resultado?.candidatos)) {
    return json.resultado.candidatos.map(pickCandidate).filter(Boolean);
  }
  return [];
}

export function parseEleicoesNow(json, sourceUrl) {
  const candidatos = extractCandidates(json);
  if (!candidatos.length) {
    throw new Error("Formato feed/agora.json inválido: candidatos ausentes.");
  }

  return buildNormalized({
    provider: "eleicoes-feed",
    sourceUrl,
    sourceKind: "independent-tse-derived",
    updatedAt:
      json?.updatedAt ||
      json?.atualizadoEm ||
      json?.resultado?.updatedAt ||
      null,
    votosValidos: toNumber(json?.votosValidos ?? json?.resultado?.votosValidos),
    secoesApuradas: toNumber(
      json?.secoesApuradas ?? json?.resultado?.secoesApuradas,
    ),
    secoesTotais: toNumber(json?.secoesTotais ?? json?.resultado?.secoesTotais),
    candidatos,
    progressPercent: toNumber(
      json?.percentualApurado ?? json?.resultado?.percentualApurado,
    ),
    consolidationWarning: "Feed independente baseado no TSE.",
  });
}

export function parseCompactFeed(json, scope, sourceUrl) {
  const record =
    scope.uf === "br"
      ? json?.presidente?.br
      : json?.presidente?.uf?.[scope.uf.toUpperCase()];
  if (!record || !record.votos)
    throw new Error("Feed sem resultado para a abrangência selecionada.");
  const values = Object.values(record.votos).map(toNumber);
  const denominator =
    values.length && values.every((v) => v !== null && v >= 0)
      ? values.reduce((a, b) => a + b, 0)
      : null;
  const candidatos = [
    ["22", "Flávio Bolsonaro"],
    ["13", "Lula"],
  ]
    .filter(([number]) => Object.hasOwn(record.votos, number))
    .map(([number, name]) => {
      const votes = toNumber(record.votos[number]);
      return candidate(
        name,
        votes,
        denominator > 0 && votes !== null ? (votes / denominator) * 100 : null,
      );
    });
  if (!candidatos.length) throw new Error("Feed sem candidatos esperados.");
  return buildNormalized({
    provider: "eleicoes-feed",
    sourceUrl,
    sourceKind: "independent-tse-derived",
    updatedAt:
      typeof json.gerado === "number" && Number.isFinite(json.gerado)
        ? new Date(json.gerado).toISOString()
        : null,
    votosValidos: denominator,
    secoesApuradas: toNumber(record.totalizadas),
    secoesTotais: toNumber(record.secoes),
    candidatos,
    progressPercent: null,
    consolidationWarning:
      "Feed independente baseado no TSE. Percentuais calculados sobre os votos a candidatos retornados pelo feed.",
  });
}
export async function fetchEleicoesFeed(scope, fetchImpl = fetch) {
  if (scope.kind === "municipio")
    return buildUnavailable(
      "eleicoes-feed",
      BASE,
      "Feed municipal não validado.",
    );
  const url = scope.city ? `${BASE}/uf/zz.json` : `${BASE}/agora.json`;
  try {
    const { data, fetchedAt } = await fetchWithPolicy({
      key: `eleicoes-feed:${url}`,
      url,
      cacheTtlMs: 15000,
      timeoutMs: 5000,
      fetchImpl,
    });
    if (scope.city) {
      if (Array.isArray(data?.tse))
        return {
          ...(await parsePackedExterior(data, scope, url, fetchImpl)),
          retrievedAt: fetchedAt,
        };
      const selected = (Array.isArray(data?.locais) ? data.locais : []).find(
        (x) =>
          String(x.id) === scope.city &&
          x.tipo === (scope.kind === "exterior-pais" ? "country" : "city"),
      );
      if (!selected)
        return buildUnavailable(
          "eleicoes-feed",
          url,
          "Identificador de país/cidade não encontrado no feed. A fonte compacta não informa nomes ou agrupamento por país.",
        );
      const normalized = parseEleicoesNow(selected, url);
      return {
        ...normalized,
        retrievedAt: fetchedAt,
        location: {
          id: String(selected.id),
          nome: selected.nome,
          tipo: selected.tipo,
        },
      };
    }
    if (data?.presidente)
      return { ...parseCompactFeed(data, scope, url), retrievedAt: fetchedAt };
    if (scope.kind === "estado")
      throw new Error(
        "Feed sem resultado estadual; total nacional não substitui a localidade selecionada.",
      );
    // Legacy exterior contract is explicitly fetched from ZZ, never from a national total.
    if (scope.uf === "zz") {
      const zzUrl = `${BASE}/uf/zz.json`;
      const zz = await fetchWithPolicy({
        key: `eleicoes-feed:${zzUrl}`,
        url: zzUrl,
        cacheTtlMs: 15000,
        fetchImpl,
      });
      return { ...parseEleicoesNow(zz.data, zzUrl), retrievedAt: zz.fetchedAt };
    }
    return { ...parseEleicoesNow(data, url), retrievedAt: fetchedAt };
  } catch (error) {
    return buildUnavailable(
      "eleicoes-feed",
      url,
      `Feed independente indisponível: ${error.message}`,
    );
  }
}

export async function fetchEleicoesHistory(fetchImpl = fetch) {
  const url = `${BASE}/historico.json`;
  try {
    const { data } = await fetchWithPolicy({
      key: "eleicoes-feed:historico",
      url,
      cacheTtlMs: 15000,
      timeoutMs: 5000,
      fetchImpl,
    });
    const points = Array.isArray(data) ? data : data?.pontos;
    if (!Array.isArray(points)) throw new Error("Histórico inválido.");
    return points;
  } catch (error) {
    throw new Error(`Histórico do feed: ${error.message}`);
  }
}

export function extractFeedLocations(json) {
  if (!Array.isArray(json?.locais)) return [];
  return json.locais.map((item) => ({
    id: String(item.id),
    nome: item.nome,
    tipo: item.tipo || "unknown",
  }));
}
