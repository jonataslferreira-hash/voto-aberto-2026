import { writeFile } from "node:fs/promises";
import { fetchG1History } from "../src/providers/g1History.mjs";

const { points, sourceUrl } = await fetchG1History(
  { kind: "brasil", uf: "br", city: null },
  1,
);
if (!points.length) throw new Error("O G1 não publicou pontos para o 1º turno nacional.");

const archive = {
  schemaVersion: 1,
  year: 2026,
  turn: 1,
  scope: "brasil",
  provider: "g1-history",
  sourceKind: "independent-tse-derived",
  sourceUrl,
  retrievedAt: new Date().toISOString(),
  points: points.map(({ updatedAt, candidatePercents }) => ({
    at: updatedAt,
    candidatePercents,
  })),
};
await writeFile(
  new URL("../static/data/history-2026-1-br.json", import.meta.url),
  `${JSON.stringify(archive)}\n`,
);
console.log(`Arquivados ${archive.points.length} pontos de ${sourceUrl}`);
