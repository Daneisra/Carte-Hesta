const { test, expect, loginAsSyntheticAdmin } = require('../support/playwright.cjs');
const { locations: locationsByContinent } = require('../fixtures/application.cjs');

const normalizeText = value => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim();

const collectLocationNames = source => Object.values(source || {})
  .flatMap(entries => Array.isArray(entries) ? entries : [])
  .map(entry => entry?.name)
  .filter(Boolean);

const mapLocationNames = new Set(collectLocationNames(locationsByContinent).map(normalizeText));

const loadTimelineEntries = async page => {
  const response = await page.request.get('/api/timeline');
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  return Array.isArray(payload?.timeline?.entries) ? payload.timeline.entries : [];
};

const expandAllContinents = async page => {
  const toggles = page.locator('.continent-toggle');
  await toggles.first().waitFor();

  const count = await toggles.count();
  for (let i = 0; i < count; i += 1) {
    const toggle = toggles.nth(i);
    const expanded = await toggle.getAttribute('aria-expanded');
    if (expanded !== 'true') {
      await toggle.click();
    }
  }
};

const waitForAppReady = async page => {
  await loginAsSyntheticAdmin(page);
  await page.goto('/map/');
  await page.waitForLoadState('domcontentloaded');
  await expandAllContinents(page);
  await page.waitForSelector('.location:visible');
};

