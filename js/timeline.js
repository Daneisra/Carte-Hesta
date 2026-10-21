import { TimelineAdminPanel } from './ui/timelineAdminPanel.js';

const PREFERENCES_KEY = 'interactive-map-preferences';

const dom = {
    subtitle: document.getElementById('timeline-subtitle'),
    count: document.getElementById('timeline-count'),
    periods: document.getElementById('timeline-periods'),
    range: document.getElementById('timeline-range'),
    status: document.getElementById('timeline-status'),
    headerActions: document.querySelector('.timeline-header-actions'),
    hero: document.querySelector('.timeline-hero'),
    stage: document.querySelector('.timeline-stage'),
    stageHeader: document.querySelector('.timeline-stage-header'),
    track: document.getElementById('timeline-track'),
    periodNav: document.getElementById('timeline-period-nav'),
    stageOverview: document.getElementById('timeline-stage-overview'),
    adminEntry: document.getElementById('timeline-admin-entry'),
    detail: document.getElementById('timeline-detail'),
    detailYear: document.getElementById('timeline-detail-year'),
    detailPeriod: document.getElementById('timeline-detail-period'),
    detailTitle: document.getElementById('timeline-detail-title'),
    detailSummary: document.getElementById('timeline-detail-summary'),
    detailContent: document.getElementById('timeline-detail-content'),
    detailTags: document.getElementById('timeline-detail-tags'),
    detailLocations: document.getElementById('timeline-detail-locations'),
    mapLink: document.getElementById('timeline-map-link'),
    scrollPrev: document.getElementById('timeline-scroll-prev'),
    scrollNext: document.getElementById('timeline-scroll-next'),
    imageLightbox: document.getElementById('timeline-image-lightbox'),
    imageLightboxBackdrop: document.getElementById('timeline-image-lightbox-backdrop'),
    imageLightboxClose: document.getElementById('timeline-image-lightbox-close'),
    imageLightboxTitle: document.getElementById('timeline-image-lightbox-title'),
    imageLightboxImage: document.getElementById('timeline-image-lightbox-img'),
    imageLightboxCaption: document.getElementById('timeline-image-lightbox-caption')
};

const TIMELINE_ADMIN_ENTRY_URL = '/timeline/?admin=timeline';

let timelineAdminPanel = null;
let imageLightboxPreviousFocus = null;

const state = {
    timeline: null,
    entries: [],
    filteredEntries: [],
    filters: {
        search: '',
        period: '',
        tag: ''
    },
    activeId: ''
};

const normalizeText = value => (typeof value === 'string' ? value.trim() : '');
const normalizeForSearch = value => normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
const normalizeMediaUrl = value => {
    const normalized = normalizeText(value);
    if (!normalized) {
        return '';
    }
    if (/^(https?:)?\/\//i.test(normalized) || normalized.startsWith('/')) {
        return normalized;
    }
    return `/${normalized.replace(/^\.?\//, '')}`;
};
const normalizeEventKind = value => normalizeText(value).toLowerCase() === 'player' ? 'player' : 'lore';
const getEventKindLabel = value => normalizeEventKind(value) === 'player' ? 'Evenement joueur' : 'Lore ecrit';

const readQueryState = () => {
    try {
        const params = new URLSearchParams(window.location.search);
        const search = normalizeText(params.get('search')) || normalizeText(params.get('location'));
        return {
            eventId: normalizeText(params.get('event')),
            search,
            period: normalizeText(params.get('period')),
            tag: normalizeText(params.get('tag'))
        };
    } catch (error) {
        return { eventId: '', search: '', period: '', tag: '' };
    }
};

const ensureTimelineAdminEntry = () => {
    if (!dom.headerActions) {
        return null;
    }
    if (!dom.adminEntry) {
        const entry = document.createElement('a');
        entry.id = 'timeline-admin-entry';
        entry.className = 'timeline-link-button timeline-link-button-admin';
        entry.href = TIMELINE_ADMIN_ENTRY_URL;
        entry.textContent = 'Admin chronologie';
        entry.hidden = true;
        dom.headerActions.appendChild(entry);
        dom.adminEntry = entry;
    }
    return dom.adminEntry;
};

const updateTimelineAdminEntry = payload => {
    const entry = ensureTimelineAdminEntry();
    if (!entry) {
        return;
    }
    const isAdmin = Boolean(payload?.authenticated) && normalizeText(payload?.role).toLowerCase() === 'admin';
    entry.hidden = !isAdmin;
    entry.href = TIMELINE_ADMIN_ENTRY_URL;
    timelineAdminPanel?.setSession(payload);
};

