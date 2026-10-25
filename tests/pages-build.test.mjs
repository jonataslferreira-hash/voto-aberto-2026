import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const distDir = path.join(repoRoot, "dist");

test("artifact de produção contém arquivos exigidos do GitHub Pages", async () => {
  await access(path.join(distDir, "index.html"));
  await access(path.join(distDir, "404.html"));
  await access(path.join(distDir, ".nojekyll"));
});

test("build referencia assets com subpath /voto-aberto-2026/", async () => {
  const html = await readFile(path.join(distDir, "index.html"), "utf8");
  assert.match(html, /\/voto-aberto-2026\/assets\//);
});

test("bundle permite dados publicados sem API e inclui arquivo real", async () => {
  const assetsDir = path.join(distDir, "assets");
  const files = await readdir(assetsDir);
  const jsFile = files.find((name) => name.endsWith(".js"));
  assert.ok(jsFile, "Nenhum bundle JavaScript encontrado em dist/assets.");
  const js = await readFile(path.join(assetsDir, jsFile), "utf8");
  assert.match(js, /data\/results\.json/);
  const published = JSON.parse(
    await readFile(path.join(distDir, "data/results.json"), "utf8"),
  );
  assert.equal(published.schemaVersion, 1);
  assert.equal(
    published.elections["2026-1"].results.br.sourceKind,
    "official-tse",
  );
  assert.ok(published.elections["2026-1"].results.br.candidatos.length > 2);
});

test("Pages inclui a série G1 arquivada do 1º turno com origem e pontos completos", async () => {
  const archive = JSON.parse(
    await readFile(path.join(distDir, "data/history-2026-1-br.json"), "utf8"),
  );
  assert.equal(archive.provider, "g1-history");
  assert.match(archive.sourceUrl, /^https:\/\/s\.glbimg\.com\/jo\/el\/2026\/apuracao\/1-turno\//);
  assert.equal(archive.scope, "brasil");
  assert.ok(archive.points.length > 300);
  assert.ok(Object.hasOwn(archive.points.at(-1).candidatePercents, "70"));
});
