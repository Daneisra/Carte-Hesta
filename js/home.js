import { APP_VERSION } from './shared/appVersion.mjs';
import { CHANGELOG } from './shared/changelog.mjs';
import { mergeChangelog, normalizeEntries } from './shared/changelogData.mjs';
import { loadChangelog } from './shared/changelogClient.mjs';
import { setAvatarImage } from './ui/avatar.mjs';
const dom = {
    year: document.getElementById('home-year'),
    headerActions: document.querySelector('.home-header-actions'),
    login: document.getElementById('home-login'),
    profileToggle: document.getElementById('home-profile-toggle'),
    profileToggleAvatar: document.getElementById('home-profile-toggle-avatar'),
    profileToggleName: document.getElementById('home-profile-toggle-name'),
    profilePopover: document.getElementById('home-profile-popover'),
    logout: document.getElementById('home-logout'),
    authNote: document.getElementById('home-auth-note'),
    username: document.getElementById('home-username'),
    role: document.getElementById('home-role'),
    status: document.getElementById('home-session-status'),
    avatar: document.getElementById('home-avatar'),
    provider: document.getElementById('home-provider'),
    discord: document.getElementById('home-discord'),
    lastLogin: document.getElementById('home-last-login'),
    sessionMap: document.getElementById('home-session-map'),
    adminLink: document.getElementById('home-admin-link'),
    adminEntry: document.getElementById('home-admin-entry'),
    heroKicker: document.getElementById('home-kicker'),
    heroTitle: document.getElementById('home-hero-title'),
    heroLead: document.getElementById('home-hero-lead'),
    heroTags: document.getElementById('home-hero-tags'),
    heroMetrics: document.getElementById('home-hero-metrics'),
    atmosphereCopy: document.getElementById('home-atmosphere-copy'),
    resumeCard: document.getElementById('home-resume-card'),
    resumeFavorites: document.getElementById('home-resume-favorites'),
    resumeLastLocation: document.getElementById('home-resume-last-location'),
    resumeNote: document.getElementById('home-resume-note'),
    newsStatus: document.getElementById('home-news-status'),
    newsNote: document.getElementById('home-news-note'),
    newsList: document.getElementById('home-news-list'),
    liveStatus: document.getElementById('home-live-status'),
    liveNote: document.getElementById('home-live-note'),
    liveList: document.getElementById('home-live-list'),
    featuredStatus: document.getElementById('home-featured-status'),
    featuredNote: document.getElementById('home-featured-note'),
    featuredList: document.getElementById('home-featured-list'),
    changelogStatus: document.getElementById('home-changelog-status'),
    changelogNote: document.getElementById('home-changelog-note'),
    changelogList: document.getElementById('home-changelog-list'),
    donateLink: document.getElementById('home-donate-link'),
    mapPreviewImage: document.getElementById('home-map-preview-image'),
    characterArt: document.getElementById('home-character-art'),
    floatingTitle: document.getElementById('home-floating-title'),
    floatingCopy: document.getElementById('home-floating-copy'),
    footerSupport: document.getElementById('home-footer-support'),
    footerContact: document.getElementById('home-footer-contact'),
    footerCredits: document.getElementById('home-footer-credits'),
    footerVersion: document.getElementById('home-version'),
    footerNote: document.getElementById('home-footer-note'),
    statNewsValue: document.getElementById('home-stat-news-value'),
    statNewsLabel: document.getElementById('home-stat-news-label'),
    statFeaturedValue: document.getElementById('home-stat-featured-value'),
    statFeaturedLabel: document.getElementById('home-stat-featured-label')
};

const PREFERENCES_STORAGE_KEY = 'interactive-map-preferences';
const SITE_CONFIG_URL = '/assets/site-config.json';
const LOCATIONS_DATA_URL = '/assets/locations.json';
const PORTAL_URL = 'https://hesta.dannytech.fr/';
const LIVE_ITEMS_LIMIT = 5;
const PAYPAL_DONATION_URL = 'https://paypal.me/Daneisra?country.x=FR&locale.x=fr_FR';
const HOME_ADMIN_ENTRY_URL = '/?admin=home';

