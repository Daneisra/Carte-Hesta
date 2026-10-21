const sanitizeString = value => (value ?? '').toString().trim();

const collectTextArray = value => {
    if (Array.isArray(value)) {
        return value.map(sanitizeString).filter(Boolean);
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed ? [trimmed] : [];
    }
    return [];
};

const normalizeQuestEvents = (events = [], locationName = '') => {
    if (!Array.isArray(events)) {
        return [];
    }
    return events
        .map(event => {
            const id = sanitizeString(event?.id) || `quest_${Date.now()}`;
            const questId = sanitizeString(event?.questId);
            const status = sanitizeString(event?.status);
            const milestone = sanitizeString(event?.milestone) || null;
            const note = sanitizeString(event?.note) || '';
            const locName = sanitizeString(event?.locationName) || sanitizeString(locationName);
            let progress = null;
            if (event?.progress && typeof event.progress === 'object') {
                const current = Number(event.progress.current);
                const max = event.progress.max !== undefined ? Number(event.progress.max) : null;
                progress = {
                    current: Number.isFinite(current) ? current : 0,
                    max: Number.isFinite(max) ? max : null
                };
            }
            return {
                id,
                questId,
                locationName: locName,
                status,
                milestone,
                progress,
                note,
                updatedAt: sanitizeString(event?.updatedAt) || null,
                createdAt: sanitizeString(event?.createdAt) || null
            };
        })
        .filter(event => event.id && event.questId && event.locationName && event.status);
};

const normalizePnjList = pnjs => {
    if (!Array.isArray(pnjs)) {
        return [];
    }
    return pnjs
        .filter(Boolean)
        .map(pnj => {
            const entry = {
                name: sanitizeString(pnj?.name) || 'PNJ',
                role: sanitizeString(pnj?.role),
                description: sanitizeString(pnj?.description)
            };
            return entry;
        });
};

const normalizeVideoList = videos => {
    if (!Array.isArray(videos)) {
        return [];
    }
    return videos.reduce((accumulator, entry) => {
        let url = '';
        let title = '';

        if (typeof entry === 'string') {
            url = sanitizeString(entry);
        } else if (entry && typeof entry === 'object') {
            url = sanitizeString(entry.url);
            title = sanitizeString(entry.title);
        }

        if (!url) {
            return accumulator;
        }

        accumulator.push({ url, title });
        return accumulator;
    }, []);
};

const normalizeLocation = rawLocation => {
    if (!rawLocation || typeof rawLocation !== 'object') {
        return null;
    }

    const videos = normalizeVideoList(rawLocation.videos);

    const normalized = {
        name: sanitizeString(rawLocation.name) || 'Lieu inconnu',
        type: sanitizeString(rawLocation.type) || 'default',
        x: Number(rawLocation.x),
        y: Number(rawLocation.y),
        description: sanitizeString(rawLocation.description),
        images: Array.isArray(rawLocation.images)
            ? rawLocation.images.map(sanitizeString).filter(Boolean)
            : [],
        videos,
        audio: (() => {
            const audioPath = sanitizeString(rawLocation.audio);
            return audioPath ? audioPath : null;
        })(),
        history: collectTextArray(rawLocation.history),
        quests: collectTextArray(rawLocation.quests),
        lore: collectTextArray(rawLocation.lore),
        instances: collectTextArray(rawLocation.instances),
        nobleFamilies: collectTextArray(rawLocation.nobleFamilies),
        pnjs: normalizePnjList(rawLocation.pnjs),
        tags: (() => {
            if (Array.isArray(rawLocation.tags)) {
                return rawLocation.tags.map(sanitizeString).filter(Boolean);
            }
            const single = sanitizeString(rawLocation.tags);
            if (!single) {
                return [];
            }
            return single
                .split(/[,;]+/)
                .map(sanitizeString)
                .filter(Boolean);
        })(),
        questEvents: normalizeQuestEvents(rawLocation.questEvents, sanitizeString(rawLocation.name))
    };

    if (!Number.isFinite(normalized.x)) {
        normalized.x = 0;
    }
    if (!Number.isFinite(normalized.y)) {
        normalized.y = 0;
    }

    return normalized;
};

const normalizeDataset = (dataset, { sanitizeKeys = false } = {}) => {
    const normalizedDataset = {};

    Object.entries(dataset || {}).forEach(([continent, locations]) => {
        const key = sanitizeKeys ? sanitizeString(continent) : continent;
        if (sanitizeKeys && !key) {
            return;
        }

        normalizedDataset[key] = Array.isArray(locations)
            ? locations.map(normalizeLocation).filter(Boolean)
            : [];
    });

    return normalizedDataset;
};

const serializeTextGroup = value => {
    const list = collectTextArray(value);
    if (!list.length) {
        return '';
    }
    if (list.length === 1) {
        return list[0];
    }
    return list;
};

const serializeVideos = videos => normalizeVideoList(videos).map(video => ({
    url: video.url,
    title: video.title
}));

const serializePnjs = pnjs => normalizePnjList(pnjs).map(pnj => ({
    name: pnj.name,
    role: pnj.role,
    description: pnj.description
}));

export {
    sanitizeString,
    collectTextArray,
    normalizePnjList,
    normalizeVideoList,
    normalizeLocation,
    normalizeDataset,
    serializeTextGroup,
    serializeVideos,
    serializePnjs
};
