import { electionFor, tseUrl } from "../../public/elections.js";
import {
  buildNormalized,
  buildUnavailable,
  candidate,
  toNumber,
} from "../lib/model.mjs";
import { fetchWithPolicy } from "../lib/http-cache.mjs";
const BASE = "https://resultados.tse.jus.br/oficial/ele2026/6258/dados";
function sourceDate(json) {
  const date = json.dg || json.dt;
  const time = json.hg || json.ht;
  if (!date) return null;
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(date)) return date;
  const [day, month, year] = date.split("/");
  return time ? `${year}-${month}-${day}T${time}-03:00` : null;
}
export function parseTseJson(json, sourceUrl) {
  const office = json?.carg?.find((c) => String(c.cd) === "1");
  const entries = Array.isArray(json?.cand)
    ? json.cand
    : office?.agr?.flatMap((a) =>
        (a.par || []).flatMap((p) =>
          (p.cand || []).map((c) => ({ ...c, party: p.sg })),
        ),
      );
  if (!Array.isArray(entries))
    throw new Error(
      "Formato TSE inválido: campo cand ausente ou sem candidatos esperados.",
    );
  const denominator = toNumber(
    json?.v?.vvc ?? json?.v?.vv ?? json?.vvc ?? json?.vv,
  );
  const candidatos = entries.map((c) => ({
    ...candidate(
      c.nmu || c.nm || c.name,
      toNumber(c.vap ?? c.v ?? c.votos),
      denominator === 0 ? null : toNumber(c.pvap ?? c.p ?? c.percentual),
    ),
    numero: String(c.n ?? c.nr ?? ""),
    partido: c.party || c.cc || c.sgp || null,
  }));
  if (!candidatos.length)
    throw new Error("Formato TSE inválido: candidatos esperados ausentes.");
  return buildNormalized({
    provider: "tse",
    sourceUrl,
    sourceKind: "official-tse",
    updatedAt: sourceDate(json),
    votosValidos: denominator,
    secoesApuradas: toNumber(
      json?.s?.st ??
        json?.a?.a ??
        (typeof json?.s === "object" ? null : json?.s) ??
        json?.sapur,
    ),
    secoesTotais: toNumber(json?.s?.ts ?? json?.a?.t ?? json?.st ?? json?.stot),
    candidatos,
    progressPercent: toNumber(json?.s?.pst ?? json?.pst ?? json?.pvap),
    consolidationWarning: null,
  });
}
export async function fetchTse(
  scope,
  fetchImpl = fetch,
  election = electionFor(),
) {
  if (scope.city)
    return buildUnavailable(
      "tse",
      BASE,
      "Fonte TSE configurada fornece totais por UF; país/cidade não suportado neste contrato.",
    );
  const url = tseUrl(election, scope.uf);
  try {
    const { data, fetchedAt } = await fetchWithPolicy({
      key: `tse:${election.year}:${election.turn}:${scope.uf}`,
      url,
      cacheTtlMs: 30000,
      timeoutMs: 5000,
      fetchImpl,
    });
    if (data?.cdabr && String(data.cdabr).toLowerCase() !== scope.uf)
      throw new Error("Abrangência TSE não corresponde à UF solicitada.");
    if (data.ele && String(data.ele) !== election.id)
      throw new Error("Resposta pertence a outra eleição.");
    return {
      ...parseTseJson(data, url),
      retrievedAt: fetchedAt,
      year: election.year,
      turn: election.turn,
    };
  } catch (error) {
    return buildUnavailable(
      "tse",
      url,
      `TSE oficial indisponível: ${error.message}`,
    );
  }
}
