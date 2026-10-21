const { test, expect } = require('../support/playwright.cjs');

test.describe('Planning - UI', () => {
  test('la page planning affiche le socle calendrier JDR', async ({ page }) => {
    await page.goto('/planning/');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('.planning-nav a[aria-current="page"]')).toHaveText('Planning');
    await expect(page.locator('#planning-title')).toContainText('Trouver une date');
    await expect(page.locator('#planning-version')).toHaveText('0.17.49');
    await expect(page.locator('#planning-version-footer')).toHaveText('0.17.49');
    await expect(page.locator('#planning-agenda-title')).toHaveText('Sessions candidates');
    await expect(page.locator('#planning-dated-title')).toHaveText("Mes disponibilites dans l'agenda");
    await expect(page.locator('.planning-agenda-day')).toHaveCount(42);
    await expect(page.locator('#planning-summary')).toHaveCount(0);
    await expect(page.locator('#planning-week')).toHaveCount(0);
    await expect(page.locator('.site-footer-links a[href="/changelog/"]')).toHaveText('Changelog');
  });

  test('un utilisateur connecte peut renseigner une disponibilite datee', async ({ page }) => {
    let savedPayload = null;
    let deletedPayload = null;

    await page.route('**/auth/session', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        authenticated: true,
        username: 'Danny',
        availability: { timezone: 'Europe/Warsaw', slots: [] }
      })
    }));
    await page.route('**/api/planning/my-availability', route => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'ok', availability: [] })
        });
      }
      if (route.request().method() === 'DELETE') {
        deletedPayload = route.request().postDataJSON();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'ok', availability: [] })
        });
      }
      savedPayload = route.request().postDataJSON();
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ok',
          availability: [
            ...savedPayload.dates.map((date, index) => ({
              id: `availability-test-${index}`,
              date,
              startTime: savedPayload.startTime,
              endTime: savedPayload.endTime,
              status: savedPayload.status,
              comment: savedPayload.comment
            }))
          ]
        })
      });
    });

    await page.goto('/planning/');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('#planning-dated-start')).toBeEnabled();
    const agendaDay = page.locator('.planning-agenda-day[data-date]').nth(20);
    const selectedDate = await agendaDay.getAttribute('data-date');
    const secondAgendaDay = page.locator('.planning-agenda-day[data-date]').nth(21);
    const secondSelectedDate = await secondAgendaDay.getAttribute('data-date');
    await agendaDay.click();
    await secondAgendaDay.click();
    await expect(page.locator('#planning-dated-date')).toHaveValue(secondSelectedDate);
    await expect(page.locator('.planning-selected-date')).toHaveCount(2);

    await page.locator('#planning-dated-start').fill('20:30');
    await page.locator('#planning-dated-end').fill('23:30');
    await page.locator('#planning-dated-response').selectOption('available');
    await page.locator('#planning-dated-comment').fill('Disponible apres le repas');
    await page.locator('#planning-dated-save').click();

    await expect(page.locator('#planning-dated-status')).toHaveText('2 disponibilites datees enregistrees.');
    expect(savedPayload).toMatchObject({
      date: selectedDate,
      dates: [selectedDate, secondSelectedDate],
      startTime: '20:30',
      endTime: '23:30',
      status: 'available',
      comment: 'Disponible apres le repas'
    });
    await expect(page.locator('.planning-dated-entry')).toHaveCount(2);
    await expect(page.locator('.planning-dated-entry').first()).toContainText('Disponible apres le repas');

    await page.locator('.planning-dated-delete').first().click();
    await expect(page.locator('#planning-dated-status')).toHaveText('Disponibilite supprimee.');
    expect(deletedPayload.id).toBe('availability-test-0');
  });

  test('un admin peut creer modifier et supprimer une session candidate', async ({ page }) => {
    let sessions = [];
    const adminRequests = [];

    await page.route('**/auth/session', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        authenticated: true,
        role: 'admin',
        username: 'Danny',
        availability: { timezone: 'Europe/Warsaw', slots: [] }
      })
    }));
    await page.route('**/api/planning/sessions', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', sessions })
    }));
    await page.route('**/api/planning/my-availability', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', availability: [] })
    }));
    await page.route('**/api/admin/planning/sessions', route => {
      const method = route.request().method();
      const payload = route.request().postDataJSON();
      adminRequests.push({ method, payload });
      if (method === 'POST') {
        sessions = payload.dates.map((date, index) => ({
            id: `session-admin-${index}`,
            title: payload.title,
            date,
            startTime: payload.startTime,
            durationMinutes: payload.durationMinutes,
            groupName: payload.groupName,
            status: payload.status,
            description: payload.description,
            responseSummary: { available: 0, maybe: 0, busy: 0 },
            planningInsight: { quality: 'unknown', weekly: {}, dated: {} },
            responses: {}
          }));
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'ok', session: sessions[0], created: sessions, sessions })
        });
      }
      if (method === 'PATCH') {
        sessions = sessions.map(session => session.id === payload.id ? { ...session, ...payload } : session);
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'ok', session: sessions[0], sessions })
        });
      }
      sessions = sessions.filter(session => session.id !== payload.id);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok', removed: { id: payload.id }, sessions })
      });
    });

    await page.goto('/planning/');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('#planning-admin-link')).toBeVisible();
    await expect(page.locator('#planning-admin')).toBeVisible();

    await page.locator('#planning-admin-title-input').fill('Session admin test');
    await page.locator('#planning-admin-date').fill('2026-08-14');
    await page.locator('#planning-admin-date').dispatchEvent('change');
    await page.locator('#planning-admin-date').fill('2026-08-21');
    await page.locator('#planning-admin-date').dispatchEvent('change');
    await page.locator('#planning-admin-start').fill('20:45');
    await page.locator('#planning-admin-duration').fill('210');
    await page.locator('#planning-admin-group').fill('Table Hesta');
    await page.locator('#planning-admin-description').fill('Session creee depuis admin planning.');
    await page.locator('#planning-admin-save').click();

    await expect(page.locator('#planning-admin-status')).toHaveText('2 sessions creees.');
    await expect(page.locator('.planning-admin-entry')).toHaveCount(2);
    expect(adminRequests[0]).toMatchObject({
      method: 'POST',
      payload: {
        title: 'Session admin test',
        date: '2026-08-21',
        dates: ['2026-08-14', '2026-08-21'],
        startTime: '20:45',
        durationMinutes: 210,
        groupName: 'Table Hesta',
        status: 'candidate'
      }
    });

    await page.locator('[data-admin-action="edit"]').first().click();
    await page.locator('#planning-admin-title-input').fill('Session admin modifiee');
    await page.locator('#planning-admin-session-status').selectOption('confirmed');
    await page.locator('#planning-admin-save').click();

    await expect(page.locator('#planning-admin-status')).toHaveText('Session modifiee.');
    expect(adminRequests[1]).toMatchObject({
      method: 'PATCH',
      payload: {
        id: 'session-admin-0',
        title: 'Session admin modifiee',
        status: 'confirmed'
      }
    });

    await page.locator('[data-admin-action="delete"]').first().click();
    await expect(page.locator('#planning-admin-status')).toHaveText('Session supprimee.');
    await expect(page.locator('.planning-admin-entry')).toHaveCount(1);
    expect(adminRequests[2]).toMatchObject({
      method: 'DELETE',
      payload: { id: 'session-admin-0' }
    });
  });

  test('la vue agenda affiche les sessions datees et navigue par mois', async ({ page }) => {
    const now = new Date();
    const currentMonthDate = new Date(now.getFullYear(), now.getMonth(), 12);
    const nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 8);
    const toKey = date => [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
    let savedResponse = null;

    await page.route('**/auth/session', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        authenticated: true,
        username: 'Danny',
        availability: { timezone: 'Europe/Warsaw', slots: [] }
      })
    }));
    await page.route('**/api/planning/sessions', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        sessions: [
          {
            id: 'session-current',
            title: 'Conseil des routes',
            date: toKey(currentMonthDate),
            startTime: '20:30',
            durationMinutes: 180,
            groupName: 'Groupe principal',
            status: 'candidate',
            description: 'Date candidate pour organiser la prochaine partie.',
            responseSummary: { available: 0, maybe: 1, busy: 0 },
            planningInsight: {
              quality: 'conflict',
              weekly: { available: 0, maybe: 1, busy: 1, empty: 0, respondents: 2 },
              conflicts: 1,
              targetUsers: 2
            },
            responses: {}
          },
          {
            id: 'session-next',
            title: 'Session confirmee',
            date: toKey(nextMonthDate),
            startTime: '21:00',
            durationMinutes: 210,
            groupName: 'Table Hesta',
            status: 'confirmed',
            description: 'Partie confirmee.',
            responseSummary: { available: 2, maybe: 0, busy: 1 },
            planningInsight: {
              quality: 'good',
              weekly: { available: 2, maybe: 0, busy: 0, empty: 0, respondents: 2 },
              conflicts: 1,
              targetUsers: 2
            },
            responses: {}
          }
        ]
      })
    }));
    await page.route('**/api/planning/sessions/*/response', route => {
      savedResponse = route.request().postDataJSON();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ok',
          session: {
            id: 'session-current',
            title: 'Conseil des routes',
            date: toKey(currentMonthDate),
            startTime: '20:30',
            durationMinutes: 180,
            groupName: 'Groupe principal',
            status: 'candidate',
            description: 'Date candidate pour organiser la prochaine partie.',
            responseSummary: { available: 1, maybe: 1, busy: 0 },
            planningInsight: {
              quality: 'good',
              weekly: { available: 1, maybe: 1, busy: 0, empty: 0, respondents: 2 },
              conflicts: 0,
              targetUsers: 2
            },
            responses: {}
          }
        })
      });
    });

    await page.goto('/planning/');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('#planning-agenda-status')).toHaveText('2 sessions chargees.');
    await expect(page.locator('.planning-agenda-session')).toHaveCount(1);
    await expect(page.locator('.planning-agenda-session').first()).toContainText('Conseil des routes');
    await expect(page.locator('.planning-agenda-chip').first()).toContainText('Conseil des routes');
    await expect(page.locator('.planning-agenda-response-summary').first()).toContainText('0 dispo / 1 incertain / 0 indispo');
    await expect(page.locator('.planning-agenda-insight').first()).toContainText('Creneau prevu: 0 dispo / 1 incertain / 1 conflit');
    await page.locator('.planning-agenda-response-actions button', { hasText: 'Disponible' }).first().click();
    expect(savedResponse.status).toBe('available');
    await expect(page.locator('#planning-agenda-status')).toHaveText('Reponse enregistree.');
    await expect(page.locator('.planning-agenda-response-summary').first()).toContainText('1 dispo / 1 incertain / 0 indispo');

    await page.locator('#planning-month-next').click();
    await expect(page.locator('.planning-agenda-session')).toHaveCount(1);
    await expect(page.locator('.planning-agenda-session').first()).toContainText('Session confirmee');
    await expect(page.locator('.planning-agenda-session').first()).toContainText('Confirmee');
  });

  test('la page planning reste exploitable sur mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/planning/');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('.planning-header')).toBeVisible();
    await expect(page.locator('#planning-dated')).toBeVisible();

    const hasHorizontalOverflow = await page.evaluate(() => (
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
    ));
    expect(hasHorizontalOverflow).toBeFalsy();
  });
});
