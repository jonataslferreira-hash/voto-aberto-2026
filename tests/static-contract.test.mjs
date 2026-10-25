import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appPath = path.resolve(__dirname, "../public/app.js");
const htmlPath = path.resolve(__dirname, "../public/index.html");

test("frontend exige VITE_API_BASE_URL e evita fallback fictício", async () => {
  const source = await readFile(appPath, "utf8");
  assert.match(source, /VITE_API_BASE_URL/);
  assert.match(source, /publishedJSON/);
  assert.match(source, /data\/results\.json/);
});

test("layout inclui painéis obrigatórios e não depende de CDN", async () => {
  const html = await readFile(htmlPath, "utf8");
  assert.match(html, /data-main-scope="brasil"/);
  assert.match(html, /data-main-scope="estados"/);
  assert.match(html, /data-main-scope="exterior"/);
  assert.match(html, /id="cardMapa"/);
  assert.match(html, /id="cardExterior"/);
  assert.match(html, /id="cardHistorico"/);
  assert.doesNotMatch(html, /cdn\.jsdelivr\.net/);
});