const fetchSession = async () => {
    try {
        const response = await fetch('/auth/session', { credentials: 'include' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const payload = await response.json();
        updateTimelineAdminEntry(payload);
    } catch (error) {
        console.error('[timeline] session fetch failed', error);
        updateTimelineAdminEntry({ authenticated: false, role: 'guest' });
    }
};

const syncQueryState = () => {
    if (!window.history?.replaceState) {
        return;
    }
    const params = new URLSearchParams();
    const search = normalizeText(state.filters.search);
    const period = normalizeText(state.filters.period);
    const tag = normalizeText(state.filters.tag);
    const eventId = normalizeText(state.activeId);

    if (eventId) {
        params.set('event', eventId);
    }
    if (search) {
        params.set('search', search);
    }
    if (period) {
        params.set('period', period);
    }
    if (tag) {
        params.set('tag', tag);
    }

    const query = params.toString();
    const nextUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    window.history.replaceState({}, '', nextUrl);
};

const normalizeEntry = (entry, index) => {
    const title = normalizeText(entry?.title) || `Evenement ${index + 1}`;
    const yearValue = Number(entry?.year);
    const year = Number.isFinite(yearValue) ? yearValue : index;
    const summary = normalizeText(entry?.summary);
    const content = normalizeText(entry?.content) || summary;
    const period = normalizeText(entry?.period) || 'Periode inconnue';
    const era = normalizeText(entry?.era) || period;
    const imageUrl = normalizeMediaUrl(entry?.imageUrl);
    const tags = Array.isArray(entry?.tags)
        ? entry.tags.map(normalizeText).filter(Boolean)
        : [];
    const locationNames = Array.isArray(entry?.locationNames)
        ? entry.locationNames.map(normalizeText).filter(Boolean)
        : [];

    return {
        id: normalizeText(entry?.id) || `timeline-${index + 1}`,
        year,
        yearLabel: normalizeText(entry?.yearLabel) || String(year),
        title,
        summary: summary || content || 'Aucun resume pour cet evenement.',
        content: content || 'Aucun contenu detaille pour cet evenement.',
        eventKind: normalizeEventKind(entry?.eventKind),
        era,
        eraSummary: normalizeText(entry?.eraSummary),
        sceneLabel: normalizeText(entry?.sceneLabel),
        period,
        tags,
        locationNames,
        imageUrl,
        mediaAlt: normalizeText(entry?.mediaAlt),
        accentColor: normalizeText(entry?.accentColor) || '#7dd3fc'
    };
};

const normalizeTimeline = payload => {
    const source = payload?.timeline && typeof payload.timeline === 'object'
        ? payload.timeline
        : payload;
    const rawEntries = Array.isArray(source?.entries) ? source.entries : [];
    const entries = rawEntries
        .map((entry, index) => normalizeEntry(entry, index))
        .sort((left, right) => left.year - right.year);

    return {
        title: normalizeText(source?.title) || "Chronologie d'Hesta",
        subtitle: normalizeText(source?.subtitle) || 'Parcourez les evenements majeurs qui structurent les campagnes.',
        entries
    };
};

const readPreferences = () => {
    try {
        const raw = window.localStorage.getItem(PREFERENCES_KEY);
        if (!raw) {
            return {};
        }
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
        return {};
    }
};

const writePreferences = nextState => {
    try {
        window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(nextState));
    } catch (error) {
        // ignore storage failures
    }
};

const openLocationOnMap = locationName => {
    const target = normalizeText(locationName);
    if (!target) {
        window.location.href = '/map/';
        return;
    }
    const preferences = readPreferences();
    preferences.lastLocation = target;
    writePreferences(preferences);
    window.location.href = '/map/';
};

const closeImageLightbox = () => {
    if (!dom.imageLightbox) {
        return;
    }
    dom.imageLightbox.hidden = true;
    document.body.classList.remove('timeline-lightbox-open');
    if (dom.imageLightboxImage) {
        dom.imageLightboxImage.removeAttribute('src');
        dom.imageLightboxImage.alt = '';
    }
    if (imageLightboxPreviousFocus && typeof imageLightboxPreviousFocus.focus === 'function') {
        imageLightboxPreviousFocus.focus();
    }
    imageLightboxPreviousFocus = null;
};

const openImageLightbox = entry => {
    const imageUrl = normalizeMediaUrl(entry?.imageUrl);
    if (!dom.imageLightbox || !dom.imageLightboxImage || !imageUrl) {
        return;
    }
    imageLightboxPreviousFocus = document.activeElement;
    const alt = entry.mediaAlt || `Illustration pour ${entry.title}`;
    dom.imageLightboxImage.src = imageUrl;
    dom.imageLightboxImage.alt = alt;
    if (dom.imageLightboxTitle) {
        dom.imageLightboxTitle.textContent = entry.title || 'Image de chronologie';
    }
    if (dom.imageLightboxCaption) {
        const caption = normalizeText(entry.mediaAlt) || normalizeText(entry.summary);
        dom.imageLightboxCaption.textContent = caption;
        dom.imageLightboxCaption.hidden = !caption;
    }
    dom.imageLightbox.hidden = false;
    document.body.classList.add('timeline-lightbox-open');
    window.requestAnimationFrame(() => dom.imageLightboxClose?.focus());
};

const createTimelineImage = ({ src, alt = '', className = '', onError } = {}) => {
    const normalizedSrc = normalizeMediaUrl(src);
    if (!normalizedSrc) {
        return null;
    }
    const image = document.createElement('img');
    image.src = normalizedSrc;
    image.alt = normalizeText(alt);
    image.loading = 'lazy';
    if (className) {
        image.className = className;
    }
    image.addEventListener('error', () => {
        if (typeof onError === 'function') {
            onError(image);
            return;
        }
        image.closest('.timeline-card-media, .timeline-detail-media')?.remove();
    }, { once: true });
    return image;
};

const updateHero = timeline => {
    dom.subtitle.textContent = timeline.subtitle;
    dom.count.textContent = String(timeline.entries.length);
    const periods = new Set(timeline.entries.map(entry => entry.period));
    dom.periods.textContent = String(periods.size);
    if (!timeline.entries.length) {
        dom.range.textContent = '--';
        return;
    }
    const first = timeline.entries[0].yearLabel;
    const last = timeline.entries[timeline.entries.length - 1].yearLabel;
    dom.range.textContent = first === last ? first : `${first} -> ${last}`;
};

const updateTrackNavigationState = () => {
    if (!dom.track || !dom.scrollPrev || !dom.scrollNext) {
        return;
    }
    const maxScrollLeft = Math.max(0, dom.track.scrollWidth - dom.track.clientWidth);
    const current = dom.track.scrollLeft;
    const atStart = current <= 4;
    const atEnd = current >= (maxScrollLeft - 4);
    dom.scrollPrev.disabled = atStart;
    dom.scrollNext.disabled = atEnd || maxScrollLeft <= 0;
};

const setActiveAccent = accentColor => {
    const nextAccent = normalizeText(accentColor) || 'var(--timeline-accent)';
    dom.hero?.style.setProperty('--timeline-active-accent', nextAccent);
    dom.stage?.style.setProperty('--timeline-active-accent', nextAccent);
    dom.detail?.style.setProperty('--timeline-detail-accent', nextAccent);
};

const updatePeriodNavState = () => {
    if (!dom.periodNav) {
        return;
    }
    const activeCard = dom.track?.querySelector(`.timeline-card[data-timeline-id="${state.activeId}"]`);
    const activeGroup = activeCard?.closest('.timeline-era-group');
    const activeGroupId = activeGroup?.dataset.eraGroupId || '';
    dom.periodNav.querySelectorAll('.timeline-period-nav-chip').forEach(button => {
        const isActive = button.dataset.eraGroupId === activeGroupId;
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-pressed', String(isActive));
    });
};

const ensureStageOverviewDom = () => {
    if (!dom.stage || !dom.status) {
        return;
    }
    if (!dom.stageOverview) {
        const panel = document.createElement('section');
        panel.id = 'timeline-stage-overview';
        panel.className = 'timeline-stage-overview';
        panel.hidden = true;
        panel.setAttribute('aria-label', 'Contexte actif');
        panel.innerHTML = `
            <div class="timeline-stage-overview-copy">
                <p id="timeline-stage-overview-kicker" class="timeline-stage-overview-kicker">Lecture active</p>
                <h3 id="timeline-stage-overview-title" class="timeline-stage-overview-title">Selectionnez un evenement</h3>
                <p id="timeline-stage-overview-summary" class="timeline-stage-overview-summary"></p>
            </div>
            <dl class="timeline-stage-overview-meta">
                <div class="timeline-stage-overview-stat">
                    <dt>Annee</dt>
                    <dd id="timeline-stage-overview-year">--</dd>
                </div>
                <div class="timeline-stage-overview-stat">
                    <dt>Epoque</dt>
                    <dd id="timeline-stage-overview-era">--</dd>
                </div>
                <div class="timeline-stage-overview-stat">
                    <dt>Periode</dt>
                    <dd id="timeline-stage-overview-period">--</dd>
                </div>
                <div class="timeline-stage-overview-stat">
                    <dt>Lieux lies</dt>
                    <dd id="timeline-stage-overview-locations">0</dd>
                </div>
            </dl>
        `;
        dom.status.insertAdjacentElement('afterend', panel);
        dom.stageOverview = panel;
    }
};

const ensurePeriodNavDom = () => {
    if (!dom.stage || !dom.status) {
        return;
    }
    if (!dom.periodNav) {
        const wrapper = document.createElement('div');
        wrapper.id = 'timeline-period-nav';
        wrapper.className = 'timeline-period-nav';
        wrapper.setAttribute('aria-label', 'Navigation rapide par epoque');
        wrapper.hidden = true;
        dom.status.insertAdjacentElement('afterend', wrapper);
        dom.periodNav = wrapper;
    }
};

const ensureFilterDom = () => {
    if (!dom.stage || document.getElementById('timeline-search')) {
        return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'timeline-filters';
    wrapper.setAttribute('aria-label', 'Filtres chronologie');
    wrapper.innerHTML = `
        <label class="timeline-filter-field timeline-filter-field-search" for="timeline-search">
            <span>Recherche</span>
            <input id="timeline-search" type="search" placeholder="Titre, texte, lieu, tag..." autocomplete="off" />
        </label>
        <label class="timeline-filter-field" for="timeline-period-filter">
            <span>Periode</span>
            <select id="timeline-period-filter">
                <option value="">Toutes</option>
            </select>
        </label>
        <label class="timeline-filter-field" for="timeline-tag-filter">
            <span>Tag</span>
            <select id="timeline-tag-filter">
                <option value="">Tous</option>
            </select>
        </label>
        <button id="timeline-reset-filters" class="timeline-reset-button" type="button">Reinitialiser</button>
    `;

    dom.stage.insertBefore(wrapper, dom.status);
    dom.searchInput = wrapper.querySelector('#timeline-search');
    dom.periodFilter = wrapper.querySelector('#timeline-period-filter');
    dom.tagFilter = wrapper.querySelector('#timeline-tag-filter');
    dom.resetFilters = wrapper.querySelector('#timeline-reset-filters');
};

const renderStageOverview = entry => {
    ensureStageOverviewDom();
    if (!dom.stageOverview) {
        return;
    }
    if (!entry) {
        dom.stageOverview.hidden = true;
        return;
    }

    dom.stageOverview.hidden = false;
    dom.stageOverview.style.setProperty('--timeline-stage-accent', entry.accentColor);

    const title = dom.stageOverview.querySelector('#timeline-stage-overview-title');
    const summary = dom.stageOverview.querySelector('#timeline-stage-overview-summary');
    const kicker = dom.stageOverview.querySelector('#timeline-stage-overview-kicker');
    const year = dom.stageOverview.querySelector('#timeline-stage-overview-year');
    const era = dom.stageOverview.querySelector('#timeline-stage-overview-era');
    const period = dom.stageOverview.querySelector('#timeline-stage-overview-period');
    const locations = dom.stageOverview.querySelector('#timeline-stage-overview-locations');

    if (kicker) {
        kicker.textContent = entry.sceneLabel || 'Lecture active';
    }
    if (title) {
        title.textContent = entry.title;
    }
    if (summary) {
        summary.textContent = entry.eraSummary || entry.summary;
    }
    if (year) {
        year.textContent = entry.yearLabel;
    }
    if (era) {
        era.textContent = entry.era;
    }
    if (period) {
        period.textContent = entry.period;
    }
    if (locations) {
        locations.textContent = String(entry.locationNames.length);
    }
};

const renderPeriodNav = entries => {
    ensurePeriodNavDom();
    if (!dom.periodNav) {
        return;
    }
    const groups = groupEntriesByEra(entries);
    dom.periodNav.innerHTML = '';
    dom.periodNav.hidden = groups.length <= 1;
    if (groups.length <= 1) {
        return;
    }

    groups.forEach(group => {
        const firstEntry = group.entries[0];
        if (!firstEntry) {
            return;
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'timeline-period-nav-chip';
        button.dataset.eraGroupId = firstEntry.id;
        button.textContent = group.era;
        button.setAttribute('aria-label', `Aller a l epoque ${group.era}`);
        button.setAttribute('aria-pressed', 'false');
        button.addEventListener('click', () => {
            setActiveEntry(firstEntry.id);
            window.requestAnimationFrame(updatePeriodNavState);
        });
        dom.periodNav.appendChild(button);
    });
    updatePeriodNavState();
};

const populateFilterOptions = entries => {
    if (!dom.periodFilter || !dom.tagFilter) {
        return;
    }

    const periods = Array.from(new Set(entries.map(entry => entry.period).filter(Boolean))).sort((left, right) => left.localeCompare(right, 'fr'));
    const tags = Array.from(new Set(entries.flatMap(entry => entry.tags))).sort((left, right) => left.localeCompare(right, 'fr'));

    dom.periodFilter.innerHTML = '<option value="">Toutes</option>';
    periods.forEach(period => {
        const option = document.createElement('option');
        option.value = period;
        option.textContent = period;
        dom.periodFilter.appendChild(option);
    });

    dom.tagFilter.innerHTML = '<option value="">Tous</option>';
    tags.forEach(tag => {
        const option = document.createElement('option');
        option.value = tag;
        option.textContent = tag;
        dom.tagFilter.appendChild(option);
    });
};

const renderLocations = entry => {
    dom.detailLocations.innerHTML = '';
    if (!entry.locationNames.length) {
        const fallback = document.createElement('span');
        fallback.className = 'timeline-chip';
        fallback.textContent = 'Aucun lieu relie';
        dom.detailLocations.appendChild(fallback);
        dom.mapLink.href = '/map/';
        dom.mapLink.textContent = 'Ouvrir la carte';
        return;
    }

    dom.mapLink.href = '/map/';
    dom.mapLink.textContent = `Voir ${entry.locationNames[0]} sur la carte`;
    dom.mapLink.onclick = event => {
        event.preventDefault();
        openLocationOnMap(entry.locationNames[0]);
    };

    entry.locationNames.forEach(locationName => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'timeline-location-button';
        button.textContent = locationName;
        button.addEventListener('click', () => openLocationOnMap(locationName));
        dom.detailLocations.appendChild(button);
    });
};

const renderTags = entry => {
    dom.detailTags.innerHTML = '';
    if (!entry.tags.length) {
        return;
    }
    entry.tags.forEach(tag => {
        const chip = document.createElement('span');
        chip.className = 'timeline-chip';
        chip.textContent = tag;
        dom.detailTags.appendChild(chip);
    });
};

const renderDetail = entry => {
    dom.detail.hidden = false;
    setActiveAccent(entry.accentColor);
    renderStageOverview(entry);
    dom.detail.classList.toggle('is-player-event', entry.eventKind === 'player');
    dom.detail.classList.toggle('is-lore-event', entry.eventKind !== 'player');
    dom.detailYear.textContent = entry.yearLabel;
    dom.detailPeriod.textContent = `${entry.era} | ${entry.period}`;
    dom.detailTitle.textContent = entry.title;
    dom.detailSummary.textContent = entry.summary;
    dom.detailContent.innerHTML = '';

    if (entry.sceneLabel || entry.eraSummary) {
        const context = document.createElement('div');
        context.className = 'timeline-detail-context';
        const kind = document.createElement('span');
        kind.className = `timeline-detail-kind timeline-detail-kind-${entry.eventKind}`;
        kind.textContent = getEventKindLabel(entry.eventKind);
        context.appendChild(kind);
        if (entry.sceneLabel) {
            const scene = document.createElement('span');
            scene.className = 'timeline-detail-scene';
            scene.textContent = entry.sceneLabel;
            context.appendChild(scene);
        }
        if (entry.eraSummary) {
            const eraSummary = document.createElement('p');
            eraSummary.className = 'timeline-detail-era-summary';
            eraSummary.textContent = entry.eraSummary;
            context.appendChild(eraSummary);
        }
        dom.detailContent.appendChild(context);
    }

    const paragraph = document.createElement('p');
    paragraph.textContent = entry.content;
    if (entry.imageUrl) {
        const media = document.createElement('div');
        media.className = 'timeline-detail-media';
        const mediaButton = document.createElement('button');
        mediaButton.type = 'button';
        mediaButton.className = 'timeline-detail-media-button';
        mediaButton.setAttribute('aria-label', `Ouvrir l'image de ${entry.title} en grand`);
        const image = createTimelineImage({
            src: entry.imageUrl,
            alt: entry.mediaAlt || `Illustration pour ${entry.title}`
        });
        if (image) {
            mediaButton.appendChild(image);
            mediaButton.addEventListener('click', () => openImageLightbox(entry));
            media.appendChild(mediaButton);
            dom.detailContent.appendChild(media);
        }
    }
    dom.detailContent.appendChild(paragraph);

    renderTags(entry);
    renderLocations(entry);
};

const focusTimelineCard = entryId => {
    dom.track.querySelectorAll('.timeline-card').forEach(card => {
        if (card.dataset.timelineId === entryId) {
            card.focus();
        }
    });
};

const setActiveEntry = entryId => {
    const source = Array.isArray(state.filteredEntries) && state.filteredEntries.length ? state.filteredEntries : state.entries;
    const nextEntry = source.find(entry => entry.id === entryId) || source[0] || null;
    if (!nextEntry) {
        state.activeId = '';
        dom.detail.hidden = true;
        dom.detail.classList.remove('is-player-event', 'is-lore-event');
        dom.detail.style.removeProperty('--timeline-detail-accent');
        dom.hero?.style.removeProperty('--timeline-active-accent');
        dom.stage?.style.removeProperty('--timeline-active-accent');
        renderStageOverview(null);
        updatePeriodNavState();
        syncQueryState();
        return;
    }

    state.activeId = nextEntry.id;
    renderDetail(nextEntry);

    dom.track.querySelectorAll('.timeline-card').forEach(card => {
        const isActive = card.dataset.timelineId === nextEntry.id;
        card.classList.toggle('is-active', isActive);
        card.setAttribute('aria-pressed', String(isActive));
        if (isActive) {
            card.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }
    });
    updatePeriodNavState();
    window.requestAnimationFrame(updateTrackNavigationState);
    syncQueryState();
};

const moveActiveEntry = direction => {
    const source = Array.isArray(state.filteredEntries) && state.filteredEntries.length ? state.filteredEntries : state.entries;
    if (!source.length) {
        return;
    }
    const currentIndex = Math.max(0, source.findIndex(entry => entry.id === state.activeId));
    const nextIndex = Math.min(source.length - 1, Math.max(0, currentIndex + direction));
    const nextEntry = source[nextIndex];
    if (!nextEntry) {
        return;
    }
    setActiveEntry(nextEntry.id);
    window.requestAnimationFrame(() => focusTimelineCard(nextEntry.id));
};

const handleCardKeydown = event => {
    switch (event.key) {
        case 'ArrowRight':
            event.preventDefault();
            moveActiveEntry(1);
            break;
        case 'ArrowLeft':
            event.preventDefault();
            moveActiveEntry(-1);
            break;
        case 'Home':
            event.preventDefault();
            if (state.filteredEntries.length) {
                setActiveEntry(state.filteredEntries[0].id);
                window.requestAnimationFrame(() => focusTimelineCard(state.filteredEntries[0].id));
            }
            break;
        case 'End':
            event.preventDefault();
            if (state.filteredEntries.length) {
                const lastEntry = state.filteredEntries[state.filteredEntries.length - 1];
                setActiveEntry(lastEntry.id);
                window.requestAnimationFrame(() => focusTimelineCard(lastEntry.id));
            }
            break;
        default:
            break;
    }
};

const groupPeriodsWithinEra = entries => {
    const groups = [];
    entries.forEach(entry => {
        const period = entry.period || 'Periode inconnue';
        const lastGroup = groups[groups.length - 1];
        if (lastGroup && lastGroup.period === period) {
            lastGroup.entries.push(entry);
            return;
        }
        groups.push({
            period,
            entries: [entry]
        });
    });
    return groups;
};

const groupEntriesByEra = entries => {
    const groups = [];
    entries.forEach(entry => {
        const era = entry.era || entry.period || 'Periode inconnue';
        const lastGroup = groups[groups.length - 1];
        if (lastGroup && lastGroup.era === era) {
            lastGroup.entries.push(entry);
            if (!lastGroup.eraSummary && entry.eraSummary) {
                lastGroup.eraSummary = entry.eraSummary;
            }
            return;
        }
        groups.push({
            era,
            eraSummary: entry.eraSummary || '',
            entries: [entry]
        });
    });
    return groups.map(group => ({
        ...group,
        periods: groupPeriodsWithinEra(group.entries)
    }));
};

const renderTrack = entries => {
    dom.track.innerHTML = '';
    renderPeriodNav(entries);
    if (!entries.length) {
        const empty = document.createElement('div');
        empty.className = 'timeline-empty';
        empty.textContent = 'Aucun evenement ne correspond aux filtres en cours.';
        dom.track.appendChild(empty);
        return;
    }
    groupEntriesByEra(entries).forEach(group => {
        const section = document.createElement('section');
        section.className = 'timeline-era-group';
        section.setAttribute('aria-label', group.era);
        section.dataset.eraGroupId = group.entries[0]?.id || group.era;

        const eraHeader = document.createElement('div');
        eraHeader.className = 'timeline-era-group-header';

        const eraCopy = document.createElement('div');
        eraCopy.className = 'timeline-era-group-copy';

        const eraEyebrow = document.createElement('span');
        eraEyebrow.className = 'timeline-era-group-eyebrow';
        eraEyebrow.textContent = 'Epoque';

        const eraTitle = document.createElement('h3');
        eraTitle.className = 'timeline-era-group-title';
        eraTitle.textContent = group.era;

        const eraSummary = document.createElement('p');
        eraSummary.className = 'timeline-era-group-summary';
        eraSummary.textContent = group.eraSummary || `Traversez ${group.entries.length} evenement${group.entries.length > 1 ? 's' : ''} relies a cette epoque.`;

        eraCopy.append(eraEyebrow, eraTitle, eraSummary);

        const eraMeta = document.createElement('div');
        eraMeta.className = 'timeline-era-group-meta';
        eraMeta.innerHTML = `
            <span>${group.entries[0]?.yearLabel || '--'}</span>
            <span>${group.entries[group.entries.length - 1]?.yearLabel || '--'}</span>
            <span>${group.entries.length} evenement${group.entries.length > 1 ? 's' : ''}</span>
        `;

        eraHeader.append(eraCopy, eraMeta);

        const eraBody = document.createElement('div');
        eraBody.className = 'timeline-era-group-body';

        group.periods.forEach(periodGroup => {
            const periodSection = document.createElement('section');
            periodSection.className = 'timeline-period-group';
            periodSection.setAttribute('aria-label', periodGroup.period);
            periodSection.dataset.periodGroupId = periodGroup.entries[0]?.id || periodGroup.period;

            const header = document.createElement('div');
            header.className = 'timeline-period-group-header';

            const title = document.createElement('h4');
            title.className = 'timeline-period-group-title';
            title.textContent = periodGroup.period;

            const meta = document.createElement('span');
            meta.className = 'timeline-period-group-meta';
            meta.textContent = `${periodGroup.entries.length} evenement${periodGroup.entries.length > 1 ? 's' : ''}`;

            header.append(title, meta);

            const cards = document.createElement('div');
            cards.className = 'timeline-period-group-track';

            periodGroup.entries.forEach(entry => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'timeline-card';
                button.classList.add(entry.eventKind === 'player' ? 'is-player-event' : 'is-lore-event');
                button.dataset.timelineId = entry.id;
                button.dataset.timelineKind = entry.eventKind;
                button.style.setProperty('--timeline-card-accent', entry.accentColor);
                button.setAttribute('role', 'listitem');
                button.setAttribute('aria-pressed', 'false');
                button.setAttribute('aria-controls', 'timeline-detail');
                button.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight Home End');

                const year = document.createElement('span');
                year.className = 'timeline-card-year';
                year.textContent = entry.yearLabel;

                const sceneLabel = document.createElement('span');
                sceneLabel.className = 'timeline-card-scene';
                sceneLabel.textContent = entry.sceneLabel || entry.era;

                const period = document.createElement('span');
                period.className = 'timeline-card-period';
                period.textContent = entry.period;

                const kind = document.createElement('span');
                kind.className = `timeline-card-kind timeline-card-kind-${entry.eventKind}`;
                kind.textContent = getEventKindLabel(entry.eventKind);

                const entryTitle = document.createElement('h3');
                entryTitle.className = 'timeline-card-title';
                entryTitle.textContent = entry.title;

                const summary = document.createElement('p');
                summary.className = 'timeline-card-summary';
                summary.textContent = entry.summary;

                const cardMeta = document.createElement('div');
                cardMeta.className = 'timeline-card-meta';
                if (entry.tags.length) {
                    entry.tags.slice(0, 2).forEach(tag => {
                        const chip = document.createElement('span');
                        chip.className = 'timeline-chip';
                        chip.textContent = tag;
                        cardMeta.appendChild(chip);
                    });
                }
                if (entry.locationNames.length) {
                    const chip = document.createElement('span');
                    chip.className = 'timeline-chip';
                    chip.textContent = entry.locationNames[0];
                    cardMeta.appendChild(chip);
                }

                if (entry.imageUrl) {
                    const media = document.createElement('div');
                    media.className = 'timeline-card-media';
                    const image = createTimelineImage({
                        src: entry.imageUrl,
                        alt: entry.mediaAlt || `Illustration pour ${entry.title}`
                    });
                    if (image) {
                        media.appendChild(image);
                        button.appendChild(media);
                    }
                }

                button.append(year, sceneLabel, period, kind, entryTitle, summary, cardMeta);
                button.addEventListener('click', () => setActiveEntry(entry.id));
                button.addEventListener('keydown', handleCardKeydown);
                cards.appendChild(button);
            });

            periodSection.append(header, cards);
            eraBody.appendChild(periodSection);
        });

        section.append(eraHeader, eraBody);
        dom.track.appendChild(section);
    });
    window.requestAnimationFrame(updateTrackNavigationState);
};

const bindTrackNavigation = () => {
    const scrollByAmount = direction => {
        dom.track.scrollBy({ left: direction * 360, behavior: 'smooth' });
    };

    if (dom.scrollPrev) {
        dom.scrollPrev.textContent = '←';
    }
    if (dom.scrollNext) {
        dom.scrollNext.textContent = '→';
    }
    dom.scrollPrev?.addEventListener('click', () => scrollByAmount(-1));
    dom.scrollNext?.addEventListener('click', () => scrollByAmount(1));
    dom.track?.addEventListener('scroll', updateTrackNavigationState, { passive: true });
    window.addEventListener('resize', updateTrackNavigationState, { passive: true });
};

const bindImageLightbox = () => {
    dom.imageLightboxClose?.addEventListener('click', closeImageLightbox);
    dom.imageLightboxBackdrop?.addEventListener('click', closeImageLightbox);
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && dom.imageLightbox && !dom.imageLightbox.hidden) {
            event.preventDefault();
            closeImageLightbox();
        }
    });
};

