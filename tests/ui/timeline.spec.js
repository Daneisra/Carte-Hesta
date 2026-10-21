const { test, expect } = require('../support/playwright.cjs');

const normalizeText = value => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim();

const buildSearchHaystack = entry => [
  entry?.yearLabel,
  entry?.title,
  entry?.summary,
  entry?.content,
  entry?.era,
  entry?.eraSummary,
  entry?.sceneLabel,
  entry?.period,
  ...(Array.isArray(entry?.tags) ? entry.tags : []),
  ...(Array.isArray(entry?.locationNames) ? entry.locationNames : [])
].map(normalizeText).join(' ');

const loadTimelineEntries = async page => {
  const response = await page.request.get('/api/timeline');
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  const entries = Array.isArray(payload?.timeline?.entries) ? payload.timeline.entries : [];
  expect(entries.length).toBeGreaterThan(0);
  return entries;
};

const sortEntriesByTimelineOrder = entries => entries
  .map((entry, index) => {
    const year = Number(entry?.year);
    return {
      entry,
      index,
      year: Number.isFinite(year) ? year : index
    };
  })
  .sort((left, right) => left.year - right.year || left.index - right.index)
  .map(item => item.entry);

const countContiguousPeriods = entries => {
  let count = 0;
  let lastPeriod = null;
  entries.forEach(entry => {
    const nextPeriod = entry?.period || '';
    if (nextPeriod !== lastPeriod) {
      count += 1;
      lastPeriod = nextPeriod;
    }
  });
  return count;
};

const buildContiguousPeriods = entries => {
  const groups = [];
  entries.forEach(entry => {
    const period = entry?.period || '';
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.period === period) {
      lastGroup.entries.push(entry);
      return;
    }
    groups.push({
      period,
      entries: [entry]
    });
  });
  return groups;
};

const countContiguousEras = entries => {
  let count = 0;
  let lastEra = null;
  entries.forEach(entry => {
    const nextEra = entry?.era || entry?.period || '';
    if (nextEra !== lastEra) {
      count += 1;
      lastEra = nextEra;
    }
  });
  return count;
};

const readQueryParam = (page, key) => new URL(page.url()).searchParams.get(key);

