// Imports factual vote counts, not application code or test fixtures.
import { readFile, writeFile } from "node:fs/promises";
import { parseTseJson } from "../src/providers/tse.mjs";
import { STATES } from "../public/dashboard-data.js";
const COMMIT = "e80326fa1ee8b4ebbeb8a31a215e898807798e79";
const ROOT = `https://raw.githubusercontent.com/kalebefukuda/brazil-election-results-2026/${COMMIT}/public/historico/2022`;
const path = new URL("../static/data/results.json", import.meta.url);
const published = JSON.parse(await readFile(path, "utf8"));
for (const [turn, id] of [
  [1, "544"],
  [2, "545"],
]) {
  const results = {};
  const ufs = ["br", ...STATES.map((s) => s.uf), "zz"];
  let next = 0;
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (next < ufs.length) {
        const uf = ufs[next++];
        const url = `${ROOT}/${id}/${uf}-c0001.json`;
        const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
        if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
        const raw = await r.json();
        if (raw.ele !== id || String(raw.cdabr).toLowerCase() !== uf)
          throw new Error("Arquivo histórico de outra eleição/localidade.");
        const parsed = parseTseJson(raw, url);
        if (
          !parsed.candidatos.length ||
          !parsed.candidatos.every(
            (c) => Number.isInteger(c.votos) && c.votos >= 0,
          )
        )
          throw new Error("Votos inválidos no arquivo histórico.");
        const sum = parsed.candidatos.reduce((n, c) => n + c.votos, 0);
        if (sum !== parsed.votosValidos)
          throw new Error(`Denominador inconsistente em ${uf}, turno ${turn}`);
        results[uf] = {
          ...parsed,
          provider: "historical-archive",
          sourceKind: "independent-tse-derived",
          year: 2022,
          turn,
          scope:
            uf === "br"
              ? "brasil"
              : uf === "zz"
                ? "exterior-geral"
                : `estado:${uf}`,
          retrievedAt: new Date().toISOString(),
          status: "totalized",
          secoesApuradas: null,
          secoesTotais: null,
          progressPercent: null,
          candidatos: parsed.candidatos.map((c) => ({
            ...c,
            percentual: sum > 0 ? (c.votos / sum) * 100 : null,
          })),
          consolidationWarning:
            "Arquivo histórico independente derivado dos CSVs do TSE; cópia fixada por commit. Percentuais calculados sobre os votos válidos. Quantidade de seções não revalidada e omitida.",
          originalSourceUrl:
            "https://dadosabertos.tse.jus.br/dataset/resultados-2022",
        };
      }
    }),
  );
  for (const candidate of results.br.candidatos) {
    const total = ufs
      .filter((uf) => uf !== "br")
      .reduce((sum, uf) => {
        const c = results[uf].candidatos.find(
          (c) => c.numero === candidate.numero,
        );
        if (!c)
          throw new Error(`Candidato ${candidate.numero} ausente em ${uf}`);
        return sum + c.votos;
      }, 0);
    if (total !== candidate.votos)
      throw new Error(
        `Soma das UFs e exterior difere do Brasil, candidato ${candidate.numero}`,
      );
  }
  published.elections[`2022-${turn}`] = {
    year: 2022,
    turn,
    results,
    archiveCommit: COMMIT,
    validation:
      "Candidate sums across 27 UFs + exterior equal national totals.",
  };
  console.log(
    `2022-${turn}: ${results.br.candidatos.length} candidatos, 29 localidades; soma nacional conferida.`,
  );
}
published.generatedAt = new Date().toISOString();
await writeFile(path, JSON.stringify(published) + "\n");
