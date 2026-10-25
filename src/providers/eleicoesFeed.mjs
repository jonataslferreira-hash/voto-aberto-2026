import { buildNormalized, buildUnavailable, candidate, toNumber } from '../lib/model.mjs';
import { fetchWithPolicy } from '../lib/http-cache.mjs';

const BASE = 'https://eleicoes2026brasil.com/feed';

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
    throw new Error('Formato feed/agora.json inválido: candidatos ausentes.');
  }

  return buildNormalized({
    provider: 'eleicoes-feed',
    sourceUrl,
    sourceKind: 'independent-tse-derived',
    updatedAt: json?.updatedAt || json?.atualizadoEm || json?.resultado?.updatedAt || null,
    votosValidos: toNumber(json?.votosValidos || json?.resultado?.votosValidos),
    secoesApuradas: toNumber(json?.secoesApuradas || json?.resultado?.secoesApuradas),
    secoesTotais: toNumber(json?.secoesTotais || json?.resultado?.secoesTotais),
    candidatos,
    progressPercent: toNumber(json?.percentualApurado || json?.resultado?.percentualApurado),
    consolidationWarning: 'Feed independente baseado no TSE.'
  });
}

export async function fetchEleicoesFeed(scope, fetchImpl = fetch) {
  const endpoints = [];
  if (scope.uf === 'zz') endpoints.push(`${BASE}/uf/zz.json`);
  endpoints.push(`${BASE}/agora.json`);

  for (const url of endpoints) {
    try {
      const { data } = await fetchWithPolicy({
        key: `eleicoes-feed:${url}`,
        url,
        cacheTtlMs: 15000,
        timeoutMs: 5000,
        fetchImpl
      });
      const normalized = parseEleicoesNow(data, url);
      if (scope.kind === 'exterior-pais' || scope.kind === 'exterior-cidade') {
        const locations = Array.isArray(data?.locais) ? data.locais : [];
        const selected = locations.find((x) => String(x.id) === String(scope.city));
        if (!selected) {
          return buildUnavailable('eleicoes-feed', url, 'Identificador de país/cidade não encontrado no feed.');
        }
        normalized.location = {
          id: String(selected.id),
          nome: selected.nome,
          tipo: selected.tipo || (scope.kind === 'exterior-pais' ? 'country' : 'city')
        };
      }
      return normalized;
    } catch (error) {
      if (url === endpoints[endpoints.length - 1]) {
        return buildUnavailable('eleicoes-feed', url, `Feed independente indisponível: ${error.message}`);
      }
    }
  }

  return buildUnavailable('eleicoes-feed', endpoints[0], 'Feed independente indisponível.');
}

export async function fetchEleicoesHistory(fetchImpl = fetch) {
  const url = `${BASE}/historico.json`;
  try {
    const { data } = await fetchWithPolicy({
      key: 'eleicoes-feed:historico',
      url,
      cacheTtlMs: 30000,
      timeoutMs: 5000,
      fetchImpl
    });
    if (!Array.isArray(data)) throw new Error('Histórico inválido.');
    return data;
  } catch {
    return [];
  }
}

export function extractFeedLocations(json) {
  if (!Array.isArray(json?.locais)) return [];
  return json.locais.map((item) => ({
    id: String(item.id),
    nome: item.nome,
    tipo: item.tipo || 'unknown'
  }));
}