const applyFilters = () => {
    const search = normalizeForSearch(state.filters.search);
    const period = normalizeText(state.filters.period);
    const tag = normalizeText(state.filters.tag);

    state.filteredEntries = state.entries.filter(entry => {
        if (period && entry.period !== period) {
            return false;
        }
        if (tag && !entry.tags.includes(tag)) {
            return false;
        }
        if (!search) {
            return true;
        }
        const haystack = [
            entry.yearLabel,
            entry.title,
            entry.summary,
            entry.content,
            entry.era,
            entry.eraSummary,
            entry.sceneLabel,
            entry.period,
            ...entry.tags,
            ...entry.locationNames
        ].map(normalizeForSearch).join(' ');
        return haystack.includes(search);
    });

    renderTrack(state.filteredEntries);

    if (!state.filteredEntries.length) {
        state.activeId = '';
        dom.detail.hidden = true;
        dom.status.textContent = 'Aucun evenement ne correspond aux filtres en cours.';
        syncQueryState();
        return;
    }

    dom.status.textContent = `${state.filteredEntries.length} evenements affiches sur ${state.entries.length}. Faites defiler la frise de gauche a droite.`;
    const currentId = state.filteredEntries.some(entry => entry.id === state.activeId)
        ? state.activeId
        : state.filteredEntries[0].id;
    setActiveEntry(currentId);
};

