import { getOfficialLive } from "./live-results.js";
import { createEventTracker, confirmedWinner } from "./election-events.js";
import { createEventDisplay } from "./event-display.js";
import { electionFor, electionKey } from "./elections.js";
import { BRAZIL_MAP } from "./brazil-map.js";
import { WORLD_MAP } from "./world-map.js";
import {
  STATES,
  setComparisonNumbers,
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
  candidateColor,
} from "./dashboard-data.js";
const PORTRAITS = {
  blue: new URL("./images/flavio-cutout.png", import.meta.url).href,
  red: new URL("./images/lula-cutout.png", import.meta.url).href,
};
const CANDIDATE_PORTRAITS = {
  "55": new URL("./images/candidates/2026-55-ronaldo-caiado.png", import.meta.url).href,
  "27": new URL("./images/candidates/2026-27-clariana-barao.png", import.meta.url).href,
  "21": new URL("./images/candidates/2026-21-edmilson-costa.png", import.meta.url).href,
  "16": new URL("./images/candidates/2026-16-hertz-dias.png", import.meta.url).href,
  "70": new URL("./images/candidates/2026-70-augusto-cury.png", import.meta.url).href,
  "30": new URL("./images/candidates/2026-30-zema.png", import.meta.url).href,
  "80": new URL("./images/candidates/2026-80-samara-martins.png", import.meta.url).href,
  "35": new URL("./images/candidates/2026-35-wilson-grassi.png", import.meta.url).href,
  "14": new URL("./images/candidates/2026-14-renan-santos.png", import.meta.url).href,
  "29": new URL("./images/candidates/2026-29-rui-costa-pimenta.png", import.meta.url).href,
};
const CANDIDATE_PORTRAITS_2022 = {
  "22": new URL("./images/candidates/2022-22-jair-bolsonaro.png", import.meta.url).href,
  "12": new URL("./images/candidates/2022-12-ciro-gomes.png", import.meta.url).href,
  "15": new URL("./images/candidates/2022-15-simone-tebet.png", import.meta.url).href,
  "44": new URL("./images/candidates/2022-44-soraya-thronicke.png", import.meta.url).href,
  "27": new URL("./images/candidates/2022-27-jose-maria-eymael.png", import.meta.url).href,
  "14": new URL("./images/candidates/2022-14-padre-kelmon.png", import.meta.url).href,
  "80": new URL("./images/candidates/2022-80-leo-pericles.png", import.meta.url).href,
  "16": new URL("./images/candidates/2022-16-vera-lucia.png", import.meta.url).href,
  "30": new URL("./images/candidates/2022-30-felipe-davila.png", import.meta.url).href,
  "21": new URL("./images/candidates/2022-21-sofia-manzano.png", import.meta.url).href,
};
const DEFAULT_API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL || "").trim().replace(/\/+$/, "") || null;
let API_BASE_URL = DEFAULT_API_BASE_URL;
try {
  const saved = localStorage.getItem("voto-api-url");
  API_BASE_URL = saved === "published" ? null : saved || DEFAULT_API_BASE_URL;
} catch (error) {
  console.info("Preferência de conexão não pôde ser lida.");
}
let liveEnabled = true;
try {
  liveEnabled =
    localStorage.getItem("voto-live-enabled") === "off"
      ? false
      : localStorage.getItem("voto-api-url") !== "published";
} catch (error) {
  console.info("Preferência de atualização indisponível.");
}
let snapshotCache = null,
  snapshotAt = 0,
  snapshotPending = null;
