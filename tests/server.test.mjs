import test from "node:test";
import assert from "node:assert/strict";
process.env.NODE_ENV = "test";
const { default: server } = await import("../src/server.mjs");
test("servidor real preserva contratos JSON e preflight CORS", async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const preflight = await fetch(`${base}/api/results`, { method: "OPTIONS" });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
    const results = await fetch(
      `${base}/api/results?provider=not-configured&scope=exterior-geral`,
    );
    assert.equal(results.status, 200);
    const r = await results.json();
    assert.equal(r.scope, "exterior-geral");
    assert.equal(r.sourceKind, "unavailable");
    assert.ok(r.diagnostics.length);
    const history = await fetch(
      `${base}/api/history?provider=tse&scope=brasil`,
    );
    const h = await history.json();
    assert.deepEqual(h.points, []);
    assert.equal(h.gapPolicy, "missing-as-null");
    assert.ok(h.diagnostics.length);
    const missing = await fetch(`${base}/missing`);
    assert.equal(missing.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