test.describe('Chronologie - UI', () => {
  test('la frise charge des evenements et affiche un detail actif', async ({ page }) => {
    const entries = await loadTimelineEntries(page);

    await page.goto('/timeline/');
    await page.waitForLoadState('domcontentloaded');

    const cards = page.locator('.timeline-card');
    await expect(cards).toHaveCount(entries.length);
    await expect(page.locator('.timeline-era-group')).toHaveCount(countContiguousEras(entries));
    await expect(page.locator('.timeline-period-group')).toHaveCount(countContiguousPeriods(entries));
    await expect(page.locator('.timeline-card-media')).toHaveCount(entries.filter(entry => entry.imageUrl).length);
    await expect(page.locator('#timeline-detail-title')).toHaveText(entries[0].title);
    await expect(page.locator('#timeline-stage-overview-title')).toHaveText(entries[0].title);
    if (entries[0].imageUrl) {
      await expect(page.locator('.timeline-detail-media img')).toBeVisible();
      await expect(page.locator('.timeline-detail-media img')).toHaveAttribute('src', /\/assets\/images\/Frise\//);
      const detailWidth = await page.locator('#timeline-detail').evaluate(node => node.getBoundingClientRect().width);
      const mediaWidth = await page.locator('.timeline-detail-media').evaluate(node => node.getBoundingClientRect().width);
      expect(mediaWidth).toBeGreaterThan(detailWidth * 0.7);
    }
    await expect(page.locator('#timeline-status')).toContainText('evenements affiches');
  });

  test('les images de detail peuvent etre ouvertes en grand', async ({ page }) => {
    const entries = await loadTimelineEntries(page);
    const entryWithImage = entries.find(entry => entry.imageUrl);

    test.skip(!entryWithImage, 'Aucune image de chronologie disponible.');

    await page.goto(`/timeline/?event=${encodeURIComponent(entryWithImage.id)}`);
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('#timeline-detail-title')).toHaveText(entryWithImage.title);
    await page.locator('.timeline-detail-media-button').click();

    const lightbox = page.locator('#timeline-image-lightbox');
    await expect(lightbox).toBeVisible();
    await expect(page.locator('#timeline-image-lightbox-title')).toHaveText(entryWithImage.title);
    await expect(page.locator('#timeline-image-lightbox-img')).toHaveAttribute('src', /\/assets\/images\//);

    await page.keyboard.press('Escape');
    await expect(lightbox).toBeHidden();
  });

  test('les filtres periode, tag et recherche reduisent la frise', async ({ page }) => {
    const entries = await loadTimelineEntries(page);
    const periods = Array.from(new Set(entries.map(entry => entry.period).filter(Boolean)));
    const tags = Array.from(new Set(entries.flatMap(entry => Array.isArray(entry.tags) ? entry.tags : []).filter(Boolean)));
    const period = periods[0];
    const periodCount = entries.filter(entry => entry.period === period).length;
    const tag = tags[0] || '';
    const tagCount = tag ? entries.filter(entry => Array.isArray(entry.tags) && entry.tags.includes(tag)).length : 0;
    const searchQuery = (entries.find(entry => Array.isArray(entry.locationNames) && entry.locationNames.length)?.locationNames?.[0])
      || entries[0].title;
    const searchMatches = entries.filter(entry => buildSearchHaystack(entry).includes(normalizeText(searchQuery)));

    await page.goto('/timeline/');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.timeline-card')).toHaveCount(entries.length);

    await page.locator('#timeline-period-filter').selectOption({ label: period });
    await expect(page.locator('.timeline-card')).toHaveCount(periodCount);
    await expect(page.locator('#timeline-detail-title')).toHaveText(entries.find(entry => entry.period === period).title);

    await page.locator('#timeline-reset-filters').click();
    await expect(page.locator('.timeline-card')).toHaveCount(entries.length);

    if (tag) {
      await page.locator('#timeline-tag-filter').selectOption({ label: tag });
      await expect(page.locator('.timeline-card')).toHaveCount(tagCount);
      await page.locator('#timeline-reset-filters').click();
    }

    await page.locator('#timeline-search').fill('__aucun_evenement_ne_devrait_matcher__');
    await expect(page.locator('.timeline-card')).toHaveCount(0);
    await expect(page.locator('#timeline-status')).toContainText('Aucun evenement');

    await page.locator('#timeline-reset-filters').click();
    await page.locator('#timeline-search').fill(searchQuery);
    await expect(page.locator('.timeline-card')).toHaveCount(searchMatches.length);
    await expect(page.locator('#timeline-detail-title')).toHaveText(searchMatches[0].title);
  });

  test('les liens profonds depuis la carte prefiltrent la chronologie', async ({ page }) => {
    const entries = await loadTimelineEntries(page);
    const linkedEntry = entries.find(entry => (
      Array.isArray(entry.locationNames)
      && entry.locationNames.length
      && entry.period
      && Array.isArray(entry.tags)
      && entry.tags.length
    ));

    test.skip(!linkedEntry, 'Aucun evenement lie a un lieu dans la chronologie.');

    const locationName = linkedEntry.locationNames[0];
    const tag = linkedEntry.tags[0];
    const matchingEntries = entries.filter(entry => buildSearchHaystack(entry).includes(normalizeText(locationName)));

    await page.goto(`/timeline/?event=${encodeURIComponent(linkedEntry.id)}&location=${encodeURIComponent(locationName)}&period=${encodeURIComponent(linkedEntry.period)}&tag=${encodeURIComponent(tag)}`);
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('#timeline-search')).toHaveValue(locationName);
    await expect(page.locator('#timeline-period-filter')).toHaveValue(linkedEntry.period);
    await expect(page.locator('#timeline-tag-filter')).toHaveValue(tag);
    await expect(page.locator('.timeline-card')).toHaveCount(matchingEntries.filter(entry => entry.period === linkedEntry.period && Array.isArray(entry.tags) && entry.tags.includes(tag)).length);
    await expect(page.locator('#timeline-detail-title')).toHaveText(linkedEntry.title);
  });

  test('la frise est navigable au clavier', async ({ page }) => {
    const entries = await loadTimelineEntries(page);
    const nextEntry = entries[Math.min(1, entries.length - 1)];
    const lastEntry = entries[entries.length - 1];

    await page.goto('/timeline/');
    await page.waitForLoadState('domcontentloaded');

    const firstCard = page.locator('.timeline-card').first();
    await firstCard.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#timeline-detail-title')).toHaveText(nextEntry.title);

    await page.keyboard.press('End');
    await expect(page.locator('#timeline-detail-title')).toHaveText(lastEntry.title);

    await page.keyboard.press('Home');
    await expect(page.locator('#timeline-detail-title')).toHaveText(entries[0].title);
  });

  test("l'URL reflète l'etat actif et les filtres", async ({ page }) => {
    const entries = await loadTimelineEntries(page);
    const periods = Array.from(new Set(entries.map(entry => entry.period).filter(Boolean)));
    const tags = Array.from(new Set(entries.flatMap(entry => Array.isArray(entry.tags) ? entry.tags : []).filter(Boolean)));
    const period = periods[0];
    const searchQuery = (entries.find(entry => Array.isArray(entry.locationNames) && entry.locationNames.length)?.locationNames?.[0])
      || entries[0].title;
    const targetIndex = Math.min(1, entries.length - 1);

    await page.goto('/timeline/');
    await page.waitForLoadState('domcontentloaded');

    await page.locator('.timeline-card').nth(targetIndex).click();
    await expect.poll(() => readQueryParam(page, 'event')).toBe(entries[targetIndex].id);

    await page.locator('#timeline-period-filter').selectOption({ label: period });
    await expect.poll(() => readQueryParam(page, 'period')).toBe(period);

    if (tags.length) {
      const tag = tags[0];
      await page.locator('#timeline-tag-filter').selectOption({ label: tag });
      await expect.poll(() => readQueryParam(page, 'tag')).toBe(tag);
    }

    await page.locator('#timeline-reset-filters').click();
    await page.locator('#timeline-search').fill(searchQuery);
    await expect.poll(() => readQueryParam(page, 'search')).toBe(searchQuery);

    await page.locator('#timeline-reset-filters').click();
    await expect.poll(() => readQueryParam(page, 'search')).toBeNull();
    await expect.poll(() => readQueryParam(page, 'period')).toBeNull();
    await expect.poll(() => readQueryParam(page, 'tag')).toBeNull();
    await expect.poll(() => readQueryParam(page, 'event')).not.toBeNull();
  });

  test('la navigation rapide par periode active le bon groupe', async ({ page }) => {
    const entries = sortEntriesByTimelineOrder(await loadTimelineEntries(page));
    const groups = [];
    entries.forEach(entry => {
      const era = entry?.era || entry?.period || '';
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && lastGroup.era === era) {
        lastGroup.entries.push(entry);
        return;
      }
      groups.push({
        era,
        entries: [entry]
      });
    });

    test.skip(groups.length < 2, 'Une seule periode visible dans la chronologie courante.');

    const targetGroup = groups[1];

    await page.goto('/timeline/');
    await page.waitForLoadState('domcontentloaded');

    const periodChips = page.locator('.timeline-period-nav-chip');
    await expect(periodChips).toHaveCount(groups.length);
    const targetEntry = targetGroup.entries[0];
    const targetChip = page.locator(`.timeline-period-nav-chip[data-era-group-id="${targetEntry.id}"]`);
    await expect(targetChip).toBeVisible();
    await targetChip.scrollIntoViewIfNeeded();
    await targetChip.click();
    await expect.poll(() => readQueryParam(page, 'event')).toBe(targetEntry.id);
    await expect(targetChip).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#timeline-stage-overview-title')).toHaveText(targetGroup.entries[0].title);
    await expect(page.locator('#timeline-detail-title')).toHaveText(targetGroup.entries[0].title);
  });
});

