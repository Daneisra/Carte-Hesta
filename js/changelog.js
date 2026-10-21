const API_URL = '/api/changelog?limit=50';
const SITE_CONFIG_URL = '/assets/site-config.json';

const dom = {
    year: document.getElementById('changelog-year'),
    version: document.getElementById('changelog-version'),
    versionFooter: document.getElementById('changelog-version-footer'),
    count: document.getElementById('changelog-count'),
    source: document.getElementById('changelog-source'),
    status: document.getElementById('changelog-status'),
    list: document.getElementById('changelog-list')
};

const FALLBACK_CHANGELOG = [
    {
        date: '2026-09-25',
        title: 'Version 0.17.49 - Acces au systeme PA',
        summary: 'L accueil propose un lien direct vers l outil Systeme PA / Armures d100 dans la navigation principale.'
    }
];

const normalizeText = value => typeof value === 'string' ? value.trim() : '';

const setText = (node, value) => {
    if (node) {
        node.textContent = value;
    }
};

const formatDate = value => {
    const raw = normalizeText(value);
    if (!raw) {
        return 'Date inconnue';
    }
    const parsed = Date.parse(raw);
    if (!Number.isFinite(parsed)) {
        return raw;
    }
    try {
        return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(new Date(parsed));
    } catch (_error) {
        return raw;
    }
};

const normalizeEntries = entries => {
    if (!Array.isArray(entries)) {
        return [];
    }
    return entries
        .map(entry => ({
            date: normalizeText(entry?.date),
            title: normalizeText(entry?.title) || 'Mise a jour',
            summary: normalizeText(entry?.summary) || normalizeText(entry?.title) || 'Changement livre.'
        }))
        .filter(entry => entry.title);
};

const renderEntries = (entries, source = 'config') => {
    const normalized = normalizeEntries(entries);
    const safeEntries = normalized.length ? normalized : FALLBACK_CHANGELOG;
    setText(dom.count, String(safeEntries.length));
    setText(dom.source, source === 'git' ? 'Git' : 'Config');
    setText(dom.status, `${safeEntries.length} entree${safeEntries.length > 1 ? 's' : ''} chargee${safeEntries.length > 1 ? 's' : ''}`);
    if (!dom.list) {
        return;
    }
    dom.list.replaceChildren(...safeEntries.map(entry => {
        const item = document.createElement('li');
        item.className = 'changelog-entry';

        const date = document.createElement('span');
        date.className = 'changelog-entry-date';
        date.textContent = formatDate(entry.date);

        const body = document.createElement('div');
        const title = document.createElement('h3');
        title.className = 'changelog-entry-title';
        title.textContent = entry.title;
        const summary = document.createElement('p');
        summary.className = 'changelog-entry-summary';
        summary.textContent = entry.summary;

        body.append(title, summary);
        item.append(date, body);
        return item;
    }));
};

const loadFromSiteConfig = async () => {
    const response = await fetch(SITE_CONFIG_URL, { cache: 'no-store' });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    const config = await response.json();
    if (config?.version) {
        setText(dom.version, config.version);
        setText(dom.versionFooter, config.version);
    }
    renderEntries(config?.changelog, 'config');
};

const loadChangelog = async () => {
    try {
        const response = await fetch(API_URL, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const payload = await response.json();
        renderEntries(payload?.entries, payload?.source || 'api');
    } catch (error) {
        console.warn('[changelog] API unavailable, using site config', error);
        try {
            await loadFromSiteConfig();
        } catch (fallbackError) {
            console.warn('[changelog] site config unavailable, using static fallback', fallbackError);
            renderEntries(FALLBACK_CHANGELOG, 'config');
        }
    }
};

if (dom.year) {
    dom.year.textContent = String(new Date().getFullYear());
}

loadChangelog();
