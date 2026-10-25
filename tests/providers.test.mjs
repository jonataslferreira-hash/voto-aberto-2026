import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseTseJson } from "../src/providers/tse.mjs";
import { parseEleicoesNow } from "../src/providers/eleicoesFeed.mjs";
import { parsePlacarJson } from "../src/providers/placarDoVoto.mjs";
import { getNormalizedResult } from "../src/providers/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function fixture(name) {
  const raw = await readFile(
    path.resolve(__dirname, `fixtures/${name}.json`),
    "utf8",
  );
  return JSON.parse(raw);
}

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

test("parse dos 3 formatos normaliza candidatos e status", async () => {
  const [tse, feed, placar] = await Promise.all([
    fixture("tse"),
    fixture("feed"),
    fixture("placar"),
  ]);

  const t = parseTseJson(tse, "tse");
  const f = parseEleicoesNow(feed, "feed");
  const p = parsePlacarJson(placar, "placar");

  assert.equal(t.provider, "tse");
  assert.equal(f.provider, "eleicoes-feed");
  assert.equal(p.provider, "placar-do-voto");
  assert.equal(t.status, "partial");
  assert.equal(f.status, "partial");
  assert.equal(p.status, "partial");
});

test("fallback usa feed quando TSE indisponível", async () => {
  const feed = await fixture("feed");
  let calls = 0;

  const fetchMock = async (url) => {
    calls += 1;
    if (String(url).includes("resultados.tse"))
      return jsonResponse({ error: "x" }, 503, { "retry-after": "0" });
    return jsonResponse(feed, 200);
  };

  const result = await getNormalizedResult({
    scopeRaw: "exterior-geral",
    provider: "auto",
    fetchImpl: fetchMock,
  });
  assert.equal(result.provider, "eleicoes-feed");
  assert.equal(result.sourceKind, "independent-tse-derived");
  assert.ok(calls >= 2);
});

test("429 respeita retry e depois retorna sucesso", async () => {
  const feed = await fixture("feed");
  let first = true;

  const fetchMock = async () => {
    if (first) {
      first = false;
      return jsonResponse({ message: "rate limit" }, 429, {
        "retry-after": "0",
      });
    }
    return jsonResponse(feed, 200, { etag: "abc" });
  };

  const result = await getNormalizedResult({
    scopeRaw: "exterior-geral",
    provider: "eleicoes-feed",
    fetchImpl: fetchMock,
  });
  assert.equal(result.provider, "eleicoes-feed");
  assert.equal(result.candidatos.length, 2);
});

test("seleção país/cidade inválida não inventa dados", async () => {
  const feed = await fixture("feed");
  const fetchMock = async () => jsonResponse(feed, 200);

  const result = await getNormalizedResult({
    scopeRaw: "exterior-pais:nao-existe",
    provider: "eleicoes-feed",
    fetchImpl: fetchMock,
  });
  assert.equal(result.sourceKind, "unavailable");
  assert.equal(result.candidatos.length, 0);
});

test("não ocorre dupla contagem em payload agregado", async () => {
  const feed = await fixture("feed");
  const fetchMock = async () => jsonResponse(feed, 200);

  const result = await getNormalizedResult({
    scopeRaw: "exterior-geral",
    provider: "eleicoes-feed",
    fetchImpl: fetchMock,
  });
  const total = result.candidatos.reduce((sum, c) => sum + c.votos, 0);
  assert.equal(total, feed.votosValidos);
});

test("TSE não usa total ZZ como resultado de país", async () => {
  const tse = await fixture("tse");
  let calls = 0;
  const result = await getNormalizedResult({
    scopeRaw: "exterior-pais:au",
    provider: "tse",
    fetchImpl: async () => {
      calls++;
      return jsonResponse(tse);
    },
  });
  assert.equal(result.sourceKind, "unavailable");
  assert.equal(calls, 0);
});
test("feed nacional não colore estado sem contrato estadual", async () => {
  let calls = 0;
  const result = await getNormalizedResult({
    scopeRaw: "estado:sp",
    provider: "eleicoes-feed",
    fetchImpl: async () => {
      calls++;
      return jsonResponse(await fixture("feed"));
    },
  });
  assert.equal(result.sourceKind, "unavailable");
  assert.equal(calls, 1);
});
test("país existente sem seus próprios totais não herda total exterior", async () => {
  const feed = await fixture("feed");
  const result = await getNormalizedResult({
    scopeRaw: "exterior-pais:au",
    provider: "eleicoes-feed",
    fetchImpl: async () => jsonResponse(feed),
  });
  assert.equal(result.sourceKind, "unavailable");
  assert.deepEqual(result.candidatos, []);
});
test("país usa somente candidatos e metadados do local", async () => {
  const feed = await fixture("feed");
  feed.locais[0] = {
    ...feed.locais[0],
    candidatos: [
      { nome: "Flávio Bolsonaro", votos: 20, percentual: 40 },
      { nome: "Lula", votos: 30, percentual: 60 },
    ],
    votosValidos: 50,
  };
  const result = await getNormalizedResult({
    scopeRaw: "exterior-pais:au",
    provider: "eleicoes-feed",
    fetchImpl: async () => jsonResponse(feed),
  });
  assert.equal(result.candidatos[0].votos, 20);
  assert.equal(result.votosValidos, 50);
  assert.equal(result.updatedAt, null);
});
test("fallback preserva o diagnóstico de cada fonte que falhou", async () => {
  const result = await getNormalizedResult({
    scopeRaw: "brasil",
    provider: "auto",
    fetchImpl: async () => jsonResponse({}, 404),
  });
  assert.equal(result.diagnostics.length, 3);
  assert.match(result.consolidationWarning, /HTTP 404/);
  assert.equal(result.scope, "brasil");
});

