const { test, expect } = require('../support/playwright.cjs');

test.describe('Changelog - UI', () => {
  test('la page dediee affiche les versions depuis l API changelog', async ({ page }) => {
    await page.route('**/api/changelog**', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        source: 'config',
        entries: [
          {
            date: '2026-09-25',
            title: 'Version 0.17.49 - Acces au systeme PA',
            summary: 'Les versions visibles et les patch notes sont alignees.'
          },
          {
            date: '2026-05-12',
            title: 'Version 0.17.22 - Compteur Discord fiabilise',
            summary: 'Le compteur Discord affiche un fallback clair.'
          }
        ]
      })
    }));

    await page.goto('/changelog/');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('#changelog-title')).toContainText('Suivre les evolutions');
    await expect(page.locator('#changelog-version')).toHaveText('0.17.49');
    await expect(page.locator('#changelog-version-footer')).toHaveText('0.17.49');
    await expect(page.locator('#changelog-count')).toHaveText('2');
    await expect(page.locator('#changelog-source')).toHaveText('Config');
    await expect(page.locator('.changelog-entry')).toHaveCount(2);
    await expect(page.locator('.changelog-entry').first()).toContainText('Version 0.17.49 - Acces au systeme PA');
  });

  test('la page reste exploitable sur mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/changelog/');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('.changelog-header')).toBeVisible();
    await expect(page.locator('#changelog-list-title')).toBeVisible();

    const hasHorizontalOverflow = await page.evaluate(() => (
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
    ));
    expect(hasHorizontalOverflow).toBeFalsy();
  });
});
