const { test, expect } = require('../support/playwright.cjs');

test.describe('Geek Unchained - page publique', () => {
  test('presente Le Monde d Hesta et ses actions principales', async ({ page }) => {
    await page.goto('/geek-unchained/');
    await page.waitForLoadState('domcontentloaded');

    await expect(page).toHaveTitle(/Le Monde d'Hesta \| Geek Unchained Mulhouse/);
    await expect(page.locator('#gu-title')).toHaveText("Le Monde d'Hesta");
    await expect(page.locator('.gu-badge')).toContainText('Geek Unchained');
    await expect(page.locator('body')).toContainText('DnD sous steroides');
    await expect(page.locator('body')).toContainText('Comosicus');
    await expect(page.locator('body')).toContainText('Vikings de Dipovia');
    await expect(page.locator('a[href="/map/"]').first()).toBeVisible();
    await expect(page.locator('a[href="/timeline/"]').first()).toBeVisible();
    await expect(page.locator('a[href="https://discord.gg/sCFWb87SBY"]').first()).toBeVisible();
    await expect(page.locator('#gu-version')).toHaveText('0.17.49');
  });

  test('reste lisible sur mobile sans debordement horizontal', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/geek-unchained/');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('.gu-header')).toBeVisible();
    await expect(page.locator('#infos')).toContainText('A completer avec le QR code final');
    const hasHorizontalOverflow = await page.evaluate(() => (
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
    ));
    expect(hasHorizontalOverflow).toBeFalsy();
  });
});
