import { createElement, clearElement } from './dom.js';
import { sanitizeString } from '../shared/locationSchema.mjs';
import {
    setPanelStatus,
    renderPanelErrors,
    setElementsDisabled,
    syncReloadButton,
    syncSaveButton
} from './adminShared.js';

const TIMELINE_ADMIN_API_ROUTE = '/api/admin/timeline-config';
const TIMELINE_UPLOAD_ENDPOINT = '/api/upload';
const MAX_TIMELINE_IMAGE_UPLOAD_SIZE = 25 * 1024 * 1024;
const TIMELINE_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'];

export const normalizeAdminTimeline = (entriesNormalizer, config = {}) => {
    const source = config && typeof config === 'object' ? config : {};
    const entries = Array.isArray(source.entries)
        ? source.entries.map((entry, index) => entriesNormalizer(entry, index)).filter(Boolean)
        : [];
    return {
        title: sanitizeString(source.title || "Chronologie d'Hesta"),
        subtitle: sanitizeString(source.subtitle || "Une lecture lineaire des bascules politiques, spirituelles et militaires qui structurent les campagnes."),
        entries
    };
};

export const normalizeAdminTimelineEntry = (entry = {}, index = 0) => {
    const normalizedYear = Number(entry?.year);
    const year = Number.isFinite(normalizedYear) ? Math.round(normalizedYear) : index;
    const title = sanitizeString(entry?.title || '');
    return {
        id: sanitizeString(entry?.id || `${year}-${title || `event-${index + 1}`}`)
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-+|-+$/g, '') || `timeline-${index + 1}`,
        year,
        yearLabel: sanitizeString(entry?.yearLabel || String(year)),
        title: title || `Evenement ${index + 1}`,
        summary: sanitizeString(entry?.summary || ''),
        content: sanitizeString(entry?.content || ''),
        eventKind: sanitizeString(entry?.eventKind || '').toLowerCase() === 'player' ? 'player' : 'lore',
        era: sanitizeString(entry?.era || entry?.period || 'Periode inconnue'),
        eraSummary: sanitizeString(entry?.eraSummary || ''),
        sceneLabel: sanitizeString(entry?.sceneLabel || ''),
        period: sanitizeString(entry?.period || 'Periode inconnue'),
        tags: Array.isArray(entry?.tags) ? entry.tags.map(tag => sanitizeString(tag)).filter(Boolean) : [],
        locationNames: Array.isArray(entry?.locationNames) ? entry.locationNames.map(name => sanitizeString(name)).filter(Boolean) : [],
        imageUrl: sanitizeString(entry?.imageUrl || ''),
        mediaAlt: sanitizeString(entry?.mediaAlt || ''),
        accentColor: /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(sanitizeString(entry?.accentColor || '')) ? sanitizeString(entry.accentColor) : '#7dd3fc',
        visible: entry?.visible !== false
    };
};

export const createAdminTimelineEntry = (entryNormalizer, index = 0) => entryNormalizer({
    id: `timeline-${Date.now()}-${index + 1}`,
    year: new Date().getFullYear(),
    yearLabel: `An ${new Date().getFullYear()}`,
    title: 'Nouvel evenement',
    summary: '',
    content: '',
    eventKind: 'lore',
    era: 'Periode inconnue',
    eraSummary: '',
    sceneLabel: '',
    period: 'Periode inconnue',
    tags: [],
    locationNames: [],
    imageUrl: '',
    mediaAlt: '',
    accentColor: '#7dd3fc',
    visible: true
}, index);

export const parseAdminTokenList = (value = '') => (
    String(value || '')
        .split(/[\n,]/)
        .map(entry => sanitizeString(entry))
        .filter(Boolean)
);

const getFileExtension = fileName => {
    const normalized = sanitizeString(fileName || '').toLowerCase();
    const dotIndex = normalized.lastIndexOf('.');
    return dotIndex >= 0 ? normalized.slice(dotIndex) : '';
};

const readFileAsDataUrl = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(reader.result));
    reader.addEventListener('error', () => reject(reader.error || new Error('Lecture du fichier impossible.')));
    reader.readAsDataURL(file);
});

export const setAdminTimelineStatus = (ctx, message, isError = false) => {
    setPanelStatus(ctx.adminDom.timelineStatus, message, isError);
};

