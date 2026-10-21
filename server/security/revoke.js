// Called inside the original deletion transaction. IDs recreated later inherit no old grant.
async function revokeReferences(storage, kind, id) {
    const permissions = await storage.read('permissions');
    const revoke = rule => {
        if (kind === 'groups' && rule.groupId === id) return { scope: 'ADMIN' };
        if (kind === 'users' && rule.ownerId === id) return { scope: 'ADMIN' };
        if (kind === 'users' && rule.scope === 'PLAYERS' && rule.userIds.includes(id)) {
            const userIds = rule.userIds.filter(value => value !== id);
            return userIds.length ? { scope: 'PLAYERS', userIds } : { scope: 'ADMIN' };
        }
        return rule;
    };
    if (kind === 'groups') {
        if (!permissions.retiredGroupIds.includes(id)) permissions.retiredGroupIds.push(id);
        delete permissions.resources.groups[id];
        for (const key of Object.keys(permissions.managedGroups)) permissions.managedGroups[key] = permissions.managedGroups[key].filter(value => value !== id);
        const planning = await storage.read('planning');
        for (const session of Array.isArray(planning) ? planning : planning.sessions) if (session.groupId === id) delete permissions.resources.planning[session.id];
    } else delete permissions.managedGroups[id];
    for (const entries of Object.values(permissions.resources)) for (const entry of Object.values(entries)) {
        entry.rule = revoke(entry.rule);
        for (const key of Object.keys(entry.categories || {})) entry.categories[key] = revoke(entry.categories[key]);
        if (kind === 'users' && entry.ownerId === id) entry.rule = { scope: 'ADMIN' };
    }
    permissions.revision++;
    await storage.write('permissions', permissions);
}
module.exports = { revokeReferences };
