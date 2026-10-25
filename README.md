# Voto Aberto 2026

Central independente de apuração presidencial: tema escuro, candidatos nas laterais, urnas apuradas no centro, mapa geográfico, regiões, exterior e histórico. Flávio permanece à esquerda (azul), Lula à direita (vermelho). O modo completo é o padrão; o modo simples preserva disputa, localidade, votos, diferença, urnas, status e fonte, sem recarregar a página.

**Nenhum resultado é simulado em produção.** As fixtures existem somente em `tests/`. Ausência é representada por `null`/“—”. Zeros efetivamente publicados pelas fontes são preservados; zero votos não é interpretado como empate ou liderança. Sem percentuais válidos, o fundo e a barra ficam neutros.

## Desenvolvimento local

Requer Node.js **20.19+** ou **22.12+** (24 LTS recomendado), npm e dois terminais:

```bash
npm ci
npm start                  # backend/proxy: porta 3000
```

```bash
VITE_API_BASE_URL=http://localhost:3000 npm run dev:pages -- --host 0.0.0.0
# frontend Vite: porta 5173, caminho /voto-aberto-2026/
```

O frontend precisa do Vite: o HTML bruto servido pelo servidor Node não substitui a transformação de módulos e variáveis do Vite. Backend e frontend estático permanecem separados. `PORT` permite alterar a porta do proxy. `npm run dev` reinicia o backend quando os arquivos mudam.

No ambiente na nuvem com proxy HTTPS, use **Node 24** e `NODE_USE_ENV_PROXY=1 npm start`. Isso permite ao `fetch` nativo usar o proxy já configurado, preservando a validação TLS e os certificados fornecidos pela plataforma. Não defina tokens ou desative certificados para contornar erros.

## Build e GitHub Pages

`VITE_API_BASE_URL` é uma variável **de build** com a URL HTTP(S) pública do backend, sem `/api` no final. Não coloque segredo nela. Em desenvolvimento é injetada no processo Vite; mudar o valor exige reiniciá-lo. Em produção exige novo build.

```bash
VITE_API_BASE_URL=https://seu-backend.exemplo.com npm run build
npm run verify:pages
npx vite preview --host 127.0.0.1
```

A base continua `/voto-aberto-2026/`. O build gera `dist/index.html`, `dist/404.html`, `dist/.nojekyll`, módulos, CSS, retratos locais e página de créditos. Não há dependência de CDN para a interface, mapa ou gráfico.

O workflow `.github/workflows/deploy-pages.yml` mantém a publicação via GitHub Actions quando `main` recebe alterações. Ele instala dependências, executa testes de dados e navegador, gera o build e valida os artefatos antes de publicar. Configure **Settings → Pages → Source: GitHub Actions**. Configure a variável de repositório **`VITE_API_BASE_URL`** em **Settings → Secrets and variables → Actions → Variables** para apontar ao backend publicado. O proxy pode rodar em um serviço Node separado; Pages não executa esse servidor.

Sem a variável, o build é válido e mostra “API indisponível no GitHub Pages” com um diagnóstico explícito. Não existe fallback para dados de exemplo. A configuração da nuvem é salva como rascunho para revisão/publicação; isso não publica o site nem provisiona o backend público.

## Fontes reais e prioridade

