import { readFile } from "node:fs/promises";
import { electionFor } from "../../public/elections.js";
import {
  getFeaturedLocations,
  getPublishedLocations,
} from "./exterior-feed.mjs";
import { buildUnavailable } from "../lib/model.mjs";
import { parseScope } from "./scope.mjs";
import { fetchTse } from "./tse.mjs";
import { fetchEleicoesFeed, fetchEleicoesHistory } from "./eleicoesFeed.mjs";
import { fetchPlacar, fetchPlacarHistory } from "./placarDoVoto.mjs";
import { fetchWithPolicy } from "../lib/http-cache.mjs";

export const PROVIDER_LABELS = {
  tse: "TSE oficial",
  "eleicoes-feed": "Feed independente baseado no TSE",
  "placar-do-voto": "Placar do Voto (independente)",
  unavailable: "Dados indisponíveis",
  "historical-archive": "Acervo histórico · TSE derivado",
};

async function byName(provider, scope, fetchImpl) {
  if (provider === "tse") return fetchTse(scope, fetchImpl, scope.election);
  if (
    scope.election &&
    (scope.election.year !== 2026 || scope.election.turn !== 2)
  )
    return buildUnavailable(
      provider,
      "",
      "Este provedor não possui contrato validado para o ano/turno selecionado.",
    );
  if (provider === "eleicoes-feed") return fetchEleicoesFeed(scope, fetchImpl);
  if (provider === "placar-do-voto") return fetchPlacar(scope, fetchImpl);
  return buildUnavailable(
    "unavailable",
    "",
    `Provedor desconhecido: ${provider}`,
  );
}

export async function getNormalizedResult({
  scopeRaw,
  provider = "auto",
  fetchImpl = fetch,
  year = 2026,
  turn = 2,
}) {
  const scope = { ...parseScope(scopeRaw), election: electionFor(year, turn) };

  if (Number(year) === 2022 && provider === "auto") {
    try {
      const archive = JSON.parse(
        await readFile(
          new URL("../../static/data/results.json", import.meta.url),
          "utf8",
        ),
      );
      const result = archive.elections[`2022-${turn}`]?.results[scope.uf];
      if (!scope.city && result?.provider === "historical-archive")
        return {
          ...withLabel(result),
          scope: scopeRaw,
          year: Number(year),
          turn: Number(turn),
          diagnostics: [],
        };
    } catch (error) {
      console.warn(
        "Acervo histórico local não disponível:",
        error.code || error.name,
      );
    }
  }
  const diagnostics = [];
  let awaitingOfficial = null;
  const chain =
    provider === "auto"
      ? ["tse", "eleicoes-feed", "placar-do-voto"]
      : [provider];
  for (const name of chain) {
    const result = await byName(name, scope, fetchImpl);
    if (result.sourceKind !== "unavailable") {
      const waiting =
        result.status === "not-started" &&
        !result.candidatos.some(
          (c) => typeof c.votos === "number" && c.votos > 0,
        );
      if (provider === "auto" && scope.uf === "zz" && waiting) {
        awaitingOfficial ??= result;
        continue;
      }
      return {
        ...withLabel(result),
        scope: scopeRaw || "brasil",
        year: Number(year),
        turn: Number(turn),
        diagnostics,
        ...(awaitingOfficial
          ? {
              consolidationWarning:
                `${result.consolidationWarning || ""} Total oficial ainda sem apuração; exibindo esta fonte independente, sem somar ao TSE.`.trim(),
            }
          : {}),
      };
    }
    diagnostics.push({
      provider: name,
      sourceUrl: result.sourceUrl,
      message: result.consolidationWarning,
    });
  }
  if (awaitingOfficial)
    return {
      ...withLabel(awaitingOfficial),
      scope: scopeRaw,
      year: Number(year),
      turn: Number(turn),
      diagnostics,
    };
  return {
    ...withLabel(
      buildUnavailable(
        "unavailable",
        "",
        diagnostics.map((d) => d.message).join(" · "),
      ),
    ),
    scope: scopeRaw || "brasil",
    year: Number(year),
    turn: Number(turn),
    diagnostics,
  };
}

function withLabel(payload) {
  return {
    ...payload,
    providerLabel: PROVIDER_LABELS[payload.provider] || payload.provider,
    displaySource:
      payload.sourceKind === "official-tse"
        ? "TSE oficial"
        : payload.sourceKind === "independent-tse-derived"
          ? "Feed independente baseado no TSE"
          : payload.sourceKind === "bu-partial"
            ? "Boletins de urna parciais"
            : "Dados indisponíveis",
  };
}

