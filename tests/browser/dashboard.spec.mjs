import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
test.beforeEach(async ({ page }) => {
  await page.route("https://resultados.tse.jus.br/**", (route) =>
    route.abort("failed"),
  );
});
const fixture = JSON.parse(
  await readFile(new URL("../fixtures/tse.json", import.meta.url), "utf8"),
);
const normalized = {
  provider: "tse",
  sourceKind: "official-tse",
  status: "partial",
  scope: "brasil",
  updatedAt: fixture.dg,
  retrievedAt: fixture.dg,
  sourceUrl: "https://resultados.tse.jus.br/",
  votosValidos: 1000,
  secoesApuradas: 10,
  secoesTotais: 20,
  candidatos: [
    { candidato: "Flávio Bolsonaro", votos: 550, percentual: 55 },
    { candidato: "Lula", votos: 450, percentual: 45 },
  ],
};
async function api(
  page,
  { result = normalized, history = [], locations = [], includeElection = true } = {},
) {
  await page.route("http://127.0.0.1:4199/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/results")
      await route.fulfill({
        json: {
          ...result,
          ...(includeElection ? {
            year: Number(url.searchParams.get("year") || 2026),
            turn: Number(url.searchParams.get("turn") || 2),
          } : {}),
          scope: url.searchParams.get("scope"),
        },
      });
    else if (url.pathname === "/api/history")
      await route.fulfill({
        json: { points: history, provider: "eleicoes-feed" },
      });
    else if (url.pathname === "/api/sources")
      await route.fulfill({
        json: {
          scope: "exterior-geral",
          aggregation: "none",
          sources: [
            { ...normalized, scope: "exterior-geral" },
            {
              ...normalized,
              provider: "eleicoes-feed",
              sourceKind: "independent-tse-derived",
              scope: "exterior-geral",
            },
            {
              ...normalized,
              provider: "placar-do-voto",
              sourceKind: "independent-tse-derived",
              scope: "exterior-geral",
            },
          ],
        },
      });
    else await route.fulfill({ json: { locations } });
  });
}
async function ready(page) {
  await page.goto("./");
  await expect(page.locator("#heroTotals")).toContainText("Flávio Bolsonaro");
}
async function hasTransparentCorner(locator) {
  return locator.evaluate(async (image) => {
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    return context.getImageData(0, 0, 1, 1).data[3] === 0;
  });
}
for (const width of [1440, 1280, 768, 390, 360])
  test(`layout ${width}px sem overflow ou erro de console`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await api(page);
    await ready(page);
    await expect(page.locator(".candidate--blue .candidate__pct")).toHaveText(
      "55,00%",
    );
    await expect(page.locator("#connection")).toContainText("API conectada");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const invalid = await page
      .locator("button,select,h1,h2")
      .evaluateAll((nodes) =>
        nodes
          .filter(
            (n) =>
              n.getClientRects().length &&
              n.getBoundingClientRect().right > innerWidth + 1,
          )
          .map((n) => n.outerHTML),
      );
    expect(invalid).toEqual([]);
    const leftCandidate = page.locator("#heroTotals .candidate--blue"),
      rightCandidate = page.locator("#heroTotals .candidate--red");
    await expect(leftCandidate).toBeVisible();
    await expect(rightCandidate).toBeVisible();
    await expect
      .poll(async () =>
        Boolean(
          (await leftCandidate.boundingBox()) &&
            (await rightCandidate.boundingBox()),
        ),
      )
      .toBe(true);
    const left = await leftCandidate.boundingBox(),
      right = await rightCandidate.boundingBox();
    expect(width <= 550 ? left.y < right.y : left.x < right.x).toBe(true);
    expect(errors).toEqual([]);
    await page.screenshot({
      path: `test-results/dashboard-${width}.png`,
      fullPage: true,
    });
  });
test("sem API usa dados publicados reais com horário e sem erro de configuração", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:4174/voto-aberto-2026/");
  await expect(page.locator("#connection")).toContainText("Dados publicados");
  await expect(page.locator("#notice")).toContainText("Dados publicados");
  await expect(page.locator("#notice")).not.toContainText(
    "defina VITE_API_BASE_URL",
  );
  await expect(page.locator("#heroSource")).toContainText("TSE oficial");
});

