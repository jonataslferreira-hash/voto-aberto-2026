import { comparison, count } from "./dashboard-data.js";
import { electionFor, tseUrl } from "./elections.js";
export function eventContext(result, pair) {
  return [
    result.year,
    result.turn,
    result.scope,
    result.provider,
    result.sourceKind,
    result.sourceUrl,
    ...pair,
  ].join("|");
}
export function confirmedWinner(result) {
  const outcome = result?.officialOutcome;
  if (
    result?.provider !== "tse" ||
    result?.sourceKind !== "official-tse" ||
    result?.scope !== "brasil" ||
    Number(result?.year) !== 2026 ||
    ![1, 2].includes(Number(result?.turn)) ||
    !outcome ||
    outcome.decision !== "Eleito" ||
    outcome.scope !== "brasil"
  )
    return null;
  let source;
  try {
    source = new URL(outcome.sourceUrl);
  } catch (error) {
    return null;
  }
  if (
    source.protocol !== "https:" ||
    source.hostname !== "resultados.tse.jus.br" ||
    source.href !== result.sourceUrl ||
    source.href !== tseUrl(electionFor(result.year, result.turn), "br") ||
    String(outcome.electionId) !== electionFor(result.year, result.turn).id
  )
    return null;
  const list = result.candidatos || [],
    winner = list.find((c) => String(c.numero) === String(outcome.numero));
  if (
    !winner?.eleito ||
    !/^eleit[oa]$/i.test(winner.situacao || "") ||
    count(winner.votos) === null ||
    winner.votos <= 0 ||
    list.filter((c) => c.eleito).length !== 1
  )
    return null;
  if (
    list.some(
      (c) =>
        count(c.votos) === null || (c.votos >= winner.votos && c !== winner),
    )
  )
    return null;
  return winner;
}
export function createEventTracker() {
  const baselines = new Map(),
    celebrated = new Set();
  return {
    reset() {
      baselines.clear();
    },
    observe(result, pair = ["22", "13"]) {
      if (
        Number(result?.year) !== 2026 ||
        !result?.live ||
        result.publishedAt ||
        result.sourceKind === "unavailable"
      )
        return null;
      const at = Date.parse(result.updatedAt);
      if (!Number.isFinite(at)) return null;
      try {
        const url = new URL(result.sourceUrl);
        if (
          !["https:", "http:"].includes(url.protocol) ||
          url.username ||
          url.password
        )
          return null;
      } catch (error) {
        return null;
      }
      const key = eventContext(result, pair),
        previous = baselines.get(key);
      const c = comparison({ ...result, comparisonNumbers: pair });
      const leader =
        c.diff > 0 ? (c.leader === "blue" ? c.flavio : c.lula) : null;
      const winner = confirmedWinner(result);
      if (previous && at < previous.at) return null;
      // Missing votes/percentages cannot erase a known baseline or manufacture a flip.
      if (!leader && !winner) return null;
      const fingerprint = JSON.stringify([
        result.updatedAt,
        result.candidatos,
        outcomeKey(winner),
      ]);
      if (previous?.fingerprint === fingerprint) return null;
      baselines.set(key, {
        at,
        leader: leader?.number || previous?.leader || null,
        winner: outcomeKey(winner),
        fingerprint,
      });
      if (!previous) return null;
      const winKey = [
        result.year,
        result.turn,
        result.scope,
        outcomeKey(winner),
      ].join("|");
      if (winner && !previous.winner && !celebrated.has(winKey)) {
        celebrated.add(winKey);
        return {
          kind: "victory",
          year: Number(result.year),
          number: String(winner.numero),
          name: winner.candidato,
          color:
            String(winner.numero) === String(pair[0])
              ? "blue"
              : String(winner.numero) === String(pair[1])
                ? "red"
                : "neutral",
          source: result.sourceUrl,
          scope: result.scope,
          at: result.updatedAt,
          votes: winner.votos,
        };
      }
      if (
        !winner &&
        leader &&
        previous.leader &&
        leader.number !== previous.leader &&
        at > previous.at
      ) {
        return {
          kind: "lead",
          year: Number(result.year),
          number: leader.number,
          name: leader.name,
          color: c.leader,
          source: result.sourceUrl,
          scope: result.scope,
          at: result.updatedAt,
          votes: leader.votes,
        };
      }
      return null;
    },
  };
}
function outcomeKey(winner) {
  return winner ? String(winner.numero) : null;
}
export function soundNotes(number, kind = "lead", year = 2026, name = "") {
  const root =
    String(number) === "22"
      ? Number(year) === 2022 || /jair/i.test(name) ? 294 : 392
      : String(number) === "13"
        ? 330
        : 262 + ((Number(number) || 0) % 12) * 16;
  const intervals = String(number) === "13" ? [1, 1.2, 1.5] : [1, 1.25, 1.5];
  return (kind === "victory" || kind === "local-result" ? [...intervals, 2, 1.5, 2] : intervals).map(
    (ratio, index) => ({
      frequency: root * ratio,
      start: index * (kind === "victory" ? 0.18 : 0.13),
      duration: kind === "victory" ? 0.27 : 0.16,
    }),
  );
}
