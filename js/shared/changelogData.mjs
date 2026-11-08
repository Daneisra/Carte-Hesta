import { CHANGELOG } from './changelog.mjs';

const string = value => typeof value === 'string' ? value : '';
const text = value => string(value).trim();
export const entryVersion = entry => text(entry?.version) || text(entry?.title).match(/^Version (\d+\.\d+\.\d+)(?:\s|$)/u)?.[1] || '';
const meaningful = entry => entry && typeof entry === 'object' && (text(entry.date) || text(entry.title) || text(entry.summary));

// Renvoie les objets d'origine pour conserver la provenance lors des contrôles média.
// L'ordre persistant est un journal additif ; sa dernière variante fait autorité.
export function latestVersionEntries(entries) {
    const valid = Array.isArray(entries) ? entries.filter(meaningful) : [];
    const last = new Map();
    valid.forEach((entry, index) => { const version = entryVersion(entry); if (version) last.set(version, index); });
    return valid.filter((entry, index) => !entryVersion(entry) || last.get(entryVersion(entry)) === index);
}

const fields = entry => ({ date: string(entry.date), title: string(entry.title), summary: string(entry.summary) });
// Les replis de présentation ne sont jamais réutilisés pour sauvegarder l'historique.
export const normalizeEntries = entries => Array.isArray(entries) ? entries.filter(meaningful).map(entry => ({
    ...fields(entry), title: text(entry.title) ? entry.title : 'Mise à jour', summary: text(entry.summary) ? entry.summary : string(entry.title)
})) : [];

const compareVersions = (a, b) => {
    const aa = a ? a.split('.').map(Number) : [0, 0, 0];
    const bb = b ? b.split('.').map(Number) : [0, 0, 0];
    for (let index = 0; index < 3; index++) if (aa[index] !== bb[index]) return bb[index] - aa[index];
    return 0;
};

export function mergeChangelog(entries) {
    const custom = latestVersionEntries(entries);
    const canonical = CHANGELOG.filter(entry => !custom.some(saved => entryVersion(entry)
        ? entryVersion(saved) === entryVersion(entry) : saved.title === entry.title));
    const drafts = new Set(CHANGELOG.filter(entry => entry.status === 'draft').map(entryVersion));
    // La projection publique conserve les textes intégraux ; les variantes restent stockées.
    return [...canonical, ...custom].map(fields).sort((a, b) =>
        Number(drafts.has(entryVersion(b))) - Number(drafts.has(entryVersion(a)))
        || b.date.localeCompare(a.date)
        || compareVersions(entryVersion(a), entryVersion(b)));
}