function historyPercent(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100
    ? number
    : null;
}

function normalizePoint(point) {
  const at = point?.updatedAt || point?.updated_at || point?.timestamp || null;
  const lula = point?.lula ?? point?.candidato13 ?? point?.pctLula ?? null;
  const flavio =
    point?.flavio ?? point?.candidato22 ?? point?.pctFlavio ?? null;
  if (!at) return null;
  return {
    at,
    lulaPercent: historyPercent(lula),
    flavioPercent: historyPercent(flavio),
  };
}

function applyWindow(points, windowKey) {
  if (windowKey === "all") return points;
  const now = Date.now();
  const horizonMs = windowKey === "1h" ? 3600000 : 10800000;
  return points.filter(
    (p) => Date.parse(p.at) >= now - horizonMs && Date.parse(p.at) <= now,
  );
}

export async function getHistoryResponse({
  scopeRaw,
  provider = "auto",
  window = "1h",
  fetchImpl = fetch,
}) {
  const scope = parseScope(scopeRaw);
  const diagnostics = [];
  const providers =
    provider === "auto" ? ["eleicoes-feed", "placar-do-voto"] : [provider];
  for (const name of providers) {
    try {
      let list;
      if (name === "eleicoes-feed") {
        if (scope.kind !== "brasil")
          throw new Error(
            "Histórico do feed é nacional; não representa esta localidade.",
          );
        list = await fetchEleicoesHistory(fetchImpl);
      } else if (name === "placar-do-voto") {
        if (scope.city)
          throw new Error("Histórico por país/cidade não validado.");
        list = await fetchPlacarHistory(scope, fetchImpl);
      } else throw new Error("Provedor sem endpoint de histórico configurado.");
      const points = applyWindow(
        list.map(normalizePoint).filter(Boolean),
        window,
      );
      if (points.length)
        return {
          points,
          provider: name,
          sourceKind: "independent-tse-derived",
          scope: scopeRaw,
          gapPolicy: "missing-as-null",
          diagnostics,
        };
      diagnostics.push({
        provider: name,
        message: "Fonte não retornou pontos nesta janela.",
      });
    } catch (error) {
      diagnostics.push({ provider: name, message: error.message });
    }
  }
  return {
    points: [],
    scope: scopeRaw,
    gapPolicy: "missing-as-null",
    diagnostics,
  };
}

export async function getHistory(options) {
  return (await getHistoryResponse(options)).points;
}

export async function getLocations(fetchImpl = fetch, country = null) {
  if (country) {
    try {
      return await getPublishedLocations(fetchImpl, country);
    } catch (error) {
      return { locations: [], error: error.message };
    }
  }
  const url = "https://eleicoes2026brasil.com/feed/uf/zz.json";
  try {
    const { data } = await fetchWithPolicy({
      key: "eleicoes-feed:zz-locations",
      url,
      timeoutMs: 5000,
      cacheTtlMs: 30000,
      fetchImpl,
    });
    const raw = Array.isArray(data?.locais)
      ? data.locais.filter(
          (x) =>
            x.id != null &&
            typeof x.nome === "string" &&
            ["country", "city"].includes(x.tipo),
        )
      : [];
    if (!raw.length && Array.isArray(data?.tse)) {
      const published = await getFeaturedLocations(fetchImpl);
      return {
        ...published,
        highlights: published.locations
          .filter((l) =>
            ["AU", "NZ", "JP", "US", "PT", "GB", "DE", "FR"].includes(
              l.countryCode,
            ),
          )
          .map((l) => l.nome),
      };
    }
    const list = raw.map((x) => ({
      id: String(x.id),
      nome: x.nome,
      tipo: x.tipo || "unknown",
      countryCode: x.countryCode || null,
    }));
    return {
      highlights: ["Austrália", "Nova Zelândia", "Japão"].filter((name) =>
        list.some((x) => x.nome === name),
      ),
      locations: list,
    };
  } catch (error) {
    return {
      highlights: [],
      locations: [],
      sourceUrl: url,
      error: `Locais do exterior: ${error.message}`,
    };
  }
}

export async function getSourceResults({ scopeRaw, fetchImpl = fetch }) {
  const scope = parseScope(scopeRaw);
  const sources = await Promise.all(
    ["tse", "eleicoes-feed", "placar-do-voto"].map(async (name) => ({
      ...withLabel(await byName(name, scope, fetchImpl)),
      scope: scopeRaw,
    })),
  );
  return { scope: scopeRaw, sources, aggregation: "none" };
}