export const uploadAdminTimelineImage = async (ctx, index, file, { urlInput = null, trigger = null } = {}) => {
    if (!ctx.isAdmin()) {
        ctx.announcer?.assertive?.('Connexion administrateur requise.');
        return;
    }
    if (!file) {
        return;
    }
    const extension = getFileExtension(file.name);
    if (!TIMELINE_IMAGE_EXTENSIONS.includes(extension)) {
        setAdminTimelineStatus(ctx, `Format image non supporte. Formats acceptes: ${TIMELINE_IMAGE_EXTENSIONS.join(', ')}.`, true);
        return;
    }
    if (file.size > MAX_TIMELINE_IMAGE_UPLOAD_SIZE) {
        setAdminTimelineStatus(ctx, 'Image trop volumineuse (limite 25 Mo).', true);
        return;
    }
    const entry = ctx.adminTimeline?.entries?.[index];
    if (!entry) {
        setAdminTimelineStatus(ctx, 'Evenement introuvable pour cet upload.', true);
        return;
    }
    const previousDisabled = Boolean(trigger?.disabled);
    if (trigger) {
        trigger.disabled = true;
        trigger.textContent = 'Upload...';
    }
    setAdminTimelineStatus(ctx, "Upload de l'image de chronologie...");
    try {
        const data = await readFileAsDataUrl(file);
        const response = await fetch(TIMELINE_UPLOAD_ENDPOINT, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'image',
                filename: file.name,
                data
            })
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const payload = await response.json();
        const path = sanitizeString(payload?.path || '');
        if (!path) {
            throw new Error('Chemin image absent de la reponse upload.');
        }
        const imagePath = path.startsWith('/') ? path : `/${path}`;
        entry.imageUrl = imagePath;
        if (urlInput) {
            urlInput.value = imagePath;
        }
        ctx.markAdminTimelineDirty();
        setAdminTimelineStatus(ctx, `Image ajoutee a l'evenement: ${imagePath}`);
        ctx.announcer?.polite?.('Image de chronologie importee.');
    } catch (error) {
        console.error('[admin] timeline image upload failed', error);
        setAdminTimelineStatus(ctx, `Upload image impossible: ${error?.message || 'erreur inconnue'}.`, true);
    } finally {
        if (trigger) {
            trigger.disabled = previousDisabled;
            trigger.textContent = 'Uploader une image';
        }
    }
};

export const renderAdminTimelineErrors = (ctx, errors = []) => {
    renderPanelErrors(ctx.adminDom.timelineErrors, errors);
};

export const syncAdminTimelineEditor = ctx => {
    const isAdmin = ctx.isAdmin();
    const hasTimeline = !!ctx.adminTimeline;
    const disabled = !isAdmin || ctx.adminTimelinePending || !hasTimeline;
    setElementsDisabled([
        ctx.adminDom.timelineTitle,
        ctx.adminDom.timelineSubtitle,
        ctx.adminDom.timelineAddEntryButton
    ], disabled);
    syncReloadButton(ctx.adminDom.timelineReloadButton, {
        isAdmin,
        pending: ctx.adminTimelinePending
    });
    syncSaveButton(ctx.adminDom.timelineSaveButton, {
        isAdmin,
        pending: ctx.adminTimelinePending,
        hasData: hasTimeline,
        dirty: ctx.adminTimelineDirty,
        idleLabel: 'Enregistrer la chronologie',
        dirtyLabel: 'Enregistrer la chronologie *',
        pendingLabel: 'Enregistrement...'
    });
    if (ctx.adminDom.timelineList) {
        ctx.adminDom.timelineList.querySelectorAll('input, textarea, select, button').forEach(element => {
            if (element.id === 'admin-timeline-save' || element.id === 'admin-timeline-reload' || element.id === 'admin-timeline-add-entry') {
                return;
            }
            element.disabled = disabled;
        });
    }
};

export const renderAdminTimelineConfig = ctx => {
    const config = normalizeAdminTimeline(ctx.normalizeAdminTimelineEntry.bind(ctx), ctx.adminTimeline || {});
    ctx.adminTimeline = config;
    if (ctx.adminDom.timelineTitle) {
        ctx.adminDom.timelineTitle.value = config.title || '';
    }
    if (ctx.adminDom.timelineSubtitle) {
        ctx.adminDom.timelineSubtitle.value = config.subtitle || '';
    }
    renderAdminTimelineList(ctx);
    renderAdminTimelineErrors(ctx, []);
    syncAdminTimelineEditor(ctx);
};

