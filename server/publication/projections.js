// Explicit response shapes; never spread a persistent record into a public response.
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const scalar = value => typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
function pick(source, shape) {
    const result = Object.create(null);
    if (!object(source)) return result;
    for (const [key, spec] of Object.entries(shape)) {
        const value = source[key];
        if (value === undefined) continue;
        if (spec === true && scalar(value)) result[key] = value;
        else if (spec === 'strings' && Array.isArray(value)) result[key] = value.filter(item => typeof item === 'string');
        else if (Array.isArray(spec) && Array.isArray(value)) result[key] = value.map(item => pick(item, spec[0]));
        else if (object(spec) && object(value)) result[key] = pick(value, spec);
    }
    return result;
}
const card = { badge: true, title: true, copy: true };
const siteShape = {
    version: true,
    home: { kicker: true, title: true, lead: true, atmosphere: true, tags: 'strings', metrics: [{ label: true, value: true }], visuals: { backgroundImage: true, mapPreviewImage: true, characterImage: true, floatingTitle: true, floatingCopy: true } },
    community: { youtubeUrl: true, discordUrl: true, redditUrl: true, discord: card, youtube: card, reddit: card, proof: { mode: true, manualCount: true, label: true, note: true } },
    support: { issuesUrl: true, contactEmail: true }, legal: { creditsUrl: true, footerNote: true },
    changelog: [{ date: true, title: true, summary: true }]
};
const unresolved = value => ['scope', 'private', 'gmOnly', 'draft', 'published', 'ownerId', 'groupId'].some(key => Object.hasOwn(value, key));
function publicTimeline(source) {
    const result = pick(source, { title: true, subtitle: true });
    result.entries = (source.entries || []).filter(entry => entry.visible === true && !unresolved(entry)).map(entry => pick(entry, {
        id: true, year: true, yearLabel: true, title: true, summary: true, content: true, eventKind: true,
        era: true, eraSummary: true, sceneLabel: true, period: true, tags: 'strings', locationNames: 'strings', imageUrl: true, mediaAlt: true, accentColor: true, visible: true
    }));
    return result;
}
function publicTypes(source) {
    return Object.fromEntries(Object.entries(source).filter(([, value]) => object(value) && !unresolved(value)).map(([name, value]) => [name, pick(value, { icon: true, zoom: true, label: true, color: true })]));
}
module.exports = { publicSiteConfig: source => pick(source, siteShape), publicTimeline, publicTypes };
