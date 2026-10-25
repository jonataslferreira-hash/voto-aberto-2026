const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '') || null;

const UF_META = [
  ['ac', 'Acre', 'Norte', 40, 244],
  ['al', 'Alagoas', 'Nordeste', 432, 210],
  ['am', 'Amazonas', 'Norte', 102, 150],
  ['ap', 'Amapá', 'Norte', 193, 96],
  ['ba', 'Bahia', 'Nordeste', 376, 184],
  ['ce', 'Ceará', 'Nordeste', 410, 150],
  ['df', 'Distrito Federal', 'Centro-Oeste', 296, 176],
  ['es', 'Espírito Santo', 'Sudeste', 380, 242],
  ['go', 'Goiás', 'Centro-Oeste', 276, 210],
  ['ma', 'Maranhão', 'Nordeste', 334, 130],
  ['mg', 'Minas Gerais', 'Sudeste', 336, 222],
  ['ms', 'Mato Grosso do Sul', 'Centro-Oeste', 222, 214],
  ['mt', 'Mato Grosso', 'Centro-Oeste', 224, 168],
  ['pa', 'Pará', 'Norte', 224, 124],
  ['pb', 'Paraíba', 'Nordeste', 430, 170],
  ['pe', 'Pernambuco', 'Nordeste', 408, 186],
  ['pi', 'Piauí', 'Nordeste', 366, 148],
  ['pr', 'Paraná', 'Sul', 286, 262],
  ['rj', 'Rio de Janeiro', 'Sudeste', 360, 264],
  ['rn', 'Rio Grande do Norte', 'Nordeste', 446, 160],
  ['ro', 'Rondônia', 'Norte', 140, 226],
  ['rr', 'Roraima', 'Norte', 144, 88],
  ['rs', 'Rio Grande do Sul', 'Sul', 270, 302],
  ['sc', 'Santa Catarina', 'Sul', 288, 286],
  ['se', 'Sergipe', 'Nordeste', 414, 212],
  ['sp', 'São Paulo', 'Sudeste', 326, 276],
  ['to', 'Tocantins', 'Norte', 272, 156]
].map(([uf, nome, regiao, x, y]) => ({ uf, nome, regiao, x, y }));

const REGION_ORDER = ['Norte', 'Nordeste', 'Centro-Oeste', 'Sudeste', 'Sul'];

const state = {
  provider: 'auto',
  mode: 'simple',
  window: '1h',
  mainScope: 'brasil',
  scopeRaw: 'brasil',
  selectedState: 'sp',
  selectedExterior: 'exterior-geral',
  exteriorTab: 'geral',
  refreshInFlight: false,
  pendingRefresh: false,
  stateSnapshots: new Map(),
  lastStateSnapshotAt: 0,
  updates: [],
  exteriorLocations: []
};

const els = {
  app: document.querySelector('#app'),
  sourceMeta: document.querySelector('#sourceMeta'),
  heroTotals: document.querySelector('#heroTotals'),
  heroBar: document.querySelector('#heroBar'),
  heroBadges: document.querySelector('#heroBadges'),
  providerSelect: document.querySelector('#providerSelect'),
  modeSelect: document.querySelector('#modeSelect'),
  windowSelect: document.querySelector('#windowSelect'),
  stateSelect: document.querySelector('#stateSelect'),
  exteriorSelect: document.querySelector('#exteriorSelect'),
  stateFilterWrap: document.querySelector('#stateFilterWrap'),
  exteriorFilterWrap: document.querySelector('#exteriorFilterWrap'),
  cardApuracao: document.querySelector('#cardApuracao'),
  cardCandidatos: document.querySelector('#cardCandidatos'),
  cardDiferenca: document.querySelector('#cardDiferenca'),
  cardRegioes: document.querySelector('#cardRegioes'),
  cardUpdates: document.querySelector('#cardUpdates'),
  exteriorContent: document.querySelector('#exteriorContent'),
  chart: document.querySelector('#historyChart'),
  map: document.querySelector('#brazilMap'),
  mapLegend: document.querySelector('#mapLegend')
};

