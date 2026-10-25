# voto-aberto-2026

Painel eleitoral em tempo real para acompanhamento da apuração presidencial de 2026, com frontend estático para GitHub Pages e backend/proxy externo para integração de dados reais.

## Arquitetura de fontes e precedência

1. **TSE oficial** (`official-tse`) – autoridade final.
2. **Feed independente baseado no TSE** (`independent-tse-derived`) – `https://eleicoes2026brasil.com/feed/`.
3. **Placar do Voto** (`independent-tse-derived`) – `https://placardovoto.com/api/public/v1/`.

> O backend nunca mistura silenciosamente fontes diferentes na mesma totalização exibida.

## Limitação importante do GitHub Pages

O GitHub Pages **não executa Node.js**.  
Portanto:

- o conteúdo publicado em Pages é apenas o frontend estático (`dist/`);
- o proxy/backend continua separado (Render/Fly/Railway/Vercel Functions etc.);
- sem backend configurado, a interface mostra indisponibilidade com explicação da fonte/status e **não inventa números**.

## Configuração da API externa

Defina a variável de ambiente abaixo no build estático:

- `VITE_API_BASE_URL` → URL pública do backend/proxy (ex.: `https://seu-backend.exemplo.com`)

O frontend chama:

- `${VITE_API_BASE_URL}/api/results`
- `${VITE_API_BASE_URL}/api/history`
- `${VITE_API_BASE_URL}/api/locations`

## Execução local

Instalação:

```bash
npm install
```

Executar backend/proxy local:

```bash
npm start
# http://localhost:3000
```

Executar frontend Pages local (Vite):

```bash
VITE_API_BASE_URL=http://localhost:3000 npm run dev:pages
```

## Build estático para GitHub Pages

```bash
VITE_API_BASE_URL=https://seu-backend.exemplo.com npm run build
```

O build gera:

- `dist/index.html`
- `dist/404.html` (fallback de navegação para carregamento direto de rota em Pages)
- `dist/.nojekyll`

## Testes e verificações

```bash
npm test
VITE_API_BASE_URL=https://seu-backend.exemplo.com npm run build
npm run verify:pages
```

As verificações cobrem:

- build de produção;
- paths de assets com `/voto-aberto-2026/`;
- fallback/artefatos obrigatórios de Pages (`404.html` e `.nojekyll`);
- contrato de indisponibilidade quando `VITE_API_BASE_URL` não está configurada.

## Publicação automática no GitHub Pages

Workflow: `.github/workflows/deploy-pages.yml`

- dispara em `push` na branch `main`;
- usa permissões mínimas:
  - `contents: read`
  - `pages: write`
  - `id-token: write`
- executa `npm ci`, testes, build e verificação do artefato;
- usa:
  - `actions/configure-pages@v5`
  - `actions/upload-pages-artifact@v3`
  - `actions/deploy-pages@v4`

URL esperada após publicação:  
`https://jonataslferreira-hash.github.io/voto-aberto-2026/`

## Ativação do GitHub Pages

Se necessário, habilite em:

1. `Settings` → `Pages`
2. `Build and deployment` → `Source: GitHub Actions`

## Backend/proxy (fora do GitHub Pages)

Arquivo: `src/server.mjs`

Endpoints:

- `GET /api/results?scope=&provider=`
- `GET /api/history?scope=&provider=&window=1h|3h|all`
- `GET /api/locations`

Recursos:

- timeout via `AbortController`;
- cache em memória por instância;
- suporte a `ETag`/`Last-Modified`;
- backoff para `429/503` com `Retry-After`;
- mensagens de erro específicas por provedor.
