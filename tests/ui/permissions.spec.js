const { test, expect, loginAsSyntheticAdmin } = require('../support/playwright.cjs');
const { ADMIN_ID } = require('../fixtures/application.cjs');
const headers = { Authorization: 'Bearer synthetic-admin-token' };
const key = JSON.stringify(['Continent de test A', 'Port des Tests']);
async function policy(request, qualification) {
    const response = await request.get('/api/admin/permissions', { headers });
    const loaded = await response.json(), current = loaded.permissions;
    const reviewed = loaded.catalog[qualification.kind].find(value => (value.key || value.id) === qualification.key);
    qualification = { ...qualification, fingerprint: reviewed.fingerprint };
    const saved = await request.patch('/api/admin/permissions', { headers, data: { revision: current.revision, confirm: true, qualification } });
    expect(saved.status()).toBe(200);
}

test('publication éditoriale : une catégorie peut être publiée puis retirée par l’interface avec confirmation', async ({ page, request }) => {
    await loginAsSyntheticAdmin(page); await page.goto('/map/');
    await expect(page.locator('#permissions-dialog')).toBeHidden();
    await page.locator('#profile-button').click();
    await page.locator('#quick-admin-panel').click();
    await page.locator('#permissions-open').click();
    await expect(page.locator('#permissions-resource')).toBeVisible();
    await page.locator('#permissions-resource').selectOption(key);
    await page.locator('[data-category="lore"]').selectOption('PUBLIC');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Enregistrer la qualification', exact: true }).click();
    await expect(page.locator('#permissions-status')).toHaveText('Permissions enregistrées.');
    const publicView = await request.get('/assets/locations.json');
    expect((await publicView.json())['Continent de test A'].find(place => place.name === 'Port des Tests').lore).toEqual(['Récit synthétique.']);
    await page.locator('#permissions-resource').selectOption(key);
    await page.locator('[data-category="lore"]').selectOption('ADMIN');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Enregistrer la qualification', exact: true }).click();
    await expect(page.locator('#permissions-status')).toHaveText('Permissions enregistrées.');
    const privateView = await request.get('/assets/locations.json');
    expect((await privateView.json())['Continent de test A'].find(place => place.name === 'Port des Tests').lore).toBeUndefined();
});

test('un MJ voit le planning de ses groupes sans devenir administrateur global', async ({ page, request }) => {
    let createdId;
    const catalog = (await (await request.get('/api/admin/permissions', { headers })).json()).permissions;
    try {
        expect((await request.patch('/api/admin/permissions', { headers, data: { revision: catalog.revision, confirm: true, assignment: { userId: ADMIN_ID, groupIds: ['group-test-a'] } } })).status()).toBe(200);
        expect((await request.patch('/api/admin/users', { headers, data: { id: ADMIN_ID, role: 'user' } })).status()).toBe(200);
        await loginAsSyntheticAdmin(page); await page.goto('/planning/');
        await expect(page.locator('#planning-admin')).toBeVisible();
        await page.locator('#planning-admin-group-id').selectOption('group-test-a');
        await page.locator('#planning-admin-title-input').fill('Session MJ synthétique D');
        await page.locator('#planning-admin-date').fill('2026-10-23');
        await page.locator('#planning-admin-start').fill('20:00');
        await page.locator('#planning-admin-save').click();
        await expect(page.locator('#planning-admin-status')).toContainText('creee');
        const sessions = (await (await page.request.get('/api/planning/sessions')).json()).sessions;
        const created = sessions.find(session => session.title === 'Session MJ synthétique D');
        expect(created.groupId).toBe('group-test-a'); createdId = created.id;
        expect((await page.request.get('/api/admin/users')).status()).toBe(403);
        expect((await page.request.post('/api/admin/planning/sessions', { data: { title: 'Intergroupe interdit', date: '2026-10-24', groupId: 'group-test-b' } })).status()).toBe(403);
    } finally {
        await request.patch('/api/admin/users', { headers, data: { id: ADMIN_ID, role: 'admin' } });
        if (createdId) await request.delete('/api/admin/planning/sessions', { headers, data: { id: createdId } });
        const current = (await (await request.get('/api/admin/permissions', { headers })).json()).permissions;
        await request.patch('/api/admin/permissions', { headers, data: { revision: current.revision, confirm: true, assignment: { userId: ADMIN_ID, groupIds: [] } } });
    }
});

test('une révocation retire du DOM le lore privé déjà affiché sans recharger la page', async ({ page, request }) => {
    const initial = (await (await request.get('/api/admin/permissions', { headers })).json()).permissions.resources.locations[key];
    try {
        await policy(request, { kind: 'locations', key, rule: initial.rule, categories: { ...initial.categories, lore: { scope: 'GROUP', groupId: 'group-test-a' } } });
        await request.patch('/api/admin/users', { headers, data: { id: ADMIN_ID, role: 'user', groups: ['group-test-a'] } });
        await loginAsSyntheticAdmin(page);
        const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/locations');
        await page.goto('/map/'); await refreshed;
        const toggle = page.locator('.continent-toggle').first();
        await expect(toggle).toBeVisible();
        if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
        await page.locator('.location[data-location-name="Port des Tests"]').click();
        await expect(page.getByText('Récit synthétique.', { exact: true })).toHaveCount(1);
        const documentId = await page.evaluate(() => { window.syntheticDocumentId = 'unchanged'; return window.syntheticDocumentId; });
        await request.patch('/api/admin/users', { headers, data: { id: ADMIN_ID, groups: [] } });
        await expect(page.getByText('Récit synthétique.', { exact: true })).toHaveCount(0);
        expect(await page.evaluate(() => window.syntheticDocumentId)).toBe(documentId);
        await expect(page.locator('.location[data-location-name="Port des Tests"]')).toHaveCount(1);
    } finally {
        await request.patch('/api/admin/users', { headers, data: { id: ADMIN_ID, role: 'admin', groups: ['group-test-a'] } });
        await policy(request, { kind: 'locations', key, rule: initial.rule, categories: initial.categories });
    }
});

test('le flux accueil recharge seulement les annotations autorisées et retire les publications révoquées', async ({ page, request }) => {
    const login = await request.get('/auth/discord/login', { maxRedirects: 0 });
    const state = new URL(login.headers().location).searchParams.get('state');
    expect((await request.get(`/auth/discord/callback?code=synthetic-live&state=${state}`, { maxRedirects: 0 })).status()).toBe(302);
    const ids = [];
    try {
        for (const [scope, label] of [['PUBLIC', 'PUBLIC-LIVE-D'], ['PRIVATE', 'PRIVATE-LIVE-D']]) {
            const created = await request.post('/api/annotations', { data: { x: 1, y: 2, label, scope, confirm: true } });
            expect(created.status()).toBe(201); ids.push((await created.json()).annotation.id);
        }
        await page.goto('/');
        await expect(page.locator('.home-live-item').filter({ hasText: 'PUBLIC-LIVE-D' })).toHaveCount(1);
        await expect(page.getByText('PRIVATE-LIVE-D', { exact: false })).toHaveCount(0);
        expect((await request.delete('/api/annotations/' + ids[0])).status()).toBe(204);
        await expect(page.locator('.home-live-item').filter({ hasText: 'PUBLIC-LIVE-D' })).toHaveCount(0);
        await expect(page.getByText('PRIVATE-LIVE-D', { exact: false })).toHaveCount(0);
    } finally { for (const id of ids) await request.delete('/api/annotations/' + id); }
});