const MAIN_SCOPE_BUTTONS = Array.from(document.querySelectorAll('[data-main-scope]'));
const EXTERIOR_TAB_BUTTONS = Array.from(document.querySelectorAll('[data-exterior-tab]'));

const POLL_INTERVAL_MS = 3000;
const SNAPSHOT_REFRESH_MS = 45000;
let pollTimer = null;
let activeAbortController = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatInt(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return Number(value).toLocaleString('pt-BR');
}

function formatPct(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return `${Number(value).toFixed(2)}%`;
}

function formatDate(value) {
  if (!value) return 'não informado';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(String(value));
  return date.toLocaleString('pt-BR');
}

function toStatusLabel(status) {
  if (status === 'totalized') return 'Totalizado';
  if (status === 'partial') return 'Parcial';
  return 'Aguardando apuração';
}

function appendUpdate(kind, detail) {
  state.updates.unshift({
    at: new Date().toISOString(),
    kind,
    detail
  });
  state.updates = state.updates.slice(0, 10);
}

function buildApiUrl(pathname, query = {}) {
  if (!API_BASE_URL) return null;
  const url = new URL(`${API_BASE_URL}${pathname}`);
  for (const [k, v] of Object.entries(query)) {
    if (v !== null && v !== undefined && v !== '') url.searchParams.set(k, v);
  }
  return url.toString();
}

async function getJSON(pathname, query = {}, signal) {
  const url = buildApiUrl(pathname, query);
  if (!url) throw new Error('API_BASE_URL_NOT_CONFIGURED');
  const response = await fetch(url, { signal });
  const isJson = response.headers.get('content-type')?.includes('application/json');
  if (!response.ok) {
    let message = `Falha ${response.status}`;
    if (isJson) {
      try {
        const payload = await response.json();
        if (payload?.error) message = payload.error;
      } catch {
        // no-op
      }
    }
    throw new Error(message);
  }
  return response.json();
}

function inferCandidates(payload) {
  const base = Array.isArray(payload?.candidatos) ? payload.candidatos : [];
  const empty = { candidato: null, votos: null, percentual: null };

  const flavio = base.find((c) => /fl[aá]vio/i.test(c.candidato || '')) || empty;
  const lula = base.find((c) => /lula/i.test(c.candidato || '')) || empty;

  return {
    flavio: {
      name: flavio.candidato || 'Flávio Bolsonaro',
      votes: flavio.votos ?? null,
      pct: flavio.percentual ?? null
    },
    lula: {
      name: lula.candidato || 'Luiz Inácio Lula da Silva',
      votes: lula.votos ?? null,
      pct: lula.percentual ?? null
    }
  };
}

function getScopeLabel() {
  if (state.mainScope === 'brasil') return 'Brasil';
  if (state.mainScope === 'estados') {
    const item = UF_META.find((uf) => uf.uf === state.selectedState);
    return item ? `${item.nome} (${item.uf.toUpperCase()})` : 'Estado';
  }
  if (state.mainScope === 'exterior') {
    if (state.selectedExterior === 'exterior-geral') return 'Exterior (geral)';
    const opt = state.exteriorLocations.find((x) => x.value === state.selectedExterior);
    return opt ? opt.label : 'Exterior';
  }
  return 'Brasil';
}

function computeGradient(flavioPct, lulaPct) {
  const hasPercent = Number.isFinite(Number(flavioPct)) && Number.isFinite(Number(lulaPct));
  if (!hasPercent) {
    els.app.style.setProperty('--split', '50%');
    els.app.dataset.gradient = 'neutral';
    return;
  }
  const blue = Math.max(0, Math.min(100, Number(flavioPct)));
  els.app.style.setProperty('--split', `${blue}%`);
  els.app.dataset.gradient = blue === 50 ? 'neutral' : blue > 50 ? 'blue' : 'red';
}