test("API inacessível expõe Failed to fetch sem votos fictícios", async ({
  page,
}) => {
  await page.route("http://127.0.0.1:4199/**", (r) => r.abort("failed"));
  await ready(page);
  await expect(page.locator("#notice")).toContainText("Failed to fetch");
  await expect(page.locator("#app")).toHaveAttribute(
    "data-gradient",
    "neutral",
  );
  await expect(page.locator(".candidate__votes").first()).toContainText("—");
});
test("resposta parcial e percentuais ausentes mantêm votos e gradiente neutro", async ({
  page,
}) => {
  const result = {
    ...normalized,
    candidatos: normalized.candidatos.map((c) => ({ ...c, percentual: null })),
  };
  await api(page, { result });
  await ready(page);
  await expect(page.locator("#resultStatus")).toHaveText("Apuração parcial");
  await expect(page.locator(".candidate__votes").first()).toContainText("550");
  await expect(page.locator(".candidate__pct").first()).toHaveText("—");
  await expect(page.locator("#app")).toHaveAttribute(
    "data-gradient",
    "neutral",
  );
});
test("modos são instantâneos e configurações funcionam", async ({ page }) => {
  await api(page);
  await ready(page);
  await page.getByRole("button", { name: "Simples", exact: true }).click();
  await expect(page.locator("#cardMapa")).toBeHidden();
  await expect(page.locator("#cardApuracao")).toBeVisible();
  await page.getByRole("button", { name: "Completo", exact: true }).click();
  await expect(page.locator("#cardMapa")).toBeVisible();
  await page
    .getByRole("button", { name: "Configurações", exact: true })
    .click();
  await expect(page.locator("#providerSelect")).toBeVisible();
});
test("seleção de estado por mapa e select mantém escopo correto", async ({
  page,
}) => {
  await api(page);
  await ready(page);
  await page.locator('.map-state[data-uf="ba"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#scopeLabel")).toHaveText("Bahia");
  await expect(page.locator('.map-state[data-uf="ba"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.locator("#stateSelect").selectOption("sp");
  await expect(page.locator("#scopeLabel")).toHaveText("São Paulo");
});
test("exterior lista somente países reais da resposta e seleção funciona", async ({
  page,
}) => {
  await api(page, {
    locations: [
      { id: "au", nome: "Austrália", tipo: "country", countryCode: "AU" },
      { id: "tokyo", nome: "Tóquio", tipo: "city", countryCode: "JP" },
    ],
  });
  await ready(page);
  await page.getByRole("tab", { name: "Por país" }).click();
  await expect(page.locator("#exteriorContent")).toContainText("Austrália");
  await expect(page.locator("#exteriorContent")).not.toContainText("Portugal");
  await page.getByRole("button", { name: "Selecionar Austrália" }).click();
  await expect(page.locator("#scopeLabel")).toHaveText("Austrália");
  await expect(page.locator("#exteriorSelect")).toHaveValue("exterior-pais:au");
  await page.getByRole("tab", { name: "Por cidade" }).click();
  await expect(page.locator("#exteriorContent")).toContainText("Tóquio");
  await page.getByRole("button", { name: "Selecionar Tóquio" }).click();
  await expect(page.locator("#scopeLabel")).toHaveText("Tóquio");
  await expect(page.locator("#exteriorSelect")).toHaveValue(
    "exterior-cidade:tokyo",
  );
});
test("sem histórico mantém gráfico vazio; lacunas separam segmentos e tooltip funciona", async ({
  page,
}) => {
  await api(page);
  await ready(page);
  await expect(page.locator("#historyChart")).toContainText(
    "Aguardando a primeira atualização válida",
  );
  await page.unroute("http://127.0.0.1:4199/**");
  await api(page, {
    history: [
      { at: "2026-10-25T12:00Z", flavioPercent: 55, lulaPercent: 45 },
      { at: "2026-10-25T12:01Z", flavioPercent: null, lulaPercent: null },
      { at: "2026-10-25T12:02Z", flavioPercent: 56, lulaPercent: 44 },
    ],
  });
  await page.locator("#windowSelect").selectOption("all");
  const path = page.locator('[data-series="left"]');
  await expect(path).toHaveAttribute("d", /^M[^L]+ M/);
  await page.locator('[data-point="0"]').focus();
  await expect(page.locator("#chartTooltip")).toContainText("55,00%");
});
test("histórico acompanha os dois candidatos escolhidos no primeiro turno", async ({ page }) => {
  const firstTurn = {
    ...normalized,
    turn: 1,
    updatedAt: "2026-10-25T20:00:00.000Z",
    candidatos: [
      { numero: "70", candidato: "Augusto Cury", votos: 120, percentual: 12 },
      { numero: "13", candidato: "Lula", votos: 500, percentual: 50 },
      { numero: "22", candidato: "Flávio Bolsonaro", votos: 380, percentual: 38 },
    ],
  };
  await api(page, { result: firstTurn });
  await ready(page);
  await expect(page.locator("#connection")).toContainText("API conectada");
  await page.locator("#turnSelect").selectOption("1");
  await page.locator("#leftCandidateSelect").selectOption("70");
  await page.locator("#rightCandidateSelect").selectOption("13");
  await expect(page.locator("#windowSelect")).toBeDisabled();
  await expect(page.locator("#historyLegendFlavio")).toHaveText("Augusto Cury");
  await expect(page.locator("#historyLegendLula")).toHaveText("Lula");
  await expect(page.locator('[data-series="left"]')).toHaveAttribute("d", /^M/);
  await expect(page.locator('[data-series="right"]')).toHaveAttribute("d", /^M/);
  await expect(page.locator('[data-series="left"]')).toHaveAttribute("style", /#e7ad3e/i);
  await expect(page.locator("#historyLegendFlavio").locator("xpath=..").locator(".dot")).toHaveCSS("background-color", "rgb(231, 173, 62)");
});
test("textos externos são escapados e fontes independentes não ganham selo de vitória", async ({
  page,
}) => {
  await api(page, {
    result: {
      ...normalized,
      sourceKind: "independent-tse-derived",
      provider: "placar-do-voto",
      status: "totalized",
      consolidationWarning: "<img src=x onerror=alert(1)>",
    },
  });
  await ready(page);
  await expect(page.locator("#notice")).toHaveText(
    "<img src=x onerror=alert(1)>",
  );
  await expect(page.locator("#notice img")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(
    "Matematicamente eleito",
  );
});
test("artefato de produção no subpath carrega retratos locais e créditos", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:4175/voto-aberto-2026/");
  await expect(page.locator("#connection")).toContainText("Dados publicados");
  await expect(page.locator(".portrait-photo")).toHaveCount(2);
  await expect
    .poll(() =>
      page
        .locator(".portrait-photo")
        .evaluateAll((images) =>
          images.every((i) => i.complete && i.naturalWidth > 0),
        ),
    )
    .toBe(true);
  for (const image of await page.locator(".portrait-photo").all())
    expect(await image.getAttribute("src")).toContain(
      "/voto-aberto-2026/assets/",
    );
  const credits = await page.locator("#imageCredits").getAttribute("href");
  const response = await page.request.get(credits);
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain("Creative Commons");
});
test("retrato inacessível tem fallback sem avatar", async ({ page }) => {
  await api(page);
  await page.route("**/images/*.png", (r) => r.abort());
  await ready(page);
  await expect(page.locator(".portrait-frame.is-unavailable")).toHaveCount(2);
  await expect(page.locator(".portrait-fallback").first()).toBeVisible();
});
test("troca rápida de escopo não mostra resultado atrasado da localidade anterior", async ({
  page,
}) => {
  await api(page);
  await ready(page);
  await page.route("http://127.0.0.1:4199/api/results?**", async (route) => {
    const scope = new URL(route.request().url()).searchParams.get("scope");
    if (scope === "estado:ba") await new Promise((r) => setTimeout(r, 300));
    await route.fulfill({
      json: {
        ...normalized,
        scope,
        candidatos: normalized.candidatos.map((c) => ({
          ...c,
          votos: scope === "estado:sp" ? 200 : 999,
        })),
      },
    });
  });
  await page.getByRole("button", { name: "Estados", exact: true }).click();
  await page.locator("#stateSelect").selectOption("ba");
  await page.locator("#stateSelect").selectOption("sp");
  await expect(page.locator("#scopeLabel")).toHaveText("São Paulo");
  await expect(page.locator(".candidate__votes").first()).toContainText("200");
  await page.waitForTimeout(400);
  await expect(page.locator(".candidate__votes").first()).not.toContainText(
    "999",
  );
});

test("comparação do exterior preserva fontes separadas e permite escolher provedor", async ({
  page,
}) => {
  await api(page);
  await ready(page);
  await expect(page.locator("#exteriorSources .source-chip")).toHaveCount(3);
  await page.locator('[data-exterior-provider="eleicoes-feed"]').click();
  await expect(page.locator("#providerSelect")).toHaveValue("eleicoes-feed");
  await expect(page.locator("#scopeLabel")).toHaveText("Exterior · geral");
});

test("primeiro turno publicado lista todos os candidatos e permite comparação diferente", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:4174/voto-aberto-2026/");
  await page.locator("#turnSelect").selectOption("1");
  await expect(page.locator("#allCandidates .candidate-table>.candidate-rank-row")).toHaveCount(
    12,
  );
  const options = await page
    .locator("#leftCandidateSelect option")
    .evaluateAll((nodes) =>
      nodes.map((n) => ({ value: n.value, name: n.textContent })),
    );
  const alternative = options.find((o) => !["22", "13"].includes(o.value));
  await page.locator("#leftCandidateSelect").selectOption(alternative.value);
  await expect(page.locator(".candidate--blue h2")).toContainText(
    alternative.name.split(" (")[0],
  );
  await expect(page.locator(".candidate--blue .portrait-photo")).toHaveAttribute(
    "src",
    /2026-.*\.png/,
  );
  expect(await hasTransparentCorner(page.locator(".candidate--blue .portrait-photo"))).toBe(true);
  await page.locator("#leftCandidateSelect").selectOption("13");
  await expect
    .poll(() =>
      page.locator(".candidate--blue").evaluate((node) =>
        node.style.getPropertyValue("--candidate-accent"),
      ),
    )
    .toBe("#ff405d");
  await page.locator("#rightCandidateSelect").selectOption("22");
  await expect
    .poll(() =>
      page.locator(".candidate--red").evaluate((node) =>
        node.style.getPropertyValue("--candidate-accent"),
      ),
    )
    .toBe("#3195ff");
});
test("histórico de 2026 no primeiro turno mostra o resultado final real, sem fingir série temporal", async ({ page }) => {
  await page.goto("http://127.0.0.1:4174/voto-aberto-2026/");
  await page.locator("#turnSelect").selectOption("1");
  await expect(page.locator("#historyTitle")).toHaveText("Resultado final · 1º turno");
  await expect(page.locator("#historyChart .chart-point")).toHaveCount(2);
  await expect(page.locator("#historySource")).toContainText("TSE oficial");
  await expect(page.locator("#historyNote")).toContainText("este ponto não representa uma série temporal");
  await expect(page.locator("#windowSelect")).toBeDisabled();
  await expect(page.locator("#historyChart")).not.toContainText("Aguardando a primeira atualização válida");
});
test("lista de 2026 é ordenada por votos e apresenta retratos licenciados", async ({ page }) => {
  await page.goto("http://127.0.0.1:4174/voto-aberto-2026/");
  await page.locator("#turnSelect").selectOption("1");
  const rows = page.locator("#allCandidates .candidate-table>.candidate-rank-row");
  await expect(rows).toHaveCount(12);
  await expect(rows.nth(0)).toContainText("FLAVIO BOLSONARO");
  await expect(rows.nth(1)).toContainText("LULA");
  await expect(rows.nth(2)).toContainText("ESCRITOR AUGUSTO CURY");
  await expect(rows.nth(3)).toContainText("RENAN SANTOS");
  await expect(rows.nth(5)).toContainText("ZEMA");
  await expect(rows.nth(2).locator("img")).toHaveAttribute("src", /2026-70-/);
});
test("retrato do Renan não mantém os grandes blocos do fundo original", async ({ page }) => {
  await page.goto("http://127.0.0.1:4174/voto-aberto-2026/");
  await page.locator("#turnSelect").selectOption("1");
  await page.locator("#leftCandidateSelect").selectOption("14");
  const image = page.locator(".candidate--blue .portrait-photo");
  await image.evaluate((node) => new Promise((resolve) => {
    if (node.complete) resolve();
    else node.addEventListener("load", resolve, { once: true });
  }));
  const alpha = await image.evaluate(async (node) => {
    await node.decode();
    const canvas = document.createElement("canvas");
    canvas.width = node.naturalWidth;
    canvas.height = node.naturalHeight;
    const context = canvas.getContext("2d");
    context.drawImage(node, 0, 0);
    return {
      corner: context.getImageData(20, 80, 1, 1).data[3],
      face: context.getImageData(80, 90, 1, 1).data[3],
    };
  });
  await expect(image).toHaveAttribute("src", /2026-14-renan-santos/);
  expect(alpha.corner).toBe(0);
  expect(alpha.face).toBeGreaterThan(200);
});
test("lista abre o perfil detalhado do candidato", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("voto-api-url", "published"));
  await page.goto("./");
  await page.locator("#turnSelect").selectOption("1");
  const row = page.locator("#allCandidates .candidate-rank-row").filter({ hasText: "ESCRITOR AUGUSTO CURY" });
  await row.click();
  await expect(page.locator("#candidateDialog")).toBeVisible();
  await expect(page.locator("#candidateDialogName")).toHaveText("ESCRITOR AUGUSTO CURY");
  await expect(page.locator("#candidateDialogContent")).toContainText("Resultados por estado");
  await page.locator("#candidateDialog .dialog-close").click();
  await expect(page.locator("#candidateDialog")).not.toBeVisible();
});
test("mapa mundial seleciona somente local publicado pela API", async ({ page }) => {
  await api(page, {
    locations: [{ id: "au", nome: "Austrália", tipo: "country", countryCode: "au" }],
  });
  await page.goto("./");
  await expect(page.locator("#worldMap path[data-country-code='AU']")).toHaveAttribute("role", "button");
  await expect(page.locator("#worldMap path[data-country-code='AU']")).toHaveClass(/is-data/);
  await expect(page.locator("#worldMapCount")).toContainText("1 disponíveis");
  await page.locator("#worldMap path[data-country-code='AU']").click();
  await expect(page.locator("#scopeLabel")).toHaveText("Austrália");
});
test("exterior do segundo turno de 2026 mostra a espera oficial do TSE sem estimativas", async ({ page }) => {
  await page.goto("http://127.0.0.1:4174/voto-aberto-2026/");
  await page.locator("#turnSelect").selectOption("2");
  await page.locator('[data-main-scope="exterior"]').click();
  await expect(page.locator("#exteriorContent")).toContainText("aguardando a apuração do 2º turno");
  await expect(page.locator("#exteriorContent")).toContainText("0 de 1.351 seções");
  await expect(page.locator("#exteriorContent")).not.toContainText("0,00%");
});
test("2022 apresenta os dois turnos, candidatos corretos e origem histórica explícita", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:4174/voto-aberto-2026/");
  await page.locator("#yearSelect").selectOption("2022");
  await expect(page.locator("#resultStatus")).toHaveText(
    "Totalização finalizada",
  );
  await expect(page.locator("#allCandidates .candidate-table>.candidate-rank-row")).toHaveCount(
    2,
  );
  await expect(page.locator(".candidate--blue .portrait-photo")).toHaveAttribute("src", /2022-22-jair.*\.png/);
  await expect(page.locator(".candidate--red .portrait-photo")).toHaveAttribute("src", /lula-cutout/);
  await expect(page.locator(".candidate--blue h2")).toHaveText(
    "JAIR BOLSONARO",
  );
  await expect(page.locator(".candidate--red .candidate__votes")).toContainText(
    "60.345.999",
  );
  await expect(page.locator("#historyTitle")).toHaveText("Comparação entre os turnos");
  await expect(page.locator("#windowSelect")).toBeDisabled();
  await expect(page.locator("#historyChart .chart-point")).toHaveCount(4);
  await expect(page.locator("#historyNote")).toContainText("Percentuais finais reais do 1º e do 2º turno");
  await expect(page.locator("#historyChart")).not.toContainText("Histórico temporal não arquivado");
  await expect(page.locator("#notice")).toContainText(
    "Arquivo histórico independente",
  );
  await page.locator("#turnSelect").selectOption("2");
  await page.locator('[data-main-scope="exterior"]').click();
  await expect(page.locator("#exteriorContent")).toContainText("152.905");
  await expect(page.locator("#exteriorContent")).toContainText("145.264");
  await expect(page.locator("#exteriorContent")).toContainText("Acervo histórico");
  await page.locator('[data-main-scope="brasil"]').click();
  await page.locator("#turnSelect").selectOption("1");
  await expect(page.locator("#allCandidates .candidate-table>.candidate-rank-row")).toHaveCount(
    11,
  );
  await expect(page.locator("#allCandidates .candidate-table img")).toHaveCount(11);
  await expect(page.locator("#allCandidates .candidate-rank-row").nth(0)).toContainText("LULA");
  await expect(page.locator("#allCandidates .candidate-rank-row").nth(1)).toContainText("JAIR BOLSONARO");
  await expect(
    page.locator(".candidate--blue .candidate__votes"),
  ).toContainText("51.072.345");
  await expect(page.locator(".candidate--red .candidate__votes")).toContainText(
    "57.259.504",
  );
  const jairPhoto = page.locator(".candidate--blue .portrait-photo");
  await expect(jairPhoto).toHaveAttribute("src", /2022-22-jair.*\.png/);
  expect(await hasTransparentCorner(jairPhoto)).toBe(true);
  await page.locator('[data-main-scope="exterior"]').click();
  await expect(page.locator("#exteriorSources .source-chip")).toHaveCount(0);
});