| Provedor                     | Tipo exibido                         | Contrato observado                                                                                                                                                                                                          |
| ---------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TSE, `resultados.tse.jus.br` | **TSE oficial**                      | JSON oficial de 2026/6258; candidatos em `carg[].agr[].par[].cand[]`, seções em `s`, votos em `v`. Aceita também o formato legado dos testes.                                                                               |
| `eleicoes2026brasil.com`     | **Feed independente baseado no TSE** | API documentada em [OpenAPI](https://eleicoes2026brasil.com/openapi.json): `/feed/agora.json`, `/feed/uf/zz.json`, `/feed/historico.json`; metadados de locais via representação Markdown documentada das páginas públicas. |
| `placardovoto.com`           | **Feed independente baseado no TSE** | `/api/public/v1/resultados/2026/2/presidente/{uf}/`; formato atual `result.candidates`, `freshness`, `percentageBasis`, além do formato legado. Avisos de conferência pendente da fonte são preservados.                    |

A ordem automática é TSE → feed independente → Placar. A resposta carrega somente **uma totalização** e registra mensagens/URLs das tentativas anteriores. O seletor de fontes fica nas configurações; as fontes do exterior também podem ser escolhidas diretamente no card.

**Exceção explícita para o exterior:** enquanto o total oficial está “aguardando apuração”, sem votos, o automático pode mostrar uma parcial publicada por um dos provedores independentes. A interface a identifica como independente e avisa que o TSE ainda não começou. Se nenhum provedor tem apuração, mantém a resposta disponível do TSE. Havendo contagem oficial, a prioridade oficial é preservada. Esse mecanismo não garante que um portal terá números antes do TSE e não antecipa dados ainda não publicados.

O card do exterior compara separadamente os três provedores através de `/api/sources`: **não soma, calcula média nem mescla essas respostas**. Coleta e horário da fonte são distintos. Selecionar um provedor muda explicitamente a fonte do painel.

G1, UOL e CNN foram solicitados para pesquisa de resultados do exterior. As tentativas de acesso às páginas eleitorais foram bloqueadas pelo proxy da nuvem (CONNECT HTTP 403); **não foi validado um feed desses portais e eles não são apresentados como integrações existentes**. Os domínios foram acrescentados ao rascunho de rede para permitir nova validação quando a política for aplicada. Uma página de notícia, pesquisa de intenção de voto ou placar sem origem/localidade não é convertida em contagem eleitoral. Fotos de boletins só poderiam alimentar um provedor `bu-partial` com origem verificável, identificação única da seção e deduplicação; não há hoje esse provedor conectado.

## Exterior: países, cidades e atualização

**Encerramento da votação não equivale a resultado publicado.** Um país pode ter locais que já fecharam e outros ainda abertos. O painel não infere encerramento por fuso horário e não transforma uma notícia de seção fechada em votos apurados. Esse estado só pode ser mostrado quando uma fonte identificada o publicar para a seção/localidade.

A relação de países vem dos links publicados em `/md/presidente/exterior`. Cidades vêm dos links publicados nas páginas de cada país (`/md/presidente/exterior/{iso}`). Não existe catálogo de países fictícios na aplicação. Austrália, Nova Zelândia, Japão, Estados Unidos, Portugal, Reino Unido, Alemanha e França recebem prioridade **somente quando retornados pela fonte**. A lista completa de países fica no seletor; o card mostra até nove locais por aba, com rolagem. As cidades dos países destacados são descobertas no carregamento; escolher outro país carrega suas cidades.

O feed compacto de ZZ fornece vetores paralelos por código TSE. O proxy associa esses códigos às cidades efetivamente publicadas para cada país. O total de um país soma somente essas cidades, dentro do mesmo provedor, e é recusado quando falta algum código. Um resultado de cidade usa somente sua linha. Não se reaproveitam votos nacionais ou totais de ZZ para preencher país/cidade. Não se somam países ao total geral de ZZ, o que duplicaria votos.

O arquivo compacto de ZZ não informa seu horário de geração. Nesses resultados, o horário da fonte permanece “Não informado”; a coleta tem horário próprio, e a URL dos metadados está no contrato. Isso é uma limitação real. O seletor TSE não oferece países/cidades como se seus endpoints estaduais os suportassem.

A tela consulta a localidade selecionada a cada **3 segundos**, suspende consultas quando a aba fica oculta e cancela respostas antigas ao trocar localidade. O exterior completo e a comparação de fontes atualizam em até **30 segundos**; mapa/regiões em até 60 segundos; metadados de localidades são reutilizados por seis horas no backend. Não se promete “tempo real” além do que a fonte publica.

O backend usa cache fresco (TSE/Placar 30 s, feed 15 s), ETag, Last-Modified, revalidação 304, coalescência de pedidos concorrentes, limite global de quatro consultas externas e cooldown/backoff para falhas e 429. Um Retry-After longo vira cooldown, sem prender um worker dormindo. O horário da coleta é preservado no cache; uma resposta em cache não recebe um horário ficticiamente novo.

## Contratos do proxy

- `GET /api/results?scope=brasil&provider=auto`: `provider`, `sourceKind`, `scope`, `status`, `updatedAt`, `retrievedAt`, `sourceUrl`, `votosValidos`, `secoesApuradas`, `secoesTotais`, `progressPercent`, `candidatos[]`, `consolidationWarning` e `diagnostics[]`. Candidato: `{candidato, votos, percentual}`. `metadataSourceUrl` identifica a página de associação de cidades quando necessária.
- Escopos: `brasil`, `estado:sp`, `exterior-geral`, `exterior-pais:au`, `exterior-cidade:au/30562`. Os escopos legados continuam sendo aceitos quando a fonte fornece `locais[]` com resultados próprios.
- `GET /api/history?scope=brasil&provider=auto&window=1h`: `{points:[{at,lulaPercent,flavioPercent}], gapPolicy:"missing-as-null", provider?, diagnostics}`. Janelas: `1h`, `3h`, `all`. Histórico nacional não substitui histórico estadual/exterior. Séries vazias e falhas possuem mensagens diferentes.
- `GET /api/locations?country=au`: `{locations:[{id,nome,tipo,countryCode}], sourceUrl?, highlights?, diagnostics?, error?}`. Sem `country`, retorna países e cidades dos destaques publicados.
- `GET /api/sources?scope=exterior-geral`: `{scope,sources:[...resultados separados],aggregation:"none"}`.

Os endpoints mantêm CORS e preflight OPTIONS. Um HTTP 200 de uma API pode conter `sourceKind:"unavailable"`: o frontend verifica o contrato e os dados, não apenas a conexão.

## Mapa, regiões e histórico

O mapa é um SVG geográfico com 27 contornos de UF, seleção por teclado/clique e estado selecionado destacado. Origem: [Click That Hood / Code for America](https://github.com/codeforgermany/click_that_hood/blob/48ba05ad4c6969e3b3c25735492169227ae411f1/public/data/brazil-states.geojson), licença **MIT**, reproduzida em [docs/map-license.md](docs/map-license.md). Os limites foram simplificados e projetados em longitude/latitude; não é um cartograma nem uma malha para uso cartográfico de precisão. Os caminhos locais ficam em `public/brazil-map.js`; nenhuma biblioteca de mapas externa é necessária.

A cor vem da liderança em votos e a intensidade da margem percentual válida. Empate significa **igualdade exata em votos**, não um “empate técnico” estatístico: não há amostragem nem margem de erro estimada. Sem votos válidos o estado permanece sem dados.

Regiões são agregadas por provedor e tipo de fonte, exibindo cobertura de UFs, totais dos dois candidatos, diferença e horário mais antigo do grupo. Provedores distintos nunca são somados. Percentuais regionais usam o total de votos válidos reportado, quando disponível e consistente; cobertura incompleta é identificada. Não se converte uma UF ausente em zero.

O gráfico usa SVG local, cores por candidato, legenda, janela temporal e tooltip por toque/ponteiro/foco. Valores nulos quebram os segmentos; não são preenchidos com zero nem interpolados. Sem série válida, o gráfico mostra indisponibilidade, mantendo eixos e contexto. As últimas atualizações registram mudanças da fonte nesta sessão; o polling idêntico não cria eventos novos.

## Retratos e licenças

As buscas de imagem foram feitas no Google e os direitos foram verificados nos metadados da página de origem do Wikimedia Commons. Arquivos são servidos pelo próprio build; a busca não é uma dependência do site.

- **Flávio Bolsonaro, 2026**: crédito Tribunal Superior Eleitoral do Brasil (TSE), [arquivo de origem](<https://commons.wikimedia.org/wiki/File:2026_FLAVIO_BOLSONARO_CANDIDATO_PRESIDENTE_TSE_(280002551544)_(cropped).jpg>), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). JPEG de origem 411×546, cerca de 50 kB.
- **Lula, 16/02/2023**: Ricardo Stuckert/PR, publicação Palácio do Planalto, [retrato oficial](<https://commons.wikimedia.org/wiki/File:Foto_oficial_de_Luiz_In%C3%A1cio_Lula_da_Silva_(ombros).jpg>), [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/). Miniatura de 960 px disponibilizada pelo Wikimedia Commons, cerca de 260 kB. A foto de 2023 é usada por ser o retrato oficial do mandato vigente e ter licença/autoria verificáveis; não é apresentada como foto de campanha de 2026.

Tratamento visual somente em CSS: escala de cinza, contraste, enquadramento e máscara com transparência gradual nas bordas, sem retângulo de fundo. Não houve geração de rosto. Créditos e links de licença também estão disponíveis na interface. Se uma imagem não carregar, aparece “Retrato indisponível”, sem avatar genérico. Nenhum autor/instituição endossa o painel.

## Indicadores e segurança dos dados

Não existem etiquetas “Matematicamente eleito” ou “Vantagem consolidada”. Seções totalizadas são um estado de apuração, não uma inferência de vitória. O gradiente usa a razão entre os percentuais válidos dos dois candidatos apenas quando ambos existem, são finitos, estão no intervalo 0–100 e somam no máximo 100,1% (tolerância de arredondamento). A transição é animada e respeita movimento reduzido.

Textos externos são escapados antes de entrar em HTML; links aceitam somente HTTP(S). Números são validados; erros de fetch e tentativas de provedores ficam visíveis. Fontes com formatos inesperados geram indisponibilidade específica.

## Validação

```bash
npm ci
npm test
npm run build
npm run verify:pages
npx playwright install --with-deps chromium  # primeira execução, se necessário
npm run test:e2e
```

Se Chromium já estiver instalado na nuvem:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e
```

`test:e2e` gera o build antes de testar sua versão publicada, mais dois servidores Vite para cenários com/sem API. As interceptações/fixtures ficam exclusivamente nos testes. A suíte verifica larguras de **1440, 1280, 768, 390 e 360 px**, ausência de overflow e erros de console no cenário válido, candidato azul antes do vermelho, modo simples/completo, configurações, seleção de estado/país/cidade, API ausente/inacessível, percentuais ausentes, dados parciais, gradiente neutro, série vazia/com lacunas, tooltip, sanitização, cancelamento de resposta antiga, retratos locais e fallback de imagem. Falhas de rede induzidas são esperadas apenas nos cenários de indisponibilidade.

Os testes de backend verificam parsers legados/atuais, países sem herdar totais de ZZ, somas de cidades sem duplicação, parcial independente antes da apuração oficial, cache/revalidação/cooldown, isolamento regional por provedor e contratos HTTP/CORS. Snapshots reais de schemas observados em 25/10/2026 ficam em `tests/fixtures/*-current.json`, somente para testes.

A validação ao vivo confirmou respostas do TSE e dos dois provedores independentes, incluindo a ausência de apuração nas respostas consultadas. Isso não valida votos futuros, fotografias de boletins, resultado final nem continuidade dos serviços. O histórico observado estava vazio. Publicação do site, disponibilidade de um backend público, feeds de G1/UOL/CNN e restauração em nova tarefa da nuvem são verificações separadas, não presumidas por testes locais.