function computeBadges(result, flavio, lula) {
  const badges = [];
  const done = Number(result?.secoesApuradas);
  const total = Number(result?.secoesTotais);
  const ratio = Number.isFinite(done) && Number.isFinite(total) && total > 0 ? done / total : null;
  const diffPct = Number.isFinite(flavio.pct) && Number.isFinite(lula.pct) ? Math.abs(flavio.pct - lula.pct) : null;

  if (result?.status === 'totalized' && Number.isFinite(flavio.votes) && Number.isFinite(lula.votes)) {
    const winner = flavio.votes >= lula.votes ? flavio.name : lula.name;
    badges.push({ type: 'official', text: `${winner}: Matematicamente eleito (resultado oficial totalizado).` });
    return badges;
  }

  if (result?.status === 'partial' && ratio !== null && ratio >= 0.9 && diffPct !== null && diffPct >= 5) {
    const leader = (Number(flavio.votes) || 0) >= (Number(lula.votes) || 0) ? flavio.name : lula.name;
    badges.push({ type: 'informative', text: `Vantagem consolidada (${leader}) — cálculo informativo do painel.` });
  }

  return badges;
}

function renderSource(result) {
  const warning = result?.consolidationWarning ? `<p class="warning">${escapeHtml(result.consolidationWarning)}</p>` : '';
  const sourceUrl = result?.sourceUrl || '';
  const safeUrl = /^https?:\/\//.test(sourceUrl) ? sourceUrl : '';
  const sourceLink = safeUrl
    ? `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noreferrer">${escapeHtml(safeUrl)}</a>`
    : 'não informado';

  els.sourceMeta.innerHTML = `
    <div class="hero__kpi"><span>Fonte</span><strong>${escapeHtml(result?.displaySource || 'Dados indisponíveis')}</strong></div>
    <div class="hero__kpi"><span>Provedor</span><strong>${escapeHtml(result?.providerLabel || 'Indisponível')}</strong></div>
    <div class="hero__kpi"><span>Status</span><strong>${escapeHtml(toStatusLabel(result?.status))}</strong></div>
    <div class="hero__kpi"><span>Localidade</span><strong>${escapeHtml(getScopeLabel())}</strong></div>
    <div class="hero__kpi"><span>Última atualização</span><strong>${escapeHtml(formatDate(result?.updatedAt))}</strong></div>
    <div class="hero__kpi"><span>Coletado em</span><strong>${escapeHtml(formatDate(result?.retrievedAt))}</strong></div>
    <div class="hero__source-url"><span>URL da origem:</span> ${sourceLink}</div>
    ${warning}
  `;
}

function renderHero(result, flavio, lula) {
  els.heroTotals.innerHTML = `
    <article class="candidate candidate--blue">
      <h2>${escapeHtml(flavio.name)}</h2>
      <p class="candidate__votes">${escapeHtml(formatInt(flavio.votes))}</p>
      <p class="candidate__label">votos</p>
      <p class="candidate__pct">${escapeHtml(formatPct(flavio.pct))}</p>
    </article>

    <article class="candidate candidate--red">
      <h2>${escapeHtml(lula.name)}</h2>
      <p class="candidate__votes">${escapeHtml(formatInt(lula.votes))}</p>
      <p class="candidate__label">votos</p>
      <p class="candidate__pct">${escapeHtml(formatPct(lula.pct))}</p>
    </article>
  `;

  const splitBlue = Number.isFinite(Number(flavio.pct)) ? Math.max(0, Math.min(100, Number(flavio.pct))) : 50;
  const splitRed = Number.isFinite(Number(lula.pct)) ? Math.max(0, Math.min(100, Number(lula.pct))) : 50;
  const hasLive = Number.isFinite(Number(flavio.pct)) && Number.isFinite(Number(lula.pct));

  els.heroBar.innerHTML = `
    <div class="hero__bar-track">
      <span class="hero__bar-fill hero__bar-fill--blue" style="width:${splitBlue}%"></span>
      <span class="hero__bar-fill hero__bar-fill--red" style="width:${splitRed}%"></span>
    </div>
    <div class="hero__bar-legend">
      <span>Flávio ${escapeHtml(formatPct(flavio.pct))}</span>
      <span>Lula ${escapeHtml(formatPct(lula.pct))}</span>
    </div>
    ${hasLive ? '' : '<p class="warning">Sem percentuais válidos para gradiente local. Exibindo tema neutro.</p>'}
  `;

  const badges = computeBadges(result, flavio, lula);
  els.heroBadges.innerHTML = badges.length
    ? badges.map((badge) => `<span class="badge badge--${badge.type}">${escapeHtml(badge.text)}</span>`).join('')
    : '<span class="badge badge--muted">Sem gatilho estatístico verificável para etiqueta de vitória.</span>';
}