export const renderAdminTimelineList = ctx => {
    const container = ctx.adminDom.timelineList;
    const countNode = ctx.adminDom.timelineCount;
    const emptyNode = ctx.adminDom.timelineEmpty;
    if (!container || !countNode || !emptyNode) {
        return;
    }
    clearElement(container);
    const entries = Array.isArray(ctx.adminTimeline?.entries) ? ctx.adminTimeline.entries : [];
    countNode.textContent = `${entries.length} ${entries.length > 1 ? 'entrees' : 'entree'}`;
    emptyNode.hidden = entries.length > 0;
    entries.forEach((entry, index) => {
        container.appendChild(createAdminTimelineEntryCard(ctx, entry, index));
    });
    syncAdminTimelineEditor(ctx);
};

export const createAdminTimelineEntryCard = (ctx, entry, index) => {
    const card = document.createElement('article');
    card.className = 'admin-timeline-card';

    const header = document.createElement('div');
    header.className = 'admin-timeline-card-header';

    const title = document.createElement('div');
    title.className = 'admin-timeline-card-title';
    const titlePrimary = createElement('strong', { text: entry.title || `Evenement ${index + 1}` });
    const titleKind = createElement('span', { text: entry.eventKind === 'player' ? 'Evenement joueur' : 'Lore ecrit' });
    const titleEra = createElement('span', { text: entry.era || entry.period || 'Periode inconnue' });
    title.appendChild(titlePrimary);
    title.appendChild(titleKind);
    title.appendChild(titleEra);
    let titleMeta = null;

    const refreshHeaderPreview = () => {
        const currentEntry = ctx.adminTimeline?.entries?.[index] || entry;
        titlePrimary.textContent = currentEntry.title || `Evenement ${index + 1}`;
        titleKind.textContent = currentEntry.eventKind === 'player' ? 'Evenement joueur' : 'Lore ecrit';
        titleEra.textContent = currentEntry.era || currentEntry.period || 'Periode inconnue';
        if (titleMeta) {
            titleMeta.textContent = `${currentEntry.yearLabel || currentEntry.year || '--'} | ${currentEntry.period || 'Periode inconnue'}`;
            titleMeta.textContent = `${currentEntry.yearLabel || currentEntry.year || '--'} â€¢ ${currentEntry.period || 'Periode inconnue'}`;
            titleMeta.textContent = `${currentEntry.yearLabel || currentEntry.year || '--'} | ${currentEntry.period || 'Periode inconnue'}`;
        }
    };
    title.appendChild(createElement('span', { text: `${entry.yearLabel || entry.year || '--'} • ${entry.period || 'Periode inconnue'}` }));

    titleMeta = title.lastElementChild;

    const actions = document.createElement('div');
    actions.className = 'admin-timeline-card-actions';
    const moveUp = createElement('button', { className: 'tertiary-button', text: 'Monter' });
    moveUp.type = 'button';
    moveUp.addEventListener('click', () => ctx.moveAdminTimelineEntry(index, -1));
    const moveDown = createElement('button', { className: 'tertiary-button', text: 'Descendre' });
    moveDown.type = 'button';
    moveDown.addEventListener('click', () => ctx.moveAdminTimelineEntry(index, 1));
    const remove = createElement('button', { className: 'tertiary-button', text: 'Supprimer' });
    remove.type = 'button';
    remove.addEventListener('click', () => ctx.removeAdminTimelineEntry(index));
    actions.append(moveUp, moveDown, remove);

    header.append(title, actions);
    card.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'admin-timeline-card-grid';
    const block = document.createElement('div');
    block.className = 'admin-timeline-card-block';

    const buildField = ({ label, value, type = 'text', rows = 0, checked = false, onInput, placeholder = '', options = [] }) => {
        const wrapper = document.createElement('label');
        wrapper.appendChild(createElement('span', { text: label }));
        let input;
        if (type === 'textarea') {
            input = document.createElement('textarea');
            input.rows = rows || 4;
        } else if (type === 'select') {
            input = document.createElement('select');
            options.forEach(optionConfig => {
                const option = document.createElement('option');
                option.value = optionConfig.value;
                option.textContent = optionConfig.label;
                input.appendChild(option);
            });
        } else if (type === 'checkbox') {
            wrapper.className = 'admin-timeline-toggle';
            input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = checked;
            wrapper.innerHTML = '';
            wrapper.appendChild(input);
            wrapper.appendChild(document.createTextNode(label));
        } else {
            input = document.createElement('input');
            input.type = type;
        }
        if (type !== 'checkbox') {
            input.value = value || '';
            input.placeholder = placeholder;
        }
        input.addEventListener(type === 'checkbox' ? 'change' : 'input', onInput);
        wrapper.appendChild(input);
        return wrapper;
    };

    const idField = buildField({
            label: 'ID',
            value: entry.id,
            onInput: event => {
                ctx.adminTimeline.entries[index].id = sanitizeString(event.target.value)
                    .toLowerCase()
                    .replace(/[^a-z0-9_-]+/g, '-')
                    .replace(/-+/g, '-')
                    .replace(/^-+|-+$/g, '');
                ctx.markAdminTimelineDirty();
            }
        });
    const yearField = buildField({
            label: 'Annee',
            type: 'number',
            value: String(entry.year ?? ''),
            onInput: event => {
                ctx.adminTimeline.entries[index].year = Number(event.target.value) || 0;
                refreshHeaderPreview();
                ctx.markAdminTimelineDirty();
            }
        });
    const yearLabelField = buildField({
            label: 'Libelle annee',
            value: entry.yearLabel,
            onInput: event => {
                ctx.adminTimeline.entries[index].yearLabel = event.target.value || '';
                refreshHeaderPreview();
                ctx.markAdminTimelineDirty();
            }
        });
    const kindField = buildField({
            label: 'Type d evenement',
            type: 'select',
            value: entry.eventKind,
            options: [
                { value: 'lore', label: 'Lore ecrit' },
                { value: 'player', label: 'Evenement joueur' }
            ],
            onInput: event => {
                ctx.adminTimeline.entries[index].eventKind = event.target.value === 'player' ? 'player' : 'lore';
                refreshHeaderPreview();
                ctx.markAdminTimelineDirty();
            }
        });
    const periodField = buildField({
            label: 'Periode',
            value: entry.period,
            onInput: event => {
                ctx.adminTimeline.entries[index].period = event.target.value || '';
                refreshHeaderPreview();
                ctx.markAdminTimelineDirty();
            }
        });
    const eraField = buildField({
            label: 'Epoque',
            value: entry.era,
            onInput: event => {
                ctx.adminTimeline.entries[index].era = event.target.value || '';
                refreshHeaderPreview();
                ctx.markAdminTimelineDirty();
            }
        });
    const sceneField = buildField({
            label: 'Label scene',
            value: entry.sceneLabel,
            placeholder: 'Fondation, rupture, conquete...',
            onInput: event => {
                ctx.adminTimeline.entries[index].sceneLabel = event.target.value || '';
                ctx.markAdminTimelineDirty();
            }
        });
    const titleField = buildField({
            label: 'Titre',
            value: entry.title,
            onInput: event => {
                ctx.adminTimeline.entries[index].title = event.target.value || '';
                refreshHeaderPreview();
                ctx.markAdminTimelineDirty();
            }
        });
    const accentField = buildField({
            label: 'Couleur accent',
            type: 'text',
            value: entry.accentColor,
            placeholder: '#7dd3fc',
            onInput: event => {
                ctx.adminTimeline.entries[index].accentColor = event.target.value || '';
                ctx.markAdminTimelineDirty();
            }
        });
    const imageField = buildField({
            label: 'Image (URL)',
            value: entry.imageUrl,
            placeholder: '/assets/images/...',
            onInput: event => {
                ctx.adminTimeline.entries[index].imageUrl = event.target.value || '';
                ctx.markAdminTimelineDirty();
            }
        });
    const imageUrlInput = imageField.querySelector('input');
    const imageUploadRow = document.createElement('div');
    imageUploadRow.className = 'admin-timeline-upload-row';
    const imageUploadInput = document.createElement('input');
    imageUploadInput.type = 'file';
    imageUploadInput.accept = TIMELINE_IMAGE_EXTENSIONS.join(',');
    imageUploadInput.className = 'admin-timeline-upload-input';
    imageUploadInput.setAttribute('aria-label', `Uploader une image pour ${entry.title || `evenement ${index + 1}`}`);
    const imageUploadButton = createElement('button', { className: 'tertiary-button', text: 'Uploader une image' });
    imageUploadButton.type = 'button';
    imageUploadButton.addEventListener('click', () => imageUploadInput.click());
    imageUploadInput.addEventListener('change', event => {
        const [file] = Array.from(event.target.files || []);
        uploadAdminTimelineImage(ctx, index, file, { urlInput: imageUrlInput, trigger: imageUploadButton });
        event.target.value = '';
    });
    imageUploadRow.append(imageUploadButton, imageUploadInput);
    imageField.appendChild(imageUploadRow);

    const mediaAltField = buildField({
            label: 'Alt image',
            value: entry.mediaAlt,
            placeholder: 'Description courte de l illustration',
            onInput: event => {
                ctx.adminTimeline.entries[index].mediaAlt = event.target.value || '';
                ctx.markAdminTimelineDirty();
            }
        });
    const visibleField = buildField({
            label: 'Visible publiquement',
            type: 'checkbox',
            checked: entry.visible !== false,
            onInput: event => {
                ctx.adminTimeline.entries[index].visible = Boolean(event.target.checked);
                ctx.markAdminTimelineDirty();
            }
        });

    grid.append(
        idField,
        yearField,
        yearLabelField,
        kindField,
        periodField,
        eraField,
        sceneField,
        titleField,
        accentField,
        imageField,
        mediaAltField,
        visibleField
    );

    block.append(
        buildField({
            label: 'Resume',
            type: 'textarea',
            rows: 3,
            value: entry.summary,
            onInput: event => {
                ctx.adminTimeline.entries[index].summary = event.target.value || '';
                ctx.markAdminTimelineDirty();
            }
        }),
        buildField({
            label: 'Contenu detaille',
            type: 'textarea',
            rows: 5,
            value: entry.content,
            onInput: event => {
                ctx.adminTimeline.entries[index].content = event.target.value || '';
                ctx.markAdminTimelineDirty();
            }
        }),
        buildField({
            label: 'Resume epoque',
            type: 'textarea',
            rows: 3,
            value: entry.eraSummary,
            onInput: event => {
                ctx.adminTimeline.entries[index].eraSummary = event.target.value || '';
                ctx.markAdminTimelineDirty();
            }
        }),
        buildField({
            label: 'Tags (virgules ou retours ligne)',
            type: 'textarea',
            rows: 2,
            value: Array.isArray(entry.tags) ? entry.tags.join(', ') : '',
            onInput: event => {
                ctx.adminTimeline.entries[index].tags = parseAdminTokenList(event.target.value || '');
                ctx.markAdminTimelineDirty();
            }
        }),
        buildField({
            label: 'Lieux lies (virgules ou retours ligne)',
            type: 'textarea',
            rows: 2,
            value: Array.isArray(entry.locationNames) ? entry.locationNames.join(', ') : '',
            onInput: event => {
                ctx.adminTimeline.entries[index].locationNames = parseAdminTokenList(event.target.value || '');
                ctx.markAdminTimelineDirty();
            }
        })
    );

    card.append(grid, block);
    return card;
};