test("schema TSE observado ao vivo preserva abrangência, zeros oficiais e horário de Brasília", async () => {
  const raw = await fixture("tse-current");
  const result = parseTseJson(raw, "tse");
  assert.equal(result.candidatos.length, 2);
  assert.equal(result.secoesTotais, Number(raw.s.ts));
  assert.equal(result.secoesApuradas, Number(raw.s.st));
  assert.equal(result.candidatos[0].votos, 0);
  assert.equal(result.candidatos[0].percentual, null);
  assert.match(result.updatedAt, /-03:00$/);
  assert.equal(result.status, "not-started");
});
test("feed compacto atual seleciona UF real em vez do total nacional", async () => {
  const raw = await fixture("feed-current");
  const result = await getNormalizedResult({
    scopeRaw: "estado:sp",
    provider: "eleicoes-feed",
    fetchImpl: async () => jsonResponse(raw),
  });
  assert.equal(result.secoesTotais, raw.presidente.uf.SP.secoes);
  assert.notEqual(result.secoesTotais, raw.presidente.br.secoes);
  assert.equal(result.sourceKind, "independent-tse-derived");
  assert.equal(result.candidatos[0].percentual, null);
});
test("schema atual do Placar preserva aviso de conferência pendente", async () => {
  const raw = await fixture("placar-current");
  const result = parsePlacarJson(raw, "placar");
  assert.equal(result.secoesTotais, raw.result.sections);
  assert.equal(result.candidatos.length, 2);
  assert.equal(result.consolidationWarning, raw.freshness.warning);
  assert.equal(result.candidatos[0].percentual, null);
});
test("histórico nacional nunca é reutilizado para uma UF", async () => {
  const { getHistoryResponse } = await import("../src/providers/index.mjs");
  let calls = 0;
  const result = await getHistoryResponse({
    scopeRaw: "estado:sp",
    provider: "eleicoes-feed",
    fetchImpl: async () => {
      calls++;
      return jsonResponse([]);
    },
  });
  assert.equal(calls, 0);
  assert.deepEqual(result.points, []);
  assert.match(result.diagnostics[0].message, /nacional/);
});

test("exterior automático pode mostrar parcial independente quando TSE ainda não começou", async () => {
  const tse = await fixture("tse-current");
  tse.cdabr = "zz";
  const feed = await fixture("feed-current");
  feed.presidente.uf.ZZ = {
    ...feed.presidente.uf.ZZ,
    totalizadas: 1,
    votos: { 13: 10, 22: 20 },
  };
  const result = await getNormalizedResult({
    scopeRaw: "exterior-geral",
    fetchImpl: async (url) =>
      jsonResponse(String(url).includes("resultados.tse") ? tse : feed),
  });
  assert.equal(result.provider, "eleicoes-feed");
  assert.equal(result.sourceKind, "independent-tse-derived");
  assert.match(result.consolidationWarning, /Total oficial ainda sem apuração/);
  assert.equal(result.candidatos[0].votos, 20);
});
test("exterior compacto usa somente cidades publicadas do país e mantém metadados ausentes", async () => {
  const { parsePackedExterior } =
    await import("../src/providers/exterior-feed.mjs");
  const raw = {
    uf: "ZZ",
    tse: [30562, 29491, 99999],
    secoes: [2, 1, 100],
    totalizadas: [1, 1, 100],
    votos: { 13: [10, 20, 900], 22: [30, 40, 100] },
  };
  const markdown =
    "- [Sydney](https://eleicoes2026brasil.com/presidente/exterior/au/30562)\n- [Camberra](https://eleicoes2026brasil.com/presidente/exterior/au/29491)\n";
  const result = await parsePackedExterior(
    raw,
    { kind: "exterior-pais", city: "au" },
    "https://eleicoes2026brasil.com/feed/uf/zz.json",
    async () => new Response(markdown),
  );
  assert.equal(result.candidatos[0].votos, 70);
  assert.equal(result.candidatos[1].votos, 30);
  assert.equal(result.secoesTotais, 3);
  assert.equal(result.updatedAt, null);
  assert.equal(result.sourceKind, "independent-tse-derived");
  const incomplete = { ...raw, tse: [30562] };
  await assert.rejects(
    parsePackedExterior(
      incomplete,
      { kind: "exterior-pais", city: "au" },
      "source",
      async () => new Response(markdown),
    ),
    /Cobertura incompleta/,
  );
});
test("comparação retorna três fontes separadas, sem criar quarta totalização", async () => {
  const { getSourceResults } = await import("../src/providers/index.mjs");
  const result = await getSourceResults({
    scopeRaw: "exterior-geral",
    fetchImpl: async () => jsonResponse({}, 404),
  });
  assert.equal(result.sources.length, 3);
  assert.equal(result.aggregation, "none");
  assert.equal(result.candidatos, undefined);
});