function renderCardApuracao(result) {
  els.cardApuracao.innerHTML = `
    <h2>Urnas apuradas e atualização</h2>
    <div class="list-kv">
      <p><span>Seções apuradas</span><strong>${escapeHtml(formatInt(result?.secoesApuradas))}</strong></p>
      <p><span>Seções totais</span><strong>${escapeHtml(formatInt(result?.secoesTotais))}</strong></p>
      <p><span>Votos válidos</span><strong>${escapeHtml(formatInt(result?.votosValidos))}</strong></p>
      <p><span>Status</span><strong>${escapeHtml(toStatusLabel(result?.status))}</strong></p>
      <p><span>Última atualização da fonte</span><strong>${escapeHtml(formatDate(result?.updatedAt))}</strong></p>
    </div>
  `;
}

function renderCardCandidatos(flavio, lula) {
  els.cardCandidatos.innerHTML = `
    <h2>Percentuais e votos</h2>
    <div class="mini-cards">
      <article class="mini mini--blue">
        <h3>${escapeHtml(flavio.name)}</h3>
        <p>${escapeHtml(formatInt(flavio.votes))} votos</p>
        <strong>${escapeHtml(formatPct(flavio.pct))}</strong>
      </article>
      <article class="mini mini--red">
        <h3>${escapeHtml(lula.name)}</h3>
        <p>${escapeHtml(formatInt(lula.votes))} votos</p>
        <strong>${escapeHtml(formatPct(lula.pct))}</strong>
      </article>
    </div>
  `;
}

function renderCardDiferenca(flavio, lula) {
  const diff = Number.isFinite(Number(flavio.votes)) && Number.isFinite(Number(lula.votes))
    ? Math.abs(Number(flavio.votes) - Number(lula.votes))
    : null;
  const leader = diff === null ? null : (Number(flavio.votes) >= Number(lula.votes) ? flavio.name : lula.name);

  els.cardDiferenca.innerHTML = `
    <h2>Diferença de votos</h2>
    <p class="delta">${escapeHtml(formatInt(diff))}</p>
    <p class="muted">${leader ? `Liderança atual: ${escapeHtml(leader)}` : 'Dados insuficientes para calcular diferença.'}</p>
  `;
}

function aggregateRegions() {
  const totals = new Map(REGION_ORDER.map((r) => [r, { flavio: 0, lula: 0, states: 0 }]));

  for (const uf of UF_META) {
    const payload = state.stateSnapshots.get(uf.uf);
    if (!payload || payload.sourceKind === 'unavailable') continue;
    const { flavio, lula } = inferCandidates(payload);
    if (!Number.isFinite(Number(flavio.votes)) || !Number.isFinite(Number(lula.votes))) continue;
    const entry = totals.get(uf.regiao);
    entry.flavio += Number(flavio.votes);
    entry.lula += Number(lula.votes);
    entry.states += 1;
  }

  return totals;
}

