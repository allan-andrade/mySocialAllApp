import { defineConfig, devices } from '@playwright/test';

/**
 * E2E contra o ambiente local em modo mock (nenhuma API real de rede social).
 * Pré-requisitos: `docker compose up -d` + `pnpm dev` rodando (web 3000,
 * api 4000, worker consumindo a fila). O teste falha cedo com uma mensagem
 * clara se os servidores não estiverem no ar.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
