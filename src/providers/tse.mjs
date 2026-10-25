import { electionFor, tseUrl } from "../../public/elections.js";
import { buildUnavailable } from "../lib/model.mjs";
import { parseTseJson } from "../../public/tse-format.js";
export { parseTseJson } from "../../public/tse-format.js";
import { fetchWithPolicy } from "../lib/http-cache.mjs";
const BASE = "https://resultados.tse.jus.br/oficial/ele2026/6258/dados";
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
