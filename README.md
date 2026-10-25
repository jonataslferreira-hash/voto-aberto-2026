# voto-aberto-2026

Painel eleitoral premium (tema escuro) para acompanhar a apuração presidencial de 2026 com frontend estático no GitHub Pages e backend/proxy externo para dados reais.

## O que foi implementado

- Interface reconstruída para formato de dashboard de apuração:
  - topo com marca, navegação **Brasil / Estados / Exterior**, seletor **Simples / Completo** e controles de fonte;
  - hero central com candidatos, votos, percentuais, barra proporcional e badges condicionais;
  - cards de urnas/atualização, diferença de votos, resultados por região, mapa de estados, exterior por abas, últimas atualizações e histórico de linhas (1h/3h/total);
  - tema escuro premium com microinterações e transições suaves.
- Mobile-first e responsivo, sem overflow horizontal.
- Atualização automática sem reload (polling 3s), com proteção contra concorrência (`AbortController` + fila de refresh pendente).
- Gradiente global proporcional aos percentuais da localidade selecionada; fallback neutro quando não há percentuais válidos.
- Estado de indisponibilidade desenhado no próprio painel quando API externa não está configurada/indisponível (sem inventar votos).
- Renderização sanitizada para texto dinâmico vindo das fontes.

## Retratos e mapa

- **Retratos**: o repositório não contém imagens dos candidatos com origem/licença verificável. Por isso o painel mostra estado visual elegante de indisponibilidade, sem avatar genérico e sem foto sem origem documentada.
- **Mapa**: implementado como cartograma SVG clicável por UF (26 + DF), com legenda de liderança por estado baseada em dados reais quando disponíveis via backend. Estados sem retorno válido ficam como "Sem dados".

## Fontes e precedência

1. **TSE oficial** (`official-tse`) – autoridade final.
2. **Feed independente baseado no TSE** (`independent-tse-derived`) – `https://eleicoes2026brasil.com/feed/`.
3. **Placar do Voto** (`independent-tse-derived`) – `https://placardovoto.com/api/public/v1/`.

> O backend nunca mistura silenciosamente fontes diferentes na mesma totalização exibida.

## Limitação do GitHub Pages

GitHub Pages publica apenas o frontend estático (`dist/`). O backend/proxy Node (`src/server.mjs`) deve rodar separado (Render, Fly, Railway, Vercel Functions etc.).

Sem backend configurado, o painel exibe indisponibilidade explícita e preserva transparência sobre a origem.

## Configuração da API externa

Defina no build estático:

- `VITE_API_BASE_URL` → URL pública do backend/proxy (ex.: `https://seu-backend.exemplo.com`)

Endpoints esperados:

- `${VITE_API_BASE_URL}/api/results`
- `${VITE_API_BASE_URL}/api/history`
- `${VITE_API_BASE_URL}/api/locations`

## Execução local

```bash
npm install
npm start
# backend em http://localhost:3000

VITE_API_BASE_URL=http://localhost:3000 npm run dev:pages
```

## Build para GitHub Pages

```bash
VITE_API_BASE_URL=https://seu-backend.exemplo.com npm run build
npm run verify:pages
```

Artefatos obrigatórios:

- `dist/index.html`
- `dist/404.html`
- `dist/.nojekyll`

## Testes

```bash
npm test
VITE_API_BASE_URL=https://seu-backend.exemplo.com npm run build
npm run verify:pages
```

## Workflow de publicação

Arquivo: `.github/workflows/deploy-pages.yml`

Se o workflow falhar com erro de `actions/configure-pages` (`Not Found`), ative o Pages em:

1. `Settings` → `Pages`
2. `Build and deployment` → `Source: GitHub Actions`

URL final esperada:

`https://jonataslferreira-hash.github.io/voto-aberto-2026/`
