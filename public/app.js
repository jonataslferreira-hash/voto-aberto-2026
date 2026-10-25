const state = {
  provider: 'auto',
  scope: 'exterior-geral',
  window: '1h',
  mode: 'simple'
};

const app = document.querySelector('#app');
const modeBtn = document.querySelector('#modeBtn');
const providerSelect = document.querySelector('#providerSelect');
const scopeSelect = document.querySelector('#scopeSelect');
const windowSelect = document.querySelector('#windowSelect');

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

async function getJSON(url) {
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

  const blue = flavio.percentual ?? 50;
  const red = lula.percentual ?? 50;
  app.style.background = `linear-gradient(90deg, rgba(29,107,255,.55) ${blue}%, rgba(234,51,72,.55) ${blue}%)`;

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
  const svg = d3.select('#historyChart');
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

  const x = d3.scaleTime().domain(d3.extent(parsed, (d) => d.at)).range([0, innerW]);
  const y = d3.scaleLinear().domain([0, 100]).range([innerH, 0]);

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
  const mkLine = (key) => d3.line().defined((d) => d[key] !== null).x((d) => x(d.at)).y((d) => y(d[key]));

  g.append('path').datum(parsed).attr('fill', 'none').attr('stroke', '#ea3348').attr('stroke-width', 2).attr('d', mkLine('lula'));
  g.append('path').datum(parsed).attr('fill', 'none').attr('stroke', '#1d6bff').attr('stroke-width', 2).attr('d', mkLine('flavio'));

  g.append('g').attr('transform', `translate(0,${innerH})`).call(d3.axisBottom(x).ticks(5));
  g.append('g').call(d3.axisLeft(y).ticks(5));
}

async function refreshHistory() {
  const data = await getJSON(`/api/history?scope=${encodeURIComponent(state.scope)}&provider=${state.provider}&window=${state.window}`);
  renderHistory(data.points || []);
}

async function refresh() {
  try {
    const result = await getJSON(`/api/results?scope=${encodeURIComponent(state.scope)}&provider=${state.provider}`);
    renderResult(result);
    refreshHistory();
  } catch (error) {
    document.querySelector('#sourceBox').textContent = `Erro ao atualizar: ${error.message}`;
  }
}

async function loadLocations() {
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
setInterval(refresh, 3000);