async function publishedJSON(path, query) {
  if (!snapshotCache || Date.now() - snapshotAt > 30000) {
    snapshotPending ??= fetch(`${import.meta.env.BASE_URL}data/results.json`, {
      cache: "no-cache",
    })
      .then(async (r) => {
        if (!r.ok)
          throw new Error(
            `Dados publicados indisponíveis (HTTP ${r.status}). Configure um backend em Configurações ou atualize a publicação.`,
          );
        const j = await r.json();
        if (j.schemaVersion !== 1)
          throw new Error("Arquivo de resultados inválido.");
        snapshotCache = j;
        snapshotAt = Date.now();
        return j;
      })
      .finally(() => {
        snapshotPending = null;
      });
    await snapshotPending;
  }
  const election = snapshotCache.elections[electionKey(query.year, query.turn)];
  if (!election) throw new Error("Eleição não incluída nos dados publicados.");
  if (
    query.scope?.startsWith("exterior-pais:") ||
    query.scope?.startsWith("exterior-cidade:")
  )
    return unavailable(
      "Dados por país/cidade requerem um backend configurado.",
    );
  const uf =
    query.scope === "exterior-geral"
      ? "zz"
      : query.scope?.startsWith("estado:")
        ? query.scope.split(":")[1]
        : "br";
  const result = {
    ...(election.results[uf] ||
      unavailable("Localidade não incluída nesta publicação.")),
    scope: query.scope,
    year: state.year,
    turn: state.turn,
  };
  if (path === "/api/results")
    return {
      ...result,
      publishedAt: snapshotCache.generatedAt,
      refreshError: election.refreshError,
    };
  if (path === "/api/history")
    return {
      points: [],
      error:
        "Série histórica não incluída nos dados publicados. Use um backend para acompanhar o histórico.",
    };
  if (path === "/api/sources")
    return { sources: [result], aggregation: "none" };
  return {
    locations: [],
    error:
      "Detalhamento por país/cidade requer um backend. O total geral do exterior está disponível nos dados publicados.",
  };
}
const $ = (id) => document.getElementById(id);
const state = {
  mode: "complete",
  year: 2026,
  turn: 2,
  pair: ["22", "13"],
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
const MAX_LOCAL_HISTORY_POINTS = 720;
function numberForCandidate(candidate) {
  if (candidate?.numero != null) return String(candidate.numero);
  const name = candidate?.candidato || "";
  if (/fl[aá]vio|jair|bolsonaro/i.test(name)) return "22";
  if (/\blula\b/i.test(name)) return "13";
  return null;
}
function observationKey(result = state.result) {
  return result
    ? `voto-history:${state.year}:${state.turn}:${encodeURIComponent(state.scope)}:${encodeURIComponent(result.provider || "unknown")}`
    : null;
}
function readObservations(result = state.result) {
  const key = observationKey(result);
  if (!key) return [];
  try {
    const values = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(values)
      ? values.filter((item) => Number.isFinite(Date.parse(item.at)) && item.values && typeof item.values === "object")
      : [];
  } catch (error) {
    console.info("Histórico local não pôde ser lido.", error);
    return [];
  }
}
function saveHistoryObservation(result) {
  if (
    state.year !== 2026 ||
    !["official-tse", "independent-tse-derived"].includes(result?.sourceKind) ||
    !Array.isArray(result.candidatos)
  )
    return;
  const hasCount =
    (Number.isFinite(result.votosValidos) && result.votosValidos > 0) ||
    result.candidatos.some((candidate) => Number.isFinite(candidate.votos) && candidate.votos > 0);
  if (!hasCount) return;
  const timestamp = result.updatedAt || result.retrievedAt;
  const at = timestamp ? new Date(timestamp) : null;
  if (!at || Number.isNaN(at.getTime())) return;
  const values = Object.fromEntries(
    result.candidatos
      .map((candidate) => {
        const number = numberForCandidate(candidate);
        const value = candidate.percentual;
        return number && Number.isFinite(value) && value >= 0 && value <= 100
          ? [number, value]
          : null;
      })
      .filter(Boolean),
  );
  if (!Object.keys(values).length) return;
  const point = { at: at.toISOString(), values };
  const current = readObservations(result);
  const previous = current.at(-1);
  if (previous?.at === point.at && JSON.stringify(previous.values) === JSON.stringify(point.values)) return;
  current.push(point);
  try {
    localStorage.setItem(observationKey(result), JSON.stringify(current.slice(-MAX_LOCAL_HISTORY_POINTS)));
  } catch (error) {
    console.info("Este navegador não conseguiu guardar novas observações do histórico.", error);
  }
}
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
    "cnn-brasil": "CNN Brasil · painel baseado no TSE",
    "historical-archive": "Acervo histórico · TSE derivado",
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
  query = { ...query, year: state.year, turn: state.turn };
  if (!API_BASE_URL) {
    if (
      path === "/api/results" &&
      liveEnabled &&
      Number(query.year) === 2026 &&
      query.scope === state.scope &&
      ["auto", "tse"].includes(query.provider)
    ) {
      try {
        return await getOfficialLive(query, signal);
      } catch (error) {
        if (error.name === "AbortError") throw error;
        const published = await publishedJSON(path, query);
        return { ...published, liveUnavailable: error.message };
      }
    }
    return publishedJSON(path, query);
  }
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
  if (
    path === "/api/results" &&
    ((data.year !== undefined && Number(data.year) !== state.year) ||
      (data.turn !== undefined && Number(data.turn) !== state.turn) ||
      ((state.year !== 2026 || state.turn !== 2) &&
        (Number(data.year) !== state.year || Number(data.turn) !== state.turn)))
  )
    throw new Error(
      "Backend não confirmou o ano/turno solicitado; resposta descartada.",
    );
  return path === "/api/results"
    ? {
        ...data,
        live:
          liveEnabled &&
          Number(query.year) === 2026 &&
          data.sourceKind !== "unavailable",
        transport: "backend",
      }
    : data;
}
function voteBar(payload, compact = false) {
  const c = comparison(payload);
  return `<div class="vote-track ${c.valid ? "" : "unavailable"}" role="img" aria-label="${c.valid ? `${e(c.flavio.name)} ${pct(c.flavio.pct)}; ${e(c.lula.name)} ${pct(c.lula.pct)}` : "Percentuais indisponíveis"}"><i class="blue" style="--candidate-color:${c.flavio.color};width:${c.valid ? c.flavio.pct : 0}%"></i><i class="red" style="--candidate-color:${c.lula.color};width:${c.valid ? c.lula.pct : 0}%"></i></div>${compact ? "" : `<div class="bar-legend"><span>${e(c.flavio.name)} · ${e(pct(c.flavio.pct))}</span><span>${e(pct(c.lula.pct))} · ${e(c.lula.name)}</span></div>`}`;
}
function portraitFor(number, name) {
  const id = String(number);
  if (state.year === 2026) {
    if (id === "22" && /fl[aá]vio/i.test(name)) return PORTRAITS.blue;
    if (id === "13" && /lula/i.test(name)) return PORTRAITS.red;
    return CANDIDATE_PORTRAITS[id] || null;
  }
  if (state.year === 2022) {
    if (id === "13" && /lula/i.test(name)) return PORTRAITS.red;
    return CANDIDATE_PORTRAITS_2022[id] || null;
  }
  return null;
}
function renderCandidate(name, party, number, c, color) {
  const image = portraitFor(number, name);
  const accent = candidateColor(number, state.year);
  const countKey = `${state.year}-${state.turn}-${state.scope}-${number}`;
  return `<article class="candidate candidate--${color}" data-candidate-number="${e(number)}" data-watermark="${e(name)}" style="--candidate-accent:${accent}"><div class="candidate-info"><p class="candidate-kicker"><b>${e(number)}</b> ${e(party)} <span>•</span> PRESIDENTE</p><h2>${e(name)}</h2><p class="candidate__pct" aria-label="${e(pct(c.pct))}">${c.pct === null ? "—" : `<span data-count-key="${e(countKey)}" data-count-target="${e(c.pct)}">${e(pct(c.pct).slice(0, -1))}</span><small>%</small>`}</p><p class="candidate__votes">${e(int(c.votes))} <span>votos</span></p><div class="candidate-progress" aria-hidden="true"><i style="width:${c.pct ?? 0}%"></i></div></div><div class="portrait-frame ${image ? "" : "is-unavailable"}"><img class="portrait-photo" ${image ? `src="${image}"` : ""} alt="${image ? `Retrato fotográfico de ${e(name)}` : ""}" width="540" height="780" decoding="async"><span class="portrait-fallback">Retrato indisponível</span></div></article>`;
}

