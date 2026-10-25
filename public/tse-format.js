import { buildNormalized, candidate, toNumber } from "../src/lib/model.mjs";
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
    eleito: c.e === "s" && /^eleit[oa]$/i.test(String(c.st || "")),
    situacao: String(c.st || ""),
  }));
  if (!candidatos.length)
    throw new Error("Formato TSE inválido: candidatos esperados ausentes.");
  const normalized = buildNormalized({
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
  const winners = candidatos.filter((c) => c.eleito);
  const confirmation =
    winners.length === 1 &&
    ["1", "2"].includes(String(json.t)) &&
    String(json.cdabr).toLowerCase() === "br"
      ? {
          numero: winners[0].numero,
          candidato: winners[0].candidato,
          decision: "Eleito",
          electionId: String(json.ele),
          scope: "brasil",
          sourceUrl,
        }
      : null;
  return { ...normalized, officialOutcome: confirmation };
}
