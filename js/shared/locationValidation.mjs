import { sanitizeString, normalizeLocation } from './locationSchema.mjs';

const HTTP_URL_PATTERN = /^https?:\/\//i;

const formatLocationLabel = (continent, index, name) => {
    const base = continent ? sanitizeString(continent) : 'Continent inconnu';
    const position = Number.isInteger(index) ? `${base}[${index + 1}]` : base;
    return name ? `${position} • ${name}` : position;
};

const createIssue = (level, code, message, context = {}) => ({
    level,
    code,
    message,
    ...context
});

const normalizeMediaValue = value => sanitizeString(value || '');

const stripMarkdown = value => sanitizeString(value)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/[_*~]/g, '')
    .replace(/\r/g, '\n')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const countSentences = value => {
    const text = stripMarkdown(value);
    if (!text) {
        return 0;
    }
    const matches = text.match(/[.!?]+(?=\s|$)/g);
    return matches ? matches.length : 1;
};

const collectStringIssues = (field, value, { label, issues, allowString = true }) => {
    if (value === null || value === undefined || value === '') {
        return;
    }
    if (Array.isArray(value)) {
        value.forEach((entry, index) => {
            if (typeof entry !== 'string') {
                issues.push(createIssue(
                    'error',
                    `location.${field}.type`,
                    `${label}: ${field}[${index + 1}] doit être une chaîne.`,
                    {}
                ));
            }
        });
    } else if (typeof value !== 'string' || !allowString) {
        issues.push(createIssue(
            'error',
            `location.${field}.type`,
            `${label}: le champ ${field} doit être une chaîne ou une liste de chaînes.`,
            {}
        ));
    }
};

const isHttpUrl = value => HTTP_URL_PATTERN.test(value || '');

