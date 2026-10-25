# voto-aberto-2026

Painel eleitoral em tempo real para acompanhamento transparente da apuração presidencial brasileira de 2026, com prioridade para TSE e fallback explícito para fontes independentes verificadas.

## Arquitetura de fontes e precedência

1. **TSE oficial** (`official-tse`) – autoridade final.
2. **Feed independente baseado no TSE** (`independent-tse-derived`) – `https://eleicoes2026brasil.com/feed/`.
3. **Placar do Voto** (`independent-tse-derived`) – `https://placardovoto.com/api/public/v1/`.
4. **Boletins de urna parciais** (`bu-partial`) – reservado apenas se houver endpoint estruturado e rastreável; CNN é somente referência editorial e não é usada como API.

> O backend nunca mistura silenciosamente fontes diferentes na mesma totalização exibida.

## Modelo normalizado

Todos os provedores são convertidos para:

- `candidatos[]` (`candidato`, `votos`, `percentual`)
- `votosValidos`
- `secoesApuradas`, `secoesTotais`
- `status`: `not-started`, `partial`, `totalized`
- `updatedAt` (fonte), `retrievedAt` (backend)
- `provider`, `providerLabel`, `sourceUrl`, `sourceKind`
- `consolidationWarning`

Regras:

- indisponível **não vira zero**;
- números ausentes ficam `null`;
- sem estimativas inventadas.

## Backend/proxy

Arquivo: `src/server.mjs`

- endpoints:
  - `GET /api/results?scope=&provider=`
  - `GET /api/history?scope=&provider=&window=1h|3h|all`
  - `GET /api/locations`
- timeout via `AbortController`
- cache em memória (compatível com serverless por instância)
- suporte a `ETag`/`Last-Modified`
- backoff para `429/503` com `Retry-After`
- mensagens de erro específicas por provedor

## Frontend

Arquivos em `public/`.

- atualização visual a cada **3 segundos** (frontend -> backend)
- modo simples/completo
- tema escuro premium responsivo
- Flávio à esquerda (azul), Lula à direita (vermelho)
- gradiente proporcional apenas com dados válidos
- seleção exterior (geral/país/cidade) baseada em IDs realmente retornados em `/api/locations`
- destaque dinâmico para Austrália/Nova Zelândia/Japão quando disponíveis
- gráfico de linhas em D3 com janelas 1h, 3h e total
- lacunas do histórico ficam ausentes (`null`), nunca zero

## Validação manual de URLs reais (executada em desenvolvimento)

Validados com `curl -L`:

- `https://resultados.tse.jus.br/oficial/comum/config/ele-c.json`
- `https://resultados.tse.jus.br/oficial/ele2026/6258/dados/br/br-c0001-e006258-u.json`
- `https://eleicoes2026brasil.com/feed/agora.json`
- `https://eleicoes2026brasil.com/feed/uf/zz.json`
- `https://eleicoes2026brasil.com/feed/historico.json`
- `https://placardovoto.com/api/public/v1/resultados/2026/2/presidente/zz/`

Observações:

- granularidade por país/cidade só é anunciada se IDs estruturados existirem na resposta;
- se um endpoint externo não responder, o painel marca indisponibilidade com origem explícita.

## Como executar

```bash
npm install
npm start
# abre em http://localhost:3000
```

## Testes

```bash
npm test
```

Cobertura dos testes adicionados:

- parsing dos três formatos
- fallback automático de prioridade
- tratamento de 429/retry-after
- indisponibilidade/ausência de localidade
- prevenção de dupla contagem em payload agregado

## Publicação

- **Frontend+Backend juntos**: deploy Node (Render/Fly/Railway/Vercel Node Function)
- Em Vercel, exponha `src/server.mjs` como função Node e sirva `public/`.
- Polling de 3s permanece no frontend, enquanto o backend aplica cache e limites.
