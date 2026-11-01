import { expect, test, type Page } from '@playwright/test';

async function openOverview(page: Page) {
  await page.goto('/');
  await expect(page.locator('#thread')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('heading', { name: /O que você quer saber/ })).toBeVisible();
}

async function openNavigation(page: Page) {
  const toggle = page.getByRole('button', { name: 'Mostrar navegação' });
  if (await toggle.isVisible()) await toggle.click();
}

async function openLibrary(page: Page) {
  await openNavigation(page);
  await page.getByRole('button', { name: /Fontes de conhecimento/ }).click();
}

test('início: consulta, guia, filtro e layout sem rolagem horizontal', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openOverview(page);
  await expect(page.locator('.home-composer textarea')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'O que você quer saber?' })).toBeInViewport();
  await expect(page.locator('#input')).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Todas as fontes', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Todas as fontes' }).uncheck();
  await expect(page.locator('#scope-label')).toHaveText('0 fontes');
  await page.keyboard.press('Escape');
  await expect(page.locator('#scope-menu')).toBeHidden();
  await page.locator('#scope-button').click();
  await page.getByRole('checkbox', { name: 'Todas as fontes' }).check();
  await page.keyboard.press('Escape');
  await openNavigation(page);
  await page.getByRole('button', { name: 'Como usar o Nexo' }).click();
  await expect(page.getByRole('dialog', { name: 'Do documento à resposta.' })).toBeVisible();
  await expect(page.locator('.guide-steps li')).toHaveCount(3);
  await page.getByRole('button', { name: /Entendi, vamos começar/ }).click();
  await expect(page.locator('#input')).toBeFocused();
  await page.locator('#input').blur();
  await page.locator('#thread').evaluate((el) => { el.scrollTo({ top: 0, behavior: 'instant' }); });
  await page.screenshot({ path: `test-results/overview-${test.info().project.name}.png`, fullPage: true, scale: 'css', animations: 'disabled' });
  expect(errors).toEqual([]);
});

test('pergunta, streaming, citação, retorno ao início e histórico', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openOverview(page);
  await page.locator('#input').fill('Como faço o rollback do auth-service?');
  await page.locator('#input').press('Enter');
  await expect(page.locator('.msg-assistant .answer')).toContainText('Segundo as fontes');
  await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toBeDisabled();
  await page.screenshot({ path: `test-results/conversation-${test.info().project.name}.png`, scale: 'css', animations: 'disabled' });
  await page.locator('.ref').first().click();
  await expect(page.getByRole('complementary', { name: 'Trecho original do documento' })).toBeVisible();
  await expect(page.locator('#drawer-body blockquote')).not.toBeEmpty();
  await page.getByRole('button', { name: 'Fechar trecho' }).click();
  await expect(page.locator('#drawer')).toBeHidden();
  const conversationUrl = page.url();
  await openNavigation(page);
  await page.getByRole('link', { name: 'Nexo, início' }).click();
  await expect(page.locator('.home-composer textarea')).toBeVisible();
  await expect(page.getByRole('heading', { name: /O que você quer saber/ })).toBeInViewport();
  await page.locator('#input').fill('Qual equipe mantém o billing-api?');
  await page.locator('#input').press('Enter');
  await expect(page.locator('.msg-user')).toHaveText('Qual equipe mantém o billing-api?');
  await expect(page.locator('.msg-assistant .answer')).toContainText('Segundo as fontes');
  await page.goto(conversationUrl);
  await expect(page.locator('.msg-user')).toContainText('rollback');
  expect(errors).toEqual([]);
});

test('biblioteca: documentos, formulário preservado e foco contido no painel', async ({ page }) => {
  await openOverview(page);
  await openLibrary(page);
  const panel = page.getByRole('dialog', { name: 'Tudo começa com uma boa fonte.' });
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Documentos', exact: true }).first().click();
  await expect(panel.locator('.docs li')).toHaveCount(26);
  await panel.locator('[data-add="confluence"]').click();
  await panel.getByRole('textbox', { name: 'Nome da fonte' }).fill('Wiki do produto');
  await panel.getByRole('button', { name: 'Documentos', exact: true }).first().click();
  await expect(panel.getByRole('textbox', { name: 'Nome da fonte' })).toHaveValue('Wiki do produto');
  await panel.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.getByRole('button', { name: 'Fechar fontes' }).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(panel.locator('summary')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Fechar fontes' })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/library-${test.info().project.name}.png`, fullPage: true, scale: 'css', animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  const toggle = page.getByRole('button', { name: 'Mostrar navegação' });
  await expect(await toggle.isVisible() ? toggle : page.getByRole('button', { name: /Fontes de conhecimento/ })).toBeFocused();
});

test('primeiro uso: criar fonte, enviar documento e consultar o conteúdo', async ({ page, request }) => {
  const origin = 'http://127.0.0.1:3199';
  const { sources } = await (await request.get(`${origin}/api/fontes`)).json();
  for (const source of sources) await request.delete(`${origin}/api/fontes/${source.id}`);
  await page.goto(origin);
  await expect(page.locator('#thread')).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: 'Adicionar documentos para começar' }).click();
  await page.locator('[data-add="upload"]').click();
  await page.getByRole('textbox', { name: 'Nome da fonte' }).fill('Manual de integração');
  await page.getByRole('button', { name: 'Criar fonte', exact: true }).click();
  const source = page.locator('.source').filter({ hasText: 'Manual de integração' });
  await expect(source).toBeVisible();
  const fileChooser = page.waitForEvent('filechooser');
  await source.getByRole('button', { name: 'Enviar arquivos', exact: true }).click();
  await (await fileChooser).setFiles({
    name: 'boas-vindas.md', mimeType: 'text/markdown',
    buffer: Buffer.from('# Manual de integração\n\n## Primeiro acesso\nO primeiro acesso deve ser solicitado no canal #acessos. A equipe de Plataforma atende as solicitações em dias úteis.'),
  });
  await expect(source.locator('.source-stats')).toContainText('1 documento');
  await page.getByRole('button', { name: 'Fechar fontes' }).click();
  await expect(page.getByRole('button', { name: 'Adicionar documentos para começar' })).toBeHidden();
  await page.locator('#input').fill('Como solicitar o primeiro acesso?');
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(page.locator('.msg-assistant .answer')).toContainText('#acessos');
  await expect(page.locator('.ref')).toHaveCount(1);
});

