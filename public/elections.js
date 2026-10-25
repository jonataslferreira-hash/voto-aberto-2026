export const ELECTIONS = [
  {
    year: 2026,
    turn: 2,
    id: "6258",
    label: "2026 · 2º turno",
    layout: "dados",
    suffix: "u",
  },
  {
    year: 2026,
    turn: 1,
    id: "6257",
    label: "2026 · 1º turno",
    layout: "dados",
    suffix: "u",
  },
  {
    year: 2022,
    turn: 1,
    id: "544",
    label: "2022 · 1º turno",
    layout: "dados-simplificados",
    suffix: "r",
  },
  {
    year: 2022,
    turn: 2,
    id: "545",
    label: "2022 · 2º turno",
    layout: "dados-simplificados",
    suffix: "r",
  },
];
export function electionFor(year = 2026, turn = 2) {
  const election = ELECTIONS.find(
    (e) => e.year === Number(year) && e.turn === Number(turn),
  );
  if (!election)
    throw new Error(
      "Eleição não suportada: selecione 2022 ou 2026 e turno 1 ou 2.",
    );
  return election;
}
export const electionKey = (year, turn) => `${year}-${turn}`;
export function tseUrl(election, uf = "br") {
  return `https://resultados.tse.jus.br/oficial/ele${election.year}/${election.id}/${election.layout}/${uf}/${uf}-c0001-e${election.id.padStart(6, "0")}-${election.suffix}.json`;
}