const bindFilters = () => {
    ensureFilterDom();
    if (!dom.searchInput || !dom.periodFilter || !dom.tagFilter || !dom.resetFilters) {
        return;
    }

    dom.searchInput.addEventListener('input', () => {
        state.filters.search = dom.searchInput.value || '';
        applyFilters();
    });

    dom.periodFilter.addEventListener('change', () => {
        state.filters.period = dom.periodFilter.value || '';
        applyFilters();
    });

    dom.tagFilter.addEventListener('change', () => {
        state.filters.tag = dom.tagFilter.value || '';
        applyFilters();
    });

    dom.resetFilters.addEventListener('click', () => {
        state.filters = { search: '', period: '', tag: '' };
        dom.searchInput.value = '';
        dom.periodFilter.value = '';
        dom.tagFilter.value = '';
        applyFilters();
    });
};

const applyInitialQueryState = () => {
    const query = readQueryState();
    if (!query.eventId && !query.search && !query.period && !query.tag) {
        return;
    }
    if (query.search) {
        state.filters.search = query.search;
        if (dom.searchInput) {
            dom.searchInput.value = query.search;
        }
    }
    if (query.period) {
        state.filters.period = query.period;
        if (dom.periodFilter) {
            dom.periodFilter.value = query.period;
        }
    }
    if (query.tag) {
        state.filters.tag = query.tag;
        if (dom.tagFilter) {
            dom.tagFilter.value = query.tag;
        }
    }
    if (query.eventId) {
        state.activeId = query.eventId;
    }
};

