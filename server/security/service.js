const crypto = require('node:crypto');
const { Access, AccessError, fingerprint, digest, locationKey, list, select, own } = require('./access');
const { validRule, categories, kinds } = require('./schema');
const documents = ['permissions', 'users', 'groups', 'locations', 'types', 'timeline', 'site-config', 'planning', 'annotations'];
const reject = (status, message) => { throw new AccessError(status, message); };
function createSecurity({ storage, resolveCaller, json, collectBody, summarize, buildSession, datesFrom }) {
    const load = async (req, options) => {
        const actor = await resolveCaller(req, options);
        return new Access(Object.fromEntries(await Promise.all(documents.map(async name => [name, await storage.read(name)]))), actor);
    };
    const payload = async req => { try { const value = JSON.parse(await collectBody(req) || '{}'); if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(); return value; } catch { reject(400, 'Invalid JSON object'); } };
    const authenticated = access => { if (!access.actor.role) reject(401, 'Authorization required.'); };
    const admin = access => { authenticated(access); if (!access.admin) reject(403, 'Administrator required.'); };
    const savePlanning = async sessions => { const before = await storage.read('planning'); await storage.write('planning', Array.isArray(before) ? sessions : { ...before, sessions }); };
    const sessionViews = access => access.planning.map(session => access.sessionView(session, summarize)).filter(Boolean);
    const findResource = (access, kind, key) => {
        if (!kinds.includes(kind) || typeof key !== 'string') reject(400, 'Unknown resource kind/key');
        let matches;
        if (kind === 'locations') {
            let pair; try { pair = JSON.parse(key); } catch { reject(400, 'Invalid location key'); }
            if (!Array.isArray(pair) || pair.length !== 2 || pair.some(item => typeof item !== 'string')) reject(400, 'Invalid location key');
            matches = (own(access.locations, pair[0]) || []).filter(place => place.name === pair[1]);
        } else matches = (kind === 'timeline' ? access.timeline.entries : access[kind]).filter(record => record.id === key);
        if (matches.length !== 1) reject(404, 'Resource absent or ambiguous');
        return matches[0];
    };
    const checkRule = (access, rule, kind) => {
        if (!validRule(rule)) reject(400, 'Invalid explicit access rule');
        if (['GROUP', 'GM'].includes(rule.scope) && !access.groupIds.has(rule.groupId)) reject(400, 'Unknown group');
        if (rule.scope === 'PLAYERS' && rule.userIds.some(id => !access.users.some(user => user.id === id))) reject(400, 'Unknown player');
        if (rule.scope === 'PRIVATE' && (kind !== 'annotations' || !access.users.some(user => user.id === rule.ownerId))) reject(400, 'PRIVATE requires a verified annotation owner');
        if (kind === 'annotations' && rule.scope === 'PLAYERS') reject(400, 'Annotation scopes are PUBLIC, PRIVATE, GROUP, GM or ADMIN');
        if (['groups', 'planning'].includes(kind) && !['ADMIN', 'PUBLIC'].includes(rule.scope)) reject(400, 'Group/session publication accepts ADMIN or PUBLIC; memberships remain authoritative');
    };
    async function handle(req, res, url) {
        const p = url.pathname, method = req.method;
        const protectedPaths = ['/api/groups', '/api/locations', '/api/annotations', '/api/timeline', '/assets/locations.json', '/assets/timeline.json', '/api/planning/sessions', '/api/admin/planning/sessions', '/api/admin/permissions', '/api/locations/content'];
        const responseMatch = p.match(/^\/api\/planning\/sessions\/([^/]+)\/response$/);
        const annotationMatch = p.match(/^\/api\/annotations\/([^/]+)$/);
        const timelineMatch = p.match(/^\/api\/timeline\/entries\/([^/]+)$/);
        const availabilityMatch = p.match(/^\/api\/planning\/sessions\/([^/]+)\/availability$/);
        if (!protectedPaths.includes(p) && !responseMatch && !annotationMatch && !timelineMatch && !availabilityMatch) return false;
        // Preserve the established global administrator bulk location writer, behind its original gate.
        if (p === '/api/locations' && method === 'POST') return false;
        const a = await load(req);
        res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Vary', 'Cookie, Authorization');
        const reply = (status, value) => { json(res, status, method === 'HEAD' ? null : value); return true; };
        const methodOnly = allowed => { if (!allowed.includes(method)) { res.setHeader('Allow', allowed.join(', ')); reject(405, 'Method Not Allowed'); } };
        if (p === '/api/admin/permissions') {
            admin(a); methodOnly(['GET', 'PATCH']);
            if (method === 'GET') return reply(200, { status: 'ok', permissions: a.permissions, catalog: { locations: Object.entries(a.locations).flatMap(([continent, places]) => places.map(place => ({ key: locationKey(continent, place.name), name: place.name, continent, fingerprint: fingerprint('locations', place) }))), groups: a.groups.map(group => ({ ...select(group, ['id', 'name']), fingerprint: fingerprint('groups', group) })), planning: a.planning.map(session => ({ ...select(session, ['id', 'title', 'groupId']), fingerprint: fingerprint('planning', session) })), annotations: a.annotations.map(record => ({ id: record.id, label: record.label, record, fingerprint: fingerprint('annotations', record) })), timeline: a.timeline.entries.map(entry => ({ ...select(entry, ['id', 'title']), fingerprint: fingerprint('timeline', entry) })), users: a.users.map(user => ({ id: user.id, username: user.username, groups: user.groups || [] })) }, categories });
            const input = await payload(req);
            if (input.revision !== a.permissions.revision) reject(409, 'Permissions changed; reload before saving');
            if (input.confirm !== true) reject(400, 'Explicit disclosure/permission confirmation required');
            const next = structuredClone(a.permissions);
            if (input.assignment && !input.qualification) {
                const { userId, groupIds } = input.assignment;
                if (!a.users.some(user => user.id === userId) || !Array.isArray(groupIds) || new Set(groupIds).size !== groupIds.length || groupIds.some(id => !a.groupIds.has(id))) reject(400, 'Invalid MJ assignment');
                Object.defineProperty(next.managedGroups, userId, { value: groupIds, enumerable: true, configurable: true, writable: true });
            } else if (input.qualification && !input.assignment) {
                const q = input.qualification, record = findResource(a, q.kind, q.key);
                if (typeof q.fingerprint !== 'string') reject(400, 'Reviewed content fingerprint required');
                if (q.fingerprint !== fingerprint(q.kind, record)) reject(409, 'Content changed; review it again before qualification');
                checkRule(a, q.rule, q.kind);
                if (q.categories !== undefined && (q.kind !== 'locations' || !q.categories || typeof q.categories !== 'object' || Array.isArray(q.categories) || Object.keys(q.categories).some(key => !categories.includes(key)))) reject(400, 'Invalid categories');
                for (const rule of Object.values(q.categories || {})) checkRule(a, rule, 'locations');
                const entry = { rule: q.rule, fingerprint: fingerprint(q.kind, record), ...(q.categories ? { categories: q.categories } : {}) };
                if (q.withdrawn !== undefined) { if (typeof q.withdrawn !== 'boolean') reject(400, 'Invalid withdrawal'); entry.withdrawn = q.withdrawn; }
                if (q.kind === 'annotations') {
                    if (q.rule.scope !== 'ADMIN') {
                        if (!a.users.some(user => user.id === q.ownerId)) reject(400, 'Explicit verified historical owner required');
                        if (q.rule.scope === 'PRIVATE' && q.rule.ownerId !== q.ownerId) reject(400, 'Owner mismatch');
                        entry.ownerId = q.ownerId;
                        if (['GROUP', 'GM'].includes(q.rule.scope)) {
                            const owner = a.users.find(user => user.id === q.ownerId);
                            if (!(owner.groups || []).includes(q.rule.groupId) && !(own(a.permissions.managedGroups, owner.id) || []).includes(q.rule.groupId)) reject(400, 'Owner has no verified group relationship');
                            entry.groupId = q.rule.groupId;
                        }
                    }
                }
                Object.defineProperty(next.resources[q.kind], q.key, { value: entry, enumerable: true, configurable: true, writable: true });
            } else reject(400, 'Exactly one assignment or qualification is required');
            next.revision += 1;
            await storage.write('permissions', next);
            return reply(200, { status: 'ok', permissions: next });
        }
        if (p === '/api/groups') { methodOnly(['GET', 'HEAD']); return reply(200, { status: 'ok', groups: a.groups.map(group => a.groupView(group)).filter(Boolean) }); }
        if (p === '/api/locations' || p === '/assets/locations.json') { methodOnly(['GET', 'HEAD']); const locations = a.locationsView(); return reply(200, p.startsWith('/assets/') ? locations : { status: 'ok', locations }); }
        if (p === '/api/timeline' || p === '/assets/timeline.json') { methodOnly(['GET', 'HEAD']); const timeline = a.timelineView(); return reply(200, p.startsWith('/assets/') ? timeline : { status: 'ok', timeline }); }
        if (p === '/api/locations/content') {
            authenticated(a); methodOnly(['PATCH']); const input = await payload(req);
            if (!categories.includes(input.category)) reject(400, 'Unknown category');
            const key = locationKey(input.continent, input.name), place = findResource(a, 'locations', key);
            if (!a.canEditCategory(input.continent, place, input.category)) reject(404, 'Authorized content not found');
            const currentPolicy = a.locationPolicy(input.continent, place);
            if (currentPolicy?.rule.scope === 'PUBLIC' && currentPolicy.categories?.[input.category]?.scope === 'PUBLIC' && input.confirm !== true) reject(400, 'Confirm the modification of published content');
            if (['description', 'audio'].includes(input.category) ? typeof input.value !== 'string' : !Array.isArray(input.value)) reject(400, 'Invalid category value');
            const updated = { ...place, [input.category]: input.value };
            await storage.transaction(async () => {
                const policy = a.locationPolicy(input.continent, place);
                const locations = a.locations; locations[input.continent] = locations[input.continent].map(value => value === place ? updated : value);
                await storage.write('locations', locations);
                if (policy) {
                    const next = structuredClone(a.permissions); next.resources.locations[key].fingerprint = fingerprint('locations', updated); next.revision++;
                    await storage.write('permissions', next);
                }
            });
            return reply(200, { status: 'ok' });
        }
        if (timelineMatch) {
            authenticated(a); methodOnly(['PATCH']); const id = decodeURIComponent(timelineMatch[1]); const entry = findResource(a, 'timeline', id);
            const policy = a.policy('timeline', id, entry);
            if (!a.admin && (!['GROUP', 'GM'].includes(policy?.rule.scope) || !a.managed.has(policy.rule.groupId) || !a.timelineAllowed(entry))) reject(404, 'Authorized entry not found');
            const input = await payload(req); if (Object.keys(input).some(key => !['title', 'summary', 'content'].includes(key)) || Object.values(input).some(value => typeof value !== 'string' || value.length > 2400)) reject(400, 'Invalid scoped timeline update');
            const updated = { ...entry, ...input };
            await storage.transaction(async () => {
                await storage.write('timeline', { ...a.timeline, entries: a.timeline.entries.map(value => value === entry ? updated : value) });
                // A public entry edited by an administrator needs a fresh explicit publication.
                if (policy && policy.rule.scope !== 'PUBLIC') { a.permissions.resources.timeline[id].fingerprint = fingerprint('timeline', updated); a.permissions.revision++; await storage.write('permissions', a.permissions); }
            });
            return reply(200, { status: 'ok' });
        }
        if (p === '/api/planning/sessions') { methodOnly(['GET', 'HEAD']); return reply(200, { status: 'ok', sessions: sessionViews(a) }); }
        if (availabilityMatch) {
            authenticated(a); methodOnly(['GET']);
            const id = decodeURIComponent(availabilityMatch[1]), session = a.planning.find(value => value.id === id);
            if (!session || !a.sessionManage(session)) reject(404, 'Authorized session not found');
            const members = a.users.filter(user => a.admin && !session.groupId ? true : (user.groups || []).includes(session.groupId)).map(user => ({
                userId: user.id, username: user.username || '',
                availability: (user.planningAvailability || []).filter(entry => entry.date === session.date).map(entry => select(entry, ['id', 'date', 'startTime', 'endTime', 'status', 'comment'])),
                response: select(own(session.responses, user.id) || {}, ['status', 'comment'])
            }));
            return reply(200, { status: 'ok', sessionId: session.id, members });
        }
        if (p === '/api/admin/planning/sessions') {
            authenticated(a); methodOnly(['POST', 'PATCH', 'PUT', 'DELETE']); const input = await payload(req);
            const planning = a.planning;
            if (method === 'POST') {
                if (!a.admin && !a.managed.has(input.groupId)) reject(403, 'Assigned MJ group required');
                if (input.groupId && !a.groupIds.has(input.groupId)) reject(400, 'Unknown group');
                if (input.responses !== undefined || input.published !== undefined || input.role !== undefined) reject(400, 'Responses and publication use dedicated controls');
                const dates = datesFrom(input), created = dates.map(date => buildSession({ ...input, date }, { sessions: planning }));
                if (!dates.length || created.some(session => !session)) reject(400, 'Invalid session');
                // Ensure multi-date creations cannot alias one another, even with an explicit supplied id.
                const used = new Set(planning.map(session => session.id));
                for (const session of created) { const base = session.id; let i = 2; while (used.has(session.id)) session.id = `${base}-${i++}`; used.add(session.id); }
                await savePlanning([...planning, ...created]); a.planning = [...planning, ...created];
                return reply(201, { status: 'ok', session: a.sessionView(created[0], summarize), created: created.map(session => a.sessionView(session, summarize)), sessions: sessionViews(a) });
            }
            const index = planning.findIndex(session => session.id === input.id);
            if (index < 0 || !a.sessionManage(planning[index])) reject(404, 'Authorized session not found');
            const existing = planning[index];
            if (method === 'DELETE') {
                planning.splice(index, 1);
                await storage.transaction(async () => { await savePlanning(planning); if (own(a.permissions.resources.planning, existing.id)) { delete a.permissions.resources.planning[existing.id]; a.permissions.revision++; await storage.write('permissions', a.permissions); } });
                return reply(200, { status: 'ok', removed: a.sessionView(existing, summarize), sessions: sessionViews(a) });
            }
            if (input.responses !== undefined || input.published !== undefined || input.id !== existing.id) reject(400, 'Invalid session update');
            const normalized = buildSession(input, { existing, sessions: planning });
            if (!normalized || (normalized.groupId && !a.groupIds.has(normalized.groupId))) reject(400, 'Invalid session/group');
            const next = { ...existing, ...normalized, responses: existing.responses || {}, ...(Object.hasOwn(existing, 'createdAt') ? { createdAt: existing.createdAt } : {}) };
            if (!a.admin && !a.managed.has(next.groupId)) reject(403, 'Destination group is not assigned');
            planning[index] = next;
            await storage.transaction(async () => {
                await savePlanning(planning);
                // MJ edits never silently change an already published public projection.
                if (own(a.permissions.resources.planning, existing.id)) { delete a.permissions.resources.planning[existing.id]; a.permissions.revision++; await storage.write('permissions', a.permissions); }
            });
            return reply(200, { status: 'ok', session: a.sessionView(next, summarize), sessions: sessionViews(a) });
        }
        if (responseMatch) {
            authenticated(a); methodOnly(['PATCH', 'PUT']); if (!a.actor.user) reject(403, 'Persisted player account required');
            const id = decodeURIComponent(responseMatch[1]), session = a.planning.find(session => session.id === id);
            if (!session || !a.sessionInternal(session)) reject(404, 'Authorized session not found');
            const input = await payload(req), status = input.status || input.response;
            if (!['available', 'maybe', 'busy'].includes(status) || (input.userId !== undefined && input.userId !== a.actor.user.id)) reject(400, 'Invalid own response');
            session.responses = { ...(session.responses || {}), [a.actor.user.id]: { ...(own(session.responses, a.actor.user.id) || {}), status, comment: String(input.comment || '').slice(0, 280), updatedAt: new Date().toISOString() } };
            await savePlanning(a.planning);
            return reply(200, { status: 'ok', session: a.sessionView(session, summarize) });
        }
        if (p === '/api/annotations' && ['GET', 'HEAD'].includes(method)) return reply(200, { status: 'ok', annotations: a.annotations.filter(annotation => !own(a.permissions.resources.annotations, annotation.id)?.withdrawn).map(annotation => a.annotationView(annotation)).filter(Boolean) });
        if (p === '/api/annotations' && method === 'POST') {
            authenticated(a); if (!a.actor.user) reject(403, 'Persisted annotation owner required');
            const input = await payload(req), scope = input.scope;
            if (!['PUBLIC', 'PRIVATE', 'GROUP', 'GM', 'ADMIN'].includes(scope)) reject(400, 'Explicit canonical annotation scope required');
            if (['PUBLIC', 'ADMIN'].includes(scope) && !a.admin) reject(403, 'Administrator publication required');
            if (input.ownerId !== undefined && input.ownerId !== a.actor.user.id) reject(403, 'Annotation owner is set by the server');
            const rule = { scope, ...(scope === 'PRIVATE' ? { ownerId: a.actor.user.id } : {}), ...(['GROUP', 'GM'].includes(scope) ? { groupId: input.groupId } : {}) };
            checkRule(a, rule, 'annotations');
            if (!a.allows(rule)) reject(403, 'Unauthorized annotation scope');
            const x = Number(input.x ?? input.coords?.x), y = Number(input.y ?? input.coords?.y), label = typeof input.label === 'string' ? input.label.trim().slice(0, 500) : '';
            if (!Number.isFinite(x) || !Number.isFinite(y) || !label) reject(400, 'x, y and label required');
            const expires = input.expiresAt ? Date.parse(input.expiresAt) : null;
            if (expires !== null && !Number.isFinite(expires)) reject(400, 'Invalid expiration');
            if (scope === 'PUBLIC' && input.confirm !== true) reject(400, 'Explicit publication confirmation required');
            const annotation = { id: `annotation_${crypto.randomUUID()}`, x, y, label, color: /^#[a-f0-9]{3}(?:[a-f0-9]{3})?$/i.test(input.color) ? input.color : '#ff8a00', icon: typeof input.icon === 'string' ? input.icon : null, scope, ownerId: a.actor.user.id, ...(['GROUP', 'GM'].includes(scope) ? { groupId: rule.groupId } : {}), createdAt: new Date().toISOString(), expiresAt: expires === null ? null : new Date(expires).toISOString() };
            await storage.transaction(async () => {
                await storage.write('annotations', [...a.annotations, annotation]);
                a.permissions.resources.annotations[annotation.id] = { rule, ownerId: a.actor.user.id, fingerprint: fingerprint('annotations', annotation), ...(['GROUP', 'GM'].includes(scope) ? { groupId: rule.groupId } : {}) };
                a.permissions.revision++; await storage.write('permissions', a.permissions);
            });
            return reply(201, { status: 'ok', annotation });
        }
        if (annotationMatch) {
            admin(a); methodOnly(['DELETE']); const id = decodeURIComponent(annotationMatch[1]), annotation = findResource(a, 'annotations', id);
            const previous = own(a.permissions.resources.annotations, id);
            Object.defineProperty(a.permissions.resources.annotations, id, { value: { ...(previous || {}), rule: { scope: 'ADMIN' }, withdrawn: true, fingerprint: fingerprint('annotations', annotation) }, enumerable: true, configurable: true, writable: true });
            a.permissions.revision++; await storage.write('permissions', a.permissions);
            return reply(204, null);
        }
        reject(405, 'Method Not Allowed');
    }
    // No source payload crosses this boundary. Compare only the recipient's current authorized view.
    async function publish(clients, force = false) {
        for (const client of clients) {
            if (client.res.writableEnded || client.res.destroyed) continue;
            try {
                const access = await load(client.req, { renew: false });
                const signature = digest(access.snapshot());
                if (client.signature !== signature) {
                    client.signature = signature;
                    if (force || client.initialized) {
                        if (client.res.writableLength > 64 * 1024) { client.res.destroy(); continue; }
                        client.res.write('event: permissions.changed\ndata: {"refresh":true}\n\n');
                    }
                }
                if (!client.initialized) client.res.write('event: permissions.ready\ndata: {"refresh":true}\n\n');
                client.initialized = true;
            } catch {
                // Authentication/storage errors revoke the stream. No stale authorization is reused.
                client.res.write('event: permissions.changed\ndata: {"refresh":true}\n\n');
                client.res.end();
            }
        }
    }
    return { load, handle, publish };
}
module.exports = { createSecurity };