const displayedPercents = new Map();
function animatePercents() {
  document.querySelectorAll("[data-count-key]").forEach((node) => {
    const key = node.dataset.countKey, target = Number(node.dataset.countTarget);
    const from = displayedPercents.get(key);
    if (from === undefined || !Number.isFinite(target) || from === target) {
      displayedPercents.set(key, target);
      return;
    }
    const started = performance.now(), duration = 380;
    const tick = (now) => {
      const t = Math.min(1, (now - started) / duration);
      const eased = 1 - (1 - t) ** 3;
      const value = from + (target - from) * eased;
      node.textContent = value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      if (t < 1 && node.isConnected) requestAnimationFrame(tick);
      else displayedPercents.set(key, target);
    };
    requestAnimationFrame(tick);
  });
}

function renderResult(result) {
  result = { ...result, year: state.year, turn: state.turn };
  $("providerSelect").disabled = !API_BASE_URL;
  $("liveUpdatesToggle").disabled = state.year !== 2026;
  $("liveUpdatesToggle").checked = state.year === 2026 && liveEnabled;
  state.result = result;
  saveHistoryObservation(result);
  syncCandidateOptions(result);
  const c = comparison(result),
    pr = progress(result),
    valid = result.sourceKind !== "unavailable";
  $("app").dataset.gradient = c.valid ? "live" : "neutral";
  $("app").style.setProperty("--split", `${c.split ?? 50}%`);
  $("app").style.setProperty("--left-color", candidateColor(state.pair[0], state.year));
  $("app").style.setProperty("--right-color", candidateColor(state.pair[1], state.year));
  $("app").style.setProperty("--left-presence", `${c.valid ? c.split : 50}%`);
  $("app").style.setProperty("--right-presence", `${c.valid ? 100 - c.split : 50}%`);
  $("heroColorField").dataset.valid = String(c.valid);
  $("heroColorBlue").style.width = `${c.split ?? 0}%`;
  $("heroColorRed").style.width = `${c.split === null ? 0 : 100 - c.split}%`;
  $("heroColorField").setAttribute(
    "aria-label",
    c.valid
      ? `${c.flavio.name} ${c.split.toFixed(2)}%, ${c.lula.name} ${(100 - c.split).toFixed(2)}%; proporção entre os candidatos selecionados.`
      : "Áreas de cor neutras: percentuais ausentes.",
  );
  $("heroColorBlue").style.background = `linear-gradient(100deg, color-mix(in srgb, ${candidateColor(state.pair[0], state.year)} 85%, transparent), color-mix(in srgb, ${candidateColor(state.pair[0], state.year)} 48%, transparent))`;
  $("heroColorRed").style.background = `linear-gradient(100deg, color-mix(in srgb, ${candidateColor(state.pair[1], state.year)} 48%, transparent), color-mix(in srgb, ${candidateColor(state.pair[1], state.year)} 85%, transparent))`;
  const winner = confirmedWinner(result);
  $("winnerConfirmation").hidden = !winner;
  $("winnerConfirmation").textContent = winner
    ? `${winner.candidato} · eleito, confirmado pelo TSE`
    : "";
  const event = eventTracker.observe(result, state.pair);
  if (event) eventDisplay.show(event, scopeLabel());

  $("heroTotals").innerHTML =
    renderCandidate(
      c.flavio.name,
      c.flavio.party,
      c.flavio.number,
      c.flavio,
      "blue",
    ) +
    renderCandidate(c.lula.name, c.lula.party, c.lula.number, c.lula, "red");
  animatePercents();
  $("heroBar").innerHTML = voteBar(result);
  const legends = document.querySelectorAll(".map-legend>span");
  if (legends[0])
    legends[0].innerHTML = `<i class="dot blue" style="background:${candidateColor(c.flavio.number, state.year)}"></i>${e(c.flavio.name)} na frente`;
  if (legends[1])
    legends[1].innerHTML = `<i class="dot red" style="background:${candidateColor(c.lula.number, state.year)}"></i>${e(c.lula.name)} na frente`;

  $("heroDifference").innerHTML =
    c.diff === null
      ? "Diferença não disponível"
      : c.diff === 0
        ? "Empate em votos"
        : `<strong>${e(int(c.diff))} votos</strong> de diferença · ${e(c.leader === "blue" ? c.flavio.name : c.lula.name)} à frente`;
  $("raceOverview").textContent = c.valid
    ? `Visão geral: ${c.leader === "tie" ? "empate em votos entre os nomes comparados" : `${c.leader === "blue" ? c.flavio.name : c.lula.name} está à frente por ${int(c.diff)} votos`}. Possibilidade de virada: indeterminada; a fonte não informa quantos votos ainda podem ser contabilizados.`
    : "Visão geral e possibilidade de virada indisponíveis: faltam percentuais válidos nesta localidade.";
  $("raceOverview").style.setProperty("--race-accent", c.valid ? candidateColor(c.leader === "blue" ? c.flavio.number : c.leader === "red" ? c.lula.number : state.pair[0], state.year) : "#607087");
  $("worldBlueLegend").textContent = c.flavio.name;
  $("worldRedLegend").textContent = c.lula.name;
  renderWorldMap();
  $("heroSource").innerHTML = result.sourceUrl
    ? safeLink(result.sourceUrl, sourceKind(result))
    : e(sourceKind(result));
  $("heroUpdate").textContent =
    `Atualização da fonte · ${date(result.updatedAt)} · Brasília`;
  $("resultStatus").textContent = statusLabel(result);
  $("liveStatus").textContent =
    result.transport === "tse-direct"
      ? `Consulta direta ao TSE; intervalo mínimo de 60 s. Fonte: ${date(result.updatedAt)}.`
      : API_BASE_URL
        ? liveEnabled
          ? "Tela consulta o backend a cada 3 s; o cache da fonte pode ser maior."
          : "Atualização automática pausada; use Atualizar agora para consultar."
        : result.liveUnavailable
          ? result.liveUnavailable + "; usando dados publicados."
          : "Dados publicados não são uma conexão ao vivo.";

  $("connection").dataset.status = valid ? "online" : "error";
  $("connection").innerHTML =
    `<i></i>${valid ? (result.transport === "tse-direct" ? "TSE ao vivo" : API_BASE_URL ? "API conectada" : "Dados publicados") : "Sem dados"}`;
  $("notice").textContent =
    (result.liveUnavailable
      ? `${result.liveUnavailable}. Exibindo a última coleta publicada. `
      : "") +
      (result.publishedAt
        ? `Dados publicados; coleta ${date(result.retrievedAt)}. Atualização periódica, sem conexão ao vivo. `
        : "") +
      (result.refreshError || result.consolidationWarning || "") ||
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
            ? `color-mix(in srgb, ${candidateColor(c.flavio.number, state.year)} ${30 + intensity * 70}%, #1d2b41)`
            : `color-mix(in srgb, ${candidateColor(c.lula.number, state.year)} ${30 + intensity * 70}%, #2a2436)`;
    const label = `${s.name} · ${c.leader === "unknown" ? "Sem dados" : c.leader === "tie" ? "Empate em votos" : `${e(c.leader === "blue" ? c.flavio.name : c.lula.name)} na frente · ${providerName(p.provider)}`}`;
    node.setAttribute("aria-label", `Selecionar ${label}`);
    node.querySelector("title").textContent = label;
  }
  const p = state.snapshots.get(state.uf),
    c = comparison(p);
  $("mapDetail").innerHTML =
    `<strong>${e(STATES.find((s) => s.uf === state.uf)?.name)}</strong><span>${state.mainScope === "estados" ? "Selecionado" : "Em destaque"}</span><p class="value">${e(pct(c.flavio.pct))} ${e(c.flavio.name)}</p><p class="red-text">${e(pct(c.lula.pct))} ${e(c.lula.name)}</p><p>${e(int(c.diff))} votos de diferença</p><p>${e(p ? providerName(p.provider) : "Sem dados")}</p><p>${e(date(p?.updatedAt))}</p>`;
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
                    year: state.year,
                    candidatos: [
                      {
                        candidato: candidates(state.result).flavio.name,
                        numero: state.pair[0],
                        percentual: g.flavioPct,
                        votos: g.flavio,
                      },
                      {
                        candidato: candidates(state.result).lula.name,
                        numero: state.pair[1],
                        percentual: g.lulaPct,
                        votos: g.lula,
                      },
                    ],
                  };
                  const leading = g.flavio === g.lula ? "Empate nos votos comparados" : `Mais votos: ${g.flavio > g.lula ? candidates(state.result).flavio.name : candidates(state.result).lula.name}`;
                  return `<div class="region-values"><span>${e(pct(g.flavioPct))}</span><span class="red-text">${e(pct(g.lulaPct))}</span></div>${voteBar(payload, true)}<p class="region-front">${e(leading)}</p><p class="region-note">${e(candidates(state.result).flavio.name)} ${e(int(g.flavio))} · ${e(candidates(state.result).lula.name)} ${e(int(g.lula))} votos · Δ ${e(int(Math.abs(g.flavio - g.lula)))}</p><p class="region-note">${e(providerName(g.provider))} · ${g.states}/${region.total} UFs${g.states < region.total ? " · Cobertura incompleta" : ""} · ${g.statuses.every((s) => s === "totalized") ? "Totalização finalizada" : g.statuses.some((s) => s === "partial") ? "Apuração parcial" : "Aguardando apuração"} · ${g.times.length ? e(date(g.times.slice().sort()[0])) : "Horário não informado"}</p>`;
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
    ? '<p class="footnote">Exterior · fontes separadas, sem somar totalizações</p>' +
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
          if (
            general && state.year === 2026 && state.turn === 2 &&
            p?.provider === "tse" && p.status === "not-started" &&
            c.flavio.votes === 0 && c.lula.votes === 0
          )
            return `<div class="empty-state exterior-awaiting"><span class="empty-symbol" aria-hidden="true">◷</span><h3>Exterior · aguardando a apuração do 2º turno</h3><p>O TSE ainda não publicou votos para o exterior nesta eleição. A resposta oficial indica <strong>${e(int(p.secoesApuradas))} de ${e(int(p.secoesTotais))} seções</strong> apuradas; os percentuais permanecem indisponíveis até haver votos publicados.</p><p class="exterior-meta">TSE oficial · fonte atualizada em ${e(date(p.updatedAt))} · ${safeLink(p.sourceUrl, "consultar resposta do TSE")}</p></div>`;
          return `<button type="button" class="exterior-row" data-exterior-scope="${e(l.scope)}" aria-label="Selecionar ${e(l.nome)}"><span class="exterior-name"><span class="country-code">${e(l.countryCode || "LOC")}</span>${e(l.nome)} <span aria-hidden="true">↗</span></span><span class="exterior-values"><span>${e(c.flavio.name)} ${e(pct(c.flavio.pct))} · ${e(int(c.flavio.votes))}</span><span>${e(c.lula.name)} ${e(pct(c.lula.pct))} · ${e(int(c.lula.votes))}</span></span>${voteBar(p, true)}<span class="exterior-meta">Δ ${e(int(c.diff))} votos · ${e(pct(progress(p)))} apurado · ${e(int(p?.secoesApuradas))}/${e(int(p?.secoesTotais))} seções</span><span class="exterior-meta">${e(sourceKind(p))} · ${e(providerName(p?.provider))} · ${e(date(p?.updatedAt))}</span>${p?.consolidationWarning ? `<span class="exterior-meta">${e(p.consolidationWarning)}</span>` : ""}</button>`;
        })
        .join("")
    : `<div class="empty-state"><span class="empty-symbol" aria-hidden="true">◎</span><h3>Nenhum ${state.tab === "pais" ? "país" : "município"} disponível</h3><p>${e(state.locationsError || "A fonte ainda não retornou locais verificáveis para esta aba. Nenhuma localidade foi criada pelo painel.")}</p></div>`;
}
function initWorldMap() {
  $("worldMap").innerHTML = WORLD_MAP.map((country) => {
    const available = state.locations.some((location) => location.tipo === "country" && (location.countryCode || location.id?.toUpperCase()) === country.code);
    return `<path d="${country.d}" class="world-country ${available ? "has-results-source" : ""}" data-country-code="${country.code}" aria-label="${e(country.name)} · ${available ? "localidade publicada pela fonte" : "sem dados publicados"}" ${available ? 'role="button" tabindex="0"' : ""}><title>${e(country.name)} · ${available ? "dados disponíveis na fonte" : "sem dados"}</title></path>`;
  }).join("");
  renderWorldMap();
}
function renderWorldMap() {
  if (!$("worldMap")) return;
  for (const node of $("worldMap").querySelectorAll(".world-country")) {
    const location = state.locations.find((entry) => entry.tipo === "country" && (entry.countryCode || entry.id?.toUpperCase()) === node.dataset.countryCode);
    const result = location ? state.exteriorResults.get(locationScope(location)) : null;
    const c = comparison(result);
    node.classList.toggle("is-data", Boolean(result && result.sourceKind !== "unavailable"));
    node.style.setProperty("--map-result", c.valid ? c.leader === "blue" ? candidateColor(c.flavio.number, state.year) : c.leader === "red" ? candidateColor(c.lula.number, state.year) : "#b99dff" : "#31435a");
    node.setAttribute("aria-pressed", String(Boolean(location && locationScope(location) === state.exterior)));
  }
  $("worldMapCount").textContent = `Países com resultados: ${[...$("worldMap").querySelectorAll(".world-country.is-data")].length}`;
}
function chooseWorldCountry(event) {
  const code = event.target.closest("[data-country-code]")?.dataset.countryCode;
  const location = state.locations.find((entry) => entry.tipo === "country" && (entry.countryCode || entry.id?.toUpperCase()) === code);
  if (location) selectScope("exterior", locationScope(location));
}
let chartPoints = [];
function renderHistory(history) {
  const selected = candidates(state.result);
  const localPoints = state.year === 2026
    ? readObservations().map((sample) => ({
        at: Date.parse(sample.at),
        left: Number.isFinite(sample.values[state.pair[0]]) ? sample.values[state.pair[0]] : null,
        right: Number.isFinite(sample.values[state.pair[1]]) ? sample.values[state.pair[1]] : null,
      }))
    : [];
  const remoteAllowed =
    state.year === 2026 &&
    state.turn === 2 &&
    new Set(state.pair).size === 2 &&
    state.pair.includes("22") &&
    state.pair.includes("13");
  const remotePoints = remoteAllowed
    ? historyPoints(history?.points).map((point) => ({
        at: point.at,
        left: state.pair[0] === "22" ? point.flavio : point.lula,
        right: state.pair[1] === "22" ? point.flavio : point.lula,
      }))
    : [];
  const remoteFiltered = filterHistoryWindow(remotePoints, state.window);
  const points = remoteFiltered.length
    ? remoteFiltered
    : filterHistoryWindow(localPoints, state.window);
  const localSelected = !remoteFiltered.length && localPoints.length > 0;
  const chartHistoryError =
    state.year === 2022
      ? "A série temporal de 2022 não foi arquivada. O painel mostra os totais finais do turno sem fingir que são uma sequência ao vivo."
      : !points.length
        ? history?.error ||
          "O gráfico começa no primeiro resultado válido publicado após o fechamento de uma seção. Ainda não há ponto histórico disponível nesta sessão."
        : null;
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
  const hasValues = points.some((p) => p.left !== null || p.right !== null);
  const series = [
    { key: "left", candidate: selected.flavio, number: state.pair[0] },
    { key: "right", candidate: selected.lula, number: state.pair[1] },
  ].map((item) => ({ ...item, color: candidateColor(item.number, state.year) }));
  $("historyChart").innerHTML =
    grid +
    [0, 0.5, 1]
      .map(
        (r) =>
          `<text class="chart-axis" x="${42 + r * 620}" y="208" text-anchor="${r === 0 ? "start" : r === 1 ? "end" : "middle"}">${e(date(new Date(min + (max - min) * r), true).slice(0, 5))}</text>`,
      )
      .join("") +
    (hasValues
      ? series
          .map(
            ({ key, candidate, color }) =>
              `<path class="chart-line" style="--series-color:${color}" data-series="${key}" d="${linePath(points, key, x, y)}"/>${points.map((point) => (point[key] === null ? "" : `<circle class="chart-point" cx="${x(point.at)}" cy="${y(point[key])}" r="3" fill="${color}"/>`)).join("")}`,
          )
          .join("") +
        points
          .map((point, index) => {
            const value = point.left ?? point.right;
            return value === null
              ? ""
              : `<circle class="chart-hit" cx="${x(point.at)}" cy="${y(value)}" r="12" tabindex="0" data-point="${index}" aria-label="${e(date(new Date(point.at)))}: ${e(selected.flavio.name)} ${e(pct(point.left))}; ${e(selected.lula.name)} ${e(pct(point.right))}"><title>${e(date(new Date(point.at)))} · ${e(selected.flavio.name)} ${e(pct(point.left))} · ${e(selected.lula.name)} ${e(pct(point.right))}</title></circle>`;
          })
          .join("")
      : `<text class="chart-empty" x="352" y="94" text-anchor="middle">${state.year === 2022 ? "Histórico temporal não arquivado" : "Aguardando a primeira atualização válida"}</text><text class="chart-empty-note" x="352" y="115" text-anchor="middle">${state.year === 2022 ? "Resultados finais disponíveis; sem série de evolução." : "O gráfico começará quando a fonte publicar votos e percentuais."}</text>`);
  $("historyLegendFlavio").textContent = selected.flavio.name;
  $("historyLegendLula").textContent = selected.lula.name;
  $("historyLegendFlavio").parentElement.style.setProperty("--series-color", series[0].color);
  $("historyLegendLula").parentElement.style.setProperty("--series-color", series[1].color);
  $("historyLegendFlavio").parentElement.querySelector(".dot").style.backgroundColor = series[0].color;
  $("historyLegendLula").parentElement.querySelector(".dot").style.backgroundColor = series[1].color;
  $("historySource").textContent = remoteFiltered.length
    ? providerName(history?.provider)
    : localPoints.length
    ? `${providerName(state.result?.provider)} · série observada neste navegador`
      : "Fonte sem série disponível";
  $("historyNote").textContent = localSelected && points.length
    ? `Série desde o primeiro resultado válido observado neste navegador (${date(new Date(points[0].at))}). Se uma seção fechou antes desta sessão, só um histórico preservado pela fonte pode preencher esse período. Lacunas permanecem vazias.`
    : chartHistoryError || (history?.diagnostics?.length
      ? history.diagnostics.map((diagnostic) => diagnostic.message).join(" · ")
      : "Lacunas permanecem vazias. Nenhum valor é estimado.");
  $("chartTooltip").hidden = true;
}
function filterHistoryWindow(points, windowKey) {
  if (windowKey === "all") return points.slice().sort((a, b) => a.at - b.at);
  const horizon = windowKey === "1h" ? 3600000 : 10800000;
  const min = Date.now() - horizon;
  return points.filter((point) => point.at >= min && point.at <= Date.now()).sort((a, b) => a.at - b.at);
}
function tooltip(event) {
  const node = event.target.closest("[data-point]");
  if (!node) {
    $("chartTooltip").hidden = true;
    return;
  }
  const p = chartPoints[Number(node.dataset.point)];
  const chartCandidates = candidates(state.result);
  $("chartTooltip").textContent =
    `${date(new Date(p.at))} · ${chartCandidates.flavio.name} ${pct(p.left)} · ${chartCandidates.lula.name} ${pct(p.right)}`;
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
  resetEventContext();
  state.mainScope = main;
  if (main === "estados") state.uf = value || state.uf;
  if (main === "exterior") state.exterior = value || state.exterior;
  state.scope =
    main === "brasil"
      ? "brasil"
      : main === "estados"
        ? `estado:${state.uf}`
        : state.exterior;
  renderWorldMap();
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
    if (state.mode === "complete" && (liveEnabled || !API_BASE_URL))
      refreshDetails();
  } finally {
    refreshing = false;
    if (refreshAgain) {
      refreshAgain = false;
      refresh();
    }
  }
}
async function refreshDetails() {
  if (snapshotBusy) return;
  snapshotBusy = true;
  snapshotController = new AbortController();
  const signal = snapshotController.signal,
    provider = state.provider,
    detailRevision = revision;
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
        initWorldMap();
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
    if (state.year !== 2026 || state.turn !== 2) {
      state.sourceComparisons = [];
      state.sourcesError = null;
      renderSourceComparison();
    } else if (Date.now() - state.lastSourceComparison > 30000) {
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
            if (provider === state.provider && detailRevision === revision) {
              state.exteriorResults.set(scope, data);
              renderWorldMap();
            }
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
            if (provider === state.provider && detailRevision === revision)
              state.snapshots.set(s.uf, data);
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
function syncCandidateOptions(result) {
  const list = Array.isArray(result.candidatos) ? result.candidatos : [];
  const sortByVotes = (items) => items.map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const av = Number.isSafeInteger(a.item.votos) && a.item.votos >= 0 ? a.item.votos : null;
      const bv = Number.isSafeInteger(b.item.votos) && b.item.votos >= 0 ? b.item.votos : null;
      return av === null ? (bv === null ? a.index - b.index : 1) : bv === null ? -1 : bv - av || a.index - b.index;
    }).map(({ item }) => item);
  const ranked = sortByVotes(list);
  const numbered = ranked.filter((c) => c.numero);
  if (!numbered.length) {
    for (const [id, index] of [
      ["leftCandidateSelect", 0],
      ["rightCandidateSelect", 1],
    ])
      $(id).innerHTML =
        `<option value="${state.pair[index]}">${index === 0 ? (state.year === 2022 ? "Jair Bolsonaro" : "Flávio Bolsonaro") : "Lula"}</option>`;
  }

  if (numbered.length) {
    for (const [id, index] of [
      ["leftCandidateSelect", 0],
      ["rightCandidateSelect", 1],
    ]) {
      const select = $(id);
      select.innerHTML = numbered
        .map(
          (c) =>
            `<option value="${e(c.numero)}">${e(c.candidato)} (${e(c.numero)})</option>`,
        )
        .join("");
      if (!numbered.some((c) => c.numero === state.pair[index]))
        state.pair[index] = numbered[index]?.numero || numbered[0].numero;
      select.value = state.pair[index];
    }
    setComparisonNumbers(state.pair);
  }
  $("allCandidates").innerHTML = list.length
    ? "<h2>Todos os candidatos · " +
      e(electionFor(state.year, state.turn).label) +
      '</h2><div class="candidate-table">' +
      ranked
        .map(
          (c, index) => {
            const portrait = portraitFor(c.numero, c.candidato);
            return `<button type="button" class="candidate-rank-row" data-candidate-profile="${e(c.numero)}" aria-label="Abrir perfil de ${e(c.candidato)}">${portrait ? `<img src="${portrait}" alt="" loading="lazy" width="32" height="42">` : `<span class="candidate-rank-placeholder" aria-label="Retrato indisponível">—</span>`}<b class="candidate-rank">${index + 1}º</b><strong>${e(c.candidato)}</strong><span>${e(c.partido || "")} · ${e(c.numero || "")}</span><b style="color:${candidateColor(c.numero, state.year)}">${e(pct(c.percentual))}</b><span>${e(int(c.votos))} votos</span></button>`;
          },
        )
        .join("") +
      "</div>"
    : "";
  $("allCandidates").hidden = !list.length;
  $("dataMode").textContent =
    electionFor(state.year, state.turn).label +
    " · " +
    (API_BASE_URL
      ? "Backend configurado · tela a cada 3 s"
      : liveEnabled && state.year === 2026
        ? "TSE ao vivo quando disponível · fonte a cada 60 s"
        : "Dados publicados do site");
}
function openCandidateProfile(number) {
  const candidate = (state.result?.candidatos || []).find((c) => String(c.numero) === String(number));
  if (!candidate) return;
  const dialog = $("candidateDialog"), image = portraitFor(candidate.numero, candidate.candidato);
  const accent = candidateColor(candidate.numero, state.year);
  const orderedStates = [...state.snapshots.entries()].map(([uf, payload]) => {
    const ufInfo = STATES.find((entry) => entry.uf === uf);
    const entries = (payload?.candidatos || []).filter((item) => Number.isSafeInteger(item.votos) && item.votos >= 0);
    const own = entries.find((item) => String(item.numero) === String(number));
    const leader = entries.slice().sort((a, b) => b.votos - a.votos)[0];
    return own && ufInfo ? { uf, name: ufInfo.name, item: own, leader, source: payload.provider } : null;
  }).filter(Boolean).sort((a, b) => b.item.votos - a.item.votos);
  const states = orderedStates.length
    ? `<div class="candidate-state-grid">${orderedStates.map((entry) => {
      const isLeader = String(entry.leader?.numero) === String(number);
      return `<div class="candidate-state ${isLeader ? "is-leader" : ""}" style="--candidate-accent:${accent}" title="${e(entry.name)} · ${e(int(entry.item.votos))} votos"><b>${e(entry.uf.toUpperCase())}</b><span>${e(pct(entry.item.percentual))}</span><small>${e(int(entry.item.votos))} votos</small></div>`;
    }).join("")}</div><p class="candidate-dialog-note">Estados destacados: ${orderedStates.filter((entry) => String(entry.leader?.numero) === String(number)).length} de ${orderedStates.length} com dados válidos. Dados ausentes não são estimados.</p>`
    : `<div class="empty-state"><h3>Estados sem dados disponíveis</h3><p>Esta eleição ou fonte não publicou detalhamento estadual verificável para este candidato.</p></div>`;
  const rank = (state.result?.candidatos || []).filter((item) => Number.isSafeInteger(item.votos)).sort((a,b) => b.votos - a.votos).findIndex((item) => String(item.numero) === String(number)) + 1;
  $("candidateDialogContent").innerHTML = `<div class="candidate-profile-hero" style="--candidate-accent:${accent}">${image ? `<img src="${image}" alt="Retrato fotográfico de ${e(candidate.candidato)}">` : '<div class="profile-no-image">Retrato indisponível</div>'}<div><p class="eyebrow">PERFIL DO CANDIDATO · ${state.year} · ${state.turn}º TURNO</p><h2 id="candidateDialogName">${e(candidate.candidato)}</h2><p>${e(candidate.partido || "Partido não informado")} · número ${e(candidate.numero)}</p><strong class="candidate-profile-pct">${e(pct(candidate.percentual))}</strong><p class="candidate-profile-votes">${e(int(candidate.votos))} votos · ${rank > 0 ? `${rank}º lugar no Brasil` : "posição indisponível"}</p><p>${e(scopeLabel())} · ${e(providerName(state.result.provider))} · fonte às ${e(date(state.result.updatedAt))}</p></div></div><section class="candidate-profile-states"><div class="card-heading"><div><p class="eyebrow">DISTRIBUIÇÃO TERRITORIAL</p><h3>Resultados por estado</h3></div><span class="small-tag">${orderedStates.length}/27 UFs</span></div>${states}</section>`;
  if (!dialog.open) dialog.showModal();
}
function changeElection() {
  resetEventContext();
  state.year = Number($("yearSelect").value);
  state.turn = Number($("turnSelect").value);
  state.pair = ["22", "13"];
  setComparisonNumbers(state.pair);
  revision++;
  controller?.abort();
  snapshotController?.abort();
  state.snapshots.clear();
  state.exteriorResults.clear();
  state.sourceComparisons = [];
  state.locations = [];
  initWorldMap();
  state.updates = [];
  state.lastSnapshot =
    state.lastExterior =
    state.lastLocations =
    state.lastSourceComparison =
      0;
  renderMap();
  renderRegions();
  renderExterior();
  renderHistory(null);
  $("allCandidates").hidden = true;
  document.querySelector(".page-heading .eyebrow").textContent =
    `ELEIÇÕES ${state.year} / PRESIDENTE · ${state.turn}º TURNO`;
  renderResult(unavailable("Consultando a eleição selecionada…"));
  refresh();
}
$("yearSelect").addEventListener("change", changeElection);
$("turnSelect").addEventListener("change", changeElection);
for (const [id, index] of [
  ["leftCandidateSelect", 0],
  ["rightCandidateSelect", 1],
])
  $(id).addEventListener("change", () => {
    resetEventContext();
    const value = $(id).value;
    const other = 1 - index;
    if (state.pair[other] === value) state.pair[other] = state.pair[index];
    state.pair[index] = value;
    setComparisonNumbers(state.pair);
    if (state.result) renderResult(state.result);
    renderMap();
    renderRegions();
    renderExterior();
    renderHistory(state.history);
  });