function renderCardRegioes() {
  const totals = aggregateRegions();
  const lines = [];

  for (const region of REGION_ORDER) {
    const row = totals.get(region);
    if (!row || row.states === 0) {
      lines.push(`<p><span>${escapeHtml(region)}</span><strong>Dados indisponíveis</strong></p>`);
      continue;
    }
    const totalVotes = row.flavio + row.lula;
    const fPct = totalVotes > 0 ? (row.flavio * 100) / totalVotes : null;
    const leader = row.flavio >= row.lula ? 'Flávio' : 'Lula';
    lines.push(`<p><span>${escapeHtml(region)} (${row.states} UFs)</span><strong>${escapeHtml(leader)} ${escapeHtml(formatPct(fPct))}</strong></p>`);
  }

  els.cardRegioes.innerHTML = `
    <h2>Resultados por região</h2>
    <div class="list-kv ${lines.length ? '' : 'is-empty'}">
      ${lines.length ? lines.join('') : '<p>Nenhum resultado regional disponível.</p>'}
    </div>
  `;
}

function renderUpdatesCard() {
  els.cardUpdates.innerHTML = `
    <h2>Últimas atualizações</h2>
    <ul class="updates">
      ${state.updates.length
        ? state.updates.map((item) => `
          <li>
            <time>${escapeHtml(formatDate(item.at))}</time>
            <strong>${escapeHtml(item.kind)}</strong>
            <span>${escapeHtml(item.detail)}</span>
          </li>
        `).join('')
        : '<li><span>Nenhuma atualização registrada.</span></li>'}
    </ul>
  `;
}

function renderExteriorCard(result) {
  const locations = state.exteriorLocations;
  const filtered = locations.filter((item) => {
    if (state.exteriorTab === 'geral') return item.value === 'exterior-geral';
    if (state.exteriorTab === 'pais') return item.type === 'country';
    return item.type === 'city';
  });

  const available = filtered.length
    ? filtered
    : [{ label: 'Sem opções retornadas pelo backend para esta aba.', value: 'none', type: 'none' }];

  const active = locations.find((x) => x.value === state.selectedExterior);
  const title = state.exteriorTab === 'geral' ? 'Geral' : state.exteriorTab === 'pais' ? 'Por país' : 'Por cidade';
  const source = result?.sourceKind === 'unavailable'
    ? 'Dados indisponíveis no provedor selecionado.'
    : `Exibindo resultados do escopo: ${getScopeLabel()}.`;

  els.exteriorContent.innerHTML = `
    <h2>Votos no exterior · ${escapeHtml(title)}</h2>
    <p class="muted">${escapeHtml(source)}</p>
    <p class="muted">${active ? `Seleção atual: ${active.label}` : 'Selecione um local do exterior quando disponível.'}</p>
    <div class="chips">
      ${available.map((item) => `<button type="button" class="chip ${item.value === state.selectedExterior ? 'is-active' : ''}" data-exterior-scope="${escapeHtml(item.value)}" ${item.value === 'none' ? 'disabled' : ''}>${escapeHtml(item.label)}</button>`).join('')}
    </div>
  `;

  document.querySelectorAll('[data-exterior-scope]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const value = btn.getAttribute('data-exterior-scope');
      if (!value || value === 'none') return;
      state.selectedExterior = value;
      els.exteriorSelect.value = value;
      state.mainScope = 'exterior';
      state.scopeRaw = value;
      syncScopeControls();
      queueRefresh();
    });
  });
}