const DEFAULT_SITE_CONFIG = {
    version: APP_VERSION,
    home: {
        kicker: 'Accueil - Hub narratif',
        title: "Entrez dans l'univers avant d'ouvrir la carte",
        lead: "Explorez les lieux, suivez les quetes en direct, retrouvez votre groupe JDR et centralisez vos personnages. Cette page sert de point d'entree rapide pour la carte et la communaute.",
        atmosphere: "Accueil narratif - entree rapide vers l'univers, la carte et la communaute.",
        tags: ['Carte narrative', 'Quetes live', 'Groupes JDR', 'Profils & personnages'],
        metrics: [
            { label: 'Hub', value: 'Carte + Communaute' },
            { label: 'Acces', value: 'Lecture / Discord / Admin' },
            { label: 'Etat', value: 'Version actuelle en production' }
        ],
        visuals: {
            backgroundImage: '/assets/home/backgrounds/hero-main.png',
            mapPreviewImage: '/assets/home/mockups/map-preview-main.png',
            characterImage: '/assets/home/characters/Chevalier.png',
            floatingTitle: "Les terres d'Hesta",
            floatingCopy: "Un apercu clair du monde, des routes, des villes et des quetes qui structurent vos campagnes."
        }
    },
    community: {
        youtubeUrl: 'https://www.youtube.com/',
        discordUrl: 'https://discord.com/',
        redditUrl: 'https://www.reddit.com/',
        discord: {
            badge: 'Discord',
            title: 'Serveur principal',
            copy: 'Organisation des sessions, annonces JDR et coordination des groupes.'
        },
        proof: {
            mode: 'manual',
            guildId: '',
            manualCount: 200,
            label: 'membres sur Discord',
            note: 'Sessions, annonces et coordination des groupes JDR.'
        },
        youtube: {
            badge: 'YouTube',
            title: 'Lore & recaps',
            copy: 'Recaps, videos d univers et ambiances pour prolonger les campagnes.'
        },
        reddit: {
            badge: 'Reddit',
            title: 'Discussions',
            copy: 'Partage d idees, feedback et archives communautaires.'
        }
    },
    support: {
        issuesUrl: 'https://hesta.dannytech.fr/',
        contactEmail: 'contact@cartehesta.local'
    },
    legal: {
        creditsUrl: '/docs/ASSETS-CREDITS.md',
        footerNote: "Projet narratif / JDR - fan project / page d'accueil officielle."
    },
    changelog: CHANGELOG
};

const state = {
    liveItems: [],
    eventSource: null,
    siteConfig: DEFAULT_SITE_CONFIG,
    profileOpen: false
};

const isSafeExternalUrl = value => typeof value === 'string' && /^https?:\/\//i.test(value.trim());
const isSafeRelativeUrl = value => typeof value === 'string' && value.trim().startsWith('/');
const isSafeMailto = value => typeof value === 'string' && /^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(value.trim());

const formatLastLogin = value => {
    if (!value || typeof value !== 'string') {
        return '--';
    }
    const ts = Date.parse(value);
    if (!Number.isFinite(ts)) {
        return '--';
    }
    try {
        return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ts));
    } catch (_error) {
        return new Date(ts).toLocaleString('fr-FR');
    }
};

const getLoginRedirect = () => '/auth/discord/login?redirect=%2Fmap%2F';

const ensureAdminEntryButton = () => {
    if (!dom.headerActions) {
        return null;
    }
    if (!dom.adminEntry) {
        const entry = document.createElement('a');
        entry.id = 'home-admin-entry';
        entry.className = 'home-link-button home-link-button-admin';
        entry.textContent = 'Admin accueil';
        entry.href = HOME_ADMIN_ENTRY_URL;
        entry.hidden = true;
        if (dom.login) {
            dom.headerActions.insertBefore(entry, dom.login);
        } else {
            dom.headerActions.appendChild(entry);
        }
        dom.adminEntry = entry;
    }
    return dom.adminEntry;
};

const escapeHtml = value => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const normalizeText = value => typeof value === 'string' ? value.trim() : '';