export const addAdminTimelineEntry = ctx => {
    if (!ctx.adminTimeline) {
        ctx.adminTimeline = ctx.normalizeAdminTimeline({});
    }
    ctx.adminTimeline.entries.push(ctx.createAdminTimelineEntry(ctx.adminTimeline.entries.length));
    renderAdminTimelineList(ctx);
    ctx.markAdminTimelineDirty();
};

export const moveAdminTimelineEntry = (ctx, index, direction) => {
    if (!Array.isArray(ctx.adminTimeline?.entries)) {
        return;
    }
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= ctx.adminTimeline.entries.length) {
        return;
    }
    const [entry] = ctx.adminTimeline.entries.splice(index, 1);
    ctx.adminTimeline.entries.splice(targetIndex, 0, entry);
    renderAdminTimelineList(ctx);
    ctx.markAdminTimelineDirty();
};

export const removeAdminTimelineEntry = (ctx, index) => {
    if (!Array.isArray(ctx.adminTimeline?.entries)) {
        return;
    }
    ctx.adminTimeline.entries.splice(index, 1);
    renderAdminTimelineList(ctx);
    ctx.markAdminTimelineDirty();
};

export const collectAdminTimelineDraft = ctx => normalizeAdminTimeline(
    ctx.normalizeAdminTimelineEntry.bind(ctx),
    {
        title: ctx.adminDom.timelineTitle?.value || '',
        subtitle: ctx.adminDom.timelineSubtitle?.value || '',
        entries: Array.isArray(ctx.adminTimeline?.entries) ? ctx.adminTimeline.entries : []
    }
);