test("URL do backend pode ser configurada e removida no navegador", async ({
  page,
}) => {
  await api(page);
  await page.goto("http://127.0.0.1:4174/voto-aberto-2026/");
  await page
    .getByRole("button", { name: "Configurações", exact: true })
    .click();
  await page.locator("#apiUrlInput").fill("http://127.0.0.1:4199");
  await page
    .getByRole("button", { name: "Salvar conexão", exact: true })
    .click();
  await expect(page.locator("#connection")).toContainText("API conectada");
  await page.reload();
  await expect(page.locator("#connection")).toContainText("API conectada");
  await page
    .getByRole("button", { name: "Configurações", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Usar dados publicados do site", exact: true })
    .click();
  await expect(page.locator("#connection")).toContainText("Dados publicados");
});

test("backend antigo sem confirmação do turno não exibe eleição incorreta", async ({
  page,
}) => {
  await api(page, { includeElection: false });
  await ready(page);
  await page.locator("#turnSelect").selectOption("1");
  await expect(page.locator("#notice")).toContainText(
    "Backend não confirmou o ano/turno solicitado",
  );
  await expect(page.locator(".candidate__votes").first()).toContainText("—");
});

function eventResult(f, l, minute = 0, won = false) {
  const source =
    "https://resultados.tse.jus.br/oficial/ele2026/6258/dados/br/br-c0001-e006258-u.json";
  return {
    ...normalized,
    year: 2026,
    turn: 2,
    sourceUrl: source,
    updatedAt: `2026-10-25T20:${String(minute).padStart(2, "0")}:00Z`,
    status: won ? "totalized" : "partial",
    candidatos: [
      {
        numero: "22",
        candidato: "Flávio Bolsonaro",
        partido: "PL",
        votos: f,
        percentual: f,
        eleito: false,
        situacao: won ? "Não eleito" : "",
      },
      {
        numero: "13",
        candidato: "Lula",
        partido: "PT",
        votos: l,
        percentual: l,
        eleito: won,
        situacao: won ? "Eleito" : "",
      },
    ],
    officialOutcome: won
      ? {
          numero: "13",
          candidato: "Lula",
          decision: "Eleito",
          electionId: "6258",
          scope: "brasil",
          sourceUrl: source,
        }
      : null,
  };
}
async function eventAPI(page, getResult) {
  await api(page);
  await page.route("http://127.0.0.1:4199/api/results?**", (route) =>
    route.fulfill({
      json: {
        ...getResult(new URL(route.request().url())),
        scope: new URL(route.request().url()).searchParams.get("scope"),
      },
    }),
  );
}
async function labelledCapture(page, path) {
  await page.evaluate(() => {
    const banner = document.createElement("aside");
    banner.id = "testOnlyBanner";
    banner.textContent = "TESTE AUTOMATIZADO · NÚMEROS DE FIXTURE";
    banner.style.cssText =
      "position:fixed;top:0;left:0;right:0;z-index:2000;background:#ffe099;color:#101827;font:700 12px system-ui;padding:8px;text-align:center";
    const active = document.querySelector(
      '#electionEvent:not([hidden])[data-kind="victory"] .event-content',
    );
    if (active) {
      banner.style.cssText =
        "position:relative;display:block;max-width:100%;background:#ffe099;color:#101827;font:700 12px system-ui;padding:8px;text-align:center;z-index:2000";
      active.prepend(banner);
    } else document.body.append(banner);
  });
  await page.screenshot({ path, fullPage: false });
  await page.locator("#testOnlyBanner").evaluate((el) => el.remove());
}
test("PNG real tem alpha transparente e conserva pixels centrais da fotografia original", async ({
  page,
}) => {
  await api(page);
  await ready(page);
  await expect
    .poll(() =>
      page
        .locator(".portrait-photo")
        .evaluateAll((nodes) =>
          nodes.every((n) => n.complete && n.naturalWidth > 0),
        ),
    )
    .toBe(true);
  const originals = await Promise.all(
    ["flavio-2026.jpg", "lula-oficial-2023.jpg"].map(
      async (file) =>
        "data:image/jpeg;base64," +
        (
          await readFile(
            new URL("../../public/images/" + file, import.meta.url),
          )
        ).toString("base64"),
    ),
  );
  const stats = await page.locator(".portrait-photo").evaluateAll(
    async (nodes, originals) =>
      Promise.all(
        nodes.map(async (img, index) => {
          const c = document.createElement("canvas");
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          const context = c.getContext("2d");
          context.drawImage(img, 0, 0);
          const pixels = context.getImageData(0, 0, c.width, c.height).data;
          let transparent = 0;
          for (let i = 3; i < pixels.length; i += 4)
            if (pixels[i] === 0) transparent++;
          const point = [
            Math.floor(c.width * 0.5),
            Math.floor(c.height * 0.35),
          ];
          const actual = [...context.getImageData(...point, 1, 1).data];
          const original = new Image();
          original.src = originals[index];
          await original.decode();
          context.clearRect(0, 0, c.width, c.height);
          context.drawImage(
            original,
            index === 1 ? -200 : 0,
            index === 1 ? -60 : 0,
          );
          const expected = [...context.getImageData(...point, 1, 1).data];
          return {
            png: img.src.endsWith(".png"),
            transparent: transparent / (c.width * c.height),
            actual,
            expected,
          };
        }),
      ),
    originals,
  );
  for (const image of stats) {
    expect(image.png).toBe(true);
    expect(image.transparent).toBeGreaterThan(0.2);
    expect(image.actual[3]).toBe(255);
    for (let i = 0; i < 3; i++)
      expect(Math.abs(image.actual[i] - image.expected[i])).toBeLessThanOrEqual(
        1,
      );
  }
});
test("fundo por trás dos PNGs ocupa 75/25 e fica neutro sem percentuais", async ({
  page,
}) => {
  let current = eventResult(75, 25);
  await eventAPI(page, () => current);
  await ready(page);
  await expect
    .poll(() =>
      page.locator("#heroColorBlue").evaluate((el) => el.style.width),
    )
    .toBe("75%");
  await expect
    .poll(() =>
      page.locator("#heroColorRed").evaluate((el) => el.style.width),
    )
    .toBe("25%");
  await expect
    .poll(() =>
      page
        .locator("#heroColorBlue")
        .evaluate(
          (el) =>
            el.getBoundingClientRect().width /
            el.parentElement.getBoundingClientRect().width,
        ),
    )
    .toBeCloseTo(0.75, 2);
  await labelledCapture(page, "test-results/png-proportional-colors.png");
  current = {
    ...current,
    candidatos: current.candidatos.map((c) => ({ ...c, percentual: null })),
  };
  await page
    .getByRole("button", { name: "Configurações", exact: true })
    .click();
  await page.locator("#refreshBtn").click();
  await expect(page.locator("#heroColorField")).toHaveAttribute(
    "data-valid",
    "false",
  );
  await expect
    .poll(() =>
      page.locator("#heroColorBlue").evaluate((el) => el.style.width),
    )
    .toBe("0%");
});
test("viradas têm sinais distintos, sem alerta inicial, com áudio só após ativação e retorno automático", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-25T20:00Z") });
  let stage = 0;
  await eventAPI(page, () =>
    stage === 0
      ? eventResult(60, 40)
      : stage === 1
        ? eventResult(40, 60, 1)
        : eventResult(70, 30, 2),
  );
  await ready(page);
  await expect(page.locator("#electionEvent")).toBeHidden();
  await expect(page.locator("#soundToggle")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await page.locator("#soundToggle").click();
  await expect(page.locator("#soundToggle")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  stage = 1;
  await page.clock.fastForward(3100);
  await expect(page.locator("#electionEvent")).toBeVisible();
  await expect(page.locator("#electionEvent")).toHaveAttribute(
    "data-color",
    "red",
  );
  await expect(page.locator("#eventName")).toHaveText("Lula");
  await page.locator("[data-event-close]").click();
  stage = 2;
  await page.clock.fastForward(3100);
  await expect(page.locator("#electionEvent")).toHaveAttribute(
    "data-color",
    "blue",
  );
  await expect(page.locator("#eventName")).toHaveText("Flávio Bolsonaro");
  await page.clock.fastForward(4600);
  await expect(page.locator("#electionEvent")).toBeHidden();
  await page.locator("#soundToggle").click();
  await expect(page.locator("#soundToggle")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});
test("vitória oficial ocupa a tela, respeita foco e fecha sozinha sem repetir a animação", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-25T20:00Z") });
  let won = false;
  await eventAPI(page, () =>
    won ? eventResult(40, 60, 1, true) : eventResult(40, 60),
  );
  await ready(page);
  won = true;
  await page.clock.fastForward(3100);
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator("#eventMessage")).toHaveText("VENCEU A ELEIÇÃO");
  await expect(page.locator("#electionEvent")).toHaveAttribute(
    "data-color",
    "red",
  );
  expect(await page.locator("#app").evaluate((el) => el.inert)).toBe(true);
  await expect(page.locator("[data-event-close]")).toBeFocused();
  await labelledCapture(page, "test-results/official-victory-overlay.png");
  await page.clock.fastForward(8100);
  await expect(page.locator("#electionEvent")).toBeHidden();
  expect(await page.locator("#app").evaluate((el) => el.inert)).toBe(false);
  await expect(page.locator("#winnerConfirmation")).toContainText("Lula");
  await page.clock.fastForward(3100);
  await expect(page.locator("#electionEvent")).toBeHidden();
});
test("vitória independente não vira anúncio oficial e movimento reduzido desliga confetes", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install({ time: new Date("2026-10-25T20:00Z") });
  let won = false;
  await eventAPI(page, () => ({
    ...eventResult(40, 60, won ? 1 : 0, won),
    provider: "placar-do-voto",
    sourceKind: "independent-tse-derived",
  }));
  await ready(page);
  won = true;
  await page.clock.fastForward(3100);
  await expect(page.locator("#electionEvent")).toBeHidden();
  await expect(page.locator("#winnerConfirmation")).toBeHidden();
  expect(
    await page
      .locator(".event-particles")
      .evaluate((el) => getComputedStyle(el).display),
  ).toBe("none");
});
test("Pages consulta TSE automaticamente, respeita cache e mantém a mesma página atualizada", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-25T20:00Z") });
  await page.unroute("https://resultados.tse.jus.br/**");
  const raw = JSON.parse(
    await readFile(
      new URL("../fixtures/tse-current.json", import.meta.url),
      "utf8",
    ),
  );
  let calls = 0;
  await page.route("https://resultados.tse.jus.br/**", async (route) => {
    calls++;
    const body = structuredClone(raw);
    body.dg = "25/10/2026";
    body.hg = calls === 1 ? "17:00:00" : "17:01:00";
    body.s = { ts: "100", st: "50", pst: "50" };
    body.v = { vv: "100", vvc: "100" };
    for (const group of body.carg[0].agr)
      for (const party of group.par)
        for (const c of party.cand) {
          c.vap = String(
            c.n === "22" ? (calls === 1 ? 75 : 35) : calls === 1 ? 25 : 65,
          );
          c.pvap = c.vap;
        }
    await route.fulfill({
      json: body,
      headers: {
        "access-control-allow-origin": "*",
        "cache-control": "max-age=56",
      },
    });
  });
  await page.goto("http://127.0.0.1:4174/voto-aberto-2026/");
  await expect(page.locator("#connection")).toContainText("TSE ao vivo");
  await expect(page.locator(".candidate--blue .candidate__pct")).toHaveText(
    "75,00%",
  );
  expect(calls).toBe(1);
  await page.clock.fastForward(3100);
  expect(calls).toBe(1);
  await page.clock.fastForward(60100);
  await expect(page.locator(".candidate--blue .candidate__pct")).toHaveText(
    "35,00%",
  );
  expect(calls).toBe(2);
  await expect(page.locator("#electionEvent")).toHaveAttribute(
    "data-kind",
    "lead",
  );
});

test("pausar atualização automática do backend interrompe polling sem disparar eventos", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-25T20:00Z") });
  let calls = 0;
  await eventAPI(page, (url) => {
    if (url.searchParams.get("scope") === "brasil") calls++;
    return eventResult(60, 40);
  });
  await ready(page);
  await page.locator("#liveUpdatesToggle").uncheck();
  await expect(page.locator("#liveStatus")).toContainText("pausada");
  const before = calls;
  await page.clock.fastForward(10000);
  expect(calls).toBe(before);
  await expect(page.locator("#electionEvent")).toBeHidden();
});