const stripMarkdown = value => normalizeText(value)
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*_>#~]+/g, ' ')
    .replace(/\n+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

const resolveLocationAssetUrl = value => {
    const next = normalizeText(value);
    if (!next) {
        return '';
    }
    if (isSafeExternalUrl(next) || isSafeRelativeUrl(next)) {
        return next;
    }
    if (/^(assets|images|uploads)\//i.test(next)) {
        return `/${next.replace(/^\/+/, '')}`;
    }
    return '';
};

const setLinkHref = (element, url, fallback) => {
    if (!element) {
        return;
    }
    const next = typeof url === 'string' ? url.trim() : '';
    if (isSafeExternalUrl(next) || isSafeRelativeUrl(next) || isSafeMailto(next)) {
        element.href = next;
        return;
    }
    element.href = fallback;
};

const resolveAssetUrl = (value, fallback) => {
    const next = typeof value === 'string' ? value.trim() : '';
    if (isSafeExternalUrl(next) || isSafeRelativeUrl(next)) {
        return next;
    }
    return fallback;
};

const setImageSource = (element, url, fallback) => {
    if (!element) {
        return;
    }
    element.src = resolveAssetUrl(url, fallback);
};

const applySiteConfig = config => {
    const merged = {
        ...DEFAULT_SITE_CONFIG,
        ...(config || {}),
        home: {
            ...DEFAULT_SITE_CONFIG.home,
            ...(config?.home || {}),
            visuals: {
                ...DEFAULT_SITE_CONFIG.home.visuals,
                ...(config?.home?.visuals || {})
            }
        },
        community: {
            ...DEFAULT_SITE_CONFIG.community,
            ...(config?.community || {}),
            discord: {
                ...DEFAULT_SITE_CONFIG.community.discord,
                ...(config?.community?.discord || {})
            },
            proof: {
                ...DEFAULT_SITE_CONFIG.community.proof,
                ...(config?.community?.proof || {})
            },
            youtube: {
                ...DEFAULT_SITE_CONFIG.community.youtube,
                ...(config?.community?.youtube || {})
            },
            reddit: {
                ...DEFAULT_SITE_CONFIG.community.reddit,
                ...(config?.community?.reddit || {})
            }
        },
        support: {
            ...DEFAULT_SITE_CONFIG.support,
            ...(config?.support || {})
        },
        legal: {
            ...DEFAULT_SITE_CONFIG.legal,
            ...(config?.legal || {})
        }
    };

    state.siteConfig = merged;
    applyHomeHero(merged.home);
    setLinkHref(dom.footerSupport, 'https://github.com/Daneisra/Carte-Hesta/issues/new/choose', 'https://github.com/Daneisra/Carte-Hesta/issues/new/choose');
    const contactValue = normalizeText(merged.support.contactEmail);
    const contactHref = contactValue.startsWith('mailto:') ? contactValue : `mailto:${contactValue}`;
    setLinkHref(dom.footerContact, contactHref, `mailto:${DEFAULT_SITE_CONFIG.support.contactEmail}`);
    setLinkHref(dom.donateLink, PAYPAL_DONATION_URL, PAYPAL_DONATION_URL);
    setLinkHref(dom.footerCredits, merged.legal.creditsUrl, DEFAULT_SITE_CONFIG.legal.creditsUrl);
    setTextContent(dom.footerVersion, APP_VERSION);
    setTextContent(dom.footerNote, merged.legal.footerNote || DEFAULT_SITE_CONFIG.legal.footerNote);
    renderHomeChangelog(mergeChangelog(merged.changelog), 'code+config');
};

const loadSiteConfig = async () => {
    try {
        const response = await fetch(SITE_CONFIG_URL, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const payload = await response.json();
        applySiteConfig(payload);
        await fetchHomeChangelog();
    } catch (error) {
        console.warn('[home] site config unavailable, fallback defaults used', error);
        applySiteConfig(DEFAULT_SITE_CONFIG);
        await fetchHomeChangelog();
    }
};

const readPreferencesState = () => {
    try {
        const raw = window.localStorage?.getItem(PREFERENCES_STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (_error) {
        return {};
    }
};

const writePreferencesState = nextState => {
    try {
        window.localStorage?.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(nextState || {}));
    } catch (_error) {
        // ignore storage errors on home page
    }
};

const readPreferencesSummary = () => {
    const parsed = readPreferencesState();
    const favorites = Array.isArray(parsed?.favorites)
        ? parsed.favorites.filter(name => typeof name === 'string' && name.trim())
        : [];
    const uniqueFavorites = Array.from(new Set(favorites.map(name => name.trim()).filter(Boolean)));
    const lastLocation = typeof parsed?.lastLocation === 'string' ? parsed.lastLocation.trim() : '';
    return { favorites: uniqueFavorites.length, lastLocation };
};

const focusLocationOnMap = locationName => {
    const target = normalizeText(locationName);
    if (!target) {
        window.location.href = '/map/';
        return;
    }
    const preferences = readPreferencesState();
    preferences.lastLocation = target;
    writePreferencesState(preferences);
    window.location.href = '/map/';
};

const setAuthNote = (message, tone = 'neutral') => {
    if (!dom.authNote) {
        return;
    }
    dom.authNote.textContent = message;
    dom.authNote.classList.remove('is-error', 'is-ok');
    if (tone === 'error') {
        dom.authNote.classList.add('is-error');
    }
    if (tone === 'ok') {
        dom.authNote.classList.add('is-ok');
    }
};

const applyAvatar = (avatarUrl, fallbackText) => {
    if (!dom.avatar) {
        return;
    }
    for (const element of [dom.avatar, dom.profileToggleAvatar]) setAvatarImage(element, avatarUrl, fallbackText);
};

const setProfilePopoverOpen = open => {
    state.profileOpen = Boolean(open) && !dom.profileToggle?.hidden;
    if (dom.profilePopover) {
        dom.profilePopover.hidden = !state.profileOpen;
    }
    if (dom.profileToggle) {
        dom.profileToggle.setAttribute('aria-expanded', state.profileOpen ? 'true' : 'false');
        dom.profileToggle.classList.toggle('is-open', state.profileOpen);
    }
};

const setStatusPill = (element, message, tone = 'neutral') => {
    if (!element) {
        return;
    }
    element.textContent = message;
    element.classList.remove('is-ok', 'is-error');
    if (tone === 'ok') {
        element.classList.add('is-ok');
    }
    if (tone === 'error') {
        element.classList.add('is-error');
    }
};

const setTextContent = (element, value) => {
    if (!element) {
        return;
    }
    element.textContent = normalizeText(value) || '';
};

const formatChangelogDate = value => {
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

const renderHomeChangelog = (entries, source = 'config') => {
    if (!dom.changelogList) {
        return;
    }
    const safeEntries = normalizeEntries(entries).slice(0, 3);
    if (!safeEntries.length) {
        dom.changelogList.innerHTML = '<li class="home-news-empty">Aucun patch note disponible pour le moment.</li>';
        setStatusPill(dom.changelogStatus, 'Vide', 'error');
        setTextContent(dom.changelogNote, 'Le changelog public reste accessible depuis la page dediee.');
        return;
    }
    dom.changelogList.innerHTML = safeEntries.map(entry => `
<li class="home-changelog-item">
    <div class="home-changelog-head">
        <strong>${escapeHtml(entry.title)}</strong>
        <span>${escapeHtml(formatChangelogDate(entry.date))}</span>
    </div>
    <p class="home-changelog-text">${escapeHtml(entry.summary)}</p>
</li>`).join('');
    setStatusPill(dom.changelogStatus, source === 'code' ? 'Code' : 'Code + Config', 'ok');
    setTextContent(dom.changelogNote, 'Versions, corrections et évolutions techniques de Carte Hesta. Notes maintenues dans le code et la configuration.');
};

const fetchHomeChangelog = async () => {
    if (!dom.changelogList) {
        return;
    }
    setStatusPill(dom.changelogStatus, 'Chargement...');
    const result = await loadChangelog({ limit: 3, config: state.siteConfig });
    renderHomeChangelog(result.entries, result.source);
    if (result.fallback) setStatusPill(dom.changelogStatus, 'Repli local', 'neutral');
};

const formatDisplayDate = value => {
    const formatted = formatLastLogin(value || '');
    if (formatted !== '--') {
        return formatted;
    }
    return normalizeText(value) || '--';
};

const renderHeroTags = tags => {
    if (!dom.heroTags) {
        return;
    }
    const items = Array.isArray(tags) ? tags.filter(Boolean).slice(0, 8) : [];
    dom.heroTags.innerHTML = items.length
        ? items.map(tag => `<span class="home-hero-tag">${escapeHtml(tag)}</span>`).join('')
        : '';
};

const renderHeroMetrics = metrics => {
    if (!dom.heroMetrics) {
        return;
    }
    const items = Array.isArray(metrics)
        ? metrics.filter(metric => normalizeText(metric?.label) && normalizeText(metric?.value)).slice(0, 6)
        : [];
    dom.heroMetrics.innerHTML = items.length
        ? items.map(metric => `
<div class="home-hero-metric">
    <span>${escapeHtml(metric.label)}</span>
    <strong>${escapeHtml(metric.value)}</strong>
</div>`).join('')
        : '';
};

const applyHomeHero = home => {
    const next = home && typeof home === 'object' ? home : DEFAULT_SITE_CONFIG.home;
    setTextContent(dom.heroKicker, next.kicker || DEFAULT_SITE_CONFIG.home.kicker);
    setTextContent(dom.heroTitle, next.title || DEFAULT_SITE_CONFIG.home.title);
    setTextContent(dom.heroLead, next.lead || DEFAULT_SITE_CONFIG.home.lead);
    setTextContent(dom.atmosphereCopy, next.atmosphere || DEFAULT_SITE_CONFIG.home.atmosphere);
    renderHeroTags(Array.isArray(next.tags) ? next.tags : DEFAULT_SITE_CONFIG.home.tags);
    renderHeroMetrics(Array.isArray(next.metrics) ? next.metrics : DEFAULT_SITE_CONFIG.home.metrics);
    setImageSource(dom.mapPreviewImage, next?.visuals?.mapPreviewImage, DEFAULT_SITE_CONFIG.home.visuals.mapPreviewImage);
    setImageSource(dom.characterArt, next?.visuals?.characterImage, DEFAULT_SITE_CONFIG.home.visuals.characterImage);
    setTextContent(dom.floatingTitle, next?.visuals?.floatingTitle || DEFAULT_SITE_CONFIG.home.visuals.floatingTitle);
    setTextContent(dom.floatingCopy, next?.visuals?.floatingCopy || DEFAULT_SITE_CONFIG.home.visuals.floatingCopy);
    const backgroundUrl = resolveAssetUrl(next?.visuals?.backgroundImage, DEFAULT_SITE_CONFIG.home.visuals.backgroundImage);
    document.documentElement.style.setProperty('--home-hero-bg-image', `url("${backgroundUrl}")`);
};

const renderStat = (valueNode, labelNode, value, label) => {
    setTextContent(valueNode, String(value ?? '0'));
    setTextContent(labelNode, label || '');
};

const renderNewsItems = events => {
    if (!dom.newsList) {
        return;
    }
    if (!Array.isArray(events) || events.length === 0) {
        dom.newsList.innerHTML = '<li class="home-news-empty">Aucune nouveaute recente pour le moment.</li>';
        renderStat(dom.statNewsValue, dom.statNewsLabel, 0, 'actualités du monde');
        return;
    }
    renderStat(dom.statNewsValue, dom.statNewsLabel, events.length, 'actualités du monde');
    dom.newsList.innerHTML = events.map(event => {
        const title = escapeHtml(event?.questId || event?.id || 'Quete');
        const location = escapeHtml(event?.locationName || 'Lieu inconnu');
        const status = escapeHtml(event?.status || 'inconnu');
        const milestone = escapeHtml(event?.milestone || '');
        const note = escapeHtml(event?.note || '');
        const date = escapeHtml(formatLastLogin(event?.updatedAt || event?.createdAt || ''));
        const metaSuffix = milestone ? ` · ${milestone}` : '';
        return `
<li class="home-news-item">
    <div class="home-news-head">
        <strong>${title}</strong>
        <span>${date}</span>
    </div>
    <p class="home-news-meta">${location} · ${status}${metaSuffix}</p>
    <p class="home-news-text">${note || 'Mise a jour de quete enregistree.'}</p>
</li>`;
    }).join('');
};

const renderLiveItems = items => {
    if (!dom.liveList) {
        return;
    }
    if (!Array.isArray(items) || items.length === 0) {
        dom.liveList.innerHTML = '<li class="home-news-empty">En attente d\'evenements live...</li>';
        return;
    }
    dom.liveList.innerHTML = items.map(item => `
<li class="home-live-item">
    <div class="home-live-head">
        <strong>${escapeHtml(item.title)}</strong>
        <span>${escapeHtml(item.time)}</span>
    </div>
    <p class="home-live-meta">${escapeHtml(item.meta)}</p>
</li>`).join('');
};

const pushLiveItem = item => {
    state.liveItems = [item, ...state.liveItems].slice(0, LIVE_ITEMS_LIMIT);
    renderLiveItems(state.liveItems);
};

const formatLiveItem = (eventName, payload) => {
    const time = formatLastLogin(new Date().toISOString());
    switch (eventName) {
        case 'quest.updated':
            return {
                title: `Quete mise a jour: ${payload?.event?.questId || payload?.event?.id || 'Quete'}`,
                meta: `${payload?.event?.locationName || 'Lieu inconnu'} · ${payload?.event?.status || 'statut inconnu'}`,
                time
            };
        case 'quest.deleted':
            return {
                title: `Quete retiree: ${payload?.id || 'inconnue'}`,
                meta: 'Suppression synchronisee dans le flux live.',
                time
            };
        case 'annotation.created':
            return {
                title: `Annotation ajoutee: ${payload?.annotation?.label || 'Annotation'}`,
                meta: payload?.annotation?.locationName || 'Nouvelle annotation en carte',
                time
            };
        case 'annotation.deleted':
            return {
                title: `Annotation supprimee: ${payload?.id || 'Annotation'}`,
                meta: 'Suppression diffusee en temps reel.',
                time
            };
        case 'locations.sync':
            return {
                title: 'Synchronisation des lieux',
                meta: `Creation ${payload?.diff?.created?.length || 0} · MAJ ${payload?.diff?.updated?.length || 0} · Suppression ${payload?.diff?.deleted?.length || 0}`,
                time
            };
        default:
            return {
                title: eventName || 'Evenement live',
                meta: 'Nouvel evenement recu depuis le serveur.',
                time
            };
    }
};

const refreshAuthorizedLiveItems = async () => {
    const generation = state.accessGeneration || 0;
    try {
        const responses = await Promise.all(['/api/quest-events', '/api/annotations'].map(url => fetch(url, { credentials: 'include', cache: 'no-store' })));
        if (responses.some(response => !response.ok)) throw new Error('Live view unavailable');
        const [quests, annotations] = await Promise.all(responses.map(response => response.json()));
        if (generation !== (state.accessGeneration || 0)) return;
        const items = [
            ...(quests.events || []).map(event => ({ title: 'Quete : ' + (event.questId || event.id || ''), meta: (event.locationName || '') + ' · ' + (event.status || ''), date: event.updatedAt || event.createdAt || '' })),
            ...(annotations.annotations || []).map(annotation => ({ title: 'Annotation : ' + (annotation.label || ''), meta: annotation.scope || '', date: annotation.createdAt || '' }))
        ].sort((left, right) => (Date.parse(right.date) || 0) - (Date.parse(left.date) || 0)).slice(0, LIVE_ITEMS_LIMIT);
        state.liveItems = items.map(item => ({ ...item, time: item.date ? formatLastLogin(item.date) : '' }));
        renderLiveItems(state.liveItems);
    } catch { if (generation === (state.accessGeneration || 0)) { state.liveItems = []; renderLiveItems([]); } }
};

const connectLiveFeed = () => {
    if (!dom.liveStatus || typeof window.EventSource !== 'function') {
        setStatusPill(dom.liveStatus, 'Indisponible', 'error');
        if (dom.liveNote) {
            dom.liveNote.textContent = 'Le navigateur ne supporte pas EventSource. Le flux live reste indisponible.';
        }
        return;
    }
    try {
        const source = new window.EventSource('/api/events/stream');
        state.eventSource = source;
        setStatusPill(dom.liveStatus, 'Connexion...');
        source.addEventListener('connected', () => {
            setStatusPill(dom.liveStatus, 'En direct', 'ok');
            if (dom.liveNote) {
                dom.liveNote.textContent = 'Connexion SSE etablie. Les derniers evenements live apparaitront ici.';
            }
        });
        source.addEventListener('permissions.changed', () => { state.accessGeneration = (state.accessGeneration || 0) + 1; state.liveItems = []; renderLiveItems([]); renderNewsItems([]); renderFeaturedLocations([]); fetchSession(); fetchQuestNews(); fetchFeaturedLocations(); refreshAuthorizedLiveItems(); });
        source.addEventListener('permissions.ready', () => { state.accessGeneration = (state.accessGeneration || 0) + 1; state.liveItems = []; renderLiveItems([]); renderNewsItems([]); renderFeaturedLocations([]); fetchSession(); fetchQuestNews(); fetchFeaturedLocations(); refreshAuthorizedLiveItems(); });
        source.addEventListener('heartbeat', () => {
            if (!state.liveItems.length) {
                renderLiveItems([]);
            }
        });
        ['quest.updated', 'quest.deleted', 'annotation.created', 'annotation.deleted', 'locations.sync'].forEach(eventName => {
            source.addEventListener(eventName, event => {
                let payload = {};
                try {
                    payload = event?.data ? JSON.parse(event.data) : {};
                } catch (_error) {
                    payload = {};
                }
                setStatusPill(dom.liveStatus, 'En direct', 'ok');
                pushLiveItem(formatLiveItem(eventName, payload));
            });
        });
        source.onerror = () => {
            setStatusPill(dom.liveStatus, 'Reconnexion...', 'error');
            if (dom.liveNote) {
                dom.liveNote.textContent = 'Le flux live tente de se reconnecter automatiquement.';
            }
        };
    } catch (error) {
        console.error('[home] live feed unavailable', error);
        setStatusPill(dom.liveStatus, 'Indisponible', 'error');
        if (dom.liveNote) {
            dom.liveNote.textContent = 'Impossible d ouvrir le flux live pour le moment.';
        }
    }
};

const scoreFeaturedLocation = entry => {
    let score = 0;
    if (Array.isArray(entry.images) && entry.images.length) {
        score += 3 + entry.images.length;
    }
    if (Array.isArray(entry.videos) && entry.videos.length) {
        score += 4 + entry.videos.length;
    }
    if (normalizeText(entry.audio)) {
        score += 3;
    }
    if (Array.isArray(entry.tags) && entry.tags.length) {
        score += 2 + entry.tags.length;
    }
    if (Array.isArray(entry.questEvents) && entry.questEvents.length) {
        score += 4 + entry.questEvents.length;
    }
    if (Array.isArray(entry.quests) && entry.quests.length) {
        score += 2 + entry.quests.length;
    }
    if (Array.isArray(entry.instances) && entry.instances.length) {
        score += 1;
    }
    if (Array.isArray(entry.pnjs) && entry.pnjs.length) {
        score += 1;
    }
    return score;
};

const renderFeaturedLocations = locations => {
    if (!dom.featuredList) {
        return;
    }
    if (!Array.isArray(locations) || locations.length === 0) {
        dom.featuredList.innerHTML = '<article class="home-featured-empty">Aucun lieu mis en avant disponible pour le moment.</article>';
        renderStat(dom.statFeaturedValue, dom.statFeaturedLabel, 0, 'lieux mis en avant');
        return;
    }
    renderStat(dom.statFeaturedValue, dom.statFeaturedLabel, locations.length, 'lieux mis en avant');
    dom.featuredList.innerHTML = locations.map(location => {
        const chips = [];
        if (location.type) {
            chips.push(`<span class="home-featured-chip">${escapeHtml(location.type)}</span>`);
        }
        if (location.continent) {
            chips.push(`<span class="home-featured-chip">${escapeHtml(location.continent)}</span>`);
        }
        if (Array.isArray(location.tags) && location.tags.length) {
            chips.push(...location.tags.slice(0, 2).map(tag => `<span class="home-featured-chip home-featured-chip-tag">${escapeHtml(tag)}</span>`));
        }
        const summary = [];
        if (location.audio) {
            summary.push('audio');
        }
        if (Array.isArray(location.images) && location.images.length) {
            summary.push(`${location.images.length} image${location.images.length > 1 ? 's' : ''}`);
        }
        if (Array.isArray(location.videos) && location.videos.length) {
            summary.push(`${location.videos.length} video${location.videos.length > 1 ? 's' : ''}`);
        }
        if (Array.isArray(location.questEvents) && location.questEvents.length) {
            summary.push(`${location.questEvents.length} evenement${location.questEvents.length > 1 ? 's' : ''}`);
        }
        if (Array.isArray(location.instances) && location.instances.length) {
            summary.push(`${location.instances.length} instance${location.instances.length > 1 ? 's' : ''}`);
        }
        const coverImage = resolveLocationAssetUrl(Array.isArray(location.images) && location.images.length ? location.images[0] : '');
        const description = stripMarkdown(location.description) || 'Ouvrez la carte pour explorer ce lieu plus en detail.';
        const excerpt = description.length > 150 ? `${description.slice(0, 150).trim()}...` : description;
        const mediaBadges = [];
        if (location.audio) {
            mediaBadges.push('<span class="home-featured-meta-pill">Audio</span>');
        }
        if (Array.isArray(location.images) && location.images.length) {
            mediaBadges.push(`<span class="home-featured-meta-pill">${location.images.length} image${location.images.length > 1 ? 's' : ''}</span>`);
        }
        if (Array.isArray(location.videos) && location.videos.length) {
            mediaBadges.push(`<span class="home-featured-meta-pill">${location.videos.length} video${location.videos.length > 1 ? 's' : ''}</span>`);
        }
        if (Array.isArray(location.questEvents) && location.questEvents.length) {
            mediaBadges.push(`<span class="home-featured-meta-pill">${location.questEvents.length} quete${location.questEvents.length > 1 ? 's' : ''}</span>`);
        }
        const fallbackMonogram = escapeHtml((location.name || '?').slice(0, 2).toUpperCase());
        return `
<article class="home-featured-card">
    <div class="home-featured-cover${coverImage ? '' : ' home-featured-cover-fallback'}">
        ${coverImage
            ? `<img src="${escapeHtml(coverImage)}" alt="${escapeHtml(location.name)}" loading="lazy" />`
            : `<span>${fallbackMonogram}</span>`}
    </div>
    <div class="home-featured-body">
        <div class="home-featured-topline">
            <span class="home-featured-continent">${escapeHtml(location.continent || 'Continent inconnu')}</span>
            <span class="home-featured-score">Score ${escapeHtml(String(location.__score || 0))}</span>
        </div>
        <h3>${escapeHtml(location.name)}</h3>
        <div class="home-featured-chips">${chips.join('')}</div>
        <p class="home-featured-text">${escapeHtml(excerpt)}</p>
    </div>
    <div class="home-featured-footer">
        <div class="home-featured-summary">
            ${mediaBadges.join('') || '<span class="home-featured-meta-pill">Exploration recommandee</span>'}
            <span class="home-featured-summary-text">${escapeHtml(summary.join(' · ') || 'Narratif, media ou quetes detectes')}</span>
        </div>
        <button class="home-cta home-cta-secondary home-featured-open" type="button" data-location-name="${escapeHtml(location.name)}">Explorer sur la carte</button>
    </div>
</article>`;
    }).join('');

    dom.featuredList.querySelectorAll('.home-featured-open').forEach(button => {
        button.addEventListener('click', () => {
            focusLocationOnMap(button.dataset.locationName || '');
        });
    });
};

const fetchFeaturedLocations = async () => {
    const generation = state.accessGeneration || 0;
    setStatusPill(dom.featuredStatus, 'Chargement...');
    try {
        const response = await fetch(LOCATIONS_DATA_URL, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const payload = await response.json();
        if (generation !== (state.accessGeneration || 0)) return;
        const flattened = [];
        Object.entries(payload || {}).forEach(([continent, entries]) => {
            if (!Array.isArray(entries)) {
                return;
            }
            entries.forEach(entry => {
                if (!entry || typeof entry !== 'object' || !normalizeText(entry.name)) {
                    return;
                }
                flattened.push({ ...entry, continent });
            });
        });
        const featured = flattened
            .map(entry => ({ ...entry, __score: scoreFeaturedLocation(entry) }))
            .filter(entry => entry.__score > 0)
            .sort((a, b) => b.__score - a.__score || a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }))
            .slice(0, 6);
        renderFeaturedLocations(featured);
        setStatusPill(dom.featuredStatus, featured.length ? `${featured.length} selectionnes` : 'A jour', 'ok');
        if (dom.featuredNote) {
            dom.featuredNote.textContent = featured.length
                ? 'Selection automatique de lieux avec bon potentiel narratif, media ou quetes a reprendre.'
                : 'Aucun lieu suffisamment riche n a ete detecte pour la mise en avant.';
        }
    } catch (error) {
        console.error('[home] featured locations fetch failed', error);
        renderFeaturedLocations([]);
        setStatusPill(dom.featuredStatus, 'Indisponible', 'error');
        if (dom.featuredNote) {
            dom.featuredNote.textContent = 'Impossible de charger les lieux mis en avant pour le moment.';
        }
    }
};

const fetchQuestNews = async () => {
    const generation = state.accessGeneration || 0;
    setStatusPill(dom.newsStatus, 'Chargement...');
    if (dom.newsNote) {
        dom.newsNote.textContent = 'Événements narratifs et avancées des quêtes dans le monde d’Hesta.';
    }
    try {
        const response = await fetch('/api/quest-events', { cache: 'no-store', credentials: 'include' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const payload = await response.json();
        if (generation !== (state.accessGeneration || 0)) return;
        const events = Array.isArray(payload?.events) ? payload.events : [];
        const sorted = events
            .slice()
            .sort((a, b) => Date.parse(b?.updatedAt || b?.createdAt || 0) - Date.parse(a?.updatedAt || a?.createdAt || 0))
            .slice(0, 5);
        renderNewsItems(sorted);
        setStatusPill(dom.newsStatus, sorted.length ? `${sorted.length} recentes` : 'A jour', 'ok');
        if (dom.newsNote) {
            dom.newsNote.textContent = sorted.length
                ? 'Apercu des derniers evenements de quete. Ouvrez la carte pour voir le flux complet.'
                : 'Aucun evenement de quete recent pour le moment.';
        }
    } catch (error) {
        console.error('[home] quest news fetch failed', error);
        renderNewsItems([]);
        setStatusPill(dom.newsStatus, 'API indisponible', 'error');
        if (dom.newsNote) {
            dom.newsNote.textContent = 'Impossible de charger les nouveautes (API /api/quest-events indisponible). Vous pouvez quand meme acceder a la carte.';
        }
    }
};

const updateResumeCard = ({ authenticated = false } = {}) => {
    if (!dom.resumeCard) {
        return;
    }
    dom.resumeCard.hidden = !authenticated;
    if (!authenticated) {
        return;
    }
    const summary = readPreferencesSummary();
    if (dom.resumeFavorites) {
        dom.resumeFavorites.textContent = String(summary.favorites);
    }
    if (dom.resumeLastLocation) {
        dom.resumeLastLocation.textContent = summary.lastLocation || '--';
    }
    if (dom.resumeNote) {
        dom.resumeNote.textContent = summary.favorites || summary.lastLocation
            ? 'Favoris et dernier lieu recuperes depuis vos preferences locales.'
            : 'Aucun repere local detecte pour le moment. Ouvrez la carte et ajoutez des favoris.';
    }
};

const setGuestState = (options = {}) => {
    const {
        authRequired = true,
        oauthDiscord = true,
        message = 'Connectez-vous pour modifier des lieux, gerer vos personnages et utiliser les outils admin.'
    } = options;
    dom.username.textContent = authRequired ? 'Invite' : 'Mode local';
    dom.role.textContent = authRequired ? 'Mode lecture' : 'Edition locale';
    dom.status.textContent = message;
    dom.provider.textContent = authRequired ? 'Invite' : 'Local';
    dom.discord.textContent = '--';
    dom.lastLogin.textContent = '--';
    applyAvatar('', authRequired ? '?' : 'L');
    dom.logout.hidden = true;
    dom.login.hidden = !authRequired || !oauthDiscord;
    if (dom.profileToggleName) {
        dom.profileToggleName.textContent = 'Profil';
    }
    if (dom.profileToggle) {
        dom.profileToggle.hidden = true;
    }
    const adminEntry = ensureAdminEntryButton();
    if (adminEntry) {
        adminEntry.hidden = true;
    }
    setProfilePopoverOpen(false);
    dom.adminLink.hidden = true;
    updateResumeCard({ authenticated: false });
};

const setAuthenticatedState = payload => {
    const username = (payload?.username || '').trim() || 'Utilisateur';
    const role = (payload?.role || 'user').toLowerCase() === 'admin' ? 'Administrateur' : 'Utilisateur';
    const isAdmin = role === 'Administrateur';
    const provider = payload?.provider === 'discord' ? 'Discord' : (payload?.provider || 'manuel');
    const discordId = (payload?.discordId || payload?.account?.discordId || '').toString().trim();
    dom.username.textContent = username;
    dom.role.textContent = role;
    dom.status.textContent = isAdmin
        ? 'Connecte. Vous pouvez acceder a la carte et aux outils d administration.'
        : 'Connecte. Vous pouvez acceder a vos personnages, groupes et a la carte.';
    dom.provider.textContent = provider;
    dom.discord.textContent = provider === 'Discord'
        ? (discordId || 'Compte Discord connecte')
        : '--';
    dom.lastLogin.textContent = formatLastLogin(payload?.account?.lastLoginAt || null);
    applyAvatar(payload?.avatar || '', username);
    dom.logout.hidden = false;
    dom.login.hidden = true;
    if (dom.profileToggleName) {
        dom.profileToggleName.textContent = username;
    }
    if (dom.profileToggle) {
        dom.profileToggle.hidden = false;
    }
    const adminEntry = ensureAdminEntryButton();
    if (adminEntry) {
        adminEntry.hidden = !isAdmin;
        adminEntry.href = HOME_ADMIN_ENTRY_URL;
    }
    dom.adminLink.hidden = !isAdmin;
    if (!dom.adminLink.hidden) {
        dom.adminLink.textContent = 'Admin accueil';
        dom.adminLink.href = HOME_ADMIN_ENTRY_URL;
    }
    updateResumeCard({ authenticated: true });
};

const fetchSession = async () => {
    setAuthNote('Verification de la session...');
    try {
        const response = await fetch('/auth/session', { credentials: 'include' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const payload = await response.json();
        const authRequired = payload?.authRequired !== false;
        const oauthDiscord = Boolean(payload?.oauth?.discord);
        if (payload?.authenticated) {
            setAuthenticatedState(payload);
            setAuthNote('Session active detectee.', 'ok');
        } else {
            const guestMessage = authRequired
                ? 'Connectez-vous via Discord pour debloquer les outils de contribution. La carte reste accessible sans connexion.'
                : 'Mode local detecte: acces direct a la carte disponible.';
            setGuestState({ authRequired, oauthDiscord, message: guestMessage });
            setAuthNote(guestMessage, authRequired ? 'neutral' : 'ok');
        }
        if (authRequired && !oauthDiscord) {
            setAuthNote('Discord OAuth n est pas configure. Acces lecture disponible.', 'error');
        }
    } catch (error) {
        console.error('[home] session fetch failed', error);
        setGuestState({ authRequired: true, oauthDiscord: true });
        setAuthNote('Impossible de verifier la session pour le moment.', 'error');
    }
};

const bindActions = () => {
    const login = () => {
        window.location.href = getLoginRedirect();
    };
    const closeProfileIfOutside = event => {
        if (!state.profileOpen) {
            return;
        }
        const target = event.target;
        if (dom.profilePopover?.contains(target) || dom.profileToggle?.contains(target)) {
            return;
        }
        setProfilePopoverOpen(false);
    };
    dom.login?.addEventListener('click', login);
    dom.profileToggle?.addEventListener('click', () => {
        if (dom.profileToggle.hidden) {
            return;
        }
        setProfilePopoverOpen(!state.profileOpen);
    });
    dom.logout?.addEventListener('click', async () => {
        dom.logout.disabled = true;
        try {
            await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
        } catch (error) {
            console.error('[home] logout failed', error);
        } finally {
            dom.logout.disabled = false;
        }
        setProfilePopoverOpen(false);
        await fetchSession();
    });
    document.addEventListener('pointerdown', closeProfileIfOutside);
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && state.profileOpen) {
            setProfilePopoverOpen(false);
            dom.profileToggle?.focus();
        }
    });
};

document.addEventListener('DOMContentLoaded', () => {
    document.body.classList.add('home-ready');
    if (dom.year) {
        dom.year.textContent = String(new Date().getFullYear());
    }
    if (dom.sessionMap) {
        dom.sessionMap.setAttribute('href', '/map/');
    }
    ensureAdminEntryButton();
    applySiteConfig(DEFAULT_SITE_CONFIG);
    bindActions();
    loadSiteConfig();
    fetchSession();
    fetchQuestNews();
    fetchFeaturedLocations();
    connectLiveFeed();
});
