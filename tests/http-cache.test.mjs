import test from "node:test";
import assert from "node:assert/strict";
import { fetchWithPolicy } from "../src/lib/http-cache.mjs";
const response = (body, status = 200, headers = {}) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
test("cache fresco e chamadas concorrentes evitam novo polling na fonte", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 5));
    return response({ real: 1 });
  };
  const options = {
    key: "fresh",
    url: "https://source.test/result",
    fetchImpl,
    cacheTtlMs: 30000,
  };
  const results = await Promise.all(
    Array.from({ length: 10 }, () => fetchWithPolicy(options)),
  );
  assert.equal(calls, 1);
  assert.equal(results[0].data.real, 1);
  assert.equal((await fetchWithPolicy(options)).fromCache, true);
  assert.equal(calls, 1);
});
test("cache expirado usa ETag e Last-Modified; 304 mantém dados", async () => {
  let calls = 0;
  const fetchImpl = async (url, { headers }) => {
    calls++;
    if (calls === 1)
      return response({ votes: 42 }, 200, {
        etag: "version-1",
        "last-modified": "Sun, 25 Oct 2026 12:00:00 GMT",
      });
    assert.equal(headers["If-None-Match"], "version-1");
    assert.equal(headers["If-Modified-Since"], "Sun, 25 Oct 2026 12:00:00 GMT");
    return response(null, 304);
  };
  const options = {
    key: "expired",
    url: "https://source.test/result",
    fetchImpl,
    cacheTtlMs: 1,
  };
  await fetchWithPolicy(options);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal((await fetchWithPolicy(options)).data.votes, 42);
  assert.equal(calls, 2);
});
test("HTTP 403 não entra em loop e falha fica em cooldown", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return response({}, 403);
  };
  const options = {
    key: "denied",
    url: "https://source.test/denied",
    fetchImpl,
  };
  await assert.rejects(fetchWithPolicy(options), /403/);
  await assert.rejects(fetchWithPolicy(options), /403/);
  assert.equal(calls, 1);
});
test("Retry-After longo é respeitado sem bloquear o worker", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return response({}, 429, { "retry-after": "120" });
  };
  const options = { key: "rate", url: "https://source.test/rate", fetchImpl };
  await assert.rejects(fetchWithPolicy(options), /429/);
  await assert.rejects(fetchWithPolicy(options), /429/);
  assert.equal(calls, 1);
});
