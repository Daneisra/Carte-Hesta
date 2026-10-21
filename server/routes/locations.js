const { publicTypes } = require('../publication/projections');
const createErrorResponse = (status, message, extra = {}) => ({
    status: 'error',
    message,
    ...extra
});

const DESCRIPTION_SENTENCE_LIMIT = 4;
const DESCRIPTION_CHAR_LIMIT = 460;

const sanitizeDraftText = value => (value ?? '').toString().trim();

const collectDraftTextArray = value => {
    if (Array.isArray(value)) {
        return value
            .map(entry => sanitizeDraftText(entry))
            .filter(Boolean);
    }
    const single = sanitizeDraftText(value);
    return single ? [single] : [];
};

const stripMarkdown = input => sanitizeDraftText(input)
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
    .replace(/\|/g, ' ')
    .replace(/\r/g, '\n')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeSentenceKey = value => stripMarkdown(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const ensureSentenceEnding = sentence => {
    const trimmed = sanitizeDraftText(sentence);
    if (!trimmed) {
        return '';
    }
    return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

const splitIntoSentences = text => {
    const cleaned = stripMarkdown(text);
    if (!cleaned) {
        return [];
    }
    return cleaned
        .split(/(?<=[.!?])\s+(?=[A-Z0-9À-ÿ])/u)
        .flatMap(chunk => chunk.split(/\s*;\s*/))
        .map(entry => sanitizeDraftText(entry))
        .filter(entry => entry.length >= 35);
};

const buildFallbackDescription = (location, typeLabel) => {
    const name = sanitizeDraftText(location?.name) || 'Ce lieu';
    const continent = sanitizeDraftText(location?.continent);
    const tags = collectDraftTextArray(location?.tags).slice(0, 3);
    const genericType = typeLabel && typeLabel !== 'default'
        ? `de type ${typeLabel}`
        : 'notable';
    const firstSentence = continent
        ? `${name} est un lieu ${genericType} situe sur ${continent}`
        : `${name} est un lieu ${genericType} de l'univers`;
    const tagSentence = tags.length
        ? `Il se distingue notamment par ${tags.join(', ')}`
        : "Il merite encore une description editee plus detaillee";
    return `${ensureSentenceEnding(firstSentence)} ${ensureSentenceEnding(tagSentence)}`.trim();
};

const buildDescriptionDraft = (payload, typeMap = {}) => {
    const location = payload && typeof payload === 'object' ? payload : {};
    const action = sanitizeDraftText(location?.action).toLowerCase() === 'improve' ? 'improve' : 'generate';
    const name = sanitizeDraftText(location?.name);
    const tags = collectDraftTextArray(location?.tags);
    const typeKey = sanitizeDraftText(location?.type);
    const typeEntry = typeMap && typeof typeMap === 'object' ? typeMap[typeKey] : null;
    const typeLabel = sanitizeDraftText(
        typeEntry && typeof typeEntry === 'object'
            ? (typeEntry.label || typeEntry.name || typeKey)
            : (typeEntry || typeKey)
    ) || 'default';
    const historyEntries = collectDraftTextArray(location?.history);
    const loreEntries = collectDraftTextArray(location?.lore);
    const descriptionEntries = action === 'improve'
        ? collectDraftTextArray(location?.description)
        : [];

    const sourceEntries = [
        ...descriptionEntries.map((text, index) => ({ text, source: 'description', index })),
        ...historyEntries.map((text, index) => ({ text, source: 'history', index })),
        ...loreEntries.map((text, index) => ({ text, source: 'lore', index }))
    ];

    const tagKeys = tags
        .map(entry => normalizeSentenceKey(entry))
        .filter(Boolean);

    const candidates = [];
    sourceEntries.forEach(entry => {
        splitIntoSentences(entry.text).forEach((sentence, sentenceIndex) => {
            const key = normalizeSentenceKey(sentence);
            if (!key) {
                return;
            }
            let score = 0;
            if (entry.source === 'description') {
                score += 80;
            } else if (entry.source === 'history') {
                score += 44;
            } else {
                score += 40;
            }
            if (entry.index === 0) {
                score += 10;
            }
            if (sentenceIndex === 0) {
                score += 6;
            }
            if (name && key.includes(normalizeSentenceKey(name))) {
                score += 10;
            }
            if (tagKeys.some(tag => tag && key.includes(tag))) {
                score += 6;
            }
            if (sentence.length >= 60 && sentence.length <= 180) {
                score += 5;
            } else if (sentence.length > 260) {
                score -= 6;
            }
            candidates.push({
                source: entry.source,
                score,
                text: ensureSentenceEnding(sentence),
                key
            });
        });
    });

    const usedSources = [];
    const seen = new Set();
    const chosen = [];
    let totalLength = 0;
    candidates
        .sort((left, right) => right.score - left.score)
        .forEach(candidate => {
            if (chosen.length >= DESCRIPTION_SENTENCE_LIMIT) {
                return;
            }
            if (!candidate.text || seen.has(candidate.key)) {
                return;
            }
            const nextLength = totalLength + candidate.text.length + (chosen.length ? 1 : 0);
            if (nextLength > DESCRIPTION_CHAR_LIMIT) {
                return;
            }
            seen.add(candidate.key);
            chosen.push(candidate.text);
            totalLength = nextLength;
            if (!usedSources.includes(candidate.source)) {
                usedSources.push(candidate.source);
            }
        });

    const description = chosen.length
        ? chosen.join(' ')
        : buildFallbackDescription(location, typeLabel);

    return {
        description,
        meta: {
            action,
            usedSources: chosen.length ? usedSources : ['fallback'],
            sentenceCount: chosen.length || 2,
            historyCount: historyEntries.length,
            loreCount: loreEntries.length,
            usedFallback: chosen.length === 0
        }
    };
};

module.exports = (register, context) => {
    const {
        logger,
        json,
        ensureAuthorized,
        normalizeString,
        parseListParam,
        loadSearchFiltersModule,
        loadLocationValidationModule,
        readLocationsFile,
        loadTypeMap,
        validateLocationsDataset,
        persistLocations,
        computeLocationsDiff,
        appendAuditLog,
        sendRemoteSync,
        broadcastSse,
        collectBody
    } = context;

    const log = logger.child('[locations]');

    register('GET', '/api/locations/search', async (req, res, urlObj) => {
        const access = await context.security.load(req);
        try {
            const {
                normalizeFilterState,
                buildLocationIndex,
                prepareFilters,
                locationMatchesFilters,
                buildFilterFacets
            } = await loadSearchFiltersModule();

            const [locationsData, typeData] = await Promise.all([
                Promise.resolve(access.locationsView()),
                loadTypeMap()
            ]);

            const entries = [];
            Object.entries(locationsData || {}).forEach(([continent, rawLocations]) => {
                if (!Array.isArray(rawLocations)) {
                    return;
                }
                rawLocations.forEach(location => {
                    const nameKey = normalizeString(location?.name).toLowerCase();
                    const relatedEvents = Array.isArray(location?.questEvents) ? location.questEvents : [];
                    const index = buildLocationIndex(location, { continent, questEvents: relatedEvents });
                    entries.push({
                        location,
                        continent,
                        index,
                        questEvents: relatedEvents
                    });
                });
            });

            const filters = normalizeFilterState({
                text: urlObj.searchParams.get('text') || '',
                types: parseListParam(urlObj.searchParams, 'types'),
                tags: parseListParam(urlObj.searchParams, 'tags'),
                statuses: parseListParam(urlObj.searchParams, 'statuses'),
                quests: urlObj.searchParams.get('quests') || undefined
            });

            const prepared = prepareFilters(filters);
            const matchedEntries = entries.filter(entry => locationMatchesFilters(entry.index, prepared));

            const limitParam = Number(urlObj.searchParams.get('limit')) || 100;
            const limit = Math.max(0, Math.min(250, limitParam));
            const sliced = matchedEntries.slice(0, limit);

            const typeLabels = new Map(Object.entries(access.admin ? typeData : publicTypes(typeData || {})));
            const datasetFacets = buildFilterFacets(entries.map(entry => entry.index), { typeLabels });
            const matchedFacets = buildFilterFacets(matchedEntries.map(entry => entry.index), { typeLabels });

            const results = sliced.map(entry => ({
                name: entry.index.name,
                type: entry.index.type,
                continent: entry.index.continent,
                tags: entry.index.tags,
                hasQuests: entry.index.hasQuests,
                eventStatuses: entry.index.eventStatuses,
                coordinates: entry.index.coords,
                quests: Array.isArray(entry.location.quests) ? entry.location.quests : [],
                questEvents: entry.questEvents,
                location: entry.location
            }));

            json(res, 200, {
                status: 'ok',
                filters,
                total: entries.length,
                matched: matchedEntries.length,
                count: results.length,
                limit,
                facets: {
                    dataset: datasetFacets,
                    matched: matchedFacets
                },
                results
            });
        } catch (error) {
            log.error('Search failed', { error: error.message });
            json(res, 500, createErrorResponse('error', 'Recherche indisponible.'));
        }
    });

    register('POST', '/api/locations', async (req, res) => {
        if (!(await ensureAuthorized(req, res, 'admin'))) {
            return;
        }
        let data;
        try {
            data = JSON.parse(await collectBody(req) || '{}');
        } catch (error) {
            json(res, 400, createErrorResponse('error', 'Invalid JSON'));
            return;
        }
        if (!data || typeof data !== 'object' || typeof data.locations !== 'object') {
            json(res, 400, createErrorResponse('error', 'Payload must contain a "locations" object.'));
            return;
        }

        const validation = await validateLocationsDataset(data.locations);
        if (!validation.valid) {
            json(res, 400, { status: 'error', errors: validation.errors.slice(0, 50) });
            return;
        }
        validation.warnings.forEach(message => log.warn(message));

        const normalizedDataset = validation.normalized;
        const previous = await readLocationsFile();
        const diff = computeLocationsDiff(previous, normalizedDataset);

        await persistLocations(normalizedDataset);
        await appendAuditLog({ dataset: normalizedDataset, diff });
        const syncResult = await sendRemoteSync({ dataset: normalizedDataset, diff });
        const totals = {
            continents: Object.keys(normalizedDataset || {}).length,
            locations: Object.values(normalizedDataset || {}).reduce(
                (acc, list) => acc + (Array.isArray(list) ? list.length : 0),
                0
            )
        };
        broadcastSse('locations.sync', {
            timestamp: new Date().toISOString(),
            diff,
            totals,
            sync: syncResult.status
        });
        if (syncResult.status === 'error') {
            const details = (syncResult.error || syncResult.body) || `HTTP ${syncResult.statusCode || 'unknown'}`;
            log.error('Remote export failed', { details });
        }

        json(res, 200, {
            status: 'ok',
            warnings: validation.warnings,
            changes: {
                created: diff.created.length,
                updated: diff.updated.length,
                deleted: diff.deleted.length
            },
            sync: syncResult.status,
            syncStatusCode: syncResult.statusCode ?? null,
            syncError: syncResult.status === 'error'
                ? ((syncResult.error || syncResult.body) || `HTTP ${syncResult.statusCode || 'unknown'}`)
                : null
        });
    });

    register('GET', '/api/admin/locations', async (req, res) => {
        if (!(await ensureAuthorized(req, res, 'admin'))) {
            return;
        }
        const dataset = await readLocationsFile();
        json(res, 200, { status: 'ok', locations: dataset });
    });

    register('GET', '/api/admin/locations/description-audit', async (req, res) => {
        if (!(await ensureAuthorized(req, res, 'admin'))) {
            return;
        }
        const [dataset, typeMap, validationModule] = await Promise.all([
            readLocationsFile(),
            loadTypeMap(),
            loadLocationValidationModule()
        ]);
        const { validateDataset } = validationModule || {};
        if (typeof validateDataset !== 'function') {
            json(res, 500, createErrorResponse('error', 'Audit descriptions indisponible.'));
            return;
        }

        const { issues } = validateDataset(dataset, { typeMap, sanitizeKeys: false });
        const relevantIssues = (Array.isArray(issues) ? issues : []).filter(issue => {
            return issue?.level === 'warning'
                && typeof issue?.code === 'string'
                && issue.code.startsWith('location.description.');
        });

        const grouped = new Map();
        relevantIssues.forEach(issue => {
            const continent = sanitizeDraftText(issue?.continent) || 'Continent inconnu';
            const name = sanitizeDraftText(issue?.name) || 'Lieu sans nom';
            const key = `${continent}::${name}`;
            if (!grouped.has(key)) {
                grouped.set(key, {
                    continent,
                    name,
                    issues: []
                });
            }
            grouped.get(key).issues.push(issue.message);
        });

        const items = Array.from(grouped.values())
            .map(entry => ({
                ...entry,
                issues: Array.from(new Set(entry.issues))
            }))
            .sort((left, right) => {
                if (right.issues.length !== left.issues.length) {
                    return right.issues.length - left.issues.length;
                }
                return `${left.continent} ${left.name}`.localeCompare(`${right.continent} ${right.name}`, 'fr', { sensitivity: 'base' });
            });

        json(res, 200, {
            status: 'ok',
            summary: {
                locationsFlagged: items.length,
                issueCount: relevantIssues.length
            },
            items
        });
    });

    register('POST', '/api/admin/locations/generate-description', async (req, res) => {
        if (!(await ensureAuthorized(req, res, 'admin'))) {
            return;
        }
        let payload;
        try {
            payload = JSON.parse(await collectBody(req) || '{}');
        } catch (error) {
            json(res, 400, createErrorResponse('error', 'Invalid JSON'));
            return;
        }

        const location = payload?.location;
        const action = sanitizeDraftText(payload?.action).toLowerCase() === 'improve' ? 'improve' : 'generate';
        if (!location || typeof location !== 'object') {
            json(res, 400, createErrorResponse('error', 'location is required.'));
            return;
        }

        const historyEntries = collectDraftTextArray(location?.history);
        const loreEntries = collectDraftTextArray(location?.lore);
        const description = sanitizeDraftText(location?.description);
        if (!historyEntries.length && !loreEntries.length && !(action === 'improve' && description)) {
            json(res, 400, createErrorResponse('error', 'Ajoutez du lore ou de l historique avant de generer une description.'));
            return;
        }

        const typeMap = await loadTypeMap();
        const draft = buildDescriptionDraft({
            ...location,
            action
        }, typeMap || {});

        json(res, 200, {
            status: 'ok',
            description: draft.description,
            meta: draft.meta
        });
    });

    register('POST', '/api/admin/locations', async (req, res) => {
        if (!(await ensureAuthorized(req, res, 'admin'))) {
            return;
        }
        let payload;
        try {
            payload = JSON.parse(await collectBody(req) || '{}');
        } catch (error) {
            json(res, 400, createErrorResponse('error', 'Invalid JSON'));
            return;
        }

        const continentRaw = normalizeString(payload?.continent);
        const location = payload?.location;
        if (!continentRaw || !location || typeof location !== 'object') {
            json(res, 400, createErrorResponse('error', 'continent and location are required.'));
            return;
        }
        const name = normalizeString(location.name);
        if (!name) {
            json(res, 400, createErrorResponse('error', 'location.name is required.'));
            return;
        }

        const previous = await readLocationsFile();
        const dataset = { ...previous };
        const continent = continentRaw;
        const targetList = Array.isArray(dataset[continent]) ? [...dataset[continent]] : [];
        const nameKey = name.toLowerCase();
        if (targetList.some(entry => normalizeString(entry?.name).toLowerCase() === nameKey)) {
            json(res, 409, createErrorResponse('error', 'Location already exists in this continent.'));
            return;
        }
        targetList.push(location);
        dataset[continent] = targetList;

        const validation = await validateLocationsDataset(dataset);
        if (!validation.valid) {
            json(res, 400, { status: 'error', errors: validation.errors.slice(0, 50) });
            return;
        }
        validation.warnings.forEach(message => log.warn(message));

        const normalizedDataset = validation.normalized;
        const diff = computeLocationsDiff(previous, normalizedDataset);

        await persistLocations(normalizedDataset);
        await appendAuditLog({ dataset: normalizedDataset, diff });
        const syncResult = await sendRemoteSync({ dataset: normalizedDataset, diff });
        if (syncResult.status === 'error') {
            const details = (syncResult.error || syncResult.body) || `HTTP ${syncResult.statusCode || 'unknown'}`;
            log.error('Remote export failed', { details });
        }
        broadcastSse('locations.sync', {
            timestamp: new Date().toISOString(),
            diff,
            totals: {
                continents: Object.keys(normalizedDataset || {}).length,
                locations: Object.values(normalizedDataset || {}).reduce(
                    (acc, list) => acc + (Array.isArray(list) ? list.length : 0),
                    0
                )
            },
            sync: syncResult.status
        });

        json(res, 200, {
            status: 'ok',
            warnings: validation.warnings,
            continent,
            location,
            changes: diff,
            sync: syncResult.status,
            syncStatusCode: syncResult.statusCode ?? null,
            syncError: syncResult.status === 'error'
                ? ((syncResult.error || syncResult.body) || `HTTP ${syncResult.statusCode || 'unknown'}`)
                : null
        });
    });

    register('PATCH', '/api/admin/locations', async (req, res) => {
        if (!(await ensureAuthorized(req, res, 'admin'))) {
            return;
        }
        let payload;
        try {
            payload = JSON.parse(await collectBody(req) || '{}');
        } catch (error) {
            json(res, 400, createErrorResponse('error', 'Invalid JSON'));
            return;
        }

        const originalContinent = normalizeString(payload?.originalContinent);
        const originalName = normalizeString(payload?.originalName);
        const newContinent = normalizeString(payload?.continent);
        const location = payload?.location;
        if (!originalContinent || !originalName || !newContinent || !location || typeof location !== 'object') {
            json(res, 400, createErrorResponse('error', 'Payload incomplet.'));
            return;
        }
        const newName = normalizeString(location.name);
        if (!newName) {
            json(res, 400, createErrorResponse('error', 'location.name est requis.'));
            return;
        }

        const previous = await readLocationsFile();
        const dataset = { ...previous };
        const sourceList = Array.isArray(dataset[originalContinent]) ? [...dataset[originalContinent]] : [];
        const sourceIndex = sourceList.findIndex(entry => normalizeString(entry?.name).toLowerCase() === originalName.toLowerCase());
        if (sourceIndex === -1) {
            json(res, 404, createErrorResponse('error', 'Location not found.'));
            return;
        }
        sourceList.splice(sourceIndex, 1);
        if (sourceList.length) {
            dataset[originalContinent] = sourceList;
        } else {
            delete dataset[originalContinent];
        }

        const targetList = Array.isArray(dataset[newContinent]) ? [...dataset[newContinent]] : [];
        const newNameKey = newName.toLowerCase();
        if (targetList.some(entry => normalizeString(entry?.name).toLowerCase() === newNameKey)) {
            json(res, 409, createErrorResponse('error', 'Location already exists in target continent.'));
            return;
        }
        targetList.push(location);
        dataset[newContinent] = targetList;

        const validation = await validateLocationsDataset(dataset);
        if (!validation.valid) {
            json(res, 400, { status: 'error', errors: validation.errors.slice(0, 50) });
            return;
        }
        validation.warnings.forEach(message => log.warn(message));

        const normalizedDataset = validation.normalized;
        const diff = computeLocationsDiff(previous, normalizedDataset);

        await persistLocations(normalizedDataset);
        await appendAuditLog({ dataset: normalizedDataset, diff });
        const syncResult = await sendRemoteSync({ dataset: normalizedDataset, diff });
        if (syncResult.status === 'error') {
            const details = (syncResult.error || syncResult.body) || `HTTP ${syncResult.statusCode || 'unknown'}`;
            log.error('Remote export failed', { details });
        }
        broadcastSse('locations.sync', {
            timestamp: new Date().toISOString(),
            diff,
            totals: {
                continents: Object.keys(normalizedDataset || {}).length,
                locations: Object.values(normalizedDataset || {}).reduce(
                    (acc, list) => acc + (Array.isArray(list) ? list.length : 0),
                    0
                )
            },
            sync: syncResult.status
        });

        json(res, 200, {
            status: 'ok',
            warnings: validation.warnings,
            continent: newContinent,
            location,
            changes: diff,
            sync: syncResult.status,
            syncStatusCode: syncResult.statusCode ?? null,
            syncError: syncResult.status === 'error'
                ? ((syncResult.error || syncResult.body) || `HTTP ${syncResult.statusCode || 'unknown'}`)
                : null
        });
    });

    register('DELETE', '/api/admin/locations', async (req, res) => {
        if (!(await ensureAuthorized(req, res, 'admin'))) {
            return;
        }
        let payload;
        try {
            payload = JSON.parse(await collectBody(req) || '{}');
        } catch (error) {
            json(res, 400, createErrorResponse('error', 'Invalid JSON'));
            return;
        }
        const continent = normalizeString(payload?.continent);
        const name = normalizeString(payload?.name);
        if (!continent || !name) {
            json(res, 400, createErrorResponse('error', 'continent et name sont requis.'));
            return;
        }

        const previous = await readLocationsFile();
        const dataset = { ...previous };
        const list = Array.isArray(dataset[continent]) ? [...dataset[continent]] : [];
        const index = list.findIndex(entry => normalizeString(entry?.name).toLowerCase() === name.toLowerCase());
        if (index === -1) {
            json(res, 404, createErrorResponse('error', 'Location not found.'));
            return;
        }
        const removed = list.splice(index, 1)[0];
        if (list.length) {
            dataset[continent] = list;
        } else {
            delete dataset[continent];
        }

        const validation = await validateLocationsDataset(dataset);
        if (!validation.valid) {
            json(res, 400, { status: 'error', errors: validation.errors.slice(0, 50) });
            return;
        }
        validation.warnings.forEach(message => log.warn(message));

        const normalizedDataset = validation.normalized;
        const diff = computeLocationsDiff(previous, normalizedDataset);

        await persistLocations(normalizedDataset);
        await appendAuditLog({ dataset: normalizedDataset, diff });
        const syncResult = await sendRemoteSync({ dataset: normalizedDataset, diff });
        if (syncResult.status === 'error') {
            const details = (syncResult.error || syncResult.body) || `HTTP ${syncResult.statusCode || 'unknown'}`;
            log.error('Remote export failed', { details });
        }
        broadcastSse('locations.sync', {
            timestamp: new Date().toISOString(),
            diff,
            totals: {
                continents: Object.keys(normalizedDataset || {}).length,
                locations: Object.values(normalizedDataset || {}).reduce(
                    (acc, list) => acc + (Array.isArray(list) ? list.length : 0),
                    0
                )
            },
            sync: syncResult.status
        });

        json(res, 200, {
            status: 'ok',
            warnings: validation.warnings,
            continent,
            removed,
            changes: diff,
            sync: syncResult.status,
            syncStatusCode: syncResult.statusCode ?? null,
            syncError: syncResult.status === 'error'
                ? ((syncResult.error || syncResult.body) || `HTTP ${syncResult.statusCode || 'unknown'}`)
                : null
        });
    });
};