export const validateAdminTimelineDraft = timeline => {
    const errors = [];
    if (!sanitizeString(timeline?.title)) {
        errors.push('Le titre de la chronologie est requis.');
    }
    if (!Array.isArray(timeline?.entries) || !timeline.entries.length) {
        errors.push('Ajoutez au moins un evenement.');
    }
    const seenIds = new Set();
    (timeline?.entries || []).forEach((entry, index) => {
        if (!sanitizeString(entry?.title)) {
            errors.push(`Evenement ${index + 1}: titre requis.`);
        }
        if (!Number.isFinite(Number(entry?.year))) {
            errors.push(`Evenement ${index + 1}: annee invalide.`);
        }
        const id = sanitizeString(entry?.id);
        if (!id) {
            errors.push(`Evenement ${index + 1}: identifiant requis.`);
        } else if (seenIds.has(id)) {
            errors.push(`Identifiant duplique: ${id}.`);
        } else {
            seenIds.add(id);
        }
    });
    return errors;
};

export const markAdminTimelineDirty = ctx => {
    if (!ctx.isAdmin()) {
        return;
    }
    ctx.adminTimelineDirty = true;
    setAdminTimelineStatus(ctx, '');
    renderAdminTimelineErrors(ctx, []);
    syncAdminTimelineEditor(ctx);
};

