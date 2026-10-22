const { test, expect } = require('../support/playwright.cjs');

test.describe('Accueil - Portail Hesta', () => {
  test('la communaute utilise le portail et le support utilise les Issues officielles', async ({ page }) => {
    const calls = []; page.on('request', r => calls.push(r.url()));
    await page.goto('/');
    await expect(page.locator('body')).toHaveClass(/home-ready/);
    const communityLink = page.locator('.home-nav a[href="https://hesta.dannytech.fr/#communaute"]');
    await expect(communityLink).toHaveText('Communaute');
    await expect(communityLink).not.toHaveAttribute('target');
    await expect(page.locator('#home-community, .home-support-panel')).toHaveCount(0);
    await expect(page.locator('a[href*="paypal.me"], a[href*="ko-fi.com"], a[href*="app.roll20.net/wishlist"]')).toHaveCount(0);
    await expect(page.locator('#home-footer-support')).toHaveAttribute('href', 'https://github.com/Daneisra/Carte-Hesta/issues/new/choose');
    await expect(page.locator('a[href*="github.com/Daneisra/"]')).toHaveCount(1);
    await expect(page.locator('a[href*="Carte-Interactive"]')).toHaveCount(0);
    await expect(page.locator('#home-discord-widget, #home-community-discord-proof')).toHaveCount(0);
    expect(calls.some(url => /widget|api\/community\/discord/.test(url))).toBe(false);
  });
  test('les actualites narratives restent distinctes des versions techniques', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#home-news-title')).toHaveText('Actualités du Monde d’Hesta');
    await expect(page.locator('#home-changelog-title')).toHaveText('Mises à jour de Carte Hesta');
    await expect(page.locator('#home-changelog-note')).toContainText(/techniques/);
    const paLink = page.locator('.home-nav a[href="https://pahesta.dannytech.fr/"]');
    await expect(paLink).toHaveText('Système PA'); await expect(paLink).not.toHaveAttribute('target');
  });
});

for (const width of [320, 390, 768, 1280]) {
  test('Accueil - navigation communautaire et cartes lisibles a ' + width + 'px', async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.locator('body')).toHaveClass(/home-ready/);
    const communityLink = page.locator('.home-nav a[href="https://hesta.dannytech.fr/#communaute"]');
    await expect(communityLink).toBeVisible();
    await expect(page.locator('.home-grid-topics > article:visible')).toHaveCount(2);
    const layout = await page.locator('.home-grid-topics').evaluate(grid => ({
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
      cards: Array.from(grid.children).filter(card => !card.hidden).map(card => {
        const { x, width: cardWidth } = card.getBoundingClientRect();
        return { x, width: cardWidth };
      })
    }));
    expect(layout.overflow).toBe(false);
    expect(layout.columns).toBe(width === 1280 ? 2 : 1);
    for (const card of layout.cards) {
      expect(card.x).toBeGreaterThanOrEqual(0);
      expect(card.x + card.width).toBeLessThanOrEqual(width);
    }
  });
}

test.describe('Accueil - patch notes', () => {
  test('affiche les derniers changements depuis l API changelog', async ({ page }) => {
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
          }
        ]
      })
    }));

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('#home-changelog-title')).toHaveText('Mises à jour de Carte Hesta');
    await expect(page.locator('#home-version')).toHaveText('0.17.49');
    await expect(page.locator('#home-changelog-status')).toHaveText('A jour');
    await expect(page.locator('.home-changelog-item')).toHaveCount(1);
    await expect(page.locator('.home-changelog-item').first()).toContainText('Version 0.17.49 - Acces au systeme PA');
    await expect(page.locator('.site-footer-links a[href="/geek-unchained/"]')).toHaveText('Geek Unchained');
    await expect(page.locator('a[href="/changelog/"]').first()).toBeVisible();
  });
});

test.describe('Accueil - mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('la page accueil reste lisible et sans debordement horizontal sur telephone', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('body')).toHaveClass(/home-ready/);

    await expect(page.locator('.home-header')).toBeVisible();
    await expect(page.locator('.home-nav')).toBeVisible();
    await expect(page.locator('.home-nav a[href="/changelog/"]')).toHaveText('Changelog');
    await expect(page.locator('.home-nav a[href="/planning/"]')).toHaveText('Planning');
    await expect(page.locator('.home-nav a[href="https://pahesta.dannytech.fr/"]')).toHaveText('Système PA');
    await expect(page.locator('#home-enter-map')).toBeVisible();
    await expect(page.locator('#home-community, #home-support-title')).toHaveCount(0);

    const hasHorizontalOverflow = await page.evaluate(() => (
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
    ));
    expect(hasHorizontalOverflow).toBeFalsy();

    const navBox = await page.locator('.home-nav').boundingBox();
    const headerBox = await page.locator('.home-header').boundingBox();
    expect(navBox).toBeTruthy();
    expect(headerBox).toBeTruthy();
    expect(navBox.width).toBeLessThanOrEqual(headerBox.width);

    await expect(page.locator('.home-nav a[href="https://hesta.dannytech.fr/#communaute"]')).toBeVisible();
  });
});
