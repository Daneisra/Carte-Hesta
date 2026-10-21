const { test, expect, loginAsSyntheticAdmin } = require('../support/playwright.cjs');

const ADMIN_SESSION = {
  authenticated: true,
  role: 'admin',
  username: 'Responsive Admin',
  avatar: '',
  provider: 'discord',
  discordId: 'responsive-admin',
  groups: [],
  groupDetails: [],
  characters: [],
  availability: { timezone: 'Europe/Warsaw', slots: [] },
  profile: {},
  account: {}
};

const mockAdminSession = async page => {
  await loginAsSyntheticAdmin(page);
  await page.route('**/auth/session', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(ADMIN_SESSION)
    });
  });
};

const expectNoDocumentOverflow = async page => {
  const metrics = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    htmlClientWidth: document.documentElement.clientWidth,
    htmlScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body?.scrollWidth || 0
  }));

  expect(metrics.htmlScrollWidth).toBeLessThanOrEqual(metrics.htmlClientWidth + 2);
  expect(metrics.bodyScrollWidth).toBeLessThanOrEqual(metrics.viewportWidth + 2);
};

const expectPanelFitsViewport = async (page, panelSelector) => {
  const metrics = await page.locator(panelSelector).evaluate(panel => {
    const rect = panel.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      width: Math.ceil(rect.width),
      height: Math.ceil(rect.height),
      left: Math.floor(rect.left),
      top: Math.floor(rect.top)
    };
  });

  expect(metrics.left).toBeGreaterThanOrEqual(0);
  expect(metrics.top).toBeGreaterThanOrEqual(0);
  expect(metrics.width).toBeLessThanOrEqual(metrics.viewportWidth);
  expect(metrics.height).toBeLessThanOrEqual(metrics.viewportHeight);
};

test.describe('QA responsive mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('les pages publiques et la carte autorisee ne debordent pas horizontalement', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('body')).toHaveClass(/home-ready/);
    await expectNoDocumentOverflow(page);

    await page.goto('/timeline/');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.timeline-header')).toBeVisible();
    await expectNoDocumentOverflow(page);

    await loginAsSyntheticAdmin(page);
    await page.goto('/map/');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#map-controls')).toBeVisible({ timeout: 10000 });
    await expectNoDocumentOverflow(page);
  });

  test('l editeur de lieu reste utilisable comme formulaire long sur mobile', async ({ page }) => {
    await mockAdminSession(page);

    await page.goto('/map/');
    await page.waitForLoadState('domcontentloaded');

    const addButton = page.locator('#add-location');
    await expect(addButton).toBeVisible({ timeout: 10000 });
    await addButton.click();

    await expect(page.locator('#location-editor')).toBeVisible();
    await expectPanelFitsViewport(page, '.editor-dialog');

    const contentMetrics = await page.locator('.editor-content').evaluate(content => ({
      clientWidth: content.clientWidth,
      scrollWidth: content.scrollWidth
    }));
    expect(contentMetrics.scrollWidth).toBeLessThanOrEqual(contentMetrics.clientWidth + 1);

    const closeBox = await page.locator('#location-editor-close').boundingBox();
    expect(closeBox).toBeTruthy();
    expect(closeBox.height).toBeGreaterThanOrEqual(44);

    const nameBox = await page.locator('#editor-name').boundingBox();
    expect(nameBox).toBeTruthy();
    expect(nameBox.height).toBeGreaterThanOrEqual(44);
  });
});
