const { test, expect } = require('../support/playwright.cjs');

test.describe('Integration Auth API', () => {
    test.describe.configure({ mode: 'serial' });

    test('session endpoint returns guest when unauthenticated', async ({ request }) => {
        const response = await request.get('/auth/session');
        expect(response.status()).toBe(200);
        const payload = await response.json();
        expect(payload.authenticated).toBeFalsy();
        expect(payload.authRequired).toBeTruthy();
    });

    test('discord login callback creates a session and allows admin access', async ({ request }) => {
        const adminBefore = await request.get('/api/admin/users');
        expect(adminBefore.status()).toBe(401);

        const loginResponse = await request.get('/auth/discord/login', { maxRedirects: 0 });
        expect(loginResponse.status()).toBe(302);
        const redirect = loginResponse.headers()['location'];
        expect(redirect).toBeTruthy();

        const redirectUrl = new URL(redirect);
        const state = redirectUrl.searchParams.get('state');
        expect(state).toBeTruthy();

        const callbackResponse = await request.get(`/auth/discord/callback?code=stub-code&state=${state}`, {
            maxRedirects: 0
        });
        if (callbackResponse.status() !== 302) {
            const body = await callbackResponse.text();
            console.error('callback-error', callbackResponse.status(), body);
        }
        expect(callbackResponse.status()).toBe(302);
        expect(callbackResponse.headers()['location']).toBe('/');

        const sessionResponse = await request.get('/auth/session');
        expect(sessionResponse.status()).toBe(200);
        const refreshedCookie = sessionResponse.headers()['set-cookie'] || '';
        expect(refreshedCookie).toContain('map_session=');
        expect(refreshedCookie).toContain('Max-Age=');
        const sessionPayload = await sessionResponse.json();
        expect(sessionPayload.authenticated).toBeTruthy();
        expect(sessionPayload.provider).toBe('discord');
        expect(sessionPayload.username).toBe('Test User');
        expect(sessionPayload.role === 'admin' || sessionPayload.role === 'user').toBeTruthy();

        const adminResponse = await request.get('/api/admin/users');
        expect(adminResponse.status()).toBe(200);
        const adminPayload = await adminResponse.json();
        expect(adminPayload.status).toBe('ok');
        expect(Array.isArray(adminPayload.users)).toBeTruthy();

    });

    test('logout clears session and protects admin route', async ({ request }) => {
        const logoutResponse = await request.post('/auth/logout');
        expect([200, 204]).toContain(logoutResponse.status());

        const sessionResponse = await request.get('/auth/session');
        const sessionPayload = await sessionResponse.json();
        expect(sessionPayload.authenticated).toBeFalsy();

        const adminResponse = await request.get('/api/admin/users');
        expect(adminResponse.status()).toBe(401);
    });
});
