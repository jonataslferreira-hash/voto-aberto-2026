# Validação da reconstrução

Executada em 25/10/2026 com Node 24.19.0, npm 11.9.0 e Chromium do ambiente.

| Verificação                                                              | Resultado                                                                                     |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `npm ci --cache /workspace/.npm`                                         | Instalação pelo lockfile concluída                                                            |
| `npm test`                                                               | 30 testes passaram, nenhum falhou/pulou                                                       |
| `npm run build`                                                          | Build concluído com base `/voto-aberto-2026/`                                                 |
| `npm run verify:pages`                                                   | 3 testes passaram: artefatos, subpath e indisponibilidade sem API                             |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e` | 17 testes passaram, nenhum falhou/pulou                                                       |
| Navegador em 1440/1280/768/390/360 px                                    | Sem overflow horizontal ou erros de console no cenário válido                                 |
| Proxy real com `NODE_USE_ENV_PROXY=1`                                    | Resultados Brasil, ZZ, Austrália; locais, histórico e comparação de fontes respondendo        |
| Consulta aos provedores para ZZ                                          | TSE, feed e Placar: apuração não iniciada; 0/1.351 seções na resposta consultada              |
| Consulta por país                                                        | Austrália: feed independente, 0/29 seções; nenhum voto publicado na resposta consultada       |
| Descoberta de localidades                                                | 160 registros publicados: países e cidades dos destaques                                      |
| Histórico ao vivo do exterior                                            | Vazio; indisponibilidade explicitada, sem linha inventada                                     |
| G1, UOL e CNN                                                            | Acesso às páginas eleitorais bloqueado pelo proxy (CONNECT HTTP 403); integração não validada |
| Publicação/merge                                                         | Não executados; requer backend público e configuração de build para dados no Pages            |

Os testes de navegador incluem produção servida no subpath, API ausente/inacessível, dados parciais, percentuais nulos, modos, seleção por mapa/select, seleção de país/cidade, histórico vazio/com lacunas, tooltip por foco, sanitização de texto, fonte independente sem etiqueta de vitória, cancelamento de resposta antiga, imagens locais, fallback e comparação de provedores.

## Capturas do cenário de teste

**Os números nas imagens abaixo vêm de fixtures interceptadas exclusivamente pelo teste de navegador. Não são resultados eleitorais reais e não fazem parte dos fallbacks da aplicação.** As capturas servem para revisar composição e responsividade. O aplicativo publicado consulta o backend ou exibe indisponibilidade.

### Desktop · 1440 px

![Cenário de teste no desktop](screenshots/desktop-test.png)

### Celular · 390 px

![Cenário de teste no celular](screenshots/mobile-test.png)

A configuração reutilizável da nuvem foi salva em rascunho (`install_script`, `start_skill`, domínios necessários). Isso não comprova publicação ou restauração do snapshot em uma tarefa nova.

## Atualização: Pages sem backend e eleições históricas

- Build sem `VITE_API_BASE_URL` agora carrega coleta real em `/data/results.json`, com origem e horário, substituindo o erro obrigatório anterior.
- 2026: 1º/2º turnos, 29 localidades por turno; primeiro turno com 12 candidatos na coleta feita.
- 2022: acervo independente explicitamente identificado, 29 localidades por turno, 11 candidatos no primeiro e 2 no segundo. Soma de cada candidato em 27 UFs + ZZ coincide com o Brasil. Seções omitidas porque não foram revalidadas na fonte original.
- Configuração da URL do backend no navegador, com opção persistente de retornar aos dados publicados.
- Novos testes de troca de ano/turno/candidatos, procedência do acervo, configuração de conexão e descarte de resposta de backend que não confirme o ano/turno solicitado.
- O detalhamento por país/cidade ainda requer backend e contrato correspondente; arquivos publicados incluem o total de ZZ, sem inventar países ou histórico.

A rodada final desta atualização passou em **34 testes de dados/servidor, 21 testes de navegador e 3 verificações de Pages (58 no total)**. `npm ci`, build sem API e consultas HTTP reais com ano/turno também concluídos. As capturas `screenshots/2022-first-desktop.png` e `screenshots/2022-first-mobile.png` mostram os registros históricos reais do primeiro turno, com origem identificada; não usam mocks.

## PNGs, consulta ao vivo e alertas

Esta rodada validou **43 testes de dados/servidor, 28 testes de navegador e 3 verificações de Pages: 74 passaram, sem falhas ou testes pulados**. `npm ci` e build também concluídos.

- Os dois retratos são PNGs RGBA com mais de 20% de pixels totalmente transparentes. Pixels centrais dos rostos coincidem com a fotografia original, considerando o reenquadramento documentado de Lula. Não se usam os rostos estilizados produzidos durante a obtenção das máscaras.
- A área azul ocupa 75% e a vermelha 25% no cenário de teste, inclusive na verificação de largura efetivamente renderizada. Valores ausentes deixam ambas neutras.
- Consulta real do endpoint TSE com Origin `https://jonataslferreira-hash.github.io`: HTTP 200 e Access-Control-Allow-Origin correspondente; cabeçalhos ETag/Last-Modified e max-age presentes. A fonte consultada ainda não havia iniciado apuração. O teste de navegador intercepta a fonte para verificar atualização após 60 segundos, coalescência e mudança de valores sem reload; não afirma ter observado uma virada eleitoral real.
- Áudio desbloqueado por clique em Chromium, perfis distintos por candidato e eventos de virada nas duas direções. A saída de um alto-falante físico não foi medida; a reprodução depende da permissão/volume do navegador.
- Confirmação oficial aciona o overlay, cor, foco e retorno após 8 segundos, sem repetição. Classificação ao 2º turno, histórico, primeira carga, empate, ausência e vitória independente não acionam anúncio oficial. Movimento reduzido desliga confetes. O polling do backend pode ser pausado.

### Imagens de teste, não resultados reais

Os dois exemplos abaixo usam **somente fixtures interceptadas pelo teste**, têm identificação de teste e não são telas de um resultado real publicado. Os PNGs dos retratos são os mesmos arquivos licenciados da aplicação.

![Teste do fundo proporcional atrás dos PNGs](screenshots/png-proportional-colors-test.png)

![Teste da animação de vitória, com dados controlados](screenshots/victory-animation-test.png)
