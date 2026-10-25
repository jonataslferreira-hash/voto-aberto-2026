import test from "node:test";
import assert from "node:assert/strict";
import {
  comparison,
  progress,
  historyPoints,
  linePath,
  regionGroups,
  escapeHtml,
} from "../public/dashboard-data.js";
import { toNumber } from "../src/lib/model.mjs";
const payload = (f, l, fp, lp) => ({
  provider: "tse",
  sourceKind: "official-tse",
  votosValidos: f + l,
  candidatos: [
    { candidato: "Flávio", votos: f, percentual: fp },
    { candidato: "Lula", votos: l, percentual: lp },
  ],
});
test("ausência não vira zero em votos, progresso, empate ou gradiente", () => {
  const p = payload(null, null, null, null);
  assert.equal(comparison(p).diff, null);
  assert.equal(comparison(p).split, null);
  assert.equal(comparison(p).leader, "unknown");
  assert.equal(progress(p), null);
});
test("gradiente só usa percentuais finitos e válidos", () => {
  assert.equal(comparison(payload(75, 25, 75, 25)).split, 75);
  for (const p of [null, undefined, -1, 101, Infinity, "75"])
    assert.equal(comparison(payload(1, 1, p, 25)).valid, false);
  assert.equal(comparison(payload(0, 0, 0, 0)).valid, false);
  assert.equal(comparison(payload(1, 1, 80, 80)).valid, false);
});
test("empate em votos não declara vencedor", () => {
  assert.equal(comparison(payload(100, 100, 50, 50)).leader, "tie");
});
test("histórico mantém lacunas e quebra a linha", () => {
  const points = historyPoints([
    { at: "2026-10-25T12:00Z", flavioPercent: 50, lulaPercent: 50 },
    { at: "2026-10-25T12:01Z", flavioPercent: null, lulaPercent: null },
    { at: "2026-10-25T12:02Z", flavioPercent: 60, lulaPercent: 40 },
  ]);
  assert.equal(points[1].flavio, null);
  assert.equal(
    linePath(
      points,
      "flavio",
      () => 1,
      (v) => v,
    ),
    "M1.00,50.00 M1.00,60.00",
  );
});
test("regiões não somam provedores diferentes e usam votos válidos como denominador", () => {
  const a = payload(40, 20, 40, 20);
  a.votosValidos = 100;
  const b = {
    ...payload(50, 50, 50, 50),
    provider: "placar-do-voto",
    sourceKind: "independent-tse-derived",
  };
  const r = regionGroups(
    new Map([
      ["sp", a],
      ["rj", b],
    ]),
  ).find((r) => r.name === "Sudeste");
  assert.equal(r.groups.length, 2);
  assert.equal(r.groups.find((g) => g.provider === "tse").flavioPct, 40);
  assert.equal(r.groups.find((g) => g.provider === "tse").states, 1);
});
test("escape de texto externo e números decimais não inventam casas", () => {
  assert.equal(
    escapeHtml('<img onerror="x">'),
    "&lt;img onerror=&quot;x&quot;&gt;",
  );
  assert.equal(toNumber("52.22"), 52.22);
  assert.equal(toNumber("1.234,56"), 1234.56);
  assert.equal(toNumber(" "), null);
  assert.equal(toNumber(false), null);
});
