const { test, expect, loginAsSyntheticAdmin } = require('../support/playwright.cjs');

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
  await page.waitForSelector('.location');
};

const getVisibleLocationNames = async page => {
  const names = await page.locator('.location:visible .location-label').allTextContents();
  return names.map(name => name.trim());
};

const searchLocations = async (page, params = {}) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach(entry => search.append(key, entry));
      return;
    }
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, value);
    }
  });
  const suffix = search.toString();
  const response = await page.request.get(`/api/locations/search${suffix ? `?${suffix}` : ''}`);
  expect(response.ok()).toBeTruthy();
  return response.json();
};

test.describe('Filtres avancés', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => console.log(`[console:${msg.type()}] ${msg.text()}`));
    page.on('pageerror', error => console.log(`[pageerror] ${error.message}`));
  });

  test('filtre par tag, statut et réinitialisation', async ({ page }) => {
    await waitForAppReady(page);

    const baselineNames = await getVisibleLocationNames(page);
    const dataset = await searchLocations(page);
    const availableTags = dataset.facets?.dataset?.tags || [];
    const availableStatuses = dataset.facets?.dataset?.statuses || [];

    let tagCandidate = null;
    let tagResults = null;
    for (const facet of availableTags) {
      const candidate = await searchLocations(page, { tags: facet.value });
      if (candidate.count > 0) {
        tagCandidate = facet;
        tagResults = candidate;
        break;
      }
    }

    expect(tagCandidate).toBeTruthy();
    expect(tagResults).toBeTruthy();

    await page.locator('#filters-advanced-toggle').click();
    const tagChip = page.locator('#filter-tags label', { hasText: new RegExp(tagCandidate.label, 'i') });
    await tagChip.click();

    let names = await getVisibleLocationNames(page);
    expect(names.sort()).toEqual(tagResults.results.map(entry => entry.name).sort());

    await page.locator('input[name="filter-quests"][value="without"]').check();
    names = await getVisibleLocationNames(page);
    const withoutQuests = await searchLocations(page, { tags: tagCandidate.value, quests: 'without' });
    expect(names.sort()).toEqual(withoutQuests.results.map(entry => entry.name).sort());

    await page.locator('input[name="filter-quests"][value="any"]').check();
    await tagChip.click();

    let combination = null;
    for (const tag of availableTags) {
      for (const status of availableStatuses) {
        const candidate = await searchLocations(page, { tags: tag.value, statuses: status.value });
        if (candidate.count > 0) {
          combination = { tag, status, results: candidate.results };
          break;
        }
      }
      if (combination) {
        break;
      }
    }

    if (combination) {
      await page.locator('#filter-tags label', { hasText: new RegExp(combination.tag.label, 'i') }).click();
      await page.locator('#filter-statuses label', { hasText: new RegExp(combination.status.label, 'i') }).click();

      names = await getVisibleLocationNames(page);
      expect(names.sort()).toEqual(combination.results.map(entry => entry.name).sort());
    } else {
      const fallbackTag = availableTags.find(tag => tag.value !== tagCandidate.value) || tagCandidate;
      const fallbackResults = await searchLocations(page, { tags: fallbackTag.value });
      await page.locator('#filter-tags label', { hasText: new RegExp(fallbackTag.label, 'i') }).click();
      names = await getVisibleLocationNames(page);
      expect(names.sort()).toEqual(fallbackResults.results.map(entry => entry.name).sort());
    }

    await page.locator('#reset-filters').click();
    names = await getVisibleLocationNames(page);
    expect(names.sort()).toEqual(baselineNames.sort());
  });

  test('API de recherche retourne les résultats attendus', async ({ page }) => {
    await waitForAppReady(page);

    const dataset = await searchLocations(page);
    const availableTags = dataset.facets?.dataset?.tags || [];
    const availableStatuses = dataset.facets?.dataset?.statuses || [];

    let params = null;
    let data = null;

    for (const tag of availableTags) {
      for (const status of availableStatuses) {
        const candidate = await searchLocations(page, { tags: tag.value, statuses: status.value });
        if (candidate.count > 0) {
          params = { tags: [tag.value], statuses: [status.value] };
          data = candidate;
          break;
        }
      }
      if (data) {
        break;
      }
    }

    if (!data) {
      const tag = availableTags[0];
      expect(tag).toBeTruthy();
      params = { tags: [tag.value] };
      data = await searchLocations(page, params);
    }

    expect(data.status).toBe('ok');
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.filters.tags).toEqual(params.tags);
    if (params.statuses) {
      expect(data.filters.statuses).toEqual(params.statuses);
    }
    expect(Array.isArray(data.facets?.dataset?.types)).toBeTruthy();
    expect(data.results.every(entry => Array.isArray(entry.tags))).toBeTruthy();
  });

  test('les chips de filtres possèdent des attributs accessibles', async ({ page }) => {
    await waitForAppReady(page);
    await page.locator('#filters-advanced-toggle').click();

    const metadata = await page.$$eval('#filter-tags input[type="checkbox"]', inputs =>
      inputs.map(input => ({
        id: input.id,
        name: input.name,
        labelledBy: input.getAttribute('aria-labelledby')
      }))
    );
    expect(metadata.length).toBeGreaterThan(0);

    const uniqueIds = new Set(metadata.map(item => item.id));
    expect(uniqueIds.size).toBe(metadata.length);
    metadata.forEach(item => {
      expect(item.id).toMatch(/^filter-tags-/);
      expect(item.name).toBe('tags[]');
      expect(item.labelledBy).toBeTruthy();
    });

    const labelledElements = await page.$$eval('#filter-tags input[type="checkbox"]', inputs =>
      inputs.map(input => {
        const targetId = input.getAttribute('aria-labelledby');
        const target = targetId ? document.getElementById(targetId) : null;
        return Boolean(target && target.textContent.trim());
      })
    );
    expect(labelledElements.every(Boolean)).toBeTruthy();

    const firstChip = page.locator('#filter-tags label.filter-chip').first();
    const firstInput = firstChip.locator('input[type="checkbox"]');
    await firstChip.click();
    await expect(firstChip).toHaveClass(/filter-chip-active/);
    await expect(firstInput).toHaveAttribute('aria-pressed', 'true');
    await firstChip.click();
    await expect(firstInput).toHaveAttribute('aria-pressed', 'false');
  });
});