export const fetchAdminTimeline = async ctx => {
    if (!ctx.adminDom.timelineSaveButton) {
        return;
    }
    if (!ctx.isAdmin()) {
        ctx.adminTimeline = null;
        ctx.adminTimelineDirty = false;
        syncAdminTimelineEditor(ctx);
        return;
    }
    setAdminTimelineStatus(ctx, 'Chargement de la chronologie...');
    try {
        const response = await fetch(TIMELINE_ADMIN_API_ROUTE, {
            credentials: 'include',
            cache: 'no-store'
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const payload = await response.json();
        ctx.adminTimeline = normalizeAdminTimeline(ctx.normalizeAdminTimelineEntry.bind(ctx), payload?.timeline || {});
        ctx.adminTimelineDirty = false;
        renderAdminTimelineConfig(ctx);
        setAdminTimelineStatus(ctx, "Chronologie chargee depuis l'API admin.");
    } catch (error) {
        console.error('[admin] timeline fetch failed', error);
        try {
            const fallbackResponse = await fetch('/assets/timeline.json', { cache: 'no-store' });
            if (!fallbackResponse.ok) {
                throw new Error(`HTTP ${fallbackResponse.status}`);
            }
            const fallbackPayload = await fallbackResponse.json();
            ctx.adminTimeline = normalizeAdminTimeline(ctx.normalizeAdminTimelineEntry.bind(ctx), fallbackPayload || {});
            ctx.adminTimelineDirty = false;
            renderAdminTimelineConfig(ctx);
            setAdminTimelineStatus(ctx, 'API admin indisponible. Chronologie chargee depuis assets/timeline.json en lecture seule.', true);
        } catch (fallbackError) {
            console.error('[admin] timeline fallback failed', fallbackError);
            ctx.adminTimeline = null;
            setAdminTimelineStatus(ctx, 'Impossible de charger la chronologie.', true);
        }
    } finally {
        syncAdminTimelineEditor(ctx);
    }
};

export const saveAdminTimeline = async ctx => {
    if (!ctx.isAdmin()) {
        ctx.announcer?.assertive?.('Connexion administrateur requise.');
        return;
    }
    const draft = collectAdminTimelineDraft(ctx);
    const errors = validateAdminTimelineDraft(draft);
    ctx.adminTimelineErrors = errors;
    renderAdminTimelineErrors(ctx, errors);
    if (errors.length) {
        setAdminTimelineStatus(ctx, 'Corrigez les erreurs avant enregistrement.', true);
        return;
    }
    ctx.adminTimelinePending = true;
    syncAdminTimelineEditor(ctx);
    setAdminTimelineStatus(ctx, 'Enregistrement de la chronologie...');
    try {
        const response = await fetch(TIMELINE_ADMIN_API_ROUTE, {
            method: 'PATCH',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ timeline: draft })
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const payload = await response.json();
        ctx.adminTimeline = normalizeAdminTimeline(ctx.normalizeAdminTimelineEntry.bind(ctx), payload?.timeline || draft);
        ctx.adminTimelineDirty = false;
        renderAdminTimelineConfig(ctx);
        setAdminTimelineStatus(ctx, 'Chronologie mise a jour. Rechargez /timeline pour verifier le rendu.');
        ctx.announcer?.polite?.('Chronologie enregistree.');
    } catch (error) {
        console.error('[admin] timeline save failed', error);
        setAdminTimelineStatus(ctx, "Impossible d'enregistrer la chronologie.", true);
    } finally {
        ctx.adminTimelinePending = false;
        syncAdminTimelineEditor(ctx);
    }
};
