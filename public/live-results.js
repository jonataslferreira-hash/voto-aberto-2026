import { electionFor, tseUrl } from "./elections.js";
import { parseTseJson } from "./tse-format.js";
const cache = new Map(),
  pending = new Map(),
  failures = new Map();
export const LIVE_INTERVAL_MS = 60000;
export async function getOfficialLive({ year, turn, scope }, signal) {
  if (Number(year) !== 2026)
    throw new Error("O histórico não é uma apuração ao vivo.");
  const uf =
    scope === "brasil"
      ? "br"
      : scope === "exterior-geral"
        ? "zz"
        : /^estado:[a-z]{2}$/.test(scope)
          ? scope.slice(7)
          : null;
  if (!uf)
    throw new Error(
      "Atualização direta do TSE disponível para Brasil, UF e exterior geral.",
    );
  const election = electionFor(year, turn),
    url = tseUrl(election, uf),
    now = Date.now();
  const cached = cache.get(url);
  if (cached && now < cached.expiresAt) return cached.result;
  const failed = failures.get(url);
  if (failed && now < failed.retryAt) throw new Error(failed.message);
  if (pending.has(url)) return pending.get(url);
  const request = (async () => {
    try {
      const timeout = AbortSignal.timeout(12000);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      // Conditional/cache revalidation is delegated to the browser's HTTP cache;
      // no custom headers that would trigger a CORS preflight.
      const response = await fetch(url, {
        signal: combined,
        cache: "no-cache",
        credentials: "omit",
      });
      if (!response.ok)
        throw new Error(`TSE respondeu HTTP ${response.status}`);
      const raw = await response.json();
      if (
        String(raw.ele) !== election.id ||
        String(raw.t) !== String(turn) ||
        String(raw.cdabr).toLowerCase() !== uf
      )
        throw new Error("TSE retornou eleição/localidade diferente.");
      const result = {
        ...parseTseJson(raw, url),
        year: Number(year),
        turn: Number(turn),
        scope,
        retrievedAt: new Date().toISOString(),
        live: true,
        transport: "tse-direct",
      };
      const maxAge = Number(
        response.headers.get("cache-control")?.match(/max-age=(\d+)/)?.[1],
      );
      cache.set(url, {
        result,
        expiresAt:
          Date.now() +
          Math.max(
            LIVE_INTERVAL_MS,
            Number.isFinite(maxAge) ? maxAge * 1000 : 0,
          ),
      });
      failures.delete(url);
      return result;
    } catch (error) {
      if (error.name === "AbortError") throw error;
      const message = `Consulta direta ao TSE indisponível: ${error.message}`;
      failures.set(url, { message, retryAt: Date.now() + LIVE_INTERVAL_MS });
      throw new Error(message);
    }
  })();
  pending.set(url, request);
  try {
    return await request;
  } finally {
    pending.delete(url);
  }
}
