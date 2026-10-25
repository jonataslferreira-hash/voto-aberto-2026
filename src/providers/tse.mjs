import { buildNormalized, buildUnavailable, candidate, toNumber } from '../lib/model.mjs';
import { fetchWithPolicy } from '../lib/http-cache.mjs';

const BASE = 'https://resultados.tse.jus.br/oficial/ele2026/6258/dados';
const FALLBACK_SCOPE_PATH = {
  br: 'br/br-c0001-e006258-u.json',
  zz: 'zz/zz-c0001-e006258-u.json'
};

function chooseCandidates(entries) {
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((item) => ['13', '22'].includes(String(item.n || item.nr || '')) || /lula|fl[aá]vio/i.test(item.nm || item.name || ''))
    .map((item) => candidate(item.nm || item.name, toNumber(item.vap || item.v || item.votos), toNumber(item.pvap || item.p || item.percentual)));
}

export function parseTseJson(json, sourceUrl) {
  const candidatos = chooseCandidates(json?.cand);
  if (!candidatos.length) throw new Error('Formato TSE inválido: campo cand ausente ou sem candidatos esperados.');

  return buildNormalized({
    provider: 'tse',
    sourceUrl,
    sourceKind: 'official-tse',
    updatedAt: json?.dg || json?.dt || null,
    votosValidos: toNumber(json?.vvc || json?.vv),
    secoesApuradas: toNumber(json?.a?.a || json?.s || json?.sapur),
    secoesTotais: toNumber(json?.a?.t || json?.st || json?.stot),
    candidatos,
    progressPercent: toNumber(json?.pst || json?.pvap),
    consolidationWarning: null
  });
}

export async function fetchTse(scope, fetchImpl = fetch) {
  const scopePath = FALLBACK_SCOPE_PATH[scope.uf] || `${scope.uf}/${scope.uf}-c0001-e006258-u.json`;
  const url = `${BASE}/${scopePath}`;

  try {
    const { data } = await fetchWithPolicy({
      key: `tse:${scope.kind}:${scope.uf}:${scope.city || ''}`,
      url,
      cacheTtlMs: 20000,
      timeoutMs: 5000,
      fetchImpl
    });
    return parseTseJson(data, url);
  } catch (error) {
    return buildUnavailable('tse', url, `TSE oficial indisponível: ${error.message}`);
  }
}
