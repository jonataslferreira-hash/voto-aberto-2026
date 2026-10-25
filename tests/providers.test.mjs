import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTseJson } from '../src/providers/tse.mjs';
import { parseEleicoesNow } from '../src/providers/eleicoesFeed.mjs';
import { parsePlacarJson } from '../src/providers/placarDoVoto.mjs';
import { getNormalizedResult } from '../src/providers/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function fixture(name) {
  const raw = await readFile(path.resolve(__dirname, `fixtures/${name}.json`), 'utf8');
  return JSON.parse(raw);
}

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}

test('parse dos 3 formatos normaliza candidatos e status', async () => {
  const [tse, feed, placar] = await Promise.all([fixture('tse'), fixture('feed'), fixture('placar')]);

  const t = parseTseJson(tse, 'tse');
  const f = parseEleicoesNow(feed, 'feed');
  const p = parsePlacarJson(placar, 'placar');

  assert.equal(t.provider, 'tse');
  assert.equal(f.provider, 'eleicoes-feed');
  assert.equal(p.provider, 'placar-do-voto');
  assert.equal(t.status, 'partial');
  assert.equal(f.status, 'partial');
  assert.equal(p.status, 'partial');
});

test('fallback usa feed quando TSE indisponível', async () => {
  const feed = await fixture('feed');
  let calls = 0;

  const fetchMock = async (url) => {
    calls += 1;
    if (String(url).includes('resultados.tse')) return jsonResponse({ error: 'x' }, 503, { 'retry-after': '0' });
    return jsonResponse(feed, 200);
  };

  const result = await getNormalizedResult({ scopeRaw: 'exterior-geral', provider: 'auto', fetchImpl: fetchMock });
  assert.equal(result.provider, 'eleicoes-feed');
  assert.equal(result.sourceKind, 'independent-tse-derived');
  assert.ok(calls >= 2);
});

test('429 respeita retry e depois retorna sucesso', async () => {
  const feed = await fixture('feed');
  let first = true;

  const fetchMock = async () => {
    if (first) {
      first = false;
      return jsonResponse({ message: 'rate limit' }, 429, { 'retry-after': '0' });
    }
    return jsonResponse(feed, 200, { etag: 'abc' });
  };

  const result = await getNormalizedResult({ scopeRaw: 'exterior-geral', provider: 'eleicoes-feed', fetchImpl: fetchMock });
  assert.equal(result.provider, 'eleicoes-feed');
  assert.equal(result.candidatos.length, 2);
});

test('seleção país/cidade inválida não inventa dados', async () => {
  const feed = await fixture('feed');
  const fetchMock = async () => jsonResponse(feed, 200);

  const result = await getNormalizedResult({ scopeRaw: 'exterior-pais:nao-existe', provider: 'eleicoes-feed', fetchImpl: fetchMock });
  assert.equal(result.sourceKind, 'unavailable');
  assert.equal(result.candidatos.length, 0);
});

test('não ocorre dupla contagem em payload agregado', async () => {
  const feed = await fixture('feed');
  const fetchMock = async () => jsonResponse(feed, 200);

  const result = await getNormalizedResult({ scopeRaw: 'exterior-geral', provider: 'eleicoes-feed', fetchImpl: fetchMock });
  const total = result.candidatos.reduce((sum, c) => sum + c.votos, 0);
  assert.equal(total, feed.votosValidos);
});
