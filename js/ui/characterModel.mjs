export const createCharacterId = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return `char_${crypto.randomUUID()}`;
    }
    return `char_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
};

export const enforceSingleActiveCharacter = characters => {
    if (!Array.isArray(characters)) {
        return [];
    }
    let found = false;
    return characters.map(character => {
        const next = { ...character };
        if (next.active && !found) {
            found = true;
            next.active = true;
        } else {
            next.active = false;
        }
        return next;
    });
};

export const normalizeCharacterList = (characters, {
    assignIds = false,
    createId = createCharacterId
} = {}) => {
    if (!Array.isArray(characters)) {
        return [];
    }
    const list = [];
    const seen = new Set();
    characters.forEach(entry => {
        if (!entry || typeof entry !== 'object') {
            return;
        }
        let id = typeof entry.id === 'string' ? entry.id.trim() : '';
        if (!id && assignIds) {
            id = createId();
        }
        if (!id) {
            return;
        }
        if (seen.has(id)) {
            if (!assignIds) {
                return;
            }
            id = createId();
        }
        seen.add(id);
        const name = typeof entry.name === 'string' ? entry.name.trim() : '';
        const bio = typeof entry.bio === 'string' ? entry.bio.trim() : '';
        const avatar = typeof entry.avatar === 'string' ? entry.avatar.trim() : '';
        const groupIdRaw = typeof entry.groupId === 'string'
            ? entry.groupId
            : (typeof entry.group === 'string' ? entry.group : '');
        const groupId = groupIdRaw ? groupIdRaw.trim() : '';
        const active = Boolean(entry.active);
        const hasValue = Boolean(name || bio || avatar || groupId || active);
        if (!hasValue) {
            return;
        }
        list.push({
            id,
            name: name || null,
            bio: bio || null,
            avatar: avatar || null,
            groupId: groupId || null,
            active
        });
    });
    return enforceSingleActiveCharacter(list);
};
