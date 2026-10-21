export const PROFILE_SOCIAL_LABELS = {
    website: 'Site web',
    discord: 'Discord',
    twitch: 'Twitch',
    youtube: 'YouTube',
    x: 'X/Twitter'
};

export const normalizeProfileUrl = value => {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized) {
        return null;
    }
    if (normalized.startsWith('/')) {
        return normalized;
    }
    if (/^https?:\/\//i.test(normalized)) {
        return normalized;
    }
    return null;
};

export const isValidAccentColor = value => (
    typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.trim())
);

export const normalizeProfileCustomization = payload => {
    const source = payload && typeof payload === 'object' ? payload : {};
    const banner = normalizeProfileUrl(source.banner);
    const accentColor = isValidAccentColor(source.accentColor || '')
        ? (source.accentColor || '').trim()
        : null;
    const bio = typeof source.bio === 'string'
        ? source.bio.trim().slice(0, 6000)
        : '';
    const socialsSource = source.socials && typeof source.socials === 'object'
        ? source.socials
        : source;
    const socials = {};
    Object.keys(PROFILE_SOCIAL_LABELS).forEach(key => {
        const value = normalizeProfileUrl(socialsSource[key]);
        if (value) {
            socials[key] = value;
        }
    });
    return {
        banner: banner || null,
        accentColor: accentColor || null,
        bio: bio || '',
        socials
    };
};
