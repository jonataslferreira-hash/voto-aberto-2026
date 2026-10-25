import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
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
  { result = normalized, history = [], locations = [] } = {},
) {
  await page.route("http://127.0.0.1:4199/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/results")
      await route.fulfill({
        json: { ...result, scope: url.searchParams.get("scope") },
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
    const left = await page.locator(".candidate--blue").boundingBox(),
      right = await page.locator(".candidate--red").boundingBox();
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
    "Sem histórico disponível",
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
  const path = page.locator('[data-series="flavio"]');
  await expect(path).toHaveAttribute("d", /^M[^L]+ M/);
  await page.locator('[data-point="0"]').focus();
  await expect(page.locator("#chartTooltip")).toContainText("55,00%");
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
  await page.route("**/images/*.jpg", (r) => r.abort());
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
  await expect(page.locator("#allCandidates .candidate-table>div")).toHaveCount(
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
  await expect(
    page.locator(".candidate--blue .portrait-fallback"),
  ).toBeVisible();
});
test("2022 apresenta os dois turnos, candidatos corretos e origem histórica explícita", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:4174/voto-aberto-2026/");
  await page.locator("#yearSelect").selectOption("2022");
  await expect(page.locator("#resultStatus")).toHaveText(
    "Totalização finalizada",
  );
  await expect(page.locator("#allCandidates .candidate-table>div")).toHaveCount(
    2,
  );
  await expect(page.locator(".candidate--blue h2")).toHaveText(
    "JAIR BOLSONARO",
  );
  await expect(page.locator(".candidate--red .candidate__votes")).toContainText(
    "60.345.999",
  );
  await expect(page.locator("#notice")).toContainText(
    "Arquivo histórico independente",
  );
  await page.locator("#turnSelect").selectOption("1");
  await expect(page.locator("#allCandidates .candidate-table>div")).toHaveCount(
    11,
  );
  await expect(
    page.locator(".candidate--blue .candidate__votes"),
  ).toContainText("51.072.345");
  await expect(page.locator(".candidate--red .candidate__votes")).toContainText(
    "57.259.504",
  );
  await expect(
    page.locator(".candidate--blue .portrait-fallback"),
  ).toBeVisible();
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
  await api(page);
  await ready(page);
  await page.locator("#turnSelect").selectOption("1");
  await expect(page.locator("#notice")).toContainText(
    "Backend não confirmou o ano/turno solicitado",
  );
  await expect(page.locator(".candidate__votes").first()).toContainText("—");
});
