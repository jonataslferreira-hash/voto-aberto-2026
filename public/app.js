import { BRAZIL_MAP } from "./brazil-map.js";
import {
  STATES,
  escapeHtml as e,
  candidates,
  comparison,
  progress,
  statusLabel,
  regionGroups,
  historyPoints,
  linePath,
  int,
  pct,
} from "./dashboard-data.js";
const PORTRAITS = {
  blue: new URL("./images/flavio-2026.jpg", import.meta.url).href,
  red: new URL("./images/lula-oficial-2023.jpg", import.meta.url).href,
};
const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL || "").trim().replace(/\/+$/, "") || null;
const $ = (id) => document.getElementById(id);
const state = {
  mode: "complete",
  provider: "auto",
  scope: "brasil",
  mainScope: "brasil",
  uf: "sp",
  exterior: "exterior-geral",
  tab: "geral",
  window: "1h",
  locations: [],
  snapshots: new Map(),
  exteriorResults: new Map(),
  updates: [],
  result: null,
  history: null,
  lastSnapshot: 0,
  lastLocations: 0,
  lastExterior: 0,
  lastSourceComparison: 0,
  sourceComparisons: [],
};
let revision = 0,
  controller = null,
  refreshing = false,
  refreshAgain = false,
  snapshotController = null,
  snapshotBusy = false;
const providerName = (p) =>
  ({
    tse: "TSE oficial",
    "eleicoes-feed": "Feed independente",
    "placar-do-voto": "Placar do Voto",
  })[p] || "Indisponível";
const sourceKind = (p) =>
  ({
    "official-tse": "TSE oficial",
    "independent-tse-derived": "Feed independente baseado no TSE",
    "bu-partial": "Boletim de urna parcial",
  })[p?.sourceKind] || "Dados indisponíveis";
const date = (value, timeOnly = false) => {
  if (!value) return "Não informado";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? "Horário inválido"
    : d.toLocaleString("pt-BR", {
        timeZone: "America/Bahia",
        ...(timeOnly
          ? { hour: "2-digit", minute: "2-digit", second: "2-digit" }
          : {
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            }),
      });
};
function scopeLabel() {
  return state.mainScope === "brasil"
    ? "Brasil"
    : state.mainScope === "estados"
      ? STATES.find((s) => s.uf === state.uf)?.name || "Estado"
      : state.locations.find((l) => locationScope(l) === state.exterior)
          ?.nome || "Exterior · geral";
}
const locationScope = (l) =>
  `${l.tipo === "country" ? "exterior-pais" : "exterior-cidade"}:${l.id}`;