test('aparência: sistema, preferência persistida e tema escuro em todos os painéis', async ({ page, context }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openOverview(page);
  await expect(page).toHaveTitle('Nexo · Conhecimento da equipe');
  const root = page.locator('html');
  const appearance = page.getByRole('combobox', { name: 'Aparência' });
  await expect(appearance).toBeInViewport();
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(appearance).toHaveValue('system');
  await appearance.selectOption('light');
  await expect(root).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(root).toHaveAttribute('data-theme', 'light');
  await appearance.selectOption('system');
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(root).toHaveAttribute('data-theme', 'light');
  await appearance.selectOption('dark');
  await page.reload();
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(appearance).toHaveValue('dark');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(28, 28, 30)');

  const secondTab = await context.newPage();
  await openOverview(secondTab);
  await expect(secondTab.locator('html')).toHaveAttribute('data-theme', 'dark');
  await secondTab.getByRole('combobox', { name: 'Aparência' }).selectOption('light');
  await expect(root).toHaveAttribute('data-theme', 'light');
  await secondTab.close();
  await appearance.selectOption('dark');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/overview-dark-${test.info().project.name}.png`, scale: 'css', animations: 'disabled' });

  await openLibrary(page);
  const library = page.getByRole('dialog', { name: 'Tudo começa com uma boa fonte.' });
  await expect(library).toHaveCSS('background-color', 'rgb(36, 36, 39)');
  await page.screenshot({ path: `test-results/library-dark-${test.info().project.name}.png`, scale: 'css', animations: 'disabled' });
  await page.keyboard.press('Escape');
  await openNavigation(page);
  await page.getByRole('button', { name: 'Como usar o Nexo' }).click();
  await expect(page.locator('#guide')).toHaveCSS('background-color', 'rgb(36, 36, 39)');
  await page.keyboard.press('Escape');
  await page.locator('#input').fill('Como faço o rollback do auth-service?');
  await page.locator('#input').press('Enter');
  await expect(page.locator('.msg-assistant .answer')).toContainText('Segundo as fontes');
  await page.screenshot({ path: `test-results/conversation-dark-${test.info().project.name}.png`, scale: 'css', animations: 'disabled' });
  await page.locator('.ref').first().click();
  await expect(page.locator('#drawer')).toHaveCSS('background-color', 'rgb(32, 32, 35)');
  await page.screenshot({ path: `test-results/citation-dark-${test.info().project.name}.png`, scale: 'css', animations: 'disabled' });
});

test('aparência continua funcionando quando o navegador bloqueia armazenamento local', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(Storage.prototype, 'getItem', { value() { throw new Error('Armazenamento bloqueado'); } });
    Object.defineProperty(Storage.prototype, 'setItem', { value() { throw new Error('Armazenamento bloqueado'); } });
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await openOverview(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('combobox', { name: 'Aparência' }).selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(errors).toEqual([]);
});

test('navegação recolhível preserva o rascunho e devolve o foco', async ({ page }, testInfo) => {
  await openOverview(page);
  await page.locator('#input').fill('Uma pergunta ainda não enviada');
  if (testInfo.project.name === 'mobile') await openNavigation(page);
  await page.getByRole('button', { name: 'Recolher navegação' }).click();
  const toggle = page.getByRole('button', { name: 'Mostrar navegação' });
  await expect(toggle).toBeFocused();
  await expect(page.getByRole('button', { name: 'Nova conversa', exact: true })).not.toBeInViewport();
  await expect(page.locator('#input')).toHaveValue('Uma pergunta ainda não enviada');
  await toggle.click();
  await expect(page.getByRole('button', { name: 'Nova conversa', exact: true })).toBeVisible();
  await expect(page.locator('#input')).toHaveValue('Uma pergunta ainda não enviada');
  await page.getByRole('button', { name: 'Nova conversa', exact: true }).click();
  await expect(page.locator('#input')).toBeFocused();
  await expect(page.locator('.home-composer')).toBeVisible();
});
