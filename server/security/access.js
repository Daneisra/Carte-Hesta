const crypto = require('node:crypto');
const { categories } = require('./schema');
const { publicTimeline, publicSiteConfig, publicTypes } = require('../publication/projections');
const own = (object, key) => Object.hasOwn(object || {}, key) ? object[key] : undefined;
const list = (value, key) => Array.isArray(value) ? value : value[key];
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const locationKey = (continent, name) => JSON.stringify([continent, name]);
const fingerprint = (kind, value) => {
    if (kind !== 'planning') return digest(value);
    const { responses: _responses, updatedAt: _updatedAt, ...editorial } = value;
    return digest(editorial);
};
const select = (value, fields) => Object.fromEntries(fields.filter(key => Object.hasOwn(value, key) && (value[key] === null || ['string', 'number', 'boolean'].includes(typeof value[key]) || (Array.isArray(value[key]) && value[key].every(item => typeof item === 'string')))).map(key => [key, value[key]]));
const PUBLIC = { scope: 'PUBLIC' };
const ADMIN = { scope: 'ADMIN' };
function categoryView(category, value) {
    if (['description', 'audio'].includes(category)) return typeof value === 'string' ? value : '';
    if (typeof value === 'string' && ['history', 'lore', 'quests', 'instances', 'nobleFamilies'].includes(category)) return value;
    if (!Array.isArray(value)) return [];
    if (category === 'pnjs') return value.filter(item => item && typeof item === 'object').map(item => select(item, ['name', 'role', 'description']));
    if (category === 'videos') return value.filter(item => typeof item === 'string' || (item && typeof item === 'object')).map(item => typeof item === 'string' ? item : select(item, ['url', 'title']));
    if (category === 'questEvents') return value.filter(item => item && typeof item === 'object').map(item => ({ ...select(item, ['id', 'questId', 'locationName', 'status', 'milestone', 'note', 'createdAt', 'updatedAt']), ...(item.progress ? { progress: select(item.progress, ['current', 'max']) } : {}) }));
    return value.filter(item => typeof item === 'string');
}
class AccessError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}
class Access {
    constructor(documents, actor) {
        Object.assign(this, documents);
        this.actor = actor;
        this.users = list(this.users, 'users');
        this.groups = list(this.groups, 'groups');
        this.planning = list(this.planning, 'sessions');
        this.groupIds = new Set(this.groups.map(group => group.id));
        this.memberships = new Set((actor.user?.groups || []).filter(id => this.groupIds.has(id)));
        this.managed = new Set((own(this.permissions.managedGroups, actor.user?.id) || []).filter(id => this.groupIds.has(id)));
    }
    get admin() { return this.actor.role === 'admin'; }
    member(id) { return this.memberships.has(id); }
    manages(id) { return this.admin || this.managed.has(id); }
    allows(rule) {
        if (this.admin) return true;
        if (!rule) return false;
        switch (rule.scope) {
        case 'PUBLIC': return true;
        case 'PLAYERS': return !!this.actor.user && rule.userIds.includes(this.actor.user.id);
        case 'GROUP': return this.groupIds.has(rule.groupId) && (this.member(rule.groupId) || this.managed.has(rule.groupId));
        case 'GM': return this.groupIds.has(rule.groupId) && this.managed.has(rule.groupId);
        case 'PRIVATE': return !!this.actor.user && this.users.some(user => user.id === rule.ownerId) && rule.ownerId === this.actor.user.id;
        default: return false;
        }
    }
    policy(kind, key, value) {
        const entry = own(this.permissions.resources[kind], key);
        return entry && entry.fingerprint === fingerprint(kind, value) ? entry : null;
    }
    locationPolicy(continent, location) { return this.policy('locations', locationKey(continent, location.name), location); }
    locationAllowed(continent, location, category) {
        if (this.admin) return true;
        const policy = this.locationPolicy(continent, location);
        return !!policy && !policy.withdrawn && this.allows(policy.rule) && (!category || this.allows(own(policy.categories, category)));
    }
    canEditCategory(continent, location, category) {
        if (this.admin) return true;
        const rule = own(this.locationPolicy(continent, location)?.categories, category);
        return this.locationAllowed(continent, location, category) && ['GROUP', 'GM'].includes(rule?.scope) && this.managed.has(rule.groupId);
    }
    locationsView() {
        if (this.admin) return this.locations;
        const result = {};
        for (const [continent, entries] of Object.entries(this.locations)) {
            const visible = entries.filter(location => this.locationAllowed(continent, location)).map(location => {
                const projected = select(location, ['name', 'type', 'x', 'y']);
                for (const category of categories) if (this.locationAllowed(continent, location, category)) projected[category] = categoryView(category, location[category]);
                return projected;
            });
            if (visible.length) Object.defineProperty(result, continent, { value: visible, enumerable: true });
        }
        return result;
    }
    groupView(group) {
        const policy = this.policy('groups', group.id, group);
        const published = policy?.rule.scope === 'PUBLIC' && !policy.withdrawn;
        const internal = this.admin || this.member(group.id) || this.managed.has(group.id);
        if (!internal && !published) return null;
        const result = select(group, ['id', 'name', 'color']);
        if (!internal) return result;
        Object.assign(result, select(group, ['x', 'y']));
        result.members = [];
        for (const user of this.users.filter(user => Array.isArray(user.groups) && user.groups.includes(group.id))) {
            result.members.push({ name: user.username || '', type: 'user' });
            for (const character of user.characters || (user.character ? [user.character] : [])) {
                if (character?.groupId === group.id) result.members.push({ name: character.name || 'Personnage', type: 'character', active: character.active === true });
            }
        }
        result.memberCount = result.members.length;
        return result;
    }
    sessionGroup(session) { return this.groupIds.has(session.groupId) ? session.groupId : null; }
    sessionInternal(session) { const id = this.sessionGroup(session); return this.admin || (!!id && (this.member(id) || this.managed.has(id))); }
    sessionManage(session) { const id = this.sessionGroup(session); return this.admin || (!!id && this.managed.has(id)); }
    sessionView(session, summarize) {
        const internal = this.sessionInternal(session);
        const policy = this.policy('planning', session.id, session);
        if (!internal && (policy?.rule.scope !== 'PUBLIC' || policy.withdrawn)) return null;
        const result = select(session, ['id', 'title', 'date', 'startTime', 'durationMinutes', 'status', 'description', 'groupName']);
        if (!internal) return { ...result, canManage: false, canRespond: false };
        result.groupId = session.groupId || '';
        result.canManage = this.sessionManage(session);
        result.canRespond = !!this.actor.user;
        const manager = result.canManage;
        const members = new Set(this.users.filter(user => (user.groups || []).includes(session.groupId)).map(user => user.id));
        result.responses = Object.fromEntries(Object.entries(session.responses || {}).filter(([id]) => manager ? (this.admin || members.has(id)) : id === this.actor.user?.id)
            .map(([id, response]) => [id, select(response, ['status', 'comment'])]));
        if (summarize) {
            const users = manager ? this.users.filter(user => this.admin || (user.groups || []).includes(session.groupId)) : this.users.filter(user => user.id === this.actor.user?.id);
            Object.assign(result, summarize({ ...result, responses: result.responses }, { users }));
        }
        return result;
    }
    annotationView(annotation) {
        if (this.admin) return annotation;
        const policy = this.policy('annotations', annotation.id, annotation);
        if (!policy || policy.withdrawn || !this.allows(policy.rule)) return null;
        if (annotation.expiresAt && (!Number.isFinite(Date.parse(annotation.expiresAt)) || Date.parse(annotation.expiresAt) <= Date.now())) return null;
        return { ...select(annotation, ['id', 'x', 'y', 'label', 'color', 'icon', 'createdAt', 'expiresAt']), scope: policy.rule.scope };
    }
    timelineAllowed(entry) {
        if (this.admin) return true;
        const policy = this.policy('timeline', entry.id, entry);
        // Once qualified, a changed record must never fall back to legacy public visibility.
        if (!policy && own(this.permissions.resources.timeline, entry.id)) return false;
        const permitted = policy ? !policy.withdrawn && this.allows(policy.rule) : publicTimeline({ entries: [entry] }).entries.length === 1;
        if (!permitted) return false;
        return (entry.locationNames || []).every(name => {
            const matches = Object.entries(this.locations).flatMap(([continent, places]) => places.filter(place => place.name === name).map(place => [continent, place]));
            return matches.length > 0 && matches.every(([continent, place]) => this.locationAllowed(continent, place));
        });
    }
    timelineView() {
        if (this.admin) return this.timeline;
        const fields = ['id', 'year', 'yearLabel', 'title', 'summary', 'content', 'eventKind', 'era', 'eraSummary', 'sceneLabel', 'period', 'tags', 'locationNames', 'imageUrl', 'mediaAlt', 'accentColor', 'visible'];
        return { ...select(this.timeline, ['title', 'subtitle']), entries: this.timeline.entries.filter(entry => this.timelineAllowed(entry)).map(entry => select(entry, fields)) };
    }
    questView() { return Object.values(this.locationsView()).flat().flatMap(place => (place.questEvents || []).map(event => select({ ...event, locationName: place.name }, ['id', 'questId', 'status', 'milestone', 'note', 'progress', 'createdAt', 'updatedAt', 'locationName']))); }
    // All references count. A public reference cannot declassify another private parent.
    mediaParents() {
        const parents = new Map();
        const scan = (value, allowed) => {
            if (typeof value === 'string') {
                // Canonicalize as a browser URL without touching the stored text or making a request.
                // Unicode, encoded names, backslashes and dot segments must not hide a private parent.
                const normalized = value.replace(/\\/g, '/');
                for (const match of normalized.matchAll(/\/?assets\/[^\x00-\x1f\x7f<>"|*?#]+?\.(?:png|jpe?g|gif|webp|mp3|wav|ogg|opus|flac|aac|m4a)(?=$|[^A-Za-z0-9_.-])/giu)) {
                    let key;
                    try { key = decodeURIComponent(new URL('/' + decodeURIComponent(match[0].replace(/^\//, '')), 'http://media.invalid').pathname).slice(1); }
                    catch { continue; }
                    const existing = parents.get(key) || []; existing.push(allowed); parents.set(key, existing);
                }
            } else if (Array.isArray(value)) value.forEach(item => scan(item, allowed));
            else if (value && typeof value === 'object') Object.values(value).forEach(item => scan(item, allowed));
        };
        const compare = (raw, projected, allowed) => {
            if (Array.isArray(raw)) raw.forEach((value, index) => compare(value, Array.isArray(projected) ? projected[index] : undefined, allowed));
            else if (raw && typeof raw === 'object') for (const [key, value] of Object.entries(raw)) compare(value, own(projected, key), allowed);
            else scan(raw, allowed && projected !== undefined);
        };
        for (const [continent, places] of Object.entries(this.locations)) for (const place of places) for (const [field, value] of Object.entries(place)) compare(value, categoryView(field, value), categories.includes(field) && this.locationAllowed(continent, place, field));
        for (const entry of this.timeline.entries) for (const [field, value] of Object.entries(entry)) compare(value, own(select(entry, ['imageUrl', 'content', 'summary']), field), ['imageUrl', 'content', 'summary'].includes(field) && this.timelineAllowed(entry));
        for (const annotation of this.annotations) compare(annotation, this.annotationView(annotation), !!this.annotationView(annotation));
        for (const group of this.groups) compare(group, this.groupView(group), !!this.groupView(group));
        for (const session of this.planning) {
            const visible = this.sessionView(session);
            for (const [field, value] of Object.entries(session)) {
                if (field === 'responses') for (const [id, response] of Object.entries(value || {})) scan(response, !!visible?.responses && Object.hasOwn(visible.responses, id));
                else compare(value, own(visible, field), !!visible);
            }
        }
        for (const user of this.users) scan(user, this.admin || user.id === this.actor.user?.id);
        const site = publicSiteConfig(this['site-config']); compare(this['site-config'], site, true);
        const types = publicTypes(this.types); compare(this.types, types, true);
        // Compiled interface illustrations have an explicit public parent, never a directory wildcard.
        for (const asset of ['assets/map.png', 'assets/logo.png', 'assets/icons/default.png', 'assets/home/backgrounds/hero-main.png', 'assets/home/mockups/map-preview-main.png', 'assets/home/characters/Chevalier.png', 'assets/home/characters/Bertholo.png', 'assets/home/characters/Alienor.png', 'assets/home/characters/character.png']) scan(asset, true);
        return parents;
    }
    mediaAllowed(relative) {
        if (this.admin) return true;
        const parents = (this._mediaParents ||= this.mediaParents()).get(relative);
        return !!parents?.length && parents.every(Boolean);
    }
    snapshot() {
        return { media: [...this.mediaParents()].filter(([, allowed]) => this.admin || allowed.every(Boolean)).map(([key]) => key).sort(), identity: { role: this.actor.role, id: this.actor.user?.id || '', managed: [...this.managed] }, locations: this.locationsView(), groups: this.groups.map(group => this.groupView(group)).filter(Boolean), planning: this.planning.map(session => this.sessionView(session)).filter(Boolean), annotations: this.annotations.map(annotation => this.annotationView(annotation)).filter(Boolean), timeline: this.timelineView() };
    }
}
module.exports = { Access, AccessError, fingerprint, digest, locationKey, select, list, own, PUBLIC, ADMIN };
