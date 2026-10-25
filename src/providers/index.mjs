import { buildUnavailable } from '../lib/model.mjs';
import { parseScope } from './scope.mjs';
import { fetchTse } from './tse.mjs';
import { fetchEleicoesFeed, fetchEleicoesHistory } from './eleicoesFeed.mjs';
import { fetchPlacar, fetchPlacarHistory } from './placarDoVoto.mjs';
import { fetchWithPolicy } from '../lib/http-cache.mjs';

export const PROVIDER_LABELS = {
  tse: 'TSE oficial',
  'eleicoes-feed': 'Feed independente baseado no TSE',
  'placar-do-voto': 'Placar do Voto (independente)',
  unavailable: 'Dados indisponíveis'
};

async function byName(provider, scope, fetchImpl) {
  if (provider === 'tse') return fetchTse(scope, fetchImpl);
  if (provider === 'eleicoes-feed') return fetchEleicoesFeed(scope, fetchImpl);
  if (provider === 'placar-do-voto') return fetchPlacar(scope, fetchImpl);
  return buildUnavailable('unavailable', '', `Provedor desconhecido: ${provider}`);
}

export async function getNormalizedResult({ scopeRaw, provider = 'auto', fetchImpl = fetch }) {
  const scope = parseScope(scopeRaw);

  if (provider !== 'auto') {
    const fixed = await byName(provider, scope, fetchImpl);
    return withLabel(fixed);
  }

  const chain = ['tse', 'eleicoes-feed', 'placar-do-voto'];
  for (const name of chain) {
    const result = await byName(name, scope, fetchImpl);
    if (result.sourceKind !== 'unavailable') return withLabel(result);
  }

  return withLabel(buildUnavailable('unavailable', '', 'Nenhum provedor retornou dados válidos.'));
}

function withLabel(payload) {
  return {
    ...payload,
    providerLabel: PROVIDER_LABELS[payload.provider] || payload.provider,
    displaySource: payload.sourceKind === 'official-tse'
      ? 'TSE oficial'
      : payload.sourceKind === 'independent-tse-derived'
        ? 'Feed independente baseado no TSE'
        : payload.sourceKind === 'bu-partial'
          ? 'Boletins de urna parciais'
          : 'Dados indisponíveis'
  };
}

function normalizePoint(point) {
  const at = point?.updatedAt || point?.updated_at || point?.timestamp || null;
  const lula = point?.lula ?? point?.candidato13 ?? point?.pctLula ?? null;
  const flavio = point?.flavio ?? point?.candidato22 ?? point?.pctFlavio ?? null;
  if (!at) return null;
  return {
    at,
    lulaPercent: lula === null ? null : Number(lula),
    flavioPercent: flavio === null ? null : Number(flavio)
  };
}

function applyWindow(points, windowKey) {
  if (windowKey === 'all') return points;
  const now = Date.now();
  const horizonMs = windowKey === '1h' ? 3600000 : 10800000;
  return points.filter((p) => Date.parse(p.at) >= now - horizonMs);
}

export async function getHistory({ scopeRaw, provider = 'auto', window = '1h', fetchImpl = fetch }) {
  const scope = parseScope(scopeRaw);
  let points = [];

  const providers = provider === 'auto'
    ? ['eleicoes-feed', 'placar-do-voto']
    : [provider];

  for (const name of providers) {
    if (name === 'eleicoes-feed') {
      const list = await fetchEleicoesHistory(fetchImpl);
      if (list.length) {
        points = list.map(normalizePoint).filter(Boolean);
        break;
      }
    }
    if (name === 'placar-do-voto') {
      const list = await fetchPlacarHistory(scope, fetchImpl);
      if (list.length) {
        points = list.map(normalizePoint).filter(Boolean);
        break;
      }
    }
  }

  return applyWindow(points, window);
}

export async function getLocations(fetchImpl = fetch) {
  const url = 'https://eleicoes2026brasil.com/feed/uf/zz.json';
  try {
    const { data } = await fetchWithPolicy({
      key: 'eleicoes-feed:zz-locations',
      url,
      timeoutMs: 5000,
      cacheTtlMs: 30000,
      fetchImpl
    });
    const raw = Array.isArray(data?.locais) ? data.locais : [];
    const list = raw.map((x) => ({
      id: String(x.id),
      nome: x.nome,
      tipo: x.tipo || 'unknown',
      countryCode: x.countryCode || null
    }));
    return {
      highlights: ['Austrália', 'Nova Zelândia', 'Japão'].filter((name) => list.some((x) => x.nome === name)),
      locations: list
    };
  } catch {
    return { highlights: [], locations: [] };
  }
}
