// N'applique que les champs soumis, conserve les champs inconnus déjà enregistrés.
// Le numéro de version enregistré est hérité ; il n'a aucune autorité à l'exécution.
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' ? value.trim() : '';
const key = entry => JSON.stringify([text(entry?.date), text(entry?.title), text(entry?.summary)]);
class ChangelogValidationError extends Error {
    constructor(code, message) { super(message); this.code = code; this.status = 400; }
}
const exceeds = (value, limit) => {
    let count = 0;
    for (const _character of typeof value === 'string' ? value : '') if (++count > limit) return true;
    return false;
};
function appendChangelog(previous, submitted) {
    const result = [...previous];
    const known = new Set(previous.map(key));
    for (const [index, entry] of submitted.entries()) {
        // Reconnaître l'historique avant de valider : une note longue non éditée reste intacte.
        const identity = key(entry);
        if (known.has(identity)) continue;
        if (exceeds(entry.title, 200)) throw new ChangelogValidationError('E_CHANGELOG_TITLE_TOO_LONG', `Note ${index + 1} : le nouveau titre dépasse 200 caractères.`);
        if (exceeds(entry.summary, 4000)) throw new ChangelogValidationError('E_CHANGELOG_SUMMARY_TOO_LONG', `Note ${index + 1} : le nouveau résumé dépasse 4 000 caractères.`);
        const next = { date: text(entry.date), title: text(entry.title), summary: text(entry.summary) };
        if (!next.date && !next.title && !next.summary) continue;
        result.push(next);
        known.add(identity);
    }
    return result;
}
function applyConfigPatch(existing, submitted, sanitized, root = true) {
    const result = { ...existing };
    for (const [name, value] of Object.entries(sanitized)) {
        if (!Object.hasOwn(submitted, name) || (root && name === 'version')) continue;
        if (root && name === 'changelog') {
            const previous = Array.isArray(existing.changelog) ? existing.changelog : [];
            result.changelog = appendChangelog(previous, submitted.changelog);
        } else if (object(value) && object(submitted[name])) {
            result[name] = applyConfigPatch(object(existing[name]) ? existing[name] : {}, submitted[name], value, false);
        } else result[name] = value;
    }
    return result;
}
module.exports = { applyConfigPatch, appendChangelog, ChangelogValidationError };
