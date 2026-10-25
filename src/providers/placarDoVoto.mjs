import { buildNormalized, buildUnavailable, candidate, toNumber } from '../lib/model.mjs';
import { fetchWithPolicy } from '../lib/http-cache.mjs';

const BASE = 'https://placardovoto.com/api/public/v1';

function mapCandidates(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((item) => /lula|fl[aá]vio/i.test(item.nome || item.name || ''))
    .map((item) => candidate(item.nome || item.name, toNumber(item.votos), toNumber(item.percentual)));
}

export function parsePlacarJson(json, sourceUrl) {
  const payload = json?.data || json;
  const candidatos = mapCandidates(payload?.candidatos || payload?.resultado?.candidatos);
  if (!candidatos.length) {
    throw new Error('Formato Placar do Voto inválido: candidatos ausentes.');
  }

  return buildNormalized({
    provider: 'placar-do-voto',
    sourceUrl,
    sourceKind: 'independent-tse-derived',
    updatedAt: payload?.updated_at || payload?.updatedAt || null,
    votosValidos: toNumber(payload?.votos_validos || payload?.votosValidos),
    secoesApuradas: toNumber(payload?.secoes_apuradas || payload?.secoesApuradas),
    secoesTotais: toNumber(payload?.secoes_totais || payload?.secoesTotais),
    candidatos,
    progressPercent: toNumber(payload?.percentual_apurado || payload?.percentualApurado),
    consolidationWarning: 'Resultado de provedor independente. Confirmar com TSE oficial.'
  });
}

function buildPath(scope) {
  const base = `${BASE}/resultados/2026/2/presidente/${scope.uf}`;
  if (scope.city) return `${base}/${scope.city}/`;
  return `${base}/`;
}

export async function fetchPlacar(scope, fetchImpl = fetch) {
  const url = buildPath(scope);
  try {
    const { data } = await fetchWithPolicy({
      key: `placar:${scope.uf}:${scope.city || ''}`,
      url,
      cacheTtlMs: 30000,
      timeoutMs: 6000,
      fetchImpl
    });
    return parsePlacarJson(data, url);
  } catch (error) {
    return buildUnavailable('placar-do-voto', url, `Placar do Voto indisponível: ${error.message}`);
  }
}

export async function fetchPlacarHistory(scope, fetchImpl = fetch) {
  const url = `${BASE}/historico/2026/2/presidente/${scope.uf}/`;
  try {
    const { data } = await fetchWithPolicy({
      key: `placar-historico:${scope.uf}`,
      url,
      cacheTtlMs: 30000,
      timeoutMs: 6000,
      fetchImpl
    });
    return Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}
