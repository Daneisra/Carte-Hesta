const normalizeString = value => (value ?? '').toString().trim();

const normalizeLower = value => normalizeString(value).toLowerCase();

const uniqueArray = iterable => {
    const seen = new Set();
    const result = [];
    iterable.forEach(item => {
        const key = typeof item === 'string' ? item : JSON.stringify(item);
        if (!seen.has(key)) {
            seen.add(key);
            result.push(item);
        }
    });
    return result;
};

const collectTextArray = value => {
    if (Array.isArray(value)) {
        return value.map(normalizeString).filter(Boolean);
    }
    if (typeof value === 'string') {
        const trimmed = normalizeString(value);
        return trimmed ? [trimmed] : [];
    }
    return [];
};

const collectTagArray = value => {
    if (Array.isArray(value)) {
        return value.map(normalizeString).filter(Boolean);
    }
    if (typeof value === 'string') {
        return value
            .split(/[,;]+/)
            .map(normalizeString)
            .filter(Boolean);
    }
    return [];
};

const tokenizeQuery = query => {
    if (!query) {
        return [];
    }
    return normalizeLower(query)
        .split(/\s+/)
        .map(token => token.replace(/[^\p{L}\p{N}\-_'’]+/u, '').trim())
        .filter(Boolean);
};

const capitalizeWords = value => {
    const lower = normalizeString(value).toLowerCase();
    if (!lower) {
        return '';
    }
    return lower.replace(/(?:^|\s|-)\p{L}/gu, match => match.toUpperCase());
};

const extractLiveQuestStatuses = quests => {
    if (!Array.isArray(quests)) {
        return [];
    }
    const statuses = [];
    quests.forEach(entry => {
        if (typeof entry !== 'string') {
            return;
        }
        const trimmed = entry.trim();
        if (!trimmed.startsWith('[LIVE]')) {
            return;
        }
        const withoutPrefix = trimmed.replace(/^\[LIVE\]\s*/, '');
        const parts = withoutPrefix.split(' - ').map(part => part.trim());
        const statusCandidate = parts.length >= 3 ? parts[2] : parts.length >= 2 ? parts[1] : '';
        const status = normalizeString(statusCandidate);
        if (status) {
            statuses.push(status);
        }
    });
    return statuses;
};

const collectPnjText = pnjs => {
    if (!Array.isArray(pnjs)) {
        return [];
    }
    return pnjs
        .map(pnj => {
            if (!pnj || typeof pnj !== 'object') {
                return '';
            }
            const name = normalizeString(pnj.name);
            const role = normalizeString(pnj.role);
            const description = normalizeString(pnj.description);
            return [name, role, description].filter(Boolean).join(' ');
        })
        .filter(Boolean);
};

export function normalizeFilterState(raw = {}) {
    const normalized = {
        text: '',
        types: [],
        tags: [],
        quests: 'any',
        statuses: []
    };

    if (raw && typeof raw === 'object') {
        if (Object.prototype.hasOwnProperty.call(raw, 'text') && typeof raw.text === 'string') {
            normalized.text = raw.text.trim();
        }

        const legacyType = typeof raw.type === 'string' ? normalizeString(raw.type) : '';
        const typeCandidates = Array.isArray(raw.types) ? raw.types : [];
        const mergedTypes = [
            ...typeCandidates,
            ...(legacyType && legacyType !== 'all' ? [legacyType] : [])
        ];
        normalized.types = uniqueArray(
            mergedTypes
                .map(normalizeString)
                .filter(Boolean)
        );

        const tagCandidates = Array.isArray(raw.tags)
            ? raw.tags
            : typeof raw.tags === 'string'
                ? raw.tags.split(/[,;]+/)
                : [];
        normalized.tags = uniqueArray(
            tagCandidates
                .map(normalizeLower)
                .filter(Boolean)
        );

        if (typeof raw.quests === 'string') {
            const candidate = normalizeLower(raw.quests);
            if (candidate === 'with' || candidate === 'without' || candidate === 'any') {
                normalized.quests = candidate;
            }
        } else if (typeof raw.hasQuests === 'boolean') {
            normalized.quests = raw.hasQuests ? 'with' : 'without';
        }

        const statusCandidates = Array.isArray(raw.statuses)
            ? raw.statuses
            : typeof raw.statuses === 'string'
                ? raw.statuses.split(/[,;]+/)
                : [];
        normalized.statuses = uniqueArray(
            statusCandidates
                .map(normalizeLower)
                .filter(Boolean)
        );
    }

    return normalized;
}

export function prepareFilters(filters = {}) {
    const normalized = normalizeFilterState(filters);
    return {
        raw: normalized,
        textTokens: tokenizeQuery(normalized.text),
        typeSet: new Set(normalized.types),
        tagSet: new Set(normalized.tags),
        statusSet: new Set(normalized.statuses),
        quests: normalized.quests
    };
}

export function buildLocationIndex(location = {}, {
    continent = '',
    questEvents = []
} = {}) {
    const name = normalizeString(location.name);
    const type = normalizeString(location.type) || 'default';
    const continentLabel = normalizeString(continent);
    const history = collectTextArray(location.history);
    const quests = collectTextArray(location.quests);
    const lore = collectTextArray(location.lore);
    const description = normalizeString(location.description);
    const tags = collectTagArray(location.tags);
    const tagsNormalized = uniqueArray(tags.map(normalizeLower));

    const questEventStatuses = Array.isArray(questEvents)
        ? questEvents
            .map(event => normalizeString(event?.status))
            .filter(Boolean)
        : [];
    const liveStatuses = extractLiveQuestStatuses(quests);
    const allStatuses = uniqueArray([
        ...questEventStatuses,
        ...liveStatuses
    ]);
    const eventStatusesNormalized = uniqueArray(allStatuses.map(normalizeLower));

    const pnjs = collectPnjText(location.pnjs);

    const textSources = uniqueArray([
        name,
        description,
        ...history,
        ...quests,
        ...lore,
        ...pnjs
    ]).filter(Boolean);

    const textIndex = textSources.map(entry => entry.toLowerCase());
    const hasQuests = quests.length > 0 || questEventStatuses.length > 0;

    return {
        source: location,
        name,
        nameLower: name.toLowerCase(),
        type,
        continent: continentLabel,
        coords: {
            x: Number(location.x) || 0,
            y: Number(location.y) || 0
        },
        tags,
        tagsNormalized,
        hasQuests,
        eventStatuses: allStatuses,
        eventStatusesNormalized,
        textSources,
        textIndex
    };
}

export function locationMatchesFilters(index, preparedFilters) {
    if (!index || !preparedFilters) {
        return true;
    }
    const {
        textTokens,
        typeSet,
        tagSet,
        statusSet,
        quests
    } = preparedFilters;

    if (textTokens.length) {
        const haystacks = index.textIndex || [];
        const matchesTokens = textTokens.every(token =>
            haystacks.some(text => text.includes(token))
        );
        if (!matchesTokens) {
            return false;
        }
    }

    if (typeSet.size && !typeSet.has(index.type)) {
        return false;
    }

    if (tagSet.size) {
        const availableTags = index.tagsNormalized || [];
        const hasAllTags = Array.from(tagSet).every(tag => availableTags.includes(tag));
        if (!hasAllTags) {
            return false;
        }
    }

    if (statusSet.size) {
        const availableStatuses = index.eventStatusesNormalized || [];
        const hasAnyStatus = availableStatuses.some(status => statusSet.has(status));
        if (!hasAnyStatus) {
            return false;
        }
    }

    if (quests === 'with' && !index.hasQuests) {
        return false;
    }
    if (quests === 'without' && index.hasQuests) {
        return false;
    }

    return true;
}

export function filterLocations(indices = [], filters = {}) {
    const prepared = prepareFilters(filters);
    return indices.filter(index => locationMatchesFilters(index, prepared));
}

export function buildFilterFacets(indices = [], {
    typeLabels = new Map()
} = {}) {
    const typeCounts = new Map();
    const tagCounts = new Map();
    const statusCounts = new Map();
    let withQuests = 0;
    let withoutQuests = 0;

    indices.forEach(index => {
        const type = index.type || 'default';
        typeCounts.set(type, (typeCounts.get(type) || 0) + 1);

    if (Array.isArray(index.tags)) {
        const seen = new Set();
        index.tags.forEach(tagLabel => {
            const normalizedTag = normalizeLower(tagLabel);
            if (!normalizedTag || seen.has(normalizedTag)) {
                return;
            }
            seen.add(normalizedTag);
            const entry = tagCounts.get(normalizedTag) || {
                value: normalizedTag,
                label: capitalizeWords(tagLabel || normalizedTag),
                count: 0
            };
            entry.count += 1;
            tagCounts.set(normalizedTag, entry);
        });
    }

    if (Array.isArray(index.eventStatuses)) {
        const seen = new Set();
        index.eventStatuses.forEach(statusLabel => {
            const normalizedStatus = normalizeLower(statusLabel);
            if (!normalizedStatus || seen.has(normalizedStatus)) {
                return;
            }
            seen.add(normalizedStatus);
            const entry = statusCounts.get(normalizedStatus) || {
                value: normalizedStatus,
                label: capitalizeWords(statusLabel || normalizedStatus),
                count: 0
            };
            entry.count += 1;
            statusCounts.set(normalizedStatus, entry);
        });
    }

        if (index.hasQuests) {
            withQuests += 1;
        } else {
            withoutQuests += 1;
        }
    });

    const types = Array.from(typeCounts.entries())
        .map(([value, count]) => ({
            value,
            label: (typeLabels.get(value)?.label) || value,
            count
        }))
        .sort((left, right) => left.label.localeCompare(right.label, 'fr', { sensitivity: 'base' }));

    const tags = Array.from(tagCounts.values())
        .sort((left, right) => left.label.localeCompare(right.label, 'fr', { sensitivity: 'base' }));

    const statuses = Array.from(statusCounts.values())
        .sort((left, right) => left.label.localeCompare(right.label, 'fr', { sensitivity: 'base' }));

    return {
        types,
        tags,
        statuses,
        quests: {
            with: withQuests,
            without: withoutQuests
        }
    };
}

export function resolveFilters(filters = {}) {
    const normalized = normalizeFilterState(filters);
    return {
        normalized,
        prepared: prepareFilters(normalized)
    };
}
