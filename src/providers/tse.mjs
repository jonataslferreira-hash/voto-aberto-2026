import {
  buildNormalized,
  buildUnavailable,
  candidate,
  toNumber,
} from "../lib/model.mjs";
import { fetchWithPolicy } from "../lib/http-cache.mjs";
const BASE = "https://resultados.tse.jus.br/oficial/ele2026/6258/dados";
function sourceDate(json) {
  if (!json.dg) return json.dt || null;
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(json.dg)) return json.dg;
  const [day, month, year] = json.dg.split("/");
  return json.hg ? `${year}-${month}-${day}T${json.hg}-03:00` : null;
}
export function parseTseJson(json, sourceUrl) {
  const office = json?.carg?.find((c) => String(c.cd) === "1");
  const entries = Array.isArray(json?.cand)
    ? json.cand
    : office?.agr?.flatMap((a) => (a.par || []).flatMap((p) => p.cand || []));
  if (!Array.isArray(entries))
    throw new Error(
      "Formato TSE inválido: campo cand ausente ou sem candidatos esperados.",
    );
  const denominator = toNumber(
    json?.v?.vvc ?? json?.v?.vv ?? json?.vvc ?? json?.vv,
  );
  const candidatos = entries
    .filter(
      (c) =>
        ["13", "22"].includes(String(c.n ?? c.nr)) ||
        /lula|fl[aá]vio/i.test(c.nm || c.name || ""),
    )
    .map((c) =>
      candidate(
        c.nmu || c.nm || c.name,
        toNumber(c.vap ?? c.v ?? c.votos),
        denominator === 0 ? null : toNumber(c.pvap ?? c.p ?? c.percentual),
      ),
    );
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
export async function fetchTse(scope, fetchImpl = fetch) {
  if (scope.city)
    return buildUnavailable(
      "tse",
      BASE,
      "Fonte TSE configurada fornece totais por UF; país/cidade não suportado neste contrato.",
    );
  const url = `${BASE}/${scope.uf}/${scope.uf}-c0001-e006258-u.json`;
  try {
    const { data, fetchedAt } = await fetchWithPolicy({
      key: `tse:${scope.uf}`,
      url,
      cacheTtlMs: 30000,
      timeoutMs: 5000,
      fetchImpl,
    });
    if (data?.cdabr && String(data.cdabr).toLowerCase() !== scope.uf)
      throw new Error("Abrangência TSE não corresponde à UF solicitada.");
    return { ...parseTseJson(data, url), retrievedAt: fetchedAt };
  } catch (error) {
    return buildUnavailable(
      "tse",
      url,
      `TSE oficial indisponível: ${error.message}`,
    );
  }
}
