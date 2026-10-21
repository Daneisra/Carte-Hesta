const { test, expect } = require('../support/playwright.cjs');
const { siteConfig } = require('../fixtures/application.cjs');

const loginWithDiscordStub = async request => {
    const loginResponse = await request.get('/auth/discord/login', { maxRedirects: 0 });
    expect(loginResponse.status()).toBe(302);
    const redirect = loginResponse.headers()['location'];
    expect(redirect).toBeTruthy();
    const state = new URL(redirect).searchParams.get('state');
    expect(state).toBeTruthy();

    const callbackResponse = await request.get(`/auth/discord/callback?code=stub-code&state=${state}`, {
        maxRedirects: 0
    });
    expect(callbackResponse.status()).toBe(302);
};

test.describe('Planning - API', () => {
    test.describe.configure({ mode: 'serial' });

    test('admin cree une session candidate et un joueur repond a une date precise', async ({ request }) => {
        const changelogResponse = await request.get('/api/changelog?limit=2');
        expect(changelogResponse.status()).toBe(200);
        const changelogPayload = await changelogResponse.json();
        expect(changelogPayload.entries.map(entry => entry.title)).toEqual(siteConfig.changelog.map(entry => entry.title));

        const publicBefore = await request.get('/api/planning/sessions');
        expect(publicBefore.status()).toBe(200);
        const publicPayload = await publicBefore.json();
        expect(Array.isArray(publicPayload.sessions)).toBeTruthy();

        await loginWithDiscordStub(request);
        const groupsBeforeResponse = await request.get('/api/admin/groups');
        expect(groupsBeforeResponse.status()).toBe(200);
        const groupsBefore = (await groupsBeforeResponse.json()).groups;
        expect(groupsBefore.length).toBeGreaterThan(0);
        const existingGroup = groupsBefore[0];
        const createGroupResponse = await request.post('/api/admin/groups', {
            data: { name: 'Groupe lot API', color: '#2468ac' }
        });
        expect(createGroupResponse.status()).toBe(201);
        const createdGroup = (await createGroupResponse.json()).group;
        const updateGroupsResponse = await request.patch('/api/admin/groups', {
            data: {
                groups: [
                    { id: existingGroup.id, name: `${existingGroup.name} test lot`, color: '#123456' },
                    { id: createdGroup.id, name: 'Groupe lot API actualise', color: '#654321' }
                ]
            }
        });
        expect(updateGroupsResponse.status()).toBe(200);
        const updatedGroups = (await updateGroupsResponse.json()).groups;
        expect(updatedGroups.map(group => group.name)).toEqual([`${existingGroup.name} test lot`, 'Groupe lot API actualise']);
        expect(updatedGroups[0].x).toBe(existingGroup.x);
        expect(updatedGroups[0].y).toBe(existingGroup.y);

        const slots = Array.from({ length: 7 }, () => Array.from({ length: 4 }, () => null));
        slots[0][2] = 'available';
        slots[6][2] = 'busy';
        const profileResponse = await request.patch('/api/profile', {
            data: {
                availability: {
                    timezone: 'Europe/Warsaw',
                    slots
                }
            }
        });
        expect(profileResponse.status()).toBe(200);

        const datedAvailabilityResponse = await request.post('/api/planning/my-availability', {
            data: {
                date: '2026-07-12',
                dates: ['2026-07-12', '2026-07-19', '2026-07-12'],
                startTime: '20:00',
                endTime: '23:30',
                status: 'busy',
                comment: 'Conflit date precise.'
            }
        });
        expect(datedAvailabilityResponse.status()).toBe(201);
        const datedAvailabilityPayload = await datedAvailabilityResponse.json();
        expect(datedAvailabilityPayload.entries).toHaveLength(2);
        expect(datedAvailabilityPayload.entries.map(entry => entry.date)).toEqual(['2026-07-12', '2026-07-19']);
        expect(datedAvailabilityPayload.entries[0].status).toBe('busy');

        const createResponse = await request.post('/api/admin/planning/sessions', {
            data: {
                title: 'Session candidate API',
                date: '2026-07-12',
                dates: ['2026-07-12', '2026-07-19', '2026-07-12'],
                startTime: '20:45',
                durationMinutes: 180,
                groupName: 'Groupe test',
                status: 'candidate',
                description: 'Date candidate creee par test API.'
            }
        });
        expect(createResponse.status()).toBe(201);
        const createdPayload = await createResponse.json();
        expect(createdPayload.status).toBe('ok');
        expect(createdPayload.created).toHaveLength(2);
        expect(createdPayload.created.map(session => session.date)).toEqual(['2026-07-12', '2026-07-19']);
        expect(createdPayload.session.id).toBeTruthy();
        expect(createdPayload.session.responseSummary.available).toBe(0);
        expect(createdPayload.session.planningInsight.weekly.busy).toBeGreaterThanOrEqual(1);
        expect(createdPayload.session.planningInsight.dated.busy).toBeGreaterThanOrEqual(1);

        const sessionId = createdPayload.session.id;
        const response = await request.patch(`/api/planning/sessions/${sessionId}/response`, {
            data: {
                status: 'available',
                comment: 'Disponible pour cette date.'
            }
        });
        expect(response.status()).toBe(200);
        const responsePayload = await response.json();
        expect(responsePayload.status).toBe('ok');
        expect(responsePayload.session.responseSummary.available).toBe(1);
        expect(responsePayload.session.planningInsight.conflicts).toBeGreaterThanOrEqual(1);

        const updateResponse = await request.patch('/api/admin/planning/sessions', {
            data: {
                id: sessionId,
                title: 'Session candidate API confirmee',
                status: 'confirmed'
            }
        });
        expect(updateResponse.status()).toBe(200);
        const updatedPayload = await updateResponse.json();
        expect(updatedPayload.session.title).toBe('Session candidate API confirmee');
        expect(updatedPayload.session.status).toBe('confirmed');
        expect(updatedPayload.session.responseSummary.available).toBe(1);

        const listResponse = await request.get('/api/planning/sessions');
        const listPayload = await listResponse.json();
        expect(listPayload.sessions.some(session => session.id === sessionId && session.status === 'confirmed')).toBeTruthy();

        const deleteResponse = await request.delete('/api/admin/planning/sessions', {
            data: { id: sessionId }
        });
        expect(deleteResponse.status()).toBe(200);
        const deletePayload = await deleteResponse.json();
        expect(deletePayload.removed.id).toBe(sessionId);

        const deleteSecondSessionResponse = await request.delete('/api/admin/planning/sessions', {
            data: { id: createdPayload.created[1].id }
        });
        expect(deleteSecondSessionResponse.status()).toBe(200);

        const deleteAvailabilityResponse = await request.delete('/api/planning/my-availability', {
            data: { id: datedAvailabilityPayload.entries[0].id }
        });
        expect(deleteAvailabilityResponse.status()).toBe(200);
        const deleteSecondAvailabilityResponse = await request.delete('/api/planning/my-availability', {
            data: { id: datedAvailabilityPayload.entries[1].id }
        });
        expect(deleteSecondAvailabilityResponse.status()).toBe(200);
    });
});