const loadTimeline = async () => {
    const response = await fetch('/api/timeline', { cache: 'no-store' });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
};

const initialize = async () => {
    const adminEntry = ensureTimelineAdminEntry();
    timelineAdminPanel = new TimelineAdminPanel({
        onSave: () => window.location.reload()
    });
    timelineAdminPanel.bindTriggers([adminEntry]);
    bindTrackNavigation();
    bindImageLightbox();
    bindFilters();
    fetchSession();
    try {
        const generation = state.accessGeneration || 0;
        const payload = await loadTimeline();
        if (generation !== (state.accessGeneration || 0)) return;
        state.timeline = normalizeTimeline(payload);
        state.entries = state.timeline.entries;
        state.filteredEntries = state.timeline.entries.slice();
        updateHero(state.timeline);
        populateFilterOptions(state.entries);
        applyInitialQueryState();
        state.initialQueryApplied = true;

        if (!state.entries.length) {
            dom.status.textContent = 'Aucun evenement de chronologie disponible pour le moment.';
            dom.detail.hidden = true;
            return;
        }

        applyFilters();
    } catch (error) {
        console.error('[timeline] unable to load timeline', error);
        dom.status.textContent = 'Impossible de charger la chronologie pour le moment.';
        dom.subtitle.textContent = 'Le chargement de la frise a echoue. Reessayez plus tard.';
        dom.count.textContent = '--';
        dom.periods.textContent = '--';
        dom.range.textContent = '--';
    }
};

