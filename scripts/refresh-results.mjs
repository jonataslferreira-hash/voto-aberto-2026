import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fetchTse } from "../src/providers/tse.mjs";
import { ELECTIONS, electionKey } from "../public/elections.js";
import { STATES } from "../public/dashboard-data.js";
const path = new URL("../static/data/results.json", import.meta.url);
let previous = { elections: {} };
try {
  previous = JSON.parse(await readFile(path, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  elections: {},
};
for (const election of ELECTIONS) {
  const key = electionKey(election.year, election.turn);
  const cached = previous.elections?.[key];
  if (cached?.results?.br?.status === "totalized") {
    output.elections[key] = cached;
    continue;
  }
  const national = await fetchTse({ uf: "br" }, fetch, election);
  const entry = {
    year: election.year,
    turn: election.turn,
    results: { br: national },
  };
  output.elections[key] = entry;
  if (national.sourceKind === "unavailable") {
    if (cached?.results?.br?.sourceKind === "official-tse")
      output.elections[key] = {
        ...cached,
        refreshError: national.consolidationWarning,
      };
    console.error(`${key}: ${national.consolidationWarning}`);
    continue;
  }
  const scopes = [...STATES.map((s) => s.uf), "zz"];
  let next = 0;
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (next < scopes.length) {
        const uf = scopes[next++];
        entry.results[uf] = await fetchTse({ uf }, fetch, election);
      }
    }),
  );
  console.log(
    `${key}: ${national.candidatos.length} candidatos; ${Object.keys(entry.results).length} localidades`,
  );
}
if (
  !Object.values(output.elections).some(
    (e) => e.results.br.sourceKind === "official-tse",
  )
)
  throw new Error(
    "Nenhuma resposta oficial válida. Arquivo anterior preservado.",
  );
await mkdir(new URL("../static/data/", import.meta.url), { recursive: true });
await writeFile(path, JSON.stringify(output) + "\n");
