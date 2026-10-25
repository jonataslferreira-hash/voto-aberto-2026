import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getOfficialLive } from "../public/live-results.js";
const raw = JSON.parse(
  await readFile(
    new URL("./fixtures/tse-current.json", import.meta.url),
    "utf8",
  ),
);
test("consulta direta coalesce e respeita intervalo/cache; não consulta história como se fosse ao vivo", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return new Response(JSON.stringify(raw), {
      headers: { "cache-control": "max-age=56" },
    });
  };
  try {
    const args = { year: 2026, turn: 2, scope: "brasil" };
    const [a, b] = await Promise.all([
      getOfficialLive(args),
      getOfficialLive(args),
    ]);
    assert.equal(calls, 1);
    assert.equal(a.live, true);
    assert.equal(a.transport, "tse-direct");
    assert.equal(b.year, 2026);
    await getOfficialLive(args);
    assert.equal(calls, 1);
    await assert.rejects(
      getOfficialLive({ year: 2022, turn: 2, scope: "brasil" }),
      /histórico/,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
test("falha/CORS entra em espera e resposta de outra localidade é rejeitada", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new TypeError("Failed to fetch");
  };
  try {
    const args = { year: 2026, turn: 2, scope: "estado:ac" };
    await assert.rejects(getOfficialLive(args), /Failed to fetch/);
    await assert.rejects(getOfficialLive(args), /Failed to fetch/);
    assert.equal(calls, 1);
    globalThis.fetch = async () => new Response(JSON.stringify(raw));
    await assert.rejects(
      getOfficialLive({ year: 2026, turn: 2, scope: "estado:ba" }),
      /diferente/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
