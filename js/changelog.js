import { loadChangelog } from './shared/changelogClient.mjs';
import { normalizeEntries, mergeChangelog } from './shared/changelogData.mjs';

const dom = {
    year: document.getElementById('changelog-year'),
    count: document.getElementById('changelog-count'),
    source: document.getElementById('changelog-source'),
    status: document.getElementById('changelog-status'),
    list: document.getElementById('changelog-list')
};

const normalizeText = value => typeof value === 'string' ? value.trim() : '';

const setText = (node, value) => {
    if (node) {
        node.textContent = value;
    }
};

const formatDate = value => {
    const raw = normalizeText(value);
    if (!raw) {
        return 'Date à confirmer';
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

const renderEntries = (entries, source = 'config') => {
    const normalized = normalizeEntries(entries);
    const safeEntries = normalized.length ? normalized : mergeChangelog();
    setText(dom.count, String(safeEntries.length));
    setText(dom.source, source === 'code+config' ? 'Code + Config' : 'Code');
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

if (dom.year) {
    dom.year.textContent = String(new Date().getFullYear());
}

loadChangelog({ complete: true }).then(({ entries, source, fallback }) => {
    renderEntries(entries, source);
    if (fallback) setText(dom.status, `${entries.length} entrées chargées (repli local)`);
});