function drawMap() {
  const selected = state.mainScope === 'estados' ? state.selectedState : null;
  els.map.innerHTML = UF_META.map((item) => {
    const payload = state.stateSnapshots.get(item.uf);
    const { flavio, lula } = inferCandidates(payload || {});
    const hasData = payload && payload.sourceKind !== 'unavailable' && Number.isFinite(Number(flavio.votes)) && Number.isFinite(Number(lula.votes));
    const winnerClass = !hasData ? 'unknown' : Number(flavio.votes) >= Number(lula.votes) ? 'blue' : 'red';

    return `
      <g class="map-state ${winnerClass} ${selected === item.uf ? 'is-selected' : ''}" data-uf="${item.uf}" tabindex="0" role="button" aria-label="Selecionar ${escapeHtml(item.nome)}">
        <rect x="${item.x}" y="${item.y}" width="46" height="32" rx="8"></rect>
        <text x="${item.x + 23}" y="${item.y + 20}" text-anchor="middle">${item.uf.toUpperCase()}</text>
      </g>
    `;
  }).join('');

  els.mapLegend.innerHTML = `
    <span><i class="dot dot--blue"></i> Flávio na frente</span>
    <span><i class="dot dot--red"></i> Lula na frente</span>
    <span><i class="dot dot--neutral"></i> Sem dados</span>
  `;

  els.map.querySelectorAll('.map-state').forEach((node) => {
    node.addEventListener('click', () => {
      const uf = node.getAttribute('data-uf');
      if (!uf) return;
      state.mainScope = 'estados';
      state.selectedState = uf;
      state.scopeRaw = `estado:${uf}`;
      els.stateSelect.value = uf;
      syncScopeControls();
      queueRefresh();
    });

    node.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      node.click();
    });
  });
}