$("apiUrlInput").value = API_BASE_URL || "";
function configureAPI(value) {
  try {
    if (value) {
      const url = new URL(value);
      if (
        !["https:", "http:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw new Error("Use uma URL HTTP(S) sem credenciais.");
      if (location.protocol === "https:" && url.protocol !== "https:")
        throw new Error("Este site requer backend HTTPS.");
      value = url.href.replace(/\/+$/, "");
    }
    API_BASE_URL = value || null;
    if (!API_BASE_URL) {
      liveEnabled = false;
      $("liveUpdatesToggle").checked = false;
      state.provider = "auto";
      $("providerSelect").value = "auto";
    }
    try {
      if (value) localStorage.setItem("voto-api-url", value);
      else localStorage.setItem("voto-api-url", "published");
    } catch (error) {
      $("apiConfigStatus").textContent =
        "Conexão aplicada somente nesta sessão.";
    }
    $("apiConfigStatus").textContent = value
      ? "Conexão salva neste navegador."
      : "Usando os dados publicados junto com o site.";
    $("apiUrlInput").value = value || "";
    changeElection();
  } catch (error) {
    $("apiConfigStatus").textContent = error.message;
  }
}
$("apiConfigForm").addEventListener("submit", (event) => {
  event.preventDefault();
  configureAPI($("apiUrlInput").value.trim());
});
$("usePublishedBtn").addEventListener("click", () => configureAPI(""));
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
  resetEventContext();
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
  state.provider = provider === "historical-archive" ? "auto" : provider;
  $("providerSelect").value = state.provider;
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
$("worldMap").addEventListener("click", chooseWorldCountry);
$("worldMap").addEventListener("keydown", (event) => {
  if (["Enter", " "].includes(event.key) && event.target.matches("[data-country-code]")) {
    event.preventDefault();
    chooseWorldCountry(event);
  }
});
$("allCandidates").addEventListener("click", (event) => {
  const number = event.target.closest("[data-candidate-profile]")?.dataset.candidateProfile;
  if (number) openCandidateProfile(number);
});
$("candidateDialog").querySelector(".dialog-close").addEventListener("click", () => $("candidateDialog").close());
$("candidateDialog").addEventListener("click", (event) => {
  if (event.target === $("candidateDialog")) $("candidateDialog").close();
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
const eventTracker = createEventTracker();
const eventDisplay = createEventDisplay({
  overlay: $("electionEvent"),
  soundButton: $("soundToggle"),
  soundStatus: $("soundStatus"),
  app: $("app"),
});
function resetEventContext() {
  eventTracker.reset();
  eventDisplay.dismiss();
}
$("liveUpdatesToggle").checked = liveEnabled;
$("liveUpdatesToggle").addEventListener("change", () => {
  liveEnabled = $("liveUpdatesToggle").checked;
  try {
    localStorage.setItem("voto-live-enabled", liveEnabled ? "on" : "off");
    if (liveEnabled && localStorage.getItem("voto-api-url") === "published")
      localStorage.removeItem("voto-api-url");
  } catch (error) {
    $("liveStatus").textContent = "Preferência aplicada somente nesta sessão.";
  }
  resetEventContext();
  revision++;
  controller?.abort();
  snapshotController?.abort();
  refresh();
});
$("imageCredits").href = new URL("./images/credits.html", import.meta.url).href;
initMap();
initWorldMap();
syncControls();
renderRegions();
renderExterior();
renderHistory(null);
renderResult(unavailable("Conectando à API…"));
refresh();
setInterval(() => {
  if (!document.hidden && (liveEnabled || !API_BASE_URL)) refresh();
}, 3000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && (liveEnabled || !API_BASE_URL)) refresh();
  else {
    controller?.abort();
    snapshotController?.abort();
  }
});
