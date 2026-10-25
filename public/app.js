const state = {
  provider: 'auto',
  scope: 'exterior-geral',
  window: '1h',
  mode: 'simple'
};

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '') || null;

const app = document.querySelector('#app');
const modeBtn = document.querySelector('#modeBtn');
const providerSelect = document.querySelector('#providerSelect');
const scopeSelect = document.querySelector('#scopeSelect');
const windowSelect = document.querySelector('#windowSelect');
const d3Ref = window.d3;

providerSelect.onchange = () => {
  state.provider = providerSelect.value;
  refresh();
};
scopeSelect.onchange = () => {
  state.scope = scopeSelect.value;
  refresh();
};
windowSelect.onchange = () => {
  state.window = windowSelect.value;
  refreshHistory();
};
modeBtn.onclick = () => {
  state.mode = state.mode === 'simple' ? 'complete' : 'simple';
  app.classList.toggle('simple', state.mode === 'simple');
  modeBtn.textContent = state.mode === 'simple' ? 'Completo' : 'Simples';
};

function buildApiUrl(pathname, query = {}) {
  if (!API_BASE_URL) return null;
  const url = new URL(`${API_BASE_URL}${pathname}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && value !== undefined && value !== '') {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

async function getJSON(pathname, query = {}) {
  const url = buildApiUrl(pathname, query);
  if (!url) throw new Error('API_BASE_URL_NOT_CONFIGURED');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Falha ${response.status}`);
  return response.json();
}

function pct(value) {
  return value === null || value === undefined ? '—' : `${Number(value).toFixed(2)}%`;
}

function int(value) {
  if (value === null || value === undefined) return '—';
  return Number(value).toLocaleString('pt-BR');
}

function renderResult(data) {
  const flavio = data.candidatos.find((c) => /fl[aá]vio/i.test(c.candidato)) || { candidato: 'Flávio Bolsonaro', votos: null, percentual: null };
  const lula = data.candidatos.find((c) => /lula/i.test(c.candidato)) || { candidato: 'Luiz Inácio Lula da Silva', votos: null, percentual: null };

  document.querySelector('#candFlavio').innerHTML = `
    <h2>${flavio.candidato}</h2>
    <div class="votes">${int(flavio.votos)} votos</div>
    <div class="percent">${pct(flavio.percentual)}</div>
  `;

  document.querySelector('#candLula').innerHTML = `
    <h2>${lula.candidato}</h2>
    <div class="votes">${int(lula.votos)} votos</div>
    <div class="percent">${pct(lula.percentual)}</div>
  `;

  const hasValidPercentages = flavio.percentual !== null && flavio.percentual !== undefined && lula.percentual !== null && lula.percentual !== undefined;
  if (hasValidPercentages) {
    const blue = Number(flavio.percentual);
    app.style.background = `linear-gradient(90deg, rgba(29,107,255,.55) ${blue}%, rgba(234,51,72,.55) ${blue}%)`;
  } else {
    app.style.background = 'linear-gradient(90deg, rgba(106,118,142,.48) 50%, rgba(83,94,117,.48) 50%)';
  }

  document.querySelector('#sourceBox').innerHTML = `
    <strong>${data.displaySource}</strong><br/>
    Provedor: ${data.providerLabel}<br/>
    Status: ${data.status}<br/>
    Atualizado na fonte: ${data.updatedAt || 'não informado'}<br/>
    Coletado em: ${new Date(data.retrievedAt).toLocaleString('pt-BR')}<br/>
    URL: <a href="${data.sourceUrl}" target="_blank" rel="noreferrer">${data.sourceUrl || '—'}</a><br/>
    ${data.consolidationWarning ? `<em>${data.consolidationWarning}</em>` : ''}
  `;

  document.querySelector('#meta').innerHTML = `
    <div class="meta-grid">
      <div><strong>Votos válidos:</strong> ${int(data.votosValidos)}</div>
      <div><strong>Seções:</strong> ${int(data.secoesApuradas)} / ${int(data.secoesTotais)}</div>
      <div><strong>Escopo:</strong> ${state.scope}</div>
      <div><strong>Fonte misturada:</strong> Não</div>
    </div>
  `;
}

