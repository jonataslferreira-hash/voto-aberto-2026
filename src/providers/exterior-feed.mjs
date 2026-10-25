import { fetchWithPolicy } from "../lib/http-cache.mjs";
import { buildNormalized, toNumber, candidate } from "../lib/model.mjs";
const BASE = "https://eleicoes2026brasil.com";
const PRIORITY = ["au", "nz", "jp", "us", "pt", "gb", "de", "fr"];
async function document(path, fetchImpl) {
  return fetchWithPolicy({
    key: `exterior-metadata:${path}`,
    url: BASE + "/md" + path,
    responseType: "text",
    cacheTtlMs: 21600000,
    fetchImpl,
  });
}
export function parsePublishedPlaces(markdown, country = null) {
  const places = [];
  const seen = new Set();
  const pattern =
    /^- \[([^\]\n]+)\]\(https:\/\/eleicoes2026brasil\.com\/presidente\/exterior\/([a-z]{2})(?:\/(\d{5}))?\)\s*$/gm;
  for (const match of markdown.matchAll(pattern)) {
    const [, name, code, id] = match;
    if (country ? code !== country || !id : Boolean(id)) continue;
    const key = id ? `${code}/${id}` : code;
    if (seen.has(key)) continue;
    seen.add(key);
    places.push({
      id: key,
      nome: name,
      tipo: id ? "city" : "country",
      countryCode: code.toUpperCase(),
    });
  }
  return places;
}
export async function getPublishedLocations(fetchImpl = fetch, country = null) {
  if (country && !/^[a-z]{2}$/.test(country))
    throw new Error("Código de país inválido.");
  const path = "/presidente/exterior" + (country ? "/" + country : "");
  const { data } = await document(path, fetchImpl);
  const locations = parsePublishedPlaces(data, country);
  if (!locations.length)
    throw new Error(
      "Fonte não publicou uma lista de locais no contrato documentado.",
    );
  return { locations, sourceUrl: BASE + path };
}
export async function getFeaturedLocations(fetchImpl = fetch) {
  const root = await getPublishedLocations(fetchImpl);
  const codes = PRIORITY.filter((code) =>
    root.locations.some((l) => l.id === code),
  );
  const cities = await Promise.allSettled(
    codes.map((code) => getPublishedLocations(fetchImpl, code)),
  );
  return {
    ...root,
    locations: [
      ...root.locations,
      ...cities.flatMap((r) =>
        r.status === "fulfilled" ? r.value.locations : [],
      ),
    ],
    diagnostics: cities.flatMap((r, i) =>
      r.status === "rejected"
        ? [
            {
              provider: "eleicoes-feed",
              message: `Locais de ${codes[i]}: ${r.reason.message}`,
            },
          ]
        : [],
    ),
  };
}
export async function parsePackedExterior(
  raw,
  scope,
  sourceUrl,
  fetchImpl = fetch,
) {
  if (raw?.uf !== "ZZ" || !Array.isArray(raw.tse) || !raw.votos)
    throw new Error("Feed compacto do exterior inválido.");
  const [country] = scope.city.split("/");
  if (!/^[a-z]{2}$/.test(country))
    throw new Error("País não identificado no código de localidade.");
  const published = await getPublishedLocations(fetchImpl, country);
  const members =
    scope.kind === "exterior-cidade"
      ? published.locations.filter((l) => l.id === scope.city)
      : published.locations;
  if (!members.length)
    throw new Error("Cidade não publicada para o país selecionado.");
  const indices = members.map((l) =>
    raw.tse.findIndex((id) => String(id) === l.id.split("/")[1]),
  );
  if (indices.some((i) => i < 0))
    throw new Error(
      "Cobertura incompleta do feed para o país/cidade; nenhum total foi estimado.",
    );
  const sum = (field) => {
    const values = indices.map((i) => toNumber(field?.[i]));
    return values.every((v) => v !== null && v >= 0)
      ? values.reduce((a, b) => a + b, 0)
      : null;
  };
  const votes = Object.fromEntries(
    Object.entries(raw.votos).map(([n, values]) => [n, sum(values)]),
  );
  const totals = Object.values(votes);
  const denominator =
    totals.length && totals.every((v) => v !== null)
      ? totals.reduce((a, b) => a + b, 0)
      : null;
  const candidatos = [
    ["22", "Flávio Bolsonaro"],
    ["13", "Lula"],
  ]
    .filter(([n]) => Object.hasOwn(votes, n))
    .map(([n, name]) =>
      candidate(
        name,
        votes[n],
        denominator > 0 && votes[n] !== null
          ? (votes[n] / denominator) * 100
          : null,
      ),
    );
  if (!candidatos.length)
    throw new Error("Candidatos ausentes no feed do exterior.");
  return {
    ...buildNormalized({
      provider: "eleicoes-feed",
      sourceUrl,
      sourceKind: "independent-tse-derived",
      updatedAt: null,
      votosValidos: denominator,
      secoesApuradas: sum(raw.totalizadas),
      secoesTotais: sum(raw.secoes),
      candidatos,
      progressPercent: null,
      consolidationWarning:
        "Feed independente baseado no TSE. Soma apenas das cidades publicadas para este país; horário de geração não informado no arquivo compacto.",
    }),
    metadataSourceUrl: published.sourceUrl,
    location: {
      id: scope.city,
      nome: scope.kind === "exterior-cidade" ? members[0].nome : null,
      tipo: scope.kind === "exterior-cidade" ? "city" : "country",
    },
  };
}
