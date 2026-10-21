const { test, expect } = require('../support/playwright.cjs');

test.describe('Accueil - Portail Hesta', () => {
  test('la communaute utilise le portail et le support utilise les Issues officielles', async ({ page }) => {
    const calls = []; page.on('request', r => calls.push(r.url()));
    await page.goto('/');
    await expect(page.locator('body')).toHaveClass(/home-ready/);
    await expect(page.locator('#home-community-portal-link')).toHaveAttribute('href', 'https://hesta.dannytech.fr/');
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

for (const width of [390, 1280]) {
  test('le bouton communautaire ne chevauche pas le texte à ' + width + 'px', async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.locator('body')).toHaveClass(/home-ready/);
    // Capture in one rendering task: the card's entry animation moves all three.
    const { text, button, support } = await page.locator('#home-community').evaluate(card => {
      const box = selector => {
        const r = card.querySelector(selector).getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      };
      return { text: box(':scope > .home-muted'), button: box('#home-community-portal-link'), support: box('.home-support-panel') };
    });
    expect(text).toBeTruthy(); expect(button).toBeTruthy(); expect(support).toBeTruthy();
    expect(button.y).toBeGreaterThanOrEqual(text.y + text.height + 10);
    expect(support.y).toBeGreaterThanOrEqual(button.y + button.height);
    expect(button.x).toBeGreaterThanOrEqual(0);
    expect(button.x + button.width).toBeLessThanOrEqual(width);
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
    await expect(page.locator('#home-support-title')).toBeVisible();

    const hasHorizontalOverflow = await page.evaluate(() => (
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
    ));
    expect(hasHorizontalOverflow).toBeFalsy();

    const navBox = await page.locator('.home-nav').boundingBox();
    const headerBox = await page.locator('.home-header').boundingBox();
    expect(navBox).toBeTruthy();
    expect(headerBox).toBeTruthy();
    expect(navBox.width).toBeLessThanOrEqual(headerBox.width);

    const roll20Links = page.locator('.home-support-roll20-list .home-link-button');
    await expect(roll20Links.first()).toBeVisible();
    const firstWishlistBox = await roll20Links.first().boundingBox();
    expect(firstWishlistBox).toBeTruthy();
    expect(firstWishlistBox.width).toBeGreaterThan(280);
    expect(firstWishlistBox.width).toBeLessThanOrEqual(366);
  });
});
