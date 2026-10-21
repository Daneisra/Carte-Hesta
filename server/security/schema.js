// Editorial authority is separate from historical content. No inference from legacy fields.
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const kinds = ['locations', 'groups', 'planning', 'annotations', 'timeline'];
const categories = ['description', 'tags', 'images', 'videos', 'audio', 'history', 'lore', 'quests', 'questEvents', 'pnjs', 'instances', 'nobleFamilies'];
const scopes = ['PUBLIC', 'PLAYERS', 'GROUP', 'GM', 'PRIVATE', 'ADMIN'];
const strings = value => Array.isArray(value) && value.every(item => typeof item === 'string' && item.length > 0) && new Set(value).size === value.length;
const exact = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));
function validRule(rule) {
    if (!exact(rule, ['scope', 'groupId', 'userIds', 'ownerId']) || !scopes.includes(rule.scope)) return false;
    if (['GROUP', 'GM'].includes(rule.scope)) return typeof rule.groupId === 'string' && !!rule.groupId && Object.keys(rule).length === 2;
    if (rule.scope === 'PLAYERS') return strings(rule.userIds) && rule.userIds.length > 0 && Object.keys(rule).length === 2;
    if (rule.scope === 'PRIVATE') return typeof rule.ownerId === 'string' && !!rule.ownerId && Object.keys(rule).length === 2;
    return Object.keys(rule).length === 1;
}
function emptyPermissions() {
    return { version: 1, revision: 0, retiredGroupIds: [], managedGroups: {}, resources: Object.fromEntries(kinds.map(kind => [kind, {}])) };
}
function validPermissions(value) {
    return exact(value, ['version', 'revision', 'retiredGroupIds', 'managedGroups', 'resources']) && value.version === 1 && Number.isSafeInteger(value.revision) && value.revision >= 0 && strings(value.retiredGroupIds)
        && object(value.managedGroups) && Object.values(value.managedGroups).every(strings)
        && exact(value.resources, kinds) && kinds.every(kind => object(value.resources[kind]) && Object.values(value.resources[kind]).every(entry =>
            exact(entry, ['rule', 'categories', 'ownerId', 'groupId', 'withdrawn', 'fingerprint']) && validRule(entry.rule)
            && (entry.categories === undefined || (exact(entry.categories, categories) && Object.values(entry.categories).every(validRule)))
            && (entry.ownerId === undefined || (typeof entry.ownerId === 'string' && !!entry.ownerId))
            && (entry.groupId === undefined || (typeof entry.groupId === 'string' && !!entry.groupId))
            && (entry.withdrawn === undefined || typeof entry.withdrawn === 'boolean')
            && typeof entry.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(entry.fingerprint)));
}
module.exports = { kinds, categories, scopes, validRule, validPermissions, emptyPermissions };