document.addEventListener('DOMContentLoaded', initialize);

if (typeof EventSource === 'function') {
    const permissionsStream = new EventSource('/api/events/stream');
    const refreshPermissions = async () => {
        const generation = state.accessGeneration = (state.accessGeneration || 0) + 1;
        const previousActive = state.activeId;
        state.entries = []; state.filteredEntries = []; state.activeId = null;
        for (const key of ['detailYear', 'detailPeriod', 'detailTitle', 'detailSummary', 'detailContent', 'detailTags', 'detailLocations', 'imageLightboxTitle', 'imageLightboxCaption']) dom[key]?.replaceChildren();
        dom.imageLightboxImage?.removeAttribute('src');
        dom.imageLightbox?.classList.remove('open'); dom.detail.hidden = true;
        // Clear the revoked view without rewriting the URL or filter controls while loading.
        dom.track?.replaceChildren(); dom.periodNav?.replaceChildren();
        renderStageOverview(null);
        dom.stageOverview?.querySelectorAll('h3, p, dd').forEach(node => { node.textContent = ''; });
        dom.count.textContent = '--'; dom.periods.textContent = '--'; dom.range.textContent = '--';
        try {
            const payload = await loadTimeline();
            if (generation !== state.accessGeneration) return;
            state.timeline = normalizeTimeline(payload);
            state.entries = state.timeline.entries; state.filteredEntries = state.entries.slice();
            updateHero(state.timeline); populateFilterOptions(state.entries);
            if (!state.initialQueryApplied) { applyInitialQueryState(); state.initialQueryApplied = true; }
            else {
                dom.searchInput.value = state.filters.search || '';
                for (const [key, input] of [['period', dom.periodFilter], ['tag', dom.tagFilter]]) {
                    if (![...input.options].some(option => option.value === state.filters[key])) state.filters[key] = '';
                    input.value = state.filters[key] || '';
                }
                state.activeId = state.entries.some(entry => entry.id === previousActive) ? previousActive : '';
            }
            applyFilters();
        } catch { dom.status.textContent = 'Chronologie indisponible.'; }
    };
    permissionsStream.addEventListener('permissions.changed', refreshPermissions);
    permissionsStream.addEventListener('permissions.ready', refreshPermissions);
    window.addEventListener('beforeunload', () => permissionsStream.close(), { once: true });
}
