import { expect, test, type Page } from '@playwright/test';

const API_URL = 'http://localhost:4000';
const EMAIL = `e2e-playwright-${Date.now()}@example.com`;
const PASSWORD = 'supersecret123';

// PNG 1x1 válido — a API verifica os magic bytes no complete do upload.
const PIXEL_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
    '1f15c4890000000d49444154789c626001000000ffff03000006000557' +
    'bfabd40000000049454e44ae426082',
  'hex',
);

function platformCard(page: Page, handle: string) {
  return page.locator('div.rounded-lg').filter({ hasText: handle });
}

test.beforeAll(async ({ request }) => {
  const health = await request.get(`${API_URL}/health`).catch(() => null);
  const web = await request.get('http://localhost:3000').catch(() => null);
  if (!health?.ok() || !web) {
    throw new Error(
      'Ambiente local fora do ar. Rode `docker compose up -d` e `pnpm dev` antes de `pnpm test:e2e`.',
    );
  }
});

test('fluxo completo: cadastro → conexões mock → composição → falha parcial → retry isolado', async ({
  page,
}) => {
  // 1. Cadastro + login automático
  await page.goto('/register');
  await page.getByLabel('Nome').fill('Testador Playwright');
  await page.getByLabel('E-mail').fill(EMAIL);
  await page.getByLabel('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await page.waitForURL('**/compose');
  await expect(page.getByRole('heading', { name: 'Nova publicação' })).toBeVisible();

  // 2. Conexão simulada das contas (fluxo OAuth mock real: authorize → callback)
  await page.goto('/connections');
  await expect(page.getByText('Modo de desenvolvimento (mock)')).toBeVisible();

  await platformCard(page, 'Publique textos de até 500 caracteres')
    .getByRole('button', { name: 'Conectar' })
    .click();
  await page.waitForURL('**/connections?connected=threads');
  await expect(page.getByText('@mock_threads')).toBeVisible();

  await platformCard(page, 'contagem ponderada')
    .getByRole('button', { name: 'Conectar' })
    .click();
  await page.waitForURL('**/connections?connected=x');
  await expect(page.getByText('@mock_x')).toBeVisible();

  // 3. Criação da publicação
  await page.goto('/compose');
  const longText = 'a'.repeat(300);
  await page.getByLabel('Texto da publicação').fill(longText);

  // 4. Ativação dos toggles
  await page.getByRole('switch', { name: 'Publicar no Threads' }).click();
  await page.getByRole('switch', { name: 'Publicar no X' }).click();

  // 5. Erro por limite no X — só o X invalida; Threads segue compatível
  await expect(page.getByText('Remova 20 caracteres para publicar no X.')).toBeVisible();
  const xCard = platformCard(page, '@mock_x');
  await expect(xCard.getByText('incompatível')).toBeVisible();
  await expect(platformCard(page, '@mock_threads').getByText('compatível')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Publicar em 2 plataformas' }),
  ).toBeDisabled();

  // 6. Texto personalizado para o X (com marcador de falha mock para o passo 10)
  await xCard.getByRole('button', { name: 'Personalizar texto' }).click();
  await page
    .getByLabel('Texto personalizado para X')
    .fill('Versão curta para o X que vai falhar de propósito [[mock:fail]]');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(xCard.getByText('texto personalizado', { exact: true })).toBeVisible();
  await expect(xCard.getByText('compatível', { exact: true }).first()).toBeVisible();
  // A personalização (curta) resolve o limite: o card do X sai do estado de erro.
  await expect(xCard.getByText('incompatível')).toHaveCount(0);

  // 7. Upload de imagem (PNG real via URL assinada + verificação de magic bytes)
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: PIXEL_PNG });
  await expect(page.getByText('pixel.png')).toBeVisible();
  await expect(page.getByLabel('Texto alternativo para pixel.png')).toBeVisible();
  await page.getByLabel('Texto alternativo para pixel.png').fill('um pixel de teste');

  // 8. Envio
  const publishButton = page.getByRole('button', { name: 'Publicar em 2 plataformas' });
  await expect(publishButton).toBeEnabled();
  await publishButton.click();
  await expect(page.getByRole('heading', { name: 'Confirmar publicação' })).toBeVisible();
  await expect(page.getByText('Personalização — X')).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar publicação' }).click();

  // 9. Acompanhamento do status (polling ao vivo até o resultado parcial)
  await page.waitForURL('**/history/**');
  await expect(page.getByText('Parcialmente publicada')).toBeVisible({ timeout: 30_000 });

  const threadsRow = page.locator('li').filter({ hasText: '@mock_threads' });
  await expect(threadsRow.getByText('Publicado', { exact: true })).toBeVisible();
  await expect(threadsRow.getByRole('link', { name: 'Abrir publicação' })).toBeVisible();

  const xRow = page.locator('li').filter({ hasText: '@mock_x' });
  await expect(xRow.getByText('Falhou')).toBeVisible();
  await expect(xRow.getByText('PROVIDER_REJECTED_CONTENT')).toBeVisible();
  await expect(xRow.getByText('1 tentativa', { exact: true })).toBeVisible();

  // 10. Retry SOMENTE da plataforma com falha — o Threads permanece intocado
  await xRow.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(xRow.getByText('2 tentativas')).toBeVisible({ timeout: 30_000 });
  await expect(xRow.getByText('Falhou')).toBeVisible(); // mock determinístico falha de novo
  await expect(threadsRow.getByText('1 tentativa', { exact: true })).toBeVisible();
  await expect(threadsRow.getByText('Publicado', { exact: true })).toBeVisible();
});