export function validateLocationRecord(rawLocation, {
    continent = '',
    index = 0,
    knownTypes = new Set(),
    allowHttpMedia = true
} = {}) {
    const issues = [];
    if (!rawLocation || typeof rawLocation !== 'object') {
        const label = formatLocationLabel(continent, index, '');
        issues.push(createIssue(
            'error',
            'location.invalid',
            `${label}: entrée invalide (objet attendu).`,
            { continent, index }
        ));
        return { normalized: null, issues };
    }

    const normalized = normalizeLocation(rawLocation);
    const label = formatLocationLabel(continent, index, normalized?.name);
    const pushWarning = (code, message) => issues.push(createIssue(
        'warning',
        code,
        message,
        { continent, index, name: normalized?.name || '' }
    ));

    const rawName = sanitizeString(rawLocation?.name);
    if (!rawName) {
        issues.push(createIssue(
            'error',
            'location.name.missing',
            `${label}: nom manquant.`,
            { continent, index, name: normalized?.name || '' }
        ));
    }

    const type = normalized?.type || 'default';
    if (type !== 'default' && knownTypes && knownTypes.size && !knownTypes.has(type)) {
        issues.push(createIssue(
            'error',
            'location.type.unknown',
            `${label}: type inconnu "${type}".`,
            { continent, index, name: normalized?.name || '', type }
        ));
    }

    const xValue = Number(rawLocation?.x);
    if (!Number.isFinite(xValue)) {
        issues.push(createIssue(
            'error',
            'location.coord.invalid',
            `${label}: coordonnée X invalide (${rawLocation?.x}).`,
            { continent, index, name: normalized?.name || '' }
        ));
    }
    const yValue = Number(rawLocation?.y);
    if (!Number.isFinite(yValue)) {
        issues.push(createIssue(
            'error',
            'location.coord.invalid',
            `${label}: coordonnée Y invalide (${rawLocation?.y}).`,
            { continent, index, name: normalized?.name || '' }
        ));
    }

    const audioRaw = normalizeMediaValue(rawLocation?.audio);
    if (audioRaw) {
        const isAsset = audioRaw.startsWith('assets/');
        const isHttp = allowHttpMedia && isHttpUrl(audioRaw);
        if (!isAsset && !isHttp) {
            issues.push(createIssue(
                'error',
                'location.audio.path',
                `${label}: audio invalide (${audioRaw}).`,
                { continent, index, name: normalized?.name || '' }
            ));
        }
    }

    const descriptionRaw = sanitizeString(rawLocation?.description);
    const descriptionText = stripMarkdown(descriptionRaw);
    const historyCount = Array.isArray(normalized?.history) ? normalized.history.length : 0;
    const loreCount = Array.isArray(normalized?.lore) ? normalized.lore.length : 0;
    const hasNarrativeSources = historyCount > 0 || loreCount > 0;

    if (!descriptionRaw) {
        pushWarning(
            'location.description.empty',
            `${label}: description absente ou vide.`
        );
    }
    if (hasNarrativeSources && !descriptionRaw) {
        pushWarning(
            'location.description.summaryMissing',
            `${label}: historique/lore renseignes sans resume court dans description.`
        );
    }
    if (!hasNarrativeSources && descriptionText.length > 520) {
        pushWarning(
            'location.description.tooLong',
            `${label}: description tres longue sans historique ni lore distincts.`
        );
    }
    if (descriptionRaw && countSentences(descriptionRaw) > 4) {
        pushWarning(
            'location.description.dense',
            `${label}: description dense (plus de 4 phrases) - preferer un resume court pour la carte.`
        );
    }
    if (descriptionRaw && /(^|\n)\s*(#|[-*+]\s)/m.test(descriptionRaw)) {
        pushWarning(
            'location.description.structured',
            `${label}: description structuree en titres ou listes - deplacer plutot ce detail dans historique ou lore.`
        );
    }

    const hasImages = Array.isArray(normalized?.images) && normalized.images.length > 0;
    const hasVideos = Array.isArray(normalized?.videos) && normalized.videos.length > 0;
    const hasAudio = Boolean(audioRaw);
    if (!hasImages && !hasVideos && !hasAudio) {
        pushWarning(
            'location.media.missing',
            `${label}: aucun média (image, vidéo ou audio) associé.`
        );
    }

    if (rawLocation?.images !== undefined) {
        if (!Array.isArray(rawLocation.images)) {
            issues.push(createIssue(
                'error',
                'location.images.type',
                `${label}: le champ images doit être une liste.`,
                { continent, index, name: normalized?.name || '' }
            ));
        } else {
            rawLocation.images.forEach((entry, imageIndex) => {
                const value = normalizeMediaValue(entry);
                if (!value) {
                    issues.push(createIssue(
                        'error',
                        'location.images.empty',
                        `${label}: image ${imageIndex + 1} vide.`,
                        { continent, index, name: normalized?.name || '' }
                    ));
                    return;
                }
                const isAsset = value.startsWith('assets/');
                const isHttp = allowHttpMedia && isHttpUrl(value);
                if (!isAsset && !isHttp) {
                    issues.push(createIssue(
                        'error',
                        'location.images.path',
                        `${label}: image ${imageIndex + 1} doit être un chemin "assets/" ou une URL http(s).`,
                        { continent, index, name: normalized?.name || '' }
                    ));
                }
            });
        }
    }

    if (rawLocation?.videos !== undefined) {
        if (!Array.isArray(rawLocation.videos)) {
            issues.push(createIssue(
                'error',
                'location.videos.type',
                `${label}: le champ videos doit être une liste.`,
                { continent, index, name: normalized?.name || '' }
            ));
        } else {
            rawLocation.videos.forEach((entry, videoIndex) => {
                if (typeof entry === 'string') {
                    const value = normalizeMediaValue(entry);
                    if (!value) {
                        issues.push(createIssue(
                            'error',
                            'location.videos.url',
                            `${label}: videos[${videoIndex + 1}] sans URL.`,
                            { continent, index, name: normalized?.name || '' }
                        ));
                        return;
                    }
                    const isAsset = value.startsWith('assets/');
                    const isHttp = allowHttpMedia && isHttpUrl(value);
                    if (!isAsset && !isHttp) {
                        issues.push(createIssue(
                            'error',
                            'location.videos.url',
                            `${label}: videos[${videoIndex + 1}] doit contenir une URL http(s) ou un chemin assets/.`,
                            { continent, index, name: normalized?.name || '' }
                        ));
                    }
                    return;
                }
                if (!entry || typeof entry !== 'object') {
                    issues.push(createIssue(
                        'error',
                        'location.videos.type',
                        `${label}: videos[${videoIndex + 1}] doit être une chaîne ou un objet.`,
                        { continent, index, name: normalized?.name || '' }
                    ));
                    return;
                }
                const url = normalizeMediaValue(entry.url);
                if (!url) {
                    issues.push(createIssue(
                        'error',
                        'location.videos.url',
                        `${label}: videos[${videoIndex + 1}] doit contenir une URL.`,
                        { continent, index, name: normalized?.name || '' }
                    ));
                    return;
                }
                const isAsset = url.startsWith('assets/');
                const isHttp = allowHttpMedia && isHttpUrl(url);
                if (!isAsset && !isHttp) {
                    issues.push(createIssue(
                        'error',
                        'location.videos.url',
                        `${label}: videos[${videoIndex + 1}] doit être un chemin assets/ ou une URL http(s).`,
                        { continent, index, name: normalized?.name || '' }
                    ));
                }
            });
        }
    }

    collectStringIssues('history', rawLocation?.history, { label, issues, allowString: true });
    collectStringIssues('quests', rawLocation?.quests, { label, issues, allowString: true });
    collectStringIssues('lore', rawLocation?.lore, { label, issues, allowString: true });
    collectStringIssues('instances', rawLocation?.instances, { label, issues, allowString: true });
    collectStringIssues('nobleFamilies', rawLocation?.nobleFamilies, { label, issues, allowString: true });

    if (rawLocation?.pnjs !== undefined) {
        if (!Array.isArray(rawLocation.pnjs)) {
            issues.push(createIssue(
                'error',
                'location.pnjs.type',
                `${label}: le champ pnjs doit être une liste.`,
                { continent, index, name: normalized?.name || '' }
            ));
        } else {
            rawLocation.pnjs.forEach((pnj, pnjIndex) => {
                if (!pnj || typeof pnj !== 'object') {
                    issues.push(createIssue(
                        'error',
                        'location.pnjs.entry',
                        `${label}: pnjs[${pnjIndex + 1}] doit être un objet.`,
                        { continent, index, name: normalized?.name || '' }
                    ));
                    return;
                }
                const pnjName = sanitizeString(pnj.name);
                if (!pnjName) {
                    issues.push(createIssue(
                        'error',
                        'location.pnjs.name',
                        `${label}: pnjs[${pnjIndex + 1}] doit avoir un nom.`,
                        { continent, index, name: normalized?.name || '' }
                    ));
                }
            });
        }
    }

    if (rawLocation?.tags !== undefined && rawLocation.tags !== null) {
        if (Array.isArray(rawLocation.tags)) {
            rawLocation.tags.forEach((tag, tagIndex) => {
                if (typeof tag !== 'string') {
                    issues.push(createIssue(
                        'error',
                        'location.tags.type',
                        `${label}: tags[${tagIndex + 1}] doit être une chaîne.`,
                        { continent, index, name: normalized?.name || '' }
                    ));
                }
            });
        } else if (typeof rawLocation.tags !== 'string') {
            issues.push(createIssue(
                'error',
                'location.tags.type',
                `${label}: le champ tags doit être une chaîne ou une liste de chaînes.`,
                { continent, index, name: normalized?.name || '' }
            ));
        }
    }

    if (!Array.isArray(normalized?.tags) || normalized.tags.length === 0) {
        pushWarning(
            'location.tags.empty',
            `${label}: aucun tag attribué.`
        );
    }

    return { normalized, issues };
}

export function validateDataset(rawDataset, {
    typeMap = {},
    sanitizeKeys = false,
    allowHttpMedia = true
} = {}) {
    const issues = [];

    if (!rawDataset || typeof rawDataset !== 'object' || Array.isArray(rawDataset)) {
        issues.push(createIssue(
            'error',
            'dataset.structure',
            'Le payload "locations" doit être un objet { continent: lieux[] }.'
        ));
        return { normalized: {}, issues };
    }

    const knownTypes = new Set(Object.keys(typeMap || {}));
    knownTypes.add('default');

    const normalizedDataset = {};
    const seenNames = new Map();

    Object.entries(rawDataset || {}).forEach(([rawContinent, rawLocations]) => {
        const sanitizedContinent = sanitizeString(rawContinent);
        const continentKey = sanitizeKeys ? sanitizedContinent : rawContinent;
        if (!continentKey) {
            issues.push(createIssue(
                'error',
                'dataset.continent.name',
                `Continent "${rawContinent}" invalide (nom requis).`
            ));
            return;
        }

        if (!Array.isArray(rawLocations)) {
            issues.push(createIssue(
                'error',
                'dataset.continent.type',
                `${continentKey}: la valeur du continent doit être une liste.`
            ));
            normalizedDataset[continentKey] = [];
            return;
        }

        const normalizedLocations = [];
        rawLocations.forEach((rawLocation, index) => {
            const { normalized, issues: locationIssues } = validateLocationRecord(rawLocation, {
                continent: continentKey,
                index,
                knownTypes,
                allowHttpMedia
            });
            locationIssues.forEach(issue => issues.push(issue));
            if (!normalized) {
                return;
            }
            const nameKey = sanitizeString(normalized.name).toLowerCase();
            if (nameKey) {
                const duplicateKey = `${sanitizeString(continentKey).toLowerCase()}::${nameKey}`;
                if (seenNames.has(duplicateKey)) {
                    const other = seenNames.get(duplicateKey);
                    const message = `Doublon de nom "${normalized.name}" entre ${other.label} et ${formatLocationLabel(continentKey, index, normalized.name)}.`;
                    issues.push(createIssue(
                        'error',
                        'dataset.location.duplicate',
                        message,
                        { continent: continentKey, index, name: normalized.name }
                    ));
                } else {
                    seenNames.set(duplicateKey, {
                        label: formatLocationLabel(continentKey, index, normalized.name)
                    });
                }
            }
            normalizedLocations.push(normalized);
        });

        normalizedDataset[continentKey] = normalizedLocations;
    });

    return { normalized: normalizedDataset, issues };
}
