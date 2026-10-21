const createErrorResponse = (status, message, extra = {}) => ({
    status: 'error',
    message,
    ...extra
});

const extractProgress = payload => {
    if (!payload || typeof payload !== 'object') {
        return null;
    }
    return {
        current: Number(payload.current) || 0,
        max: Number(payload.max) || null
    };
};

module.exports = (register, context) => {
    const {
        logger,
        ensureAuthorized,
        readLocationsFile,
        persistLocations,
        collectBody,
        normalizeString,
        broadcastSse
    } = context;

    const log = logger.child('[questEvents]');
    const sendJson = (res, status, payload) => {
        res.writeHead(status, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store'
        });
        res.end(payload === undefined ? null : JSON.stringify(payload));
    };

    const findLocationByName = (locations, name) => {
        const target = normalizeString(name).toLowerCase();
        if (!target) {
            return null;
        }
        for (const [continent, entries] of Object.entries(locations || {})) {
            if (!Array.isArray(entries)) {
                continue;
            }
            for (let idx = 0; idx < entries.length; idx += 1) {
                const entry = entries[idx];
                if (normalizeString(entry?.name).toLowerCase() === target) {
                    return { continent, index: idx, entry };
                }
            }
        }
        return null;
    };

    const findEventById = (locations, questEventId) => {
        const normalizedId = normalizeString(questEventId);
        for (const [continent, entries] of Object.entries(locations || {})) {
            if (!Array.isArray(entries)) {
                continue;
            }
            for (let idx = 0; idx < entries.length; idx += 1) {
                const entry = entries[idx];
                const list = Array.isArray(entry?.questEvents) ? entry.questEvents : [];
                const eventIndex = list.findIndex(ev => {
                    const evId = normalizeString(ev?.id);
                    return ev?.id === questEventId || (evId && evId === normalizedId);
                });
                if (eventIndex !== -1) {
                    return {
                        continent,
                        locationIndex: idx,
                        entry,
                        eventIndex,
                        event: list[eventIndex],
                        events: list
                    };
                }
            }
        }
        return null;
    };

    register('GET', '/api/quest-events', async (req, res) => {
        const access = await context.security.load(req);
        const locations = access.locationsView();
        const events = [];
        Object.entries(locations || {}).forEach(([_, entries]) => {
            if (!Array.isArray(entries)) {
                return;
            }
            entries.forEach(entry => {
                const list = Array.isArray(entry?.questEvents) ? entry.questEvents : [];
                list.forEach(ev => {
                    events.push({
                        ...ev,
                        locationName: ev?.locationName || entry?.name || ''
                    });
                });
            });
        });
        sendJson(res, 200, { status: 'ok', events });
    });

    register('POST', '/api/quest-events', async (req, res) => {
        if (!(await ensureAuthorized(req, res, 'user'))) {
            return;
        }
        let payload;
        try {
            payload = JSON.parse(await collectBody(req) || '{}');
        } catch (error) {
            sendJson(res, 400, createErrorResponse('error', 'Invalid JSON'));
            return;
        }
        const questId = normalizeString(payload?.questId);
        const locationName = normalizeString(payload?.locationName);
        const status = normalizeString(payload?.status);
        const milestone = normalizeString(payload?.milestone);
        if (!questId || !locationName || !status) {
            sendJson(res, 400, createErrorResponse('error', 'Champs questId, locationName et status requis.'));
            return;
        }
        const progress = extractProgress(payload?.progress);
        const note = normalizeString(payload?.note) || '';
        const locations = await readLocationsFile();
        const match = findLocationByName(locations, locationName);
        if (!match) {
            sendJson(res, 404, createErrorResponse('error', 'Lieu introuvable pour cet évènement.'));
            return;
        }
        const event = {
            id: payload?.id && normalizeString(payload.id) ? normalizeString(payload.id) : `quest_${Date.now()}`,
            questId,
            locationName: match.entry.name,
            status,
            milestone: milestone || null,
            progress,
            note,
            updatedAt: new Date().toISOString(),
            createdAt: new Date().toISOString()
        };
        const access = await context.security.load(req);
        if (!access.canEditCategory(match.continent, match.entry, 'questEvents')) { sendJson(res, 404, createErrorResponse('error', 'Contenu autorise introuvable.')); return; }
        const list = Array.isArray(match.entry.questEvents) ? match.entry.questEvents : [];
        list.push(event);
        match.entry.questEvents = list;
        locations[match.continent][match.index] = match.entry;
        await context.persistScopedLocations(req, locations);
        broadcastSse('quest.updated', { event });
        sendJson(res, 201, { status: 'ok', event });
    });

    register('PATCH', /^\/api\/quest-events\/(?<id>[^/]+)$/, async (req, res, _urlObj, params) => {
        if (!(await ensureAuthorized(req, res, 'user'))) {
            return;
        }
        let payload;
        try {
            payload = JSON.parse(await collectBody(req) || '{}');
        } catch (error) {
            sendJson(res, 400, createErrorResponse('error', 'Invalid JSON'));
            return;
        }
        const questEventId = normalizeString(decodeURIComponent(params?.id || params?.groups?.id || params?.[1] || ''));
        const locations = await readLocationsFile();
        const located = findEventById(locations, questEventId);
        if (!located) {
            sendJson(res, 404, createErrorResponse('error', 'Evenement de quete introuvable.'));
            return;
        }
        const access = await context.security.load(req);
        if (!access.canEditCategory(located.continent, located.entry, 'questEvents')) { sendJson(res, 404, createErrorResponse('error', 'Contenu autorise introuvable.')); return; }
        const current = located.event;
        const partial = typeof payload === 'object' ? payload : {};
        const questId = normalizeString(partial.questId) || current.questId;
        const locationName = normalizeString(partial.locationName) || current.locationName;
        const status = normalizeString(partial.status) || current.status;
        if (!questId || !locationName || !status) {
            sendJson(res, 400, createErrorResponse('error', 'Champs questId, locationName et status requis.'));
            return;
        }
        const newLocation = findLocationByName(locations, locationName) || {
            continent: located.continent,
            index: located.locationIndex,
            entry: located.entry
        };
        if (!access.canEditCategory(newLocation.continent, newLocation.entry, 'questEvents')) { sendJson(res, 404, createErrorResponse('error', 'Destination autorisee introuvable.')); return; }
        const updated = {
            ...current,
            questId,
            locationName: newLocation.entry.name || locationName,
            status,
            milestone: normalizeString(partial.milestone) || current.milestone || null,
            note: normalizeString(partial.note) || current.note || '',
            progress: partial.progress ? extractProgress(partial.progress) : current.progress,
            updatedAt: new Date().toISOString()
        };
        const sourceList = Array.isArray(located.entry.questEvents) ? located.entry.questEvents : [];
        sourceList.splice(located.eventIndex, 1);
        located.entry.questEvents = sourceList;

        const targetList = Array.isArray(newLocation.entry.questEvents) ? newLocation.entry.questEvents : [];
        targetList.push(updated);
        newLocation.entry.questEvents = targetList;

        locations[located.continent][located.locationIndex] = located.entry;
        locations[newLocation.continent][newLocation.index] = newLocation.entry;

        await context.persistScopedLocations(req, locations);
        broadcastSse('quest.updated', { event: updated });
        sendJson(res, 200, { status: 'ok', event: updated });
    });

    register('DELETE', /^\/api\/quest-events\/(?<id>[^/]+)$/, async (req, res, _urlObj, params) => {
        if (!(await ensureAuthorized(req, res, 'user'))) {
            return;
        }
        const questEventId = normalizeString(decodeURIComponent(params?.id || params?.groups?.id || params?.[1] || ''));
        const locations = await readLocationsFile();
        const located = findEventById(locations, questEventId);
        if (!located) {
            if (req.auth?.role !== 'admin') { sendJson(res, 404, createErrorResponse('error', 'Contenu autorise introuvable.')); return; }
            // Idempotent for global administrators.
            broadcastSse('quest.deleted', { id: questEventId });
            sendJson(res, 200, { status: 'ok', removed: 0, event: null });
            return;
        }
        const list = Array.isArray(located.entry.questEvents) ? located.entry.questEvents : [];
        const access = await context.security.load(req);
        if (!access.canEditCategory(located.continent, located.entry, 'questEvents')) { sendJson(res, 404, createErrorResponse('error', 'Contenu autorise introuvable.')); return; }
        const removedEvent = list[located.eventIndex] || null;
        list.splice(located.eventIndex, 1);
        located.entry.questEvents = list;
        locations[located.continent][located.locationIndex] = located.entry;
        await context.persistScopedLocations(req, locations);
        broadcastSse('quest.deleted', { id: questEventId });
        sendJson(res, 200, { status: 'ok', removed: 1, event: removedEvent });
    });
};