function renderHistory(points) {
  const width = 680;
  const height = 260;
  const margin = { top: 14, right: 18, bottom: 28, left: 40 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const parsed = Array.isArray(points)
    ? points.map((point) => ({
      at: Date.parse(point.at),
      lula: Number.isFinite(Number(point.lulaPercent)) ? Number(point.lulaPercent) : null,
      flavio: Number.isFinite(Number(point.flavioPercent)) ? Number(point.flavioPercent) : null
    })).filter((point) => Number.isFinite(point.at))
    : [];

  if (!parsed.length) {
    els.chart.innerHTML = '<text x="50%" y="50%" text-anchor="middle" class="chart-empty">Sem histórico disponível para a janela selecionada.</text>';
    return;
  }

  const minTs = Math.min(...parsed.map((p) => p.at));
  const maxTs = Math.max(...parsed.map((p) => p.at));
  const safeMax = maxTs === minTs ? minTs + 1 : maxTs;

  const scaleX = (value) => margin.left + ((value - minTs) / (safeMax - minTs)) * innerW;
  const scaleY = (value) => margin.top + innerH - (value / 100) * innerH;

  const toPath = (key) => {
    let d = '';
    let open = false;
    for (const point of parsed) {
      const value = point[key];
      if (value === null) {
        open = false;
        continue;
      }
      const x = scaleX(point.at);
      const y = scaleY(value);
      d += `${open ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)} `;
      open = true;
    }
    return d.trim();
  };

  const ticksY = [0, 25, 50, 75, 100];
  const ticksX = [0, 0.25, 0.5, 0.75, 1].map((ratio) => minTs + (safeMax - minTs) * ratio);

  els.chart.innerHTML = `
    <g class="chart-grid">
      ${ticksY.map((v) => `<line x1="${margin.left}" y1="${scaleY(v)}" x2="${margin.left + innerW}" y2="${scaleY(v)}"></line>`).join('')}
    </g>
    <g class="chart-axis">
      ${ticksY.map((v) => `<text x="8" y="${scaleY(v) + 4}">${v}%</text>`).join('')}
      ${ticksX.map((ts) => `<text x="${scaleX(ts)}" y="${height - 6}" text-anchor="middle">${new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</text>`).join('')}
    </g>
    <path class="line line--blue" d="${toPath('flavio')}"></path>
    <path class="line line--red" d="${toPath('lula')}"></path>
  `;
}

function renderUnavailable(message) {
  const payload = {
    displaySource: 'Dados indisponíveis',
    providerLabel: API_BASE_URL ? 'Backend/proxy inacessível' : 'Backend/proxy externo não configurado',
    sourceKind: 'unavailable',
    status: 'not-started',
    updatedAt: null,
    retrievedAt: new Date().toISOString(),
    sourceUrl: API_BASE_URL || 'não configurado',
    votosValidos: null,
    secoesApuradas: null,
    secoesTotais: null,
    consolidationWarning: message,
    candidatos: [
      { candidato: 'Flávio Bolsonaro', votos: null, percentual: null },
      { candidato: 'Luiz Inácio Lula da Silva', votos: null, percentual: null }
    ]
  };

  const { flavio, lula } = inferCandidates(payload);
  computeGradient(null, null);
  renderSource(payload);
  renderHero(payload, flavio, lula);
  renderCardApuracao(payload);
  renderCardCandidatos(flavio, lula);
  renderCardDiferenca(flavio, lula);
  renderCardRegioes();
  renderExteriorCard(payload);
  renderUpdatesCard();
  drawMap();
  renderHistory([]);
}

async function updateStateSnapshots(signal) {
  if (!API_BASE_URL) return;
  if (Date.now() - state.lastStateSnapshotAt < SNAPSHOT_REFRESH_MS) return;

  const chunks = [];
  const clone = [...UF_META];
  while (clone.length) chunks.push(clone.splice(0, 6));

  for (const chunk of chunks) {
    const tasks = chunk.map(async (item) => {
      try {
        const payload = await getJSON('/api/results', {
          scope: `estado:${item.uf}`,
          provider: state.provider
        }, signal);
        state.stateSnapshots.set(item.uf, payload);
      } catch {
        state.stateSnapshots.set(item.uf, { sourceKind: 'unavailable', candidatos: [] });
      }
    });
    await Promise.all(tasks);
  }

  state.lastStateSnapshotAt = Date.now();
  drawMap();
  renderCardRegioes();
}

async function fetchHistory(signal) {
  if (!API_BASE_URL) return [];
  try {
    const history = await getJSON('/api/history', {
      scope: state.scopeRaw,
      provider: state.provider,
      window: state.window
    }, signal);
    return Array.isArray(history.points) ? history.points : [];
  } catch {
    return [];
  }
}

async function refreshPanel() {
  if (state.refreshInFlight) {
    state.pendingRefresh = true;
    return;
  }

  if (!API_BASE_URL) {
    renderUnavailable('API indisponível no GitHub Pages: defina VITE_API_BASE_URL apontando para o backend/proxy externo.');
    return;
  }

  state.refreshInFlight = true;
  if (activeAbortController) activeAbortController.abort();
  activeAbortController = new AbortController();

  try {
    const [result, history] = await Promise.all([
      getJSON('/api/results', {
        scope: state.scopeRaw,
        provider: state.provider
      }, activeAbortController.signal),
      fetchHistory(activeAbortController.signal)
    ]);

    const { flavio, lula } = inferCandidates(result);

    computeGradient(flavio.pct, lula.pct);
    renderSource(result);
    renderHero(result, flavio, lula);
    renderCardApuracao(result);
    renderCardCandidatos(flavio, lula);
    renderCardDiferenca(flavio, lula);
    renderExteriorCard(result);
    renderHistory(history);
    appendUpdate('Atualização', `${getScopeLabel()} · ${result.providerLabel || result.provider || 'fonte'}`);
    renderUpdatesCard();

    if (state.mode === 'complete') {
      await updateStateSnapshots(activeAbortController.signal);
      drawMap();
      renderCardRegioes();
    }
  } catch (error) {
    appendUpdate('Erro', error.message || 'Falha desconhecida');
    renderUnavailable(`Erro específico de atualização: ${error.message || 'falha desconhecida'}`);
  } finally {
    state.refreshInFlight = false;
    if (state.pendingRefresh) {
      state.pendingRefresh = false;
      queueRefresh();
    }
  }
}

function queueRefresh() {
  refreshPanel();
}

function syncScopeControls() {
  MAIN_SCOPE_BUTTONS.forEach((button) => {
    button.classList.toggle('is-active', button.dataset.mainScope === state.mainScope);
  });

  els.stateFilterWrap.classList.toggle('is-hidden', state.mainScope !== 'estados');
  els.exteriorFilterWrap.classList.toggle('is-hidden', state.mainScope !== 'exterior');

  if (state.mainScope === 'brasil') {
    state.scopeRaw = 'brasil';
  }
  if (state.mainScope === 'estados') {
    state.scopeRaw = `estado:${state.selectedState}`;
  }
  if (state.mainScope === 'exterior') {
    state.scopeRaw = state.selectedExterior;
  }
}

function seedStateSelect() {
  els.stateSelect.innerHTML = UF_META
    .map((item) => `<option value="${item.uf}">${escapeHtml(item.nome)} (${item.uf.toUpperCase()})</option>`)
    .join('');
  els.stateSelect.value = state.selectedState;
}

async function loadExteriorLocations() {
  if (!API_BASE_URL) return;

  try {
    const payload = await getJSON('/api/locations', {}, undefined);
    const raw = Array.isArray(payload.locations) ? payload.locations : [];

    const normalized = [{ label: 'Geral (ZZ)', value: 'exterior-geral', type: 'general' }];
    for (const item of raw) {
      const type = item.tipo === 'country' ? 'country' : item.tipo === 'city' ? 'city' : 'other';
      const value = type === 'country' ? `exterior-pais:${item.id}` : `exterior-cidade:${item.id}`;
      const prefix = type === 'country' ? '🌐' : type === 'city' ? '📍' : '•';
      normalized.push({ label: `${prefix} ${item.nome}`, value, type });
    }

    state.exteriorLocations = normalized;
    els.exteriorSelect.innerHTML = normalized
      .map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`)
      .join('');
    els.exteriorSelect.value = state.selectedExterior;
  } catch (error) {
    state.exteriorLocations = [{ label: 'Geral (ZZ)', value: 'exterior-geral', type: 'general' }];
    appendUpdate('Aviso', `Falha ao carregar lista do exterior: ${error.message || 'indisponível'}`);
    renderUpdatesCard();
  }
}

function wireEvents() {
  MAIN_SCOPE_BUTTONS.forEach((button) => {
    button.addEventListener('click', () => {
      state.mainScope = button.dataset.mainScope;
      syncScopeControls();
      queueRefresh();
    });
  });

  EXTERIOR_TAB_BUTTONS.forEach((tab) => {
    tab.addEventListener('click', () => {
      EXTERIOR_TAB_BUTTONS.forEach((node) => node.classList.remove('is-active'));
      tab.classList.add('is-active');
      state.exteriorTab = tab.dataset.exteriorTab;
      renderExteriorCard({ sourceKind: 'unavailable' });
    });
  });

  els.providerSelect.addEventListener('change', () => {
    state.provider = els.providerSelect.value;
    state.lastStateSnapshotAt = 0;
    queueRefresh();
  });

  els.modeSelect.addEventListener('change', () => {
    state.mode = els.modeSelect.value;
    els.app.classList.toggle('mode-simple', state.mode === 'simple');
    els.app.classList.toggle('mode-complete', state.mode === 'complete');
    queueRefresh();
  });

  els.windowSelect.addEventListener('change', () => {
    state.window = els.windowSelect.value;
    queueRefresh();
  });

  els.stateSelect.addEventListener('change', () => {
    state.selectedState = els.stateSelect.value;
    state.mainScope = 'estados';
    syncScopeControls();
    queueRefresh();
  });

  els.exteriorSelect.addEventListener('change', () => {
    state.selectedExterior = els.exteriorSelect.value;
    state.mainScope = 'exterior';
    syncScopeControls();
    queueRefresh();
  });
}

function startPolling() {
  if (!API_BASE_URL) return;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    queueRefresh();
  }, POLL_INTERVAL_MS);
}

seedStateSelect();
wireEvents();
syncScopeControls();
renderUpdatesCard();
await loadExteriorLocations();
queueRefresh();
startPolling();
