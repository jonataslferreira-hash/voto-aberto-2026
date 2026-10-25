import test from "node:test";
import assert from "node:assert/strict";
import {
  createEventTracker,
  confirmedWinner,
  soundNotes,
} from "../public/election-events.js";
import { parseTseJson } from "../public/tse-format.js";
const source =
  "https://resultados.tse.jus.br/oficial/ele2026/6258/dados/br/br-c0001-e006258-u.json";
const make = (f = 60, l = 40, at = "2026-10-25T20:00:00Z") => ({
  year: 2026,
  turn: 2,
  scope: "brasil",
  provider: "tse",
  sourceKind: "official-tse",
  sourceUrl: source,
  updatedAt: at,
  live: true,
  status: "partial",
  candidatos: [
    { numero: "22", candidato: "Flávio Bolsonaro", votos: f, percentual: f },
    { numero: "13", candidato: "Lula", votos: l, percentual: l },
  ],
});
function victory(p) {
  return {
    ...p,
    candidatos: p.candidatos.map((c) => ({
      ...c,
      eleito: c.numero === "13",
      situacao: c.numero === "13" ? "Eleito" : "Não eleito",
    })),
    officialOutcome: {
      numero: "13",
      candidato: "Lula",
      decision: "Eleito",
      electionId: "6258",
      scope: "brasil",
      sourceUrl: source,
    },
  };
}
test("primeira carga, empate, zeros e repetição não geram virada; troca real gera uma", () => {
  const tracker = createEventTracker();
  assert.equal(tracker.observe(make()), null);
  assert.equal(tracker.observe(make()), null);
  assert.equal(tracker.observe(make(50, 50, "2026-10-25T20:00:01Z")), null);
  assert.equal(tracker.observe(make(0, 0, "2026-10-25T20:00:02Z")), null);
  const event = tracker.observe(make(40, 60, "2026-10-25T20:01:00Z"));
  assert.equal(event.kind, "lead");
  assert.equal(event.number, "13");
  assert.equal(event.color, "red");
  assert.equal(tracker.observe(make(40, 60, "2026-10-25T20:01:00Z")), null);
});
test("resposta antiga e troca de localidade/provedor/comparação não simulam virada", () => {
  const tracker = createEventTracker();
  tracker.observe(make());
  assert.equal(tracker.observe(make(40, 60, "2026-10-25T19:59:00Z")), null);
  assert.equal(
    tracker.observe({
      ...make(40, 60, "2026-10-25T20:01:00Z"),
      scope: "estado:ba",
    }),
    null,
  );
  assert.equal(
    tracker.observe({
      ...make(40, 60, "2026-10-25T20:01:00Z"),
      provider: "placar-do-voto",
      sourceKind: "independent-tse-derived",
    }),
    null,
  );
  assert.equal(
    tracker.observe(make(40, 60, "2026-10-25T20:01:00Z"), ["13", "22"]),
    null,
  );
});
test("vitória exige decisão oficial, candidato marcado Eleito e eleição nacional correta", () => {
  const valid = victory(make(40, 60));
  assert.equal(confirmedWinner(valid).numero, "13");
  for (const change of [
    { sourceKind: "independent-tse-derived" },
    { provider: "placar-do-voto" },
    { turn: 1 },
    { year: 2022 },
    { scope: "estado:sp" },
    { officialOutcome: null },
    { sourceUrl: "https://not-tse.test/" },
    { candidatos: valid.candidatos.map((c) => ({ ...c, eleito: false })) },
  ])
    assert.equal(confirmedWinner({ ...valid, ...change }), null);
});
test("anúncio oficial acontece uma vez e não dispara no histórico ou na carga inicial", () => {
  const tracker = createEventTracker();
  tracker.observe(make());
  const result = victory(make(40, 60, "2026-10-25T20:01:00Z"));
  assert.equal(tracker.observe(result).kind, "victory");
  assert.equal(
    tracker.observe({ ...result, updatedAt: "2026-10-25T20:02:00Z" }),
    null,
  );
  assert.equal(createEventTracker().observe(result), null);
  const history = createEventTracker();
  history.observe({ ...make(), year: 2022 });
  assert.equal(history.observe({ ...result, year: 2022 }), null);
  const published = createEventTracker();
  published.observe({ ...make(), publishedAt: "x" });
  assert.equal(published.observe({ ...result, publishedAt: "x" }), null);
});
test("marcação de classificado para segundo turno não é Eleito", () => {
  const raw = {
    ele: "6257",
    t: "1",
    cdabr: "br",
    dg: "25/10/2026",
    hg: "17:00:00",
    vvc: "100",
    cand: [
      { n: "22", nm: "Flávio", vap: "60", pvap: "60", e: "s", st: "2º turno" },
      { n: "13", nm: "Lula", vap: "40", pvap: "40", e: "s", st: "2º turno" },
    ],
  };
  const first = parseTseJson(raw, source);
  assert.equal(first.officialOutcome, null);
  assert.ok(first.candidatos.every((c) => !c.eleito));
  const second = parseTseJson(
    {
      ...raw,
      ele: "6258",
      t: "2",
      cand: raw.cand.map((c) => ({
        ...c,
        e: c.n === "22" ? "s" : "n",
        st: c.n === "22" ? "Eleito" : "Não eleito",
      })),
    },
    source,
  );
  assert.equal(second.officialOutcome.numero, "22");
});
test("sons diferenciam candidatos e vitória, com frequências válidas", () => {
  assert.notDeepEqual(soundNotes("22"), soundNotes("13"));
  assert.ok(
    soundNotes("13", "victory").length > soundNotes("13", "lead").length,
  );
  assert.notDeepEqual(soundNotes("22", "victory", 2022, "Jair Bolsonaro"), soundNotes("22", "victory", 2026, "Flávio Bolsonaro"));
  for (const number of ["13", "22", "12"])
    for (const note of soundNotes(number, "victory"))
      assert.ok(
        note.frequency > 0 && note.frequency < 20000 && note.duration > 0,
      );
});

test("primeiro turno também permite vitória se o TSE disser Eleito, nunca apenas classificação", () => {
  const url =
    "https://resultados.tse.jus.br/oficial/ele2026/6257/dados/br/br-c0001-e006257-u.json";
  const first = {
    ...victory(make(40, 60)),
    turn: 1,
    sourceUrl: url,
    officialOutcome: {
      ...victory(make(40, 60)).officialOutcome,
      electionId: "6257",
      sourceUrl: url,
    },
  };
  assert.equal(confirmedWinner(first).numero, "13");
});