function safeLink(url, label) {
  try {
    const u = new URL(url);
    if (!["https:", "http:"].includes(u.protocol)) return "URL não informada";
    return `<a href="${e(u.href)}" target="_blank" rel="noopener noreferrer">${e(label || u.href)} ↗</a>`;
  } catch (error) {
    return "URL não informada";
  }
}
function unavailable(message) {
  return {
    sourceKind: "unavailable",
    provider: "unavailable",
    consolidationWarning: message,
    candidatos: [],
    updatedAt: null,
  };
}
async function getJSON(path, query = {}, signal) {
  if (!API_BASE_URL) throw new Error("API_BASE_URL_NOT_CONFIGURED");
  let url;
  try {
    url = new URL(API_BASE_URL + path);
  } catch (error) {
    throw new Error(
      "VITE_API_BASE_URL inválida. Configure uma URL HTTP(S) completa.",
    );
  }
  if (!["https:", "http:"].includes(url.protocol))
    throw new Error("A API precisa usar HTTP(S).");
  for (const [key, value] of Object.entries(query))
    url.searchParams.set(key, value);
  const r = await fetch(url, { signal: signal || AbortSignal.timeout(50000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${path}`);
  if (!r.headers.get("content-type")?.includes("application/json"))
    throw new Error(`Resposta não JSON em ${path}`);
  const data = await r.json();
  if (
    path === "/api/results" &&
    (!Array.isArray(data.candidatos) ||
      ![
        "unavailable",
        "official-tse",
        "independent-tse-derived",
        "bu-partial",
      ].includes(data.sourceKind))
  )
    throw new Error("Contrato inválido em /api/results");
  if (path === "/api/results" && data.scope && data.scope !== query.scope)
    throw new Error("A resposta da API pertence a outra localidade.");
  return data;
}
function voteBar(payload, compact = false) {
  const c = comparison(payload);
  return `<div class="vote-track ${c.valid ? "" : "unavailable"}" role="img" aria-label="${c.valid ? `Flávio ${pct(c.flavio.pct)}; Lula ${pct(c.lula.pct)}` : "Percentuais indisponíveis"}"><i class="blue" style="width:${c.valid ? c.flavio.pct : 0}%"></i><i class="red" style="width:${c.valid ? c.lula.pct : 0}%"></i></div>${compact ? "" : `<div class="bar-legend"><span>FLÁVIO BOLSONARO · ${e(pct(c.flavio.pct))}</span><span>${e(pct(c.lula.pct))} · LULA</span></div>`}`;
}
function renderCandidate(name, party, number, c, color) {
  return `<article class="candidate candidate--${color}"><div class="candidate-info"><p class="candidate-kicker"><b>${number}</b> ${party} <span>•</span> PRESIDENTE</p><h2>${name}</h2><p class="candidate__pct" aria-label="${e(pct(c.pct))}">${c.pct === null ? "—" : e(pct(c.pct).slice(0, -1))}${c.pct === null ? "" : "<small>%</small>"}</p><p class="candidate__votes">${e(int(c.votes))} <span>votos</span></p><div class="candidate-progress" aria-hidden="true"><i style="width:${c.pct ?? 0}%"></i></div></div><div class="portrait-frame"><img class="portrait-photo" src="${PORTRAITS[color]}" alt="Retrato ${color === "blue" ? "TSE, 2026, de Flávio Bolsonaro" : "oficial de Lula, Ricardo Stuckert/PR, 2023"}" width="${color === "blue" ? 411 : 960}" height="${color === "blue" ? 546 : 1229}" decoding="async"><span class="portrait-fallback">Retrato indisponível</span></div></article>`;
}
function renderResult(result) {
  state.result = result;
  const c = comparison(result),
    pr = progress(result),
    valid = result.sourceKind !== "unavailable";
  $("app").dataset.gradient = c.valid ? "live" : "neutral";
  $("app").style.setProperty("--split", `${c.split ?? 50}%`);
  $("heroTotals").innerHTML =
    renderCandidate("Flávio Bolsonaro", "PL", "22", c.flavio, "blue") +
    renderCandidate("Lula", "PT", "13", c.lula, "red");
  $("heroBar").innerHTML = voteBar(result);
  $("heroDifference").innerHTML =
    c.diff === null
      ? "Diferença não disponível"
      : c.diff === 0
        ? "Empate em votos"
        : `<strong>${e(int(c.diff))} votos</strong> de diferença · ${c.leader === "blue" ? "Flávio" : "Lula"} à frente`;
  $("heroSource").innerHTML = result.sourceUrl
    ? safeLink(result.sourceUrl, sourceKind(result))
    : e(sourceKind(result));
  $("heroUpdate").textContent =
    `Atualização da fonte · ${date(result.updatedAt)} · Brasília`;
  $("resultStatus").textContent = statusLabel(result);
  $("connection").dataset.status = valid ? "online" : "error";
  $("connection").innerHTML =
    `<i></i>${valid ? "API conectada" : API_BASE_URL ? "Sem dados" : "API não configurada"}`;
  $("notice").textContent =
    result.consolidationWarning ||
    (!c.valid
      ? "Percentuais não informados pela fonte. Gradiente neutro; nenhum valor foi estimado."
      : "");
  $("cardApuracao").innerHTML =
    `<h2>URNAS / SEÇÕES APURADAS</h2><p class="summary-number">${e(pct(pr))}</p><div class="progress-track"><i style="width:${pr ?? 0}%"></i></div><div class="summary-meta"><span>${e(int(result.secoesApuradas))} de ${e(int(result.secoesTotais))} seções</span><span>${e(statusLabel(result))}</span></div><p class="summary-note">${e(providerName(result.provider))} · ${e(date(result.updatedAt, true))}</p>`;
  $("sourceMeta").innerHTML =
    `<dl class="source-kv"><div><dt>Localidade</dt><dd>${e(scopeLabel())}</dd></div><div><dt>Tipo</dt><dd>${e(sourceKind(result))}</dd></div><div><dt>Provedor</dt><dd>${e(providerName(result.provider))}</dd></div><div><dt>Fonte às</dt><dd>${e(date(result.updatedAt))}</dd></div><div><dt>Coleta às</dt><dd>${e(date(result.retrievedAt))}</dd></div><div><dt>Consolidação</dt><dd>${e(statusLabel(result))}. Sem projeção de vitória.</dd></div></dl><div class="source-url">${safeLink(result.sourceUrl)}</div>`;
  const diagnostics = Array.isArray(result.diagnostics)
    ? result.diagnostics
    : [];
  $("diagnostics").innerHTML = diagnostics.length
    ? diagnostics
        .map(
          (d) =>
            `<p class="diagnostic"><strong>${e(providerName(d.provider))}</strong>: ${e(d.message)}<br>${safeLink(d.sourceUrl)}</p>`,
        )
        .join("")
    : `<p class="diagnostic">${e(result.consolidationWarning || "Nenhuma falha reportada nesta consulta.")}</p>`;
  renderUpdates(result);
}
function renderUpdates(result) {
  if (result?.sourceKind !== "unavailable" && result?.updatedAt) {
    const key = [
      state.scope,
      result.provider,
      result.updatedAt,
      JSON.stringify(result.candidatos),
    ].join("|");
    if (!state.updates.some((u) => u.key === key)) {
      state.updates.unshift({ key, scope: scopeLabel(), result });
      state.updates = state.updates.slice(0, 12);
    }
  }
  $("updates").innerHTML = state.updates.length
    ? state.updates
        .map(
          (u) =>
            `<li class="${comparison(u.result).leader}"><time>${e(date(u.result.updatedAt, true))} · Brasília</time><strong>${e(u.scope)} · ${e(pct(progress(u.result)))} apurado</strong><small>${e(providerName(u.result.provider))} · ${e(statusLabel(u.result))}</small></li>`,
        )
        .join("")
    : "<li><strong>Aguardando atualizações da fonte</strong><small>Somente mudanças reais são registradas.</small></li>";
}
const labelPositions = {
  ac: [42.7, 183.7],
  am: [111.6, 122.2],
  ap: [264.5, 54.7],
  ba: [387.3, 221.7],
  ce: [412.6, 133.1],
  go: [292.5, 264.5],
  ma: [344.7, 132.7],
  mg: [351.9, 293.5],
  ms: [229.9, 315.9],
  mt: [217.1, 227.4],
  pa: [251.2, 119.7],
  pe: [432.0, 171.9],
  pi: [372.4, 160.6],
  pr: [268.6, 367.6],
  ro: [133.9, 202.9],
  rr: [151.2, 47.0],
  rs: [248.2, 428.5],
  sc: [282.1, 398.9],
  sp: [303.2, 339.2],
  to: [308.0, 193.8],
};
function initMap() {
  // Projected paths use the same affine lon/lat transform as the source geometry.
  $("brazilMap").innerHTML =
    BRAZIL_MAP.map(
      (s) =>
        `<path d="${s.d}" class="map-state" data-uf="${s.uf}" role="button" tabindex="0" aria-label="Selecionar ${e(s.name)}" aria-pressed="false"><title>${e(s.name)} · Sem dados</title></path>`,
    ).join("") +
    Object.entries(labelPositions)
      .map(
        ([uf, [x, y]]) =>
          `<text class="map-label" x="${x}" y="${y}" aria-hidden="true">${uf.toUpperCase()}</text>`,
      )
      .join("");
  $("brazilMap").addEventListener("click", (event) => {
    const uf = event.target.closest("[data-uf]")?.dataset.uf;
    if (uf) selectScope("estados", uf);
  });
  $("brazilMap").addEventListener("keydown", (event) => {
    if (["Enter", " "].includes(event.key) && event.target.dataset.uf) {
      event.preventDefault();
      selectScope("estados", event.target.dataset.uf);
    }
  });
}
function renderMap() {
  for (const node of $("brazilMap").querySelectorAll("[data-uf]")) {
    const s = STATES.find((s) => s.uf === node.dataset.uf),
      p = state.snapshots.get(s.uf),
      c = comparison(p);
    const selected = state.mainScope === "estados" && state.uf === s.uf;
    node.classList.toggle("is-selected", selected);
    node.setAttribute("aria-pressed", String(selected));
    const intensity = c.valid
      ? Math.min(1, Math.abs(c.flavio.pct - c.lula.pct) / 35)
      : 0.35;
    node.style.fill =
      c.leader === "unknown"
        ? "#29374a"
        : c.leader === "tie"
          ? "#8f805f"
          : c.leader === "blue"
            ? `color-mix(in srgb, #3b83ee ${30 + intensity * 70}%, #1d2b41)`
            : `color-mix(in srgb, #f45b76 ${30 + intensity * 70}%, #2a2436)`;
    const label = `${s.name} · ${c.leader === "unknown" ? "Sem dados" : c.leader === "tie" ? "Empate em votos" : `${c.leader === "blue" ? "Flávio" : "Lula"} na frente · ${providerName(p.provider)}`}`;
    node.setAttribute("aria-label", `Selecionar ${label}`);
    node.querySelector("title").textContent = label;
  }
  const p = state.snapshots.get(state.uf),
    c = comparison(p);
  $("mapDetail").innerHTML =
    `<strong>${e(STATES.find((s) => s.uf === state.uf)?.name)}</strong><span>${state.mainScope === "estados" ? "Selecionado" : "Em destaque"}</span><p class="value">${e(pct(c.flavio.pct))} Flávio</p><p class="red-text">${e(pct(c.lula.pct))} Lula</p><p>${e(int(c.diff))} votos de diferença</p><p>${e(p ? providerName(p.provider) : "Sem dados")}</p><p>${e(date(p?.updatedAt))}</p>`;
}
function renderRegions() {
  $("regionRows").innerHTML = regionGroups(state.snapshots)
    .map(
      (region) =>
        `<section class="region-row"><div class="region-heading"><h3>${e(region.name)}</h3><span>${region.groups.length ? region.groups.reduce((n, g) => n + g.states, 0) : "—"}/${region.total} UFs</span></div>${
          region.groups.length
            ? region.groups
                .map((g) => {
                  const payload = {
                    candidatos: [
                      {
                        candidato: "Flávio",
                        percentual: g.flavioPct,
                        votos: g.flavio,
                      },
                      {
                        candidato: "Lula",
                        percentual: g.lulaPct,
                        votos: g.lula,
                      },
                    ],
                  };
                  return `<div class="region-values"><span>${e(pct(g.flavioPct))}</span><span class="red-text">${e(pct(g.lulaPct))}</span></div>${voteBar(payload, true)}<p class="region-note">F ${e(int(g.flavio))} · L ${e(int(g.lula))} votos · Δ ${e(int(Math.abs(g.flavio - g.lula)))}</p><p class="region-note">${e(providerName(g.provider))} · ${g.states}/${region.total} UFs${g.states < region.total ? " · Cobertura incompleta" : ""} · ${g.statuses.every((s) => s === "totalized") ? "Totalização finalizada" : g.statuses.some((s) => s === "partial") ? "Apuração parcial" : "Aguardando apuração"} · ${g.times.length ? e(date(g.times.slice().sort()[0])) : "Horário não informado"}</p>`;
                })
                .join("")
            : `<div class="region-values"><span>—</span><span class="red-text">—</span></div><div class="vote-track unavailable"></div><p class="region-note">Dados indisponíveis · nenhuma UF com totais válidos</p>`
        }</section>`,
    )
    .join("");
}
const FEATURED = ["AU", "NZ", "JP", "US", "PT", "GB", "DE", "FR"];
function visibleLocations() {
  const type = state.tab === "cidade" ? "city" : "country";
  const list = state.locations.filter((l) => l.tipo === type);
  const selected = list.filter((l) => locationScope(l) === state.exterior);
  return [
    ...selected,
    ...list
      .filter((l) => !selected.includes(l))
      .sort((a, b) => {
        const ia = FEATURED.indexOf(a.countryCode),
          ib = FEATURED.indexOf(b.countryCode);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      }),
  ].slice(0, 9);
}
function renderSourceComparison() {
  $("exteriorSources").innerHTML = state.sourceComparisons.length
    ? '<p class="footnote">Exterior · fontes independentes, sem somar totalizações</p>' +
      state.sourceComparisons
        .map(
          (p) =>
            `<button type="button" class="source-chip" data-exterior-provider="${e(p.provider)}" title="${e(p.consolidationWarning || statusLabel(p))}"><strong>${e(providerName(p.provider))}</strong><span>${e(pct(progress(p)))} apurado · ${e(statusLabel(p))}</span><small>Fonte ${e(date(p.updatedAt, true))} · coleta ${e(date(p.retrievedAt, true))}</small></button>`,
        )
        .join("")
    : state.sourcesError
      ? `<p class="footnote">Comparação de fontes: ${e(state.sourcesError)}</p>`
      : "";
}
function renderExterior() {
  const general = state.tab === "geral";
  const list = general
    ? [{ nome: "Exterior · geral", scope: "exterior-geral", countryCode: "ZZ" }]
    : visibleLocations().map((l) => ({ ...l, scope: locationScope(l) }));
  renderSourceComparison();
  $("exteriorCount").textContent = state.locations.length
    ? `${state.locations.length} locais`
    : "ZZ";
  $("exteriorContent").setAttribute("aria-labelledby", `tab-${state.tab}`);
  $("exteriorContent").innerHTML = list.length
    ? list
        .map((l) => {
          const p = state.exteriorResults.get(l.scope);
          if (general && (!p || p.sourceKind === "unavailable"))
            return `<div class="empty-state"><span class="empty-symbol" aria-hidden="true">◎</span><h3>Exterior sem totalização disponível</h3><p>${e(p?.consolidationWarning || "Aguardando uma resposta válida da fonte. Países e cidades aparecem somente quando retornados pela API.")}</p></div>`;
          const c = comparison(p);
          return `<button type="button" class="exterior-row" data-exterior-scope="${e(l.scope)}" aria-label="Selecionar ${e(l.nome)}"><span class="exterior-name"><span class="country-code">${e(l.countryCode || "LOC")}</span>${e(l.nome)} <span aria-hidden="true">↗</span></span><span class="exterior-values"><span>Flávio ${e(pct(c.flavio.pct))} · ${e(int(c.flavio.votes))}</span><span>Lula ${e(pct(c.lula.pct))} · ${e(int(c.lula.votes))}</span></span>${voteBar(p, true)}<span class="exterior-meta">Δ ${e(int(c.diff))} votos · ${e(pct(progress(p)))} apurado · ${e(int(p?.secoesApuradas))}/${e(int(p?.secoesTotais))} seções</span><span class="exterior-meta">${e(sourceKind(p))} · ${e(providerName(p?.provider))} · ${e(date(p?.updatedAt))}</span>${p?.consolidationWarning ? `<span class="exterior-meta">${e(p.consolidationWarning)}</span>` : ""}</button>`;
        })
        .join("")
    : `<div class="empty-state"><span class="empty-symbol" aria-hidden="true">◎</span><h3>Nenhum ${state.tab === "pais" ? "país" : "município"} disponível</h3><p>${e(state.locationsError || "A fonte ainda não retornou locais verificáveis para esta aba. Nenhuma localidade foi criada pelo painel.")}</p></div>`;
}
let chartPoints = [];
function renderHistory(history) {
  const points = historyPoints(history?.points);
  chartPoints = points;
  const min = points[0]?.at || Date.now() - 3600000,
    max = Math.max(points.at(-1)?.at || Date.now(), min + 1000);
  const x = (t) => 42 + ((t - min) / (max - min)) * 620,
    y = (v) => 180 - v * 1.6;
  const grid = [0, 25, 50, 75, 100]
    .map(
      (v) =>
        `<line class="chart-grid" x1="42" y1="${y(v)}" x2="662" y2="${y(v)}"/><text class="chart-axis" x="5" y="${y(v) + 4}">${v}%</text>`,
    )
    .join("");
  const hasValues = points.some((p) => p.flavio !== null || p.lula !== null);
  $("historyChart").innerHTML =
    grid +
    [0, 0.5, 1]
      .map(
        (r) =>
          `<text class="chart-axis" x="${42 + r * 620}" y="208" text-anchor="${r === 0 ? "start" : r === 1 ? "end" : "middle"}">${e(date(new Date(min + (max - min) * r), true).slice(0, 5))}</text>`,
      )
      .join("") +
    (hasValues
      ? ["flavio", "lula"]
          .map(
            (key, i) =>
              `<path class="chart-line ${i ? "red" : "blue"}" data-series="${key}" d="${linePath(points, key, x, y)}"/>${points.map((p, index) => (p[key] === null ? "" : `<circle class="chart-point" cx="${x(p.at)}" cy="${y(p[key])}" r="3" fill="${i ? "#ff657e" : "#5d9eff"}"/>`)).join("")}`,
          )
          .join("") +
        points
          .map(
            (p, index) =>
              `<circle class="chart-hit" cx="${x(p.at)}" cy="${y(p.flavio ?? p.lula ?? 50)}" r="12" tabindex="0" data-point="${index}" aria-label="${e(date(new Date(p.at)))}: Flávio ${e(pct(p.flavio))}; Lula ${e(pct(p.lula))}"><title>${e(date(new Date(p.at)))} · Flávio ${e(pct(p.flavio))} · Lula ${e(pct(p.lula))}</title></circle>`,
          )
          .join("")
      : '<text class="chart-empty" x="352" y="94" text-anchor="middle">Sem histórico disponível</text><text class="chart-empty-note" x="352" y="115" text-anchor="middle">Os pontos aparecerão quando a fonte publicar uma série.</text>');
  $("historySource").textContent = history?.provider
    ? providerName(history.provider)
    : "Fonte sem série disponível";
  $("historyNote").textContent = history?.error
    ? `Histórico indisponível: ${history.error}`
    : history?.diagnostics?.length
      ? history.diagnostics.map((d) => d.message).join(" · ")
      : "Lacunas permanecem vazias. Nenhum valor é estimado.";
  $("chartTooltip").hidden = true;
}
function tooltip(event) {
  const node = event.target.closest("[data-point]");
  if (!node) {
    $("chartTooltip").hidden = true;
    return;
  }
  const p = chartPoints[Number(node.dataset.point)];
  $("chartTooltip").textContent =
    `${date(new Date(p.at))} · Flávio ${pct(p.flavio)} · Lula ${pct(p.lula)}`;
  $("chartTooltip").hidden = false;
}
function syncControls() {
  $("scopeLabel").textContent = scopeLabel();
  $("stateFilterWrap").hidden = state.mainScope !== "estados";
  $("exteriorFilterWrap").hidden = state.mainScope !== "exterior";
  $("stateSelect").value = state.uf;
  $("exteriorSelect").value = state.exterior;
  for (const b of document.querySelectorAll("[data-main-scope]")) {
    const active = b.dataset.mainScope === state.mainScope;
    b.classList.toggle("is-active", active);
    b.setAttribute("aria-pressed", String(active));
  }
  renderMap();
}
async function loadCountryCities(code) {
  try {
    const data = await getJSON("/api/locations", { country: code });
    if (!Array.isArray(data.locations))
      throw new Error("Lista de cidades inválida.");
    const entries = data.locations.filter(
      (l) =>
        l.tipo === "city" &&
        typeof l.id === "string" &&
        typeof l.nome === "string",
    );
    const existing = new Set(state.locations.map(locationScope));
    state.locations.push(
      ...entries.filter((l) => !existing.has(locationScope(l))),
    );
    $("exteriorSelect").innerHTML =
      '<option value="exterior-geral">Exterior · geral</option>' +
      state.locations
        .map(
          (l) => `<option value="${e(locationScope(l))}">${e(l.nome)}</option>`,
        )
        .join("");
    $("exteriorSelect").value = state.exterior;
    renderExterior();
  } catch (error) {
    state.locationsError = `Cidades: ${error.message}`;
  }
}
function selectScope(main, value) {
  state.mainScope = main;
  if (main === "estados") state.uf = value || state.uf;
  if (main === "exterior") state.exterior = value || state.exterior;
  state.scope =
    main === "brasil"
      ? "brasil"
      : main === "estados"
        ? `estado:${state.uf}`
        : state.exterior;
  if (main === "exterior" && API_BASE_URL) {
    const code = state.exterior.match(/^exterior-pais:([a-z]{2})$/)?.[1];
    if (code) loadCountryCities(code);
  }
  revision++;
  controller?.abort();
  syncControls();
  renderResult(unavailable("Consultando a localidade selecionada…"));
  renderHistory(null);
  refresh();
}
async function refresh() {
  if (refreshing) {
    refreshAgain = true;
    return;
  }
  if (!API_BASE_URL) {
    renderResult(
      unavailable(
        "API indisponível no GitHub Pages: defina VITE_API_BASE_URL apontando para o backend/proxy externo.",
      ),
    );
    return;
  }
  refreshing = true;
  controller = new AbortController();
  const current = revision,
    scope = state.scope,
    provider = state.provider;
  try {
    const [result, history] = await Promise.allSettled([
      getJSON("/api/results", { scope, provider }, controller.signal),
      state.mode === "complete"
        ? getJSON(
            "/api/history",
            { scope, provider, window: state.window },
            controller.signal,
          )
        : Promise.resolve(null),
    ]);
    if (current !== revision) return;
    if (result.status === "fulfilled") {
      renderResult(result.value);
      if (state.mainScope === "estados") {
        state.snapshots.set(state.uf, result.value);
        renderMap();
      }
      if (state.mainScope === "exterior") {
        state.exteriorResults.set(scope, result.value);
        renderExterior();
      }
    } else if (result.reason.name !== "AbortError")
      renderResult(
        unavailable(`Falha ao consultar API: ${result.reason.message}`),
      );
    if (history.status === "fulfilled") {
      state.history = history.value;
      renderHistory(history.value);
    } else if (history.reason.name !== "AbortError")
      renderHistory({ error: history.reason.message });
    if (state.mode === "complete") refreshDetails();
  } finally {
    refreshing = false;
    if (refreshAgain) {
      refreshAgain = false;
      refresh();
    }
  }
}
async function refreshDetails() {
  if (snapshotBusy || !API_BASE_URL) return;
  snapshotBusy = true;
  snapshotController = new AbortController();
  const signal = snapshotController.signal,
    provider = state.provider;
  const fetchResult = async (scope) => {
    try {
      return await getJSON("/api/results", { scope, provider }, signal);
    } catch (error) {
      if (error.name === "AbortError") throw error;
      return unavailable(error.message);
    }
  };
  try {
    if (Date.now() - state.lastLocations > 60000) {
      try {
        const data = await getJSON("/api/locations", {}, signal);
        if (!Array.isArray(data.locations))
          throw new Error("Contrato de locais inválido");
        state.locations = data.locations.filter(
          (l) =>
            ["country", "city"].includes(l.tipo) &&
            typeof l.id === "string" &&
            typeof l.nome === "string",
        );
        state.locationsError = data.error || null;
        $("exteriorSelect").innerHTML =
          '<option value="exterior-geral">Exterior · geral</option>' +
          state.locations
            .map(
              (l) =>
                `<option value="${e(locationScope(l))}">${e(l.nome)}</option>`,
            )
            .join("");
        $("exteriorSelect").value = state.exterior;
      } catch (error) {
        if (error.name === "AbortError") throw error;
        state.locationsError = `Falha na lista do exterior: ${error.message}`;
      }
      state.lastLocations = Date.now();
    }
    if (Date.now() - state.lastSourceComparison > 30000) {
      try {
        const data = await getJSON(
          "/api/sources",
          { scope: "exterior-geral" },
          signal,
        );
        if (Array.isArray(data.sources)) state.sourceComparisons = data.sources;
        else state.sourcesError = "Contrato de comparação de fontes inválido.";
      } catch (error) {
        if (error.name === "AbortError") throw error;
        state.sourcesError = error.message;
      }
      state.lastSourceComparison = Date.now();
      renderSourceComparison();
    }
    if (Date.now() - state.lastExterior > 30000) {
      const featured = state.locations.filter(
        (l) => l.tipo === "country" && FEATURED.includes(l.countryCode),
      );
      const scopes = [
        ...new Set([
          "exterior-geral",
          state.exterior,
          ...featured.map(locationScope),
          ...visibleLocations().map(locationScope),
        ]),
      ];
      for (let i = 0; i < scopes.length; i += 3) {
        await Promise.all(
          scopes.slice(i, i + 3).map(async (scope) => {
            const data = await fetchResult(scope);
            if (provider === state.provider)
              state.exteriorResults.set(scope, data);
          }),
        );
        renderExterior();
      }
      state.lastExterior = Date.now();
    }
    renderExterior();
    if (Date.now() - state.lastSnapshot > 60000) {
      for (let i = 0; i < STATES.length; i += 3) {
        await Promise.all(
          STATES.slice(i, i + 3).map(async (s) => {
            const data = await fetchResult(`estado:${s.uf}`);
            if (provider === state.provider) state.snapshots.set(s.uf, data);
          }),
        );
        renderMap();
        renderRegions();
      }
      state.lastSnapshot = Date.now();
    }
  } catch (error) {
    if (error.name !== "AbortError") {
      $("mapDetail").textContent = `Consulta interrompida: ${error.message}`;
    }
  } finally {
    snapshotBusy = false;
  }
}
$("stateSelect").innerHTML = STATES.map(
  (s) =>
    `<option value="${s.uf}">${e(s.name)} · ${s.uf.toUpperCase()}</option>`,
).join("");
for (const b of document.querySelectorAll("[data-main-scope]"))
  b.addEventListener("click", () => selectScope(b.dataset.mainScope));
for (const b of document.querySelectorAll("[data-mode]"))
  b.addEventListener("click", () => {
    state.mode = b.dataset.mode;
    $("app").classList.toggle("mode-simple", state.mode === "simple");
    for (const button of document.querySelectorAll("[data-mode]")) {
      const active = button.dataset.mode === state.mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    if (state.mode === "complete") refresh();
    else snapshotController?.abort();
  });
$("settingsBtn").addEventListener("click", () => {
  $("settingsPanel").hidden = !$("settingsPanel").hidden;
  $("settingsBtn").setAttribute(
    "aria-expanded",
    String(!$("settingsPanel").hidden),
  );
});
$("refreshBtn").addEventListener("click", refresh);
$("stateSelect").addEventListener("change", (event) =>
  selectScope("estados", event.target.value),
);
$("exteriorSelect").addEventListener("change", (event) =>
  selectScope("exterior", event.target.value),
);
$("providerSelect").addEventListener("change", () => {
  state.provider = $("providerSelect").value;
  revision++;
  controller?.abort();
  snapshotController?.abort();
  state.snapshots.clear();
  state.exteriorResults.clear();
  state.lastSnapshot = state.lastExterior = 0;
  renderMap();
  renderRegions();
  renderExterior();
  renderResult(unavailable("Consultando o provedor selecionado…"));
  refresh();
});
$("windowSelect").addEventListener("change", () => {
  state.window = $("windowSelect").value;
  revision++;
  controller?.abort();
  refresh();
});
const tabs = [...document.querySelectorAll("[data-exterior-tab]")];
function activateTab(tab) {
  state.tab = tab.dataset.exteriorTab;
  for (const t of tabs) {
    const active = t === tab;
    t.classList.toggle("is-active", active);
    t.setAttribute("aria-selected", String(active));
    t.tabIndex = active ? 0 : -1;
  }
  renderExterior();
  state.lastExterior = 0;
  refreshDetails();
}
for (const tab of tabs) {
  tab.addEventListener("click", () => activateTab(tab));
  tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : (tabs.indexOf(tab) +
              (event.key === "ArrowRight" ? 1 : -1) +
              tabs.length) %
            tabs.length;
    tabs[index].focus();
    activateTab(tabs[index]);
  });
}
$("exteriorSources").addEventListener("click", (event) => {
  const provider = event.target.closest("[data-exterior-provider]")?.dataset
    .exteriorProvider;
  if (!provider) return;
  state.provider = provider;
  $("providerSelect").value = provider;
  state.lastSnapshot = state.lastExterior = 0;
  state.snapshots.clear();
  state.exteriorResults.clear();
  selectScope("exterior", "exterior-geral");
});
$("exteriorContent").addEventListener("click", (event) => {
  const scope = event.target.closest("[data-exterior-scope]")?.dataset
    .exteriorScope;
  if (scope) selectScope("exterior", scope);
});
$("historyChart").addEventListener("pointerover", tooltip);
$("historyChart").addEventListener("focusin", tooltip);
$("historyChart").addEventListener("pointerleave", () => {
  $("chartTooltip").hidden = true;
});
$("historyChart").addEventListener("focusout", () => {
  $("chartTooltip").hidden = true;
});
$("heroTotals").addEventListener(
  "error",
  (event) => {
    if (event.target.matches(".portrait-photo"))
      event.target.parentElement.classList.add("is-unavailable");
  },
  true,
);
$("imageCredits").href = new URL("./images/credits.html", import.meta.url).href;
initMap();
syncControls();
renderRegions();
renderExterior();
renderHistory(null);
renderResult(unavailable("Conectando à API…"));
refresh();
setInterval(() => {
  if (!document.hidden) refresh();
}, 3000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refresh();
  else {
    controller?.abort();
    snapshotController?.abort();
  }
});