test.describe('Chronologie - mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('la page reste exploitable sur mobile', async ({ page }) => {
    const entries = await loadTimelineEntries(page);
    const targetIndex = Math.min(2, entries.length - 1);

    await page.goto('/timeline/');
    await page.waitForLoadState('domcontentloaded');

    const hasHorizontalOverflow = await page.evaluate(() => (
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
    ));
    expect(hasHorizontalOverflow).toBeFalsy();

    const navBox = await page.locator('.timeline-nav').boundingBox();
    const headerBox = await page.locator('.timeline-header').boundingBox();
    expect(navBox).toBeTruthy();
    expect(headerBox).toBeTruthy();
    expect(navBox.width).toBeLessThanOrEqual(headerBox.width);

    await expect(page.locator('.timeline-filters')).toBeVisible();
    const searchBox = await page.locator('#timeline-search').boundingBox();
    expect(searchBox).toBeTruthy();
    expect(searchBox.height).toBeGreaterThanOrEqual(42);
    await expect(page.locator('.timeline-card')).toHaveCount(entries.length);

    await page.locator('.timeline-card').nth(targetIndex).click();
    await expect(page.locator('#timeline-detail-title')).toHaveText(entries[targetIndex].title);
    await expect(page.locator('.timeline-detail-actions .timeline-link-button')).toHaveCount(2);
    await expect(page.locator('#timeline-map-link')).toBeVisible();

    if (entries[targetIndex].imageUrl) {
      await page.locator('.timeline-detail-media-button').click();
      await expect(page.locator('#timeline-image-lightbox')).toBeVisible();
      const lightboxPanel = await page.locator('.timeline-image-lightbox-panel').boundingBox();
      expect(lightboxPanel).toBeTruthy();
      expect(lightboxPanel.width).toBeLessThanOrEqual(390);
      await page.keyboard.press('Escape');
      await expect(page.locator('#timeline-image-lightbox')).toBeHidden();
    }
  });
});
