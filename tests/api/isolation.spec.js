const { test, expect } = require('../support/playwright.cjs');
const { ADMIN_ID, siteConfig } = require('../fixtures/application.cjs');

test.describe('Contrats du laboratoire isolé', () => {
    test('identité du processus et fichiers servis proviennent du laboratoire', async ({ request }) => {
        const identity = await request.get('/_test/identity');
        expect(identity.headers()['x-carte-test-run']).toBe(process.env.CARTE_TEST_TOKEN);
        expect((await identity.json()).token).toBe(process.env.CARTE_TEST_TOKEN);
        expect((await request.get('/.env')).status()).toBe(400);
        expect((await request.get('/.git/config')).status()).toBe(400);
        const config = await request.get('/assets/site-config.json');
        expect((await config.json()).home.title).toBe(siteConfig.home.title);
        expect((await config.json()).community.proof).not.toHaveProperty('guildId');
        // Private stores are physically outside the static root. API projections are reviewed in lot D.
        const users = await request.get('/assets/users.json');
        expect(users.status()).toBe(404);
    });

    test('OAuth du stub charge un compte explicitement administrateur dans la fixture', async ({ request }) => {
        const login = await request.get('/auth/discord/login', { maxRedirects: 0 });
        const redirect = new URL(login.headers().location);
        expect(redirect.hostname).toBe('127.0.0.1');
        const state = redirect.searchParams.get('state');
        expect((await request.get(`/auth/discord/callback?code=synthetic-code&state=${state}`, { maxRedirects: 0 })).status()).toBe(302);
        const users = await request.get('/api/admin/users');
        expect((await users.json()).users.find(user => user.id === ADMIN_ID).role).toBe('admin');
        const session = await request.get('/auth/session');
        expect((await session.json()).role).toBe('admin');
    });

    test('un jeton joueur synthétique conserve les contrôles actuels sans bootstrap implicite', async ({ playwright, baseURL }) => {
        const player = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Authorization: 'Bearer synthetic-player-token' } });
        try {
            expect((await player.get('/api/admin/users')).status()).toBe(403);
            const profile = await player.get('/api/profile');
            expect(profile.status()).toBe(200);
            expect((await profile.json()).profile.username).toBe('Joueur fictif');
        } finally { await player.dispose(); }
    });
});
