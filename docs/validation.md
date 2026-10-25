# Validação da reconstrução

Executada em 25/10/2026 com Node 24.19.0, npm 11.9.0 e Chromium do ambiente.

| Verificação | Resultado |
| --- | --- |
| `npm ci --cache /workspace/.npm` | Instalação pelo lockfile concluída |
| `npm test` | 30 testes passaram, nenhum falhou/pulou |
| `npm run build` | Build concluído com base `/voto-aberto-2026/` |
| `npm run verify:pages` | 3 testes passaram: artefatos, subpath e indisponibilidade sem API |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e` | 17 testes passaram, nenhum falhou/pulou |
| Navegador em 1440/1280/768/390/360 px | Sem overflow horizontal ou erros de console no cenário válido |
| Proxy real com `NODE_USE_ENV_PROXY=1` | Resultados Brasil, ZZ, Austrália; locais, histórico e comparação de fontes respondendo |
| Consulta aos provedores para ZZ | TSE, feed e Placar: apuração não iniciada; 0/1.351 seções na resposta consultada |
| Consulta por país | Austrália: feed independente, 0/29 seções; nenhum voto publicado na resposta consultada |
| Descoberta de localidades | 160 registros publicados: países e cidades dos destaques |
| Histórico ao vivo do exterior | Vazio; indisponibilidade explicitada, sem linha inventada |
| G1, UOL e CNN | Acesso às páginas eleitorais bloqueado pelo proxy (CONNECT HTTP 403); integração não validada |
| Publicação/merge | Não executados; requer backend público e configuração de build para dados no Pages |

Os testes de navegador incluem produção servida no subpath, API ausente/inacessível, dados parciais, percentuais nulos, modos, seleção por mapa/select, seleção de país/cidade, histórico vazio/com lacunas, tooltip por foco, sanitização de texto, fonte independente sem etiqueta de vitória, cancelamento de resposta antiga, imagens locais, fallback e comparação de provedores.

## Capturas do cenário de teste

**Os números nas imagens abaixo vêm de fixtures interceptadas exclusivamente pelo teste de navegador. Não são resultados eleitorais reais e não fazem parte dos fallbacks da aplicação.** As capturas servem para revisar composição e responsividade. O aplicativo publicado consulta o backend ou exibe indisponibilidade.

### Desktop · 1440 px

![Cenário de teste no desktop](screenshots/desktop-test.png)

### Celular · 390 px

![Cenário de teste no celular](screenshots/mobile-test.png)

A configuração reutilizável da nuvem foi salva em rascunho (`install_script`, `start_skill`, domínios necessários). Isso não comprova publicação ou restauração do snapshot em uma tarefa nova.
