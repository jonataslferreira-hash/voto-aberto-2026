import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: true,
  workers: 3,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:4173/voto-aberto-2026/",
    headless: true,
    launchOptions: {
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
        : {}),
      args: ["--no-sandbox"],
    },
  },
  webServer: [
    {
      command:
        "npm exec vite preview -- --host 127.0.0.1 --port 4175 --strictPort",
      url: "http://127.0.0.1:4175/voto-aberto-2026/",
      reuseExistingServer: !process.env.CI,
    },
    {
      command:
        "VITE_API_BASE_URL=http://127.0.0.1:4199 npm run dev:pages -- --host 127.0.0.1 --port 4173 --strictPort",
      url: "http://127.0.0.1:4173/voto-aberto-2026/",
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "npm run dev:pages -- --host 127.0.0.1 --port 4174 --strictPort",
      url: "http://127.0.0.1:4174/voto-aberto-2026/",
      reuseExistingServer: !process.env.CI,
    },
  ],
  reporter: [["list"], ["html", { open: "never" }]],
});