test.describe('Carte Interactive - UI', () => {
  test('sélection d’un lieu met à jour le panneau information', async ({ page }) => {
    await waitForAppReady(page);

    const firstLocation = page.locator('.location:visible').first();
    const expectedTitle = await firstLocation.locator('.location-label').innerText();

    await firstLocation.click();

    const sidebar = page.locator('#info-sidebar');
    await expect(sidebar).toHaveClass(/open/);
    await expect(page.locator('#info-title')).toHaveText(expectedTitle, { timeout: 10_000 });
  });

  test('un panneau rouvert reste visible apres la fermeture differee precedente', async ({ page }) => {
    await waitForAppReady(page);
    await page.clock.install();
    await page.evaluate(async () => {
      const { InfoPanel } = await import('../../js/ui/infoPanel.js');
      const sidebar = document.createElement('div');
      sidebar.id = 'reopened-panel-fixture';
      sidebar.textContent = 'Panneau synthetique';
      document.body.append(sidebar);
      const panel = new InfoPanel({ sidebar, tabsSelector: null, tabContentSelector: null });
      window.syntheticReopenedPanel = panel;
      panel.close();
      panel.show({ location: { name: 'Lieu synthetique' } });
    });
    await page.clock.fastForward(250);
    await expect(page.locator('#reopened-panel-fixture')).toBeVisible();
    await page.evaluate(() => window.syntheticReopenedPanel.close());
    await page.clock.fastForward(250);
    await expect(page.locator('#reopened-panel-fixture')).toBeHidden();
  });

  test('le clustering est activable/désactivable via la case à cocher', async ({ page }) => {
    await waitForAppReady(page);

    const toggle = page.locator('#clustering-toggle');
    await expect(toggle).toBeVisible();

    await toggle.check();
    await expect(toggle).toBeChecked();

    await toggle.uncheck();
    await expect(toggle).not.toBeChecked();
  });

  test('la galerie média affiche les vidéos d’un lieu avec un titre', async ({ page }) => {
    await waitForAppReady(page);

    await page.getByPlaceholder(/Rechercher un lieu/i).fill('Port des Tests');
    const targetLocation = page.locator('.location').filter({ hasText: /port des tests/i }).first();
    await expect(targetLocation).toBeVisible();
    await targetLocation.click();

    const galleryVideos = page.locator('#image-gallery .gallery-video-container');
    await expect(galleryVideos).not.toHaveCount(0);
    await expect(galleryVideos.first().locator('.gallery-video-title')).toHaveText(/.+/);
  });

  test('un lieu affiche les evenements lies dans la chronologie', async ({ page }) => {
    const entries = await loadTimelineEntries(page);
    const linkedEntries = entries
      .map(entry => {
        const names = Array.isArray(entry.locationNames) ? entry.locationNames : [];
        const matchingLocation = names.find(name => mapLocationNames.has(normalizeText(name)));
        return matchingLocation ? { entry, locationName: matchingLocation } : null;
      })
      .filter(Boolean);

    test.skip(!linkedEntries.length, 'Aucun evenement chronologique ne pointe vers un lieu de la carte.');

    const selectedLocationName = linkedEntries[0].locationName;
    const exactMatches = linkedEntries
      .filter(item => normalizeText(item.locationName) === normalizeText(selectedLocationName))
      .sort((left, right) => Number(left.entry?.year || 0) - Number(right.entry?.year || 0));

    await waitForAppReady(page);

    await page.getByPlaceholder(/Rechercher un lieu/i).fill(selectedLocationName);
    const targetLocation = page.locator('.location').filter({ hasText: new RegExp(selectedLocationName, 'i') }).first();
    await expect(targetLocation).toBeVisible();
    await targetLocation.click();

    const timelineSection = page.locator('#timeline-section');
    await expect(timelineSection).toBeVisible();
    await expect(timelineSection).toContainText(/Chronologie liee/i);
    await expect(timelineSection.locator('.timeline-link-card')).toHaveCount(exactMatches.length);
    await expect(timelineSection.locator('.timeline-link-title').first()).toHaveText(exactMatches[0].entry.title);
    await expect(timelineSection.locator('.timeline-link-button').first()).toHaveAttribute(
      'href',
      new RegExp(`/timeline/\\?event=${exactMatches[0].entry.id}`)
    );
  });

  test('la peinture ephemere trace et efface un schema local', async ({ page }) => {
    await waitForAppReady(page);

    const paintButton = page.locator('#temporary-paint');
    const clearButton = page.locator('#clear-temporary-paint');
    await expect(paintButton).toBeVisible();
    await expect(clearButton).toBeVisible();

    await paintButton.click();
    await expect(paintButton).toHaveAttribute('aria-pressed', 'true');

    const mapBox = await page.locator('#map').boundingBox();
    expect(mapBox).toBeTruthy();

    await page.mouse.click(mapBox.x + mapBox.width * 0.15, mapBox.y + mapBox.height * 0.20);
    await page.mouse.click(mapBox.x + mapBox.width * 0.25, mapBox.y + mapBox.height * 0.25);

    await expect(page.locator('.leaflet-overlay-pane path.temporary-paint-line')).toHaveCount(1);

    await clearButton.click();
    await expect(page.locator('.leaflet-overlay-pane path.temporary-paint-line')).toHaveCount(0);
  });

  test('le bouton theme clair de la barre d outil applique le theme', async ({ page }) => {
    await waitForAppReady(page);

    const lightButton = page.locator('#theme-toggle [data-theme="light"]');
    const darkButton = page.locator('#theme-toggle [data-theme="dark"]');

    await expect(lightButton).toBeVisible();
    await lightButton.click();

    await expect(page.locator('body')).toHaveAttribute('data-theme', 'light');
    await expect(lightButton).toHaveAttribute('aria-pressed', 'true');
    await expect(darkButton).toHaveAttribute('aria-pressed', 'false');
  });
});

test.describe('Carte Interactive - mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('la carte garde une barre mobile compacte et un panneau lieu exploitable', async ({ page }) => {
    await waitForAppReady(page);

    await expect(page.locator('#map-controls')).toBeVisible();
    const hasHorizontalOverflow = await page.evaluate(() => (
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
    ));
    expect(hasHorizontalOverflow).toBeFalsy();

    const controlsBox = await page.locator('#map-controls').boundingBox();
    expect(controlsBox).toBeTruthy();
    expect(controlsBox.height).toBeLessThanOrEqual(74);

    const firstLocation = page.locator('.location:visible').first();
    await firstLocation.click();

    const sidebar = page.locator('#info-sidebar');
    await expect(sidebar).toHaveClass(/open/);
    await expect(sidebar).toBeVisible();
    const infoBox = await sidebar.boundingBox();
    expect(infoBox).toBeTruthy();
    expect(infoBox.width).toBeGreaterThan(360);
    expect(infoBox.y).toBeGreaterThan(0);
  });
});