function renderHistory(points) {
  if (!d3Ref) return;
  const svg = d3Ref.select('#historyChart');
  svg.selectAll('*').remove();
  const width = svg.node().clientWidth || 800;
  const height = 260;
  const margin = { top: 16, right: 16, bottom: 24, left: 42 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  if (!points.length) return;

  const parsed = points.map((p) => ({
    at: new Date(p.at),
    lula: p.lulaPercent,
    flavio: p.flavioPercent
  }));

  const x = d3Ref.scaleTime().domain(d3Ref.extent(parsed, (d) => d.at)).range([0, innerW]);
  const y = d3Ref.scaleLinear().domain([0, 100]).range([innerH, 0]);

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
  const mkLine = (key) => d3Ref.line().defined((d) => d[key] !== null).x((d) => x(d.at)).y((d) => y(d[key]));

  g.append('path').datum(parsed).attr('fill', 'none').attr('stroke', '#ea3348').attr('stroke-width', 2).attr('d', mkLine('lula'));
  g.append('path').datum(parsed).attr('fill', 'none').attr('stroke', '#1d6bff').attr('stroke-width', 2).attr('d', mkLine('flavio'));

  g.append('g').attr('transform', `translate(0,${innerH})`).call(d3Ref.axisBottom(x).ticks(5));
  g.append('g').call(d3Ref.axisLeft(y).ticks(5));
}

async function refreshHistory() {
  if (!API_BASE_URL) return;
  const data = await getJSON('/api/history', {
    scope: state.scope,
    provider: state.provider,
    window: state.window
  });
  renderHistory(data.points || []);
}

function renderUnavailable(reason) {
  app.style.background = 'linear-gradient(90deg, rgba(106,118,142,.48) 50%, rgba(83,94,117,.48) 50%)';
  renderResult({
    candidatos: [
      { candidato: 'Flávio Bolsonaro', votos: null, percentual: null },
      { candidato: 'Luiz Inácio Lula da Silva', votos: null, percentual: null }
    ],
    displaySource: 'Dados indisponíveis',
    providerLabel: 'Backend/proxy externo não configurado',
    status: 'not-started',
    updatedAt: null,
    retrievedAt: new Date().toISOString(),
    sourceUrl: API_BASE_URL || 'não configurado',
    votosValidos: null,
    secoesApuradas: null,
    secoesTotais: null,
    consolidationWarning: reason
  });
}

async function refresh() {
  if (!API_BASE_URL) {
    renderUnavailable('API indisponível no GitHub Pages: defina VITE_API_BASE_URL apontando para o backend/proxy externo.');
    return;
  }
  try {
    const result = await getJSON('/api/results', {
      scope: state.scope,
      provider: state.provider
    });
    renderResult(result);
    refreshHistory();
  } catch (error) {
    document.querySelector('#sourceBox').textContent = `Erro ao atualizar: ${error.message}`;
  }
}

async function loadLocations() {
  if (!API_BASE_URL) return;
  try {
    const data = await getJSON('/api/locations');
    const highlights = new Set(data.highlights || []);
    for (const loc of data.locations || []) {
      const value = loc.tipo === 'country' ? `exterior-pais:${loc.id}` : `exterior-cidade:${loc.id}`;
      const option = document.createElement('option');
      option.value = value;
      option.textContent = highlights.has(loc.nome) ? `⭐ ${loc.nome}` : loc.nome;
      scopeSelect.append(option);
    }
  } catch {
    // mantém apenas opção geral
  }
}

await loadLocations();
await refresh();
if (API_BASE_URL) {
  setInterval(refresh, 3000);
}
