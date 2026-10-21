import { setAvatarImage } from './ui/avatar.mjs';
import { UiState } from './ui/state.js';
import { FiltersManager } from './ui/filtersManager.js';
import { ThemeManager } from './ui/themeManager.js';
import { MapControlsManager } from './ui/mapControlsManager.js';
import { HistoryManager } from './ui/historyManager.js';
import { AudioManager } from './ui/audioManager.js';
import { InfoPanel } from './ui/infoPanel.js';
import { UserAdminPanel } from './ui/userAdminPanel.js';
import { AriaAnnouncer } from './ui/ariaAnnouncer.js';
import { renderMarkdown } from './ui/markdown.mjs';
import { qs, createElement, clearElement } from './ui/dom.js';
import {
    normalizeAdminSiteConfig as normalizeAdminSiteConfigModel,
    formatAdminSiteConfigTags as formatAdminSiteConfigTagsValue,
    formatAdminSiteConfigMetrics as formatAdminSiteConfigMetricsValue,
    formatAdminSiteConfigChangelog as formatAdminSiteConfigChangelogValue,
    parseAdminDelimitedLines as parseAdminDelimitedLinesValue,
    parseAdminMetrics as parseAdminMetricsValue,
    parseAdminChangelog as parseAdminChangelogValue,
    setAdminHomeStatus as setAdminHomeStatusPanel,
    renderAdminHomeErrors as renderAdminHomeErrorsPanel,
    syncAdminHomeEditor as syncAdminHomeEditorPanel,
    renderAdminSiteConfig as renderAdminSiteConfigPanel,
    collectAdminSiteConfigDraft as collectAdminSiteConfigDraftPanel,
    validateAdminSiteConfigDraft as validateAdminSiteConfigDraftModel,
    markAdminSiteConfigDirty as markAdminSiteConfigDirtyPanel,
    fetchAdminSiteConfig as fetchAdminSiteConfigPanel,
    saveAdminSiteConfig as saveAdminSiteConfigPanel
} from './ui/adminHome.js';
import {
    normalizeAdminTimeline as normalizeAdminTimelineModel,
    normalizeAdminTimelineEntry as normalizeAdminTimelineEntryModel,
    createAdminTimelineEntry as createAdminTimelineEntryModel,
    parseAdminTokenList as parseAdminTokenListValue,
    setAdminTimelineStatus as setAdminTimelineStatusPanel,
    renderAdminTimelineErrors as renderAdminTimelineErrorsPanel,
    syncAdminTimelineEditor as syncAdminTimelineEditorPanel,
    renderAdminTimelineConfig as renderAdminTimelineConfigPanel,
    renderAdminTimelineList as renderAdminTimelineListPanel,
    createAdminTimelineEntryCard as createAdminTimelineEntryCardPanel,
    addAdminTimelineEntry as addAdminTimelineEntryPanel,
    moveAdminTimelineEntry as moveAdminTimelineEntryPanel,
    removeAdminTimelineEntry as removeAdminTimelineEntryPanel,
    collectAdminTimelineDraft as collectAdminTimelineDraftPanel,
    validateAdminTimelineDraft as validateAdminTimelineDraftModel,
    markAdminTimelineDirty as markAdminTimelineDirtyPanel,
    fetchAdminTimeline as fetchAdminTimelinePanel,
    saveAdminTimeline as saveAdminTimelinePanel
} from './ui/adminTimeline.js';
import { LocationEditor } from './ui/locationEditor.js';
import { EventsFeed } from './ui/eventsFeed.js';
import {
    AVAILABILITY_DAYS,
    AVAILABILITY_SLOTS,
    createAvailabilityMatrix,
    normalizeAvailabilityPayload,
    resolveLocalTimezone
} from './ui/availability.mjs';
import {
    PROFILE_SOCIAL_LABELS,
    isValidAccentColor as isValidAccentColorValue,
    normalizeProfileCustomization as normalizeProfileCustomizationValue,
    normalizeProfileUrl as normalizeProfileUrlValue
} from './ui/profileCustomization.mjs';
import {
    createCharacterId as createCharacterIdValue,
    enforceSingleActiveCharacter as enforceSingleActiveCharacterValue,
    normalizeCharacterList as normalizeCharacterListValue
} from './ui/characterModel.mjs';
import {
    normalizeAnnotationColor as normalizeAnnotationColorValue,
    normalizeAnnotationId
} from './ui/annotationModel.mjs';
import { getString } from './i18n.js';
import {
    sanitizeString,
    normalizeLocation,
    normalizeDataset as normalizeSharedDataset,
    serializeTextGroup,
    serializeVideos,
    serializePnjs
} from './shared/locationSchema.mjs';
import {
    buildLocationIndex,
    prepareFilters,
    locationMatchesFilters,
    buildFilterFacets,
    normalizeFilterState
} from './shared/searchFilters.mjs';

const PAGE_SIZE = 8;
const KM_PER_PIXEL = 10;

const localized = (key, fallback = '', params = undefined) => {
    const resolved = params === undefined ? getString(key) : getString(key, params);
    if (!resolved || resolved === key) {
        return fallback;
    }
    return resolved;
};

const favoriteIconActive = () => localized('favorites.iconActive', '★');
const favoriteIconInactive = () => localized('favorites.iconInactive', '☆');
const toggleAllLabel = isExpanded => localized(
    isExpanded ? 'sidebar.toggleAllCollapse' : 'sidebar.toggleAllExpand',
    isExpanded ? 'Tout masquer' : 'Tout afficher'
);
const favoritesEmptyMessage = () => localized('favorites.empty', 'Aucun favori enregistre pour le moment.');
const favoritesFilteredHint = () => localized('favorites.filtered', 'Masque par les filtres actifs.');
const randomDisabledFavoritesMessage = () => localized('filters.randomDisabledFavorites', 'Aucun favori ne correspond aux filtres actuels.');
const randomDisabledDefaultMessage = () => localized('filters.randomDisabledDefault', 'Aucun lieu ne correspond aux filtres actuels.');
const clusteringIcon = clustered => clustered
    ? localized('clustering.iconOn', 'ON')
    : localized('clustering.iconOff', 'OFF');
const clusteringEmptyIcon = () => localized('clustering.iconEmpty', '-');
const CLUSTERING_TOOLTIP_SEPARATOR = ' - ';
const ADMIN_ENTRY_SECTION_IDS = {
    home: 'admin-section-home-config',
    timeline: 'admin-section-timeline-config'
};
const ADMIN_PANEL_SCOPES = new Set(['map', 'home', 'timeline']);
const normalizeAdminPanelScope = value => {
    const scope = sanitizeString(value).toLowerCase();
    return ADMIN_PANEL_SCOPES.has(scope) ? scope : 'map';
};
const resolveRequestedAdminSection = () => {
    if (typeof window === 'undefined' || !window.location?.search) {
        return '';
    }
    try {
        const params = new URLSearchParams(window.location.search);
        const section = sanitizeString(params.get('adminSection')).toLowerCase();
        return Object.prototype.hasOwnProperty.call(ADMIN_ENTRY_SECTION_IDS, section) ? section : '';
    } catch (_error) {
        return '';
    }
};
const isInteractiveTextField = element => {
    if (!element) {
        return false;
    }
    if (element.isContentEditable) {
        return true;
    }
    const tag = element.tagName;
    if (!tag) {
        return false;
    }
    const upper = tag.toUpperCase();
    return upper === 'INPUT' || upper === 'TEXTAREA' || element.getAttribute('role') === 'textbox';
};

export class UiController {
    constructor({
        mapController,
        preferences = null,
        sidebarId = 'sidebar',
        searchBarId = 'search-bar',
        clearSearchId = 'clear-search',
        filtersToggleId = 'filters-advanced-toggle',
        filtersPanelId = 'advanced-filters-panel',
        filterTypesId = 'filter-types',
        filterTagsId = 'filter-tags',
        filterStatusesId = 'filter-statuses',
        resetFiltersId = 'reset-filters',
        toggleAllButtonId = 'toggle-all-continents',
        infoSidebarId = 'info-sidebar',
        infoTitleId = 'info-title',
        descriptionTextId = 'description-text',
        descriptionContentId = 'description-content',
        imageGalleryId = 'image-gallery',
        audioPlayerId = 'audio-player',
        audioTitleId = 'audio-title',
        historyContainerId = 'history-container',
        historyListId = 'history-list',
        historyBackId = 'history-back',
        mapControlsId = 'map-controls'
    } = {}) {
        if (!mapController) {
            throw new Error('UiController requires a MapController instance.');
        }

        this.mapController = mapController;
        this.preferences = preferences;

        this.dom = {
            sidebar: document.getElementById(sidebarId),
            searchBar: document.getElementById(searchBarId),
            clearSearch: document.getElementById(clearSearchId),
            filtersToggle: document.getElementById(filtersToggleId),
            filtersPanel: document.getElementById(filtersPanelId),
            filterTypes: document.getElementById(filterTypesId),
            filterTags: document.getElementById(filterTagsId),
            filterStatuses: document.getElementById(filterStatusesId),
            resetFilters: document.getElementById(resetFiltersId),
            toggleAll: document.getElementById(toggleAllButtonId),
            resultsBadge: document.getElementById('search-results-count'),
            addLocation: document.getElementById('add-location'),
            profilePanel: document.getElementById('profile-panel'),
            profileButton: document.getElementById('profile-button'),
            profileLabel: document.getElementById('profile-label'),
            profileAvatar: document.getElementById('profile-avatar'),
            profileAvatarPanel: document.getElementById('profile-avatar-panel'),
            authPanel: document.getElementById('auth-panel'),
            authStatus: document.getElementById('auth-status'),
            authUsername: document.getElementById('auth-username'),
            authRole: document.getElementById('auth-role'),
            authPresence: document.getElementById('auth-presence'),
            profileIdentityCard: document.getElementById('profile-identity-card'),
            authGroups: document.getElementById('auth-groups'),
            authGroupsEmpty: document.getElementById('auth-groups-empty'),
            profileCustomization: document.getElementById('profile-customization'),
            profileCustomizationLocked: document.getElementById('profile-customization-locked'),
            profileCustomizationSave: document.getElementById('profile-customization-save'),
            profileCustomizationStatus: document.getElementById('profile-customization-status'),
            profileCustomizationErrors: document.getElementById('profile-customization-errors'),
            profileBanner: document.getElementById('profile-banner'),
            profileAccent: document.getElementById('profile-accent'),
            profileAccentPicker: document.getElementById('profile-accent-picker'),
            profileBioMarkdown: document.getElementById('profile-bio-markdown'),
            profileSocialWebsite: document.getElementById('profile-social-website'),
            profileSocialDiscord: document.getElementById('profile-social-discord'),
            profileSocialTwitch: document.getElementById('profile-social-twitch'),
            profileSocialYoutube: document.getElementById('profile-social-youtube'),
            profileSocialX: document.getElementById('profile-social-x'),
            profileBioPreview: document.getElementById('profile-bio-preview'),
            profileSocialPreview: document.getElementById('profile-social-preview'),
            profileSaveState: document.getElementById('profile-save-state'),
            profileSaveDetail: document.getElementById('profile-save-detail'),
            profileCustomizationState: document.getElementById('profile-customization-state'),
            profileCharactersState: document.getElementById('profile-characters-state'),
            profileAvailabilityState: document.getElementById('profile-availability-state'),
            profileEditHistory: document.getElementById('profile-edit-history'),
            characterSection: document.getElementById('profile-character'),
            characterLocked: document.getElementById('profile-character-locked'),
            characterSummary: document.getElementById('character-summary'),
            characterOpen: document.getElementById('character-open'),
            characterOverlay: document.getElementById('character-overlay'),
            characterClose: document.getElementById('character-close'),
            characterOverlayLocked: document.getElementById('character-overlay-locked'),
            characterErrors: document.getElementById('character-errors'),
            characterList: document.getElementById('character-list'),
            characterEmpty: document.getElementById('character-empty'),
            characterEmptyState: document.getElementById('character-empty-state'),
            characterEmptyCreate: document.getElementById('character-empty-create'),
            characterEmptyImport: document.getElementById('character-empty-import'),
            characterPageIndicator: document.getElementById('character-page-indicator'),
            characterCarouselPrev: document.getElementById('character-carousel-prev'),
            characterCarouselNext: document.getElementById('character-carousel-next'),
            characterFilterSearch: document.getElementById('character-filter-search'),
            characterFilterGroup: document.getElementById('character-filter-group'),
            characterFilterActive: document.getElementById('character-filter-active'),
            characterImport: document.getElementById('character-import'),
            characterImportFile: document.getElementById('character-import-file'),
            characterExport: document.getElementById('character-export'),
            characterAdd: document.getElementById('character-add'),
            characterDuplicate: document.getElementById('character-duplicate'),
            characterName: document.getElementById('character-name'),
            characterBio: document.getElementById('character-bio'),
            characterAvatar: document.getElementById('character-avatar'),
            characterGroup: document.getElementById('character-group'),
            characterActive: document.getElementById('character-active'),
            characterFormFields: document.getElementById('character-form-fields'),
            characterFormActions: document.getElementById('character-form-actions'),
            characterSave: document.getElementById('character-save'),
            characterDelete: document.getElementById('character-delete'),
            characterStatus: document.getElementById('character-status'),
            availabilityGrid: document.getElementById('availability-grid'),
            availabilitySave: document.getElementById('availability-save'),
            availabilityStatus: document.getElementById('availability-status'),
            availabilityTimezone: document.getElementById('availability-timezone'),
            quickThemeToggle: document.getElementById('quick-theme-toggle'),
            quickFavorites: document.getElementById('quick-favorites'),
            quickAdminUsers: document.getElementById('quick-admin-users'),
            quickAdminGroups: document.getElementById('quick-admin-groups'),
            profileAccountSecurity: document.getElementById('profile-account-security'),
            profileAccountOauth: document.getElementById('profile-account-oauth'),
            profileAccountProvider: document.getElementById('profile-account-provider'),
            profileAccountDiscord: document.getElementById('profile-account-discord'),
            profileAccountLastLogin: document.getElementById('profile-account-last-login'),
            profileRevokeSession: document.getElementById('profile-revoke-session'),
            profileRevokeStatus: document.getElementById('profile-revoke-status'),
            loginButton: document.getElementById('login-button'),
            logoutButton: document.getElementById('logout-button'),
            adminPanelButton: document.getElementById('quick-admin-panel'),
            clusteringToggle: document.getElementById('clustering-toggle'),
            clusteringMetrics: document.getElementById('clustering-metrics'),
            markerScaleInput: document.getElementById('marker-size'),
            markerScaleValue: document.getElementById('marker-size-value'),
            randomButton: document.getElementById('random-location'),
            tabAll: document.getElementById('tab-all-locations'),
            tabFavorites: document.getElementById('tab-favorites'),
            favoritesContainer: document.getElementById('favorites-container'),
            continentsContainer: document.getElementById('continents-container'),
            themeToggle: document.getElementById('theme-toggle'),
            infoSidebar: document.getElementById(infoSidebarId),
            editLocation: document.getElementById('edit-location'),
            infoTitle: document.getElementById(infoTitleId),
            descriptionText: document.getElementById(descriptionTextId),
            descriptionContent: document.getElementById(descriptionContentId),
            imageGallery: document.getElementById(imageGalleryId),
            historyContainer: document.getElementById(historyContainerId),
            historyList: document.getElementById(historyListId),
            historyBack: document.getElementById(historyBackId),
            mapControls: document.getElementById(mapControlsId),
            zoomIn: qs('#zoom-in'),
            zoomOut: qs('#zoom-out'),
            resetMap: qs('#reset-map'),
            fullscreen: qs('#fullscreen-map'),
            measureDistance: document.getElementById('measure-distance'),
            captureCoordinates: document.getElementById('capture-coordinates'),
            annotationButton: document.getElementById('annotation-mode'),
            temporaryPaintButton: document.getElementById('temporary-paint'),
            clearTemporaryPaintButton: document.getElementById('clear-temporary-paint'),
            zoomLevel: document.getElementById('zoom-level'),
            favoriteToggle: document.getElementById('favorite-toggle'),
            audioPlayer: document.getElementById(audioPlayerId),
            audioTitle: document.getElementById(audioTitleId),
            audioFallback: document.getElementById('audio-fallback'),
            audioStatus: document.getElementById('audio-status'),
            audioPlayToggle: document.getElementById('audio-play-toggle'),
            audioProgress: document.getElementById('audio-progress'),
            audioCurrent: document.getElementById('audio-current'),
            audioDuration: document.getElementById('audio-duration'),
            audioVolumeButton: document.getElementById('audio-volume-button'),
            audioVolume: document.getElementById('audio-volume'),
            audioLoop: document.getElementById('audio-loop'),
            audioDownload: document.getElementById('audio-download'),
            audioSpeed: document.getElementById('audio-speed'),
            locationEditor: document.getElementById('location-editor'),
            userAdminButton: document.getElementById('user-admin-button'),
            userAdminOverlay: document.getElementById('user-admin-overlay'),
            userAdminContainer: document.getElementById('user-admin-container'),
            eventsFeed: document.getElementById('events-feed'),
            eventsFeedList: document.getElementById('events-feed-list'),
            eventsFilter: document.getElementById('events-filter'),
            eventsFeedEmpty: document.getElementById('events-feed-empty'),
            validationWarnings: document.getElementById('validation-warnings'),
            validationWarningsList: document.getElementById('validation-warnings-list'),
            validationWarningsFootnote: document.getElementById('validation-warnings-footnote')
        };

        this.adminDom = {
            overlay: document.getElementById('admin-overlay'),
            dialog: document.getElementById('admin-dialog'),
            close: document.getElementById('admin-close'),
            status: document.getElementById('admin-auth-status'),
            userButton: document.getElementById('admin-user-button'),
            groupButton: document.getElementById('admin-group-button'),
            downloadAssetsButton: document.getElementById('download-assets-button'),
            homeReloadButton: document.getElementById('admin-home-reload'),
            homeSaveButton: document.getElementById('admin-home-save'),
            homeErrors: document.getElementById('admin-home-errors'),
            homeStatus: document.getElementById('admin-home-status'),
            homeKicker: document.getElementById('admin-home-kicker'),
            homeTitle: document.getElementById('admin-home-title'),
            homeLead: document.getElementById('admin-home-lead'),
            homeAtmosphere: document.getElementById('admin-home-atmosphere'),
            homeTags: document.getElementById('admin-home-tags'),
            homeMetrics: document.getElementById('admin-home-metrics'),
            homeBackgroundImage: document.getElementById('admin-home-background-image'),
            homeMapImage: document.getElementById('admin-home-map-image'),
            homeCharacterImage: document.getElementById('admin-home-character-image'),
            homeFloatingTitle: document.getElementById('admin-home-floating-title'),
            homeFloatingCopy: document.getElementById('admin-home-floating-copy'),
            homeDiscordUrl: document.getElementById('admin-home-discord-url'),
            homeDiscordTitle: document.getElementById('admin-home-discord-title'),
            homeDiscordCopy: document.getElementById('admin-home-discord-copy'),
            homeDiscordProofMode: document.getElementById('admin-home-discord-proof-mode'),
            homeDiscordGuildId: document.getElementById('admin-home-discord-guild-id'),
            homeDiscordManualCount: document.getElementById('admin-home-discord-manual-count'),
            homeDiscordProofLabel: document.getElementById('admin-home-discord-proof-label'),
            homeDiscordProofNote: document.getElementById('admin-home-discord-proof-note'),
            homeYoutubeUrl: document.getElementById('admin-home-youtube-url'),
            homeYoutubeTitle: document.getElementById('admin-home-youtube-title'),
            homeYoutubeCopy: document.getElementById('admin-home-youtube-copy'),
            homeRedditUrl: document.getElementById('admin-home-reddit-url'),
            homeRedditTitle: document.getElementById('admin-home-reddit-title'),
            homeRedditCopy: document.getElementById('admin-home-reddit-copy'),
            homeSupportUrl: document.getElementById('admin-home-support-url'),
            homeContactEmail: document.getElementById('admin-home-contact-email'),
            homeCreditsUrl: document.getElementById('admin-home-credits-url'),
            homeFooterNote: document.getElementById('admin-home-footer-note'),
            homeChangelog: document.getElementById('admin-home-changelog'),
            timelineReloadButton: document.getElementById('admin-timeline-reload'),
            timelineSaveButton: document.getElementById('admin-timeline-save'),
            timelineErrors: document.getElementById('admin-timeline-errors'),
            timelineStatus: document.getElementById('admin-timeline-status'),
            timelineTitle: document.getElementById('admin-timeline-title'),
            timelineSubtitle: document.getElementById('admin-timeline-subtitle'),
            timelineAddEntryButton: document.getElementById('admin-timeline-add-entry'),
            timelineList: document.getElementById('admin-timeline-list'),
            timelineCount: document.getElementById('admin-timeline-count'),
            timelineEmpty: document.getElementById('admin-timeline-empty'),
            liveMetrics: document.getElementById('admin-live-metrics'),
            liveEmpty: document.getElementById('admin-live-empty'),
            validationWarnings: document.getElementById('admin-validation-warnings'),
            validationWarningsList: document.getElementById('admin-validation-list'),
            validationWarningsFootnote: document.getElementById('admin-validation-footnote'),
            descriptionAuditRefresh: document.getElementById('admin-description-audit-refresh'),
            descriptionAuditSummary: document.getElementById('admin-description-audit-summary'),
            descriptionAuditList: document.getElementById('admin-description-audit-list'),
            descriptionAuditEmpty: document.getElementById('admin-description-audit-empty'),
            telemetryList: document.getElementById('admin-telemetry-list'),
            telemetryEmpty: document.getElementById('admin-telemetry-empty')
        };

        this.announcer = new AriaAnnouncer({
            politeNode: qs('#aria-status'),
            assertiveNode: qs('#aria-alert')
        });

        this.locationEditor = null;
        this.userAdminPanel = null;
        this.userAdminMode = 'users';
        this.locationsData = {};

        this.state = new UiState({
            filters: this.preferences?.getFilters?.(),
            favorites: this.preferences?.getFavorites?.(),
            theme: this.preferences?.getTheme?.()
        });

        this.authRequired = true;
        this.auth = {
            authenticated: false,
            role: 'guest',
            username: '',
            avatar: null,
            provider: null,
            discordId: null,
            groups: [],
            groupDetails: [],
            characters: [],
            availability: null,
            profile: null,
            account: { lastLoginAt: null, lastSeenAt: null }
        };

        this.pageSize = PAGE_SIZE;
        this.entries = [];
        this.continents = new Map();
        this.activeEntry = null;
        this.toggleAllState = false;
        this.typeData = {};
        this.boundKeyboardShortcuts = false;
        this.isProfileOpen = false;
        this.isCharacterOverlayOpen = false;
        this.boundProfileClickHandler = null;
        this.boundProfileKeyHandler = null;
        this.characterFormDirty = false;
        this.characterSyncPending = false;
        this.charactersDirty = false;
        this.characterDraftMode = false;
        this.profileCharacters = [];
        this.activeCharacterId = null;
        this.characterFilterSearch = '';
        this.characterFilterGroup = '';
        this.characterFilterActive = 'all';
        this.characterPageIndex = 0;
        this.characterPageSize = 6;
        this.profileCustomization = null;
        this.profileCustomizationDirty = false;
        this.profileCustomizationPending = false;
        this.profileCustomizationInlineErrors = [];
        this.characterInlineErrors = [];
        this.availabilitySyncPending = false;
        this.profileFeedback = {
            state: 'idle',
            detail: 'Aucune modification en attente.',
            history: []
        };
        this.availability = null;
        this.availabilityDirty = false;
        this.availabilityTimezone = resolveLocalTimezone();
        this.adminMetrics = null;
        this.adminMetricsInterval = null;
        this.adminSiteConfig = null;
        this.adminSiteConfigSource = 'unloaded';
        this.adminSiteConfigDirty = false;
        this.adminSiteConfigPending = false;
        this.adminSiteConfigErrors = [];
        this.adminTimeline = null;
        this.adminTimelineDirty = false;
        this.adminTimelinePending = false;
        this.adminTimelineErrors = [];
        this.adminDescriptionAudit = null;
        this.adminDescriptionAuditPending = false;
        this.adminPanelScope = 'map';
        this.requestedAdminSection = resolveRequestedAdminSection();
        this.hasHandledRequestedAdminSection = false;
        this.mapClickUnsubscribe = null;
        this.tooltipMeta = new WeakMap();
        this.visibleTooltips = new Set();
        this.realtimeSource = null;
        this.realtimeCleanup = null;
        this.annotations = new Map();
        this.questEvents = new Map();
        this.questEventsLoaded = false;
        this.groups = [];
        this.filterFacets = { types: [], tags: [], statuses: [], quests: { with: 0, without: 0 } };
        this.annotationTool = {
            active: false,
            clickUnsubscribe: null
        };
        this.groupPlacement = {
            active: false,
            group: null,
            clickUnsubscribe: null
        };
        this.latestValidationWarnings = [];

        this.historyManager = new HistoryManager({
            container: this.dom.historyContainer,
            listElement: this.dom.historyList,
            backButton: this.dom.historyBack
        });

        this.eventsFeed = new EventsFeed({
            container: this.dom.eventsFeed,
            listElement: this.dom.eventsFeedList,
            filterSelect: this.dom.eventsFilter,
            emptyState: this.dom.eventsFeedEmpty
        });

        this.audioManager = new AudioManager({
            player: this.dom.audioPlayer,
            titleElement: this.dom.audioTitle,
            container: qs('#audio-container'),
            fallbackButton: this.dom.audioFallback,
            statusElement: this.dom.audioStatus,
            playToggle: this.dom.audioPlayToggle,
            progressBar: this.dom.audioProgress,
            currentLabel: this.dom.audioCurrent,
            durationLabel: this.dom.audioDuration,
            volumeButton: this.dom.audioVolumeButton,
            volumeSlider: this.dom.audioVolume,
            loopToggle: this.dom.audioLoop,
            downloadLink: this.dom.audioDownload,
            speedSelect: this.dom.audioSpeed
        });

        this.infoPanel = new InfoPanel({
            sidebar: this.dom.infoSidebar,
            titleElement: this.dom.infoTitle,
            descriptionElement: this.dom.descriptionText,
            descriptionContainer: this.dom.descriptionContent,
            galleryElement: this.dom.imageGallery,
            historySection: qs('#history-section'),
            questsSection: qs('#quests-section'),
            pnjsSection: qs('#pnjs-section'),
            loreSection: qs('#lore-section'),
            timelineSection: qs('#timeline-section'),
            instancesSection: qs('#instances-section'),
            nobleFamiliesSection: qs('#noble-families-section'),
            audioManager: this.audioManager,
            closeButton: qs('#close-info-sidebar'),
            lightbox: {
                container: qs('#media-lightbox'),
                image: qs('#media-lightbox-image'),
                caption: qs('#media-lightbox-caption'),
                closeButton: qs('#media-lightbox-close')
            }
        });
        this.favoriteTooltip = this.createTooltip(localized(
            'onboarding.favoritesHint',
            'Ajoutez vos lieux preferes pour y revenir rapidement.'
        ));
        this.favoriteOnboardingTooltip = this.createTooltip(localized(
            'onboarding.favoritesHint',
            'Ajoutez vos lieux preferes pour y revenir rapidement.'
        ), { persistent: true, key: 'favorites' });
        this.clusteringTooltip = this.createTooltip(localized(
            'onboarding.clusteringHint',
            'Activez le regroupement pour fluidifier la carte lorsque le zoom est eloigne.'
        ));
        this.clusteringOnboardingTooltip = this.createTooltip(localized(
            'onboarding.clusteringHint',
            'Activez le regroupement pour fluidifier la carte lorsque le zoom est eloigne.'
        ), { persistent: true, key: 'clustering' });
        this.measurement = { active: false, points: [] };
        this.measurementClickUnsubscribe = null;
        this.coordinateTool = { active: false };
        this.coordinateClickUnsubscribe = null;
        this.temporaryPaintTool = { active: false };
        this.temporaryPaintClickUnsubscribe = null;
        this.measureTooltip = this.createTooltip('', { persistent: false });
        this.coordinateTooltip = this.createTooltip('', { persistent: false });
        this.annotationTooltip = this.createTooltip('', { persistent: false });
        this.temporaryPaintTooltip = this.createTooltip('', { persistent: false });
        this.controlTooltipTimeouts = new Map();

        this.filtersManager = new FiltersManager({
            state: this.state,
            searchInput: this.dom.searchBar,
            clearButton: this.dom.clearSearch,
            resetButton: this.dom.resetFilters,
            resultsBadge: this.dom.resultsBadge,
            advancedToggle: this.dom.filtersToggle,
            advancedPanel: this.dom.filtersPanel,
            typeContainer: this.dom.filterTypes,
            tagContainer: this.dom.filterTags,
            statusContainer: this.dom.filterStatuses,
            onFiltersChanged: filters => {
                if (this.preferences?.setFilters) {
                    this.preferences.setFilters(filters);
                }
                this.applyFilters();
            }
        });

        this.themeManager = new ThemeManager({
            buttons: this.dom.themeToggle ? Array.from(this.dom.themeToggle.querySelectorAll('[data-theme]')) : [],
            state: this.state,
            preferences: this.preferences
        });

        this.mapControlsManager = new MapControlsManager({
            mapController: this.mapController,
            zoomInButton: this.dom.zoomIn,
            zoomOutButton: this.dom.zoomOut,
            resetButton: this.dom.resetMap,
            fullscreenButton: this.dom.fullscreen,
            zoomDisplay: this.dom.zoomLevel,
            preferences: this.preferences
        });
        this.handleTooltipReposition = () => this.repositionVisibleTooltips();
        window.addEventListener('resize', this.handleTooltipReposition);
        window.addEventListener('scroll', this.handleTooltipReposition, { capture: true, passive: true });
    }

    createTooltip(message, { persistent = false, key = null } = {}) {
        const classes = persistent ? 'ui-tooltip ui-tooltip--persistent' : 'ui-tooltip';
        const tooltip = createElement('div', {
            className: classes,
            attributes: { role: 'tooltip', 'aria-hidden': 'true' }
        });
        const text = createElement('span', { className: 'ui-tooltip-text', text: message });
        tooltip.appendChild(text);
        let dismissButton = null;
        if (persistent) {
            dismissButton = createElement('button', {
                className: 'ui-tooltip-dismiss',
                text: localized('onboarding.gotIt', 'Compris'),
                attributes: { type: 'button' }
            });
            tooltip.appendChild(dismissButton);
            dismissButton.addEventListener('click', () => {
                if (key) {
                    this.dismissOnboarding(key);
                } else {
                    this.hideTooltip(tooltip);
                }
            });
        }
        tooltip.hidden = true;
        document.body.appendChild(tooltip);
        this.tooltipMeta.set(tooltip, {
            persistent,
            key,
            target: null,
            placement: 'top',
            dismissButton
        });
        return tooltip;
    }

    attachHoverTooltip(target, tooltip, options = {}) {
        if (!target || !tooltip) {
            return;
        }
        const show = () => this.showTooltip(target, tooltip, options);
        const hide = () => this.hideTooltip(tooltip);
        target.addEventListener('mouseenter', show);
        target.addEventListener('focusin', show);
        target.addEventListener('mouseleave', hide);
        target.addEventListener('focusout', hide);
    }

    showTooltip(target, tooltip, { placement = 'top', persistent = null } = {}) {
        if (!target || !tooltip) {
            return;
        }
        const meta = this.tooltipMeta.get(tooltip);
        if (!meta) {
            return;
        }
        const isPersistent = persistent !== null ? persistent : Boolean(meta.persistent);
        this.tooltipMeta.set(tooltip, { ...meta, target, placement, persistent: meta.persistent });
        tooltip.dataset.placement = placement;
        tooltip.setAttribute('aria-hidden', 'false');
        tooltip.hidden = false;
        tooltip.classList.add('is-visible');
        tooltip.classList.toggle('is-persistent', isPersistent);
        requestAnimationFrame(() => {
            this.positionTooltip(target, tooltip, placement);
        });
        this.visibleTooltips.add(tooltip);
    }

    hideTooltip(tooltip) {
        if (!tooltip) {
            return;
        }
        tooltip.classList.remove('is-visible');
        tooltip.classList.remove('is-persistent');
        tooltip.setAttribute('aria-hidden', 'true');
        tooltip.hidden = true;
        this.visibleTooltips.delete(tooltip);
        const meta = this.tooltipMeta.get(tooltip);
        if (meta) {
            this.tooltipMeta.set(tooltip, { ...meta, target: null });
        }
    }

    positionTooltip(target, tooltip, placement = 'top') {
        if (!target || !tooltip.classList.contains('is-visible')) {
            return;
        }
        const rect = target.getBoundingClientRect();
        const spacing = 10;
        const tooltipRect = tooltip.getBoundingClientRect();
        let top = rect.top - tooltipRect.height - spacing;
        let left = rect.left + (rect.width - tooltipRect.width) / 2;

        if (placement === 'bottom') {
            top = rect.bottom + spacing;
        } else if (placement === 'left') {
            top = rect.top + (rect.height - tooltipRect.height) / 2;
            left = rect.left - tooltipRect.width - spacing;
        } else if (placement === 'right') {
            top = rect.top + (rect.height - tooltipRect.height) / 2;
            left = rect.right + spacing;
        }

        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        left = Math.max(8, Math.min(left, viewportWidth - tooltipRect.width - 8));
        top = Math.max(8, Math.min(top, viewportHeight - tooltipRect.height - 8));

        tooltip.style.top = `${Math.round(top)}px`;
        tooltip.style.left = `${Math.round(left)}px`;
    }

    repositionVisibleTooltips() {
        this.visibleTooltips.forEach(tooltip => {
            const meta = this.tooltipMeta.get(tooltip);
            if (meta?.target && meta.target.isConnected) {
                this.positionTooltip(meta.target, tooltip, meta.placement || 'top');
            } else if (meta) {
                this.hideTooltip(tooltip);
            }
        });
    }

    hasSeenOnboarding(step) {
        return Boolean(this.preferences?.hasSeenOnboarding?.(step));
    }

    markOnboardingSeen(step) {
        if (!step) {
            return;
        }
        this.preferences?.setOnboardingSeen?.(step, true);
    }

    dismissOnboarding(step) {
        if (!step) {
            return;
        }
        const tooltip = step === 'favorites'
            ? this.favoriteOnboardingTooltip
            : step === 'clustering'
                ? this.clusteringOnboardingTooltip
                : null;
        if (tooltip) {
            this.hideTooltip(tooltip);
        }
        if (step === 'favorites') {
            this.hideTooltip(this.favoriteTooltip);
        }
        if (step === 'clustering') {
            this.hideTooltip(this.clusteringTooltip);
        }
        this.markOnboardingSeen(step);
    }

    maybeShowClusteringOnboarding() {
        if (this.hasSeenOnboarding('clustering')) {
            return;
        }
        const toggle = this.dom.clusteringToggle;
        if (!toggle) {
            return;
        }
        const anchor = toggle.closest('#clustering-container') || toggle;
        setTimeout(() => {
            if (this.hasSeenOnboarding('clustering') || !anchor?.isConnected) {
                return;
            }
            this.hideTooltip(this.clusteringTooltip);
            this.showTooltip(anchor, this.clusteringOnboardingTooltip, { placement: 'bottom', persistent: true });
        }, 600);
    }

    maybeShowFavoritesOnboarding() {
        if (this.hasSeenOnboarding('favorites')) {
            return;
        }
        if (!this.dom.favoriteToggle || !this.dom.favoriteToggle.isConnected || !this.dom.infoSidebar?.classList.contains('open')) {
            return;
        }
        this.hideTooltip(this.favoriteTooltip);
        this.showTooltip(this.dom.favoriteToggle, this.favoriteOnboardingTooltip, { placement: 'left', persistent: true });
    }

    initialize({ typeData, locationsData, issues = [] }) {
        this.typeData = typeData || {};
        this.mapController.setTypeData(this.typeData);
        this.locationsData = normalizeSharedDataset(locationsData || {}, { sanitizeKeys: true });
        const bootstrapQuestEvents = this.collectQuestEventsFromDataset();
        const warningMessages = Array.isArray(issues)
            ? issues
                .filter(issue => issue?.level === 'warning')
                .map(issue => issue.message)
                .filter(Boolean)
            : [];
        if (warningMessages.length) {
            this.updateValidationWarnings(warningMessages);
        } else {
            this.updateValidationWarnings([]);
        }
        if (bootstrapQuestEvents.length) {
            this.applyQuestEventBootstrap(bootstrapQuestEvents);
        } else {
            this.questEventsLoaded = true;
        }

        this.applyLocalization();
        this.themeManager.initialize();
        this.mapControlsManager.initialize();
        this.audioManager.initialize();
        this.infoPanel.initialize({ onClose: () => this.handlePanelClosed() });
        this.historyManager.initialize({ onSelect: item => this.handleHistorySelect(item) });
        this.eventsFeed.initialize({
            onDeleteAnnotation: id => this.requestAnnotationDeletion(id),
            canDeleteAnnotation: () => this.isAdmin()
        });
        this.filtersManager.initialize();
        this.bindAuthPanel();

        this.bindTabs();
        this.bindToggleAll();
        this.bindClustering();
        this.bindMarkerScale();
        this.bindLocationLinks();
        this.bindFavoriteToggle();
        this.bindRandomButton();
        this.bindMeasurementTool();
        this.bindCoordinateTool();
        this.bindAnnotationTool();
        this.bindTemporaryPaintTool();
        this.bindMapKeyboardShortcuts();
        this.bindMapBackgroundDismissal();

        this.setupLocationEditor();
        this.setupUserAdminPanel();
        this.bindAdminPanel();
        this.bindAssetsDownloadButton();
        this.updateAuthUI();
        this.closeAdminPanel(true);
        this.buildSidebar(this.locationsData);
        this.refreshFilterMetadata({ reapply: false });
        this.restoreMapState();

        this.state.sidebarView = 'all';
        this.applyFilters();
        this.renderFavoritesView();
        this.updateSidebarView();
        this.updateClusteringMetrics();
        this.updateRandomButtonState();
        this.restoreLastLocation();
        this.setupRealtimeStream();

        this.mapController.onMapStateChange(state => {
            if (this.preferences?.setMapState) {
                this.preferences.setMapState(state);
            }
            this.state.mapState = state;
        });

        this.loadRealtimeData();
        this.maybeShowClusteringOnboarding();
    }

    logTelemetryEvent({ title = 'Erreur requete', description = '', route = '', method = '', status = null, meta = {} } = {}) {
        if (!this.eventsFeed) {
            return;
        }
        const details = [];
        const normalizedMethod = method ? method.toUpperCase() : '';
        if (normalizedMethod || route) {
            details.push([normalizedMethod, route].filter(Boolean).join(' '));
        }
        if (status) {
            details.push(`HTTP ${status}`);
        }
        const parts = [];
        if (description) {
            parts.push(description);
        }
        if (details.length) {
            parts.push(details.join(' | '));
        }
        this.eventsFeed.addEvent({
            type: 'telemetry',
            title,
            description: parts.join(' - ') || 'Incident admin',
            timestamp: new Date().toISOString(),
            meta: { ...meta, status, route, method: normalizedMethod }
        });
    }

    applyLocalization() {
        if (this.dom.sidebar) {
            const title = this.dom.sidebar.querySelector('h2');
            if (title) {
                title.textContent = localized('sidebar.title', title.textContent || 'Exploration');
            }
        }

        if (this.dom.toggleAll) {
            const label = localized('sidebar.toggleAll', this.dom.toggleAll.textContent?.trim() || 'Tout masquer/afficher');
            this.dom.toggleAll.textContent = label;
            this.dom.toggleAll.title = label;
            this.dom.toggleAll.setAttribute('aria-label', label);
        }

        if (this.dom.tabAll) {
            const label = localized('sidebar.tabs.all', this.dom.tabAll.textContent || 'Tous les lieux');
            this.dom.tabAll.textContent = label;
            this.dom.tabAll.setAttribute('aria-label', label);
        }

        if (this.dom.tabFavorites) {
            const label = localized('sidebar.tabs.favorites', this.dom.tabFavorites.textContent || 'Favoris');
            this.dom.tabFavorites.textContent = label;
            this.dom.tabFavorites.setAttribute('aria-label', label);
        }

        if (this.dom.filtersToggle) {
            const label = localized('filters.advancedShow', this.dom.filtersToggle.textContent || 'Filtres avancés');
            this.dom.filtersToggle.textContent = label;
        }

        const typesLegend = document.getElementById('filter-types-label');
        if (typesLegend) {
            typesLegend.textContent = localized('filters.typesLabel', typesLegend.textContent || 'Types');
        }
        const tagsLegend = document.getElementById('filter-tags-label');
        if (tagsLegend) {
            tagsLegend.textContent = localized('filters.tagsLabel', tagsLegend.textContent || 'Tags');
        }
        const questsLegend = document.getElementById('filter-quests-label');
        if (questsLegend) {
            questsLegend.textContent = localized('filters.questsLabel', questsLegend.textContent || 'Présence de quêtes');
        }
        const statusesLegend = document.getElementById('filter-statuses-label');
        if (statusesLegend) {
            statusesLegend.textContent = localized('filters.statusesLabel', statusesLegend.textContent || "Statuts d'évènement");
        }

        const typesEmpty = this.dom.filtersPanel?.querySelector('[data-empty="types"]');
        if (typesEmpty) {
            typesEmpty.textContent = localized('filters.empty.types', typesEmpty.textContent || 'Aucun type disponible');
        }
        const tagsEmpty = this.dom.filtersPanel?.querySelector('[data-empty="tags"]');
        if (tagsEmpty) {
            tagsEmpty.textContent = localized('filters.empty.tags', tagsEmpty.textContent || 'Aucun tag disponible');
        }
        const statusesEmpty = this.dom.filtersPanel?.querySelector('[data-empty="statuses"]');
        if (statusesEmpty) {
            statusesEmpty.textContent = localized('filters.empty.statuses', statusesEmpty.textContent || 'Aucun statut disponible');
        }

        if (this.dom.randomButton) {
            const icon = localized('icons.random', this.dom.randomButton.textContent || '?');
            this.dom.randomButton.textContent = icon;
            this.dom.randomButton.setAttribute('aria-label', localized('filters.randomAria', 'Choisir un lieu aleatoire'));
            this.dom.randomButton.title = localized('filters.randomHint', 'Selectionner un lieu aleatoire.');
        }

        if (this.dom.favoriteToggle) {
            const label = localized('favorites.add', 'Ajouter aux favoris');
            this.dom.favoriteToggle.textContent = favoriteIconInactive();
            this.dom.favoriteToggle.title = label;
            this.dom.favoriteToggle.setAttribute('aria-label', label);
            this.dom.favoriteToggle.setAttribute('aria-pressed', 'false');
            this.dom.favoriteToggle.disabled = true;
        }

        this.updateMeasurementButton();
        this.updateCoordinateButton();
    }
    setupLocationEditor() {
        if (!this.dom.locationEditor) {
            return;
        }
        this.locationEditor = new LocationEditor({
            container: this.dom.locationEditor,
            types: this.typeData,
            onCreate: payload => this.handleCreateLocation(payload),
            onUpdate: payload => this.handleUpdateLocation(payload),
            onDelete: payload => this.handleDeleteLocation(payload),
            onGenerateDescription: payload => this.generateLocationDescription(payload),
            onCreateQuestEvent: payload => this.createQuestEvent(payload),
            onUpdateQuestEvent: payload => this.updateQuestEvent(payload),
            onDeleteQuestEvent: eventId => this.deleteQuestEvent(eventId)
        });
        this.locationEditor.setTypes(this.typeData);
        if (this.dom.addLocation) {
            this.dom.addLocation.addEventListener('click', () => {
                if (!this.isAdmin()) {
                    this.announcer?.assertive?.('Connexion administrateur requise.');
                    return;
                }
                this.openCreateLocation();
            });
        }
        if (this.dom.editLocation) {
            this.dom.editLocation.disabled = true;
            this.dom.editLocation.addEventListener('click', () => {
                if (!this.isAdmin()) {
                    this.announcer?.assertive?.('Connexion administrateur requise.');
                    return;
                }
                this.openEditLocation();
            });
        }
        this.updateEditButton(null);
    }

    sortStateDataset() {
        const sorted = {};
        Object.keys(this.locationsData || {})
            .sort((a, b) => sanitizeString(a).localeCompare(sanitizeString(b), 'fr', { sensitivity: 'base' }))
            .forEach(continent => {
                const entries = Array.isArray(this.locationsData[continent]) ? this.locationsData[continent] : [];
                const ordered = [...entries].sort((a, b) => sanitizeString(a.name).localeCompare(sanitizeString(b.name), 'fr', { sensitivity: 'base' }));
                sorted[continent] = ordered;
            });
        this.locationsData = sorted;
    }

    prepareLocationForPersist(location) {
        const normalized = normalizeLocation(location);
        return {
            name: normalized.name,
            type: normalized.type,
            x: Math.round(normalized.x) || 0,
            y: Math.round(normalized.y) || 0,
            description: normalized.description,
            images: normalized.images,
            videos: serializeVideos(normalized.videos),
            audio: normalized.audio || '',
            history: serializeTextGroup(normalized.history),
            quests: serializeTextGroup(normalized.quests),
            lore: serializeTextGroup(normalized.lore),
            instances: serializeTextGroup(normalized.instances),
            nobleFamilies: serializeTextGroup(normalized.nobleFamilies),
            pnjs: serializePnjs(normalized.pnjs),
            tags: normalized.tags
        };
    }

    prepareLocationsForPersist(dataset) {
        const result = {};
        Object.keys(dataset || {})
            .sort((a, b) => sanitizeString(a).localeCompare(sanitizeString(b), 'fr', { sensitivity: 'base' }))
            .forEach(continent => {
                const entries = Array.isArray(dataset[continent]) ? dataset[continent] : [];
                const ordered = [...entries].sort((a, b) => sanitizeString(a.name).localeCompare(sanitizeString(b.name), 'fr', { sensitivity: 'base' }));
                result[continent] = ordered.map(entry => this.prepareLocationForPersist(entry));
            });
        return result;
    }

    async persistLocations() {
        try {
            const payload = this.prepareLocationsForPersist(this.locationsData);
            const response = await fetch('/api/locations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ locations: payload })
            });
            let payloadResponse = null;
            try {
                payloadResponse = await response.json();
            } catch (parseError) {
                payloadResponse = null;
            }
            if (!response.ok) {
                let message = `HTTP ${response.status}`;
                if (payloadResponse) {
                    if (Array.isArray(payloadResponse?.errors) && payloadResponse.errors.length) {
                        message = payloadResponse.errors.join('\n');
                    } else if (payloadResponse?.message) {
                        message = payloadResponse.message;
                    }
                }
                const error = new Error(message);
                error.status = response.status;
                this.logTelemetryEvent({
                    title: 'Lieux - sauvegarde',
                    description: message,
                    route: '/api/locations',
                    method: 'POST',
                    status: response.status
                });
                throw error;
            }
            const warnings = Array.isArray(payloadResponse?.warnings) ? payloadResponse.warnings : [];
            this.updateValidationWarnings(warnings);
            console.info('Sauvegarde des lieux terminee.');
        } catch (error) {
            console.error('Erreur lors de la sauvegarde des lieux :', error);
            if (this.announcer) {
                this.announcer.assertive(error?.message || 'Erreur lors de la sauvegarde des donnees.');
            }
            if (this.locationEditor?.showError) {
                this.locationEditor.showError('form', error?.message || 'Erreur lors de la sauvegarde des donnees.');
            }
            this.logTelemetryEvent({
                title: 'Lieux - sauvegarde',
                description: error?.message || 'Echec de sauvegarde',
                route: '/api/locations',
                method: 'POST',
                status: error?.status || null
            });
        }
    }

    buildSidebar(locationsByContinent) {
        this.expandedContinents ||= new Set();
        for (const [name, section] of this.continents) if (this.isContinentExpanded(section)) this.expandedContinents.add(name);
        this.mapController.clearEntries();
        this.entries = [];
        this.continents.clear();

        if (this.dom.continentsContainer) {
            clearElement(this.dom.continentsContainer);
        }

        const continents = Object.entries(locationsByContinent || {});
        continents.forEach(([continentName, locations], index) => {
            const list = Array.isArray(locations) ? [...locations] : [];
            list.sort((a, b) => (a?.name || '').localeCompare(b?.name || '', 'fr', { sensitivity: 'base' }));
            const section = this.createContinentSection(continentName, list, index);
            this.continents.set(continentName, section);
            if (this.expandedContinents.has(continentName)) this.setContinentExpanded(section, true);
            if (this.dom.continentsContainer) {
                this.dom.continentsContainer.appendChild(section.wrapper);
            }
        });

        if (!continents.length && this.dom.continentsContainer) {
            const empty = createElement('p', { className: 'empty-sidebar', text: localized('search.noResult', 'Aucun lieu') });
            this.dom.continentsContainer.appendChild(empty);
        }

        this.updateToggleAllState();
    }



    buildFilterIndexForEntry(entry) {
        if (!entry || !entry.location) {
            return null;
        }
        const questEvents = this.getQuestEventsForLocation(entry.location.name);
        return buildLocationIndex(entry.location, {
            continent: entry.continent,
            questEvents
        });
    }

    refreshFilterMetadata({ reapply = false } = {}) {
        if (!Array.isArray(this.entries) || !this.entries.length) {
            if (this.filtersManager?.setAvailableFilters) {
                this.filtersManager.setAvailableFilters({ types: [], tags: [], statuses: [], quests: { with: 0, without: 0 } });
            }
            if (this.locationEditor?.setAvailableTags) {
                this.locationEditor.setAvailableTags([]);
            }
            return;
        }
        const typeLabels = new Map(Object.entries(this.typeData || {}));
        const indices = [];
        this.entries.forEach(entry => {
            entry.filterIndex = this.buildFilterIndexForEntry(entry);
            if (entry.filterIndex) {
                indices.push(entry.filterIndex);
            }
        });
        this.filterFacets = buildFilterFacets(indices, { typeLabels });
        if (this.filtersManager?.setAvailableFilters) {
            this.filtersManager.setAvailableFilters(this.filterFacets);
        }
        if (this.locationEditor?.setAvailableTags) {
            this.locationEditor.setAvailableTags(this.filterFacets.tags || []);
        }
        if (reapply) {
            this.applyFilters();
        }
    }

    collectExistingNames(exceptName = null) {
        const names = [];
        const except = exceptName ? sanitizeString(exceptName).toLowerCase() : null;
        Object.values(this.locationsData || {}).forEach(list => {
            if (!Array.isArray(list)) {
                return;
            }
            list.forEach(location => {
                const normalizedName = sanitizeString(location?.name).toLowerCase();
                if (!normalizedName) {
                    return;
                }
                if (except && normalizedName === except) {
                    return;
                }
                names.push(normalizedName);
            });
        });
        return names;
    }

    collectLocationNameLabels(exceptName = null) {
        const names = [];
        const seen = new Set();
        const except = exceptName ? sanitizeString(exceptName).toLowerCase() : null;
        Object.values(this.locationsData || {}).forEach(list => {
            if (!Array.isArray(list)) {
                return;
            }
            list.forEach(location => {
                const label = sanitizeString(location?.name);
                if (!label) {
                    return;
                }
                const key = label.toLowerCase();
                if (except && key === except) {
                    return;
                }
                if (seen.has(key)) {
                    return;
                }
                seen.add(key);
                names.push(label);
            });
        });
        return names;
    }

    getQuestEventsForLocation(locationName) {
        const key = sanitizeString(locationName).toLowerCase();
        if (!key) {
            return [];
        }
        const events = [];
        this.questEvents.forEach(event => {
            const target = sanitizeString(event?.locationName).toLowerCase();
            if (target === key) {
                events.push(event);
            }
        });
        events.sort((a, b) => {
            const left = new Date(b?.updatedAt || b?.timestamp || b?.createdAt || 0).getTime();
            const right = new Date(a?.updatedAt || a?.timestamp || a?.createdAt || 0).getTime();
            return left - right;
        });
        return events;
    }

    openCreateLocation() {
        if (!this.locationEditor) {
            return;
        }
        if (!this.isAdmin()) {
            this.announcer?.assertive?.('Connexion administrateur requise.');
            return;
        }
        const disallowed = this.collectExistingNames();
        const availableLocations = this.collectLocationNameLabels();
        this.locationEditor.open({
            mode: 'create',
            location: null,
            continent: '',
            disallowedNames: disallowed,
            questEvents: [],
            availableLocations
        });
    }

    openEditLocation() {
        if (!this.locationEditor || !this.activeEntry) {
            return;
        }
        if (!this.isAdmin()) {
            this.announcer?.assertive?.('Connexion administrateur requise.');
            return;
        }
        const entry = this.activeEntry;
        const disallowed = this.collectExistingNames(entry.location.name);
        const availableLocations = this.collectLocationNameLabels(entry.location.name);
        this.locationEditor.open({
            mode: 'edit',
            location: entry.location,
            continent: entry.continent,
            disallowedNames: disallowed,
            questEvents: this.getQuestEventsForLocation(entry.location.name),
            availableLocations
        });
    }

    handleCreateLocation({ continent, location }) {
        if (!location) {
            return;
        }
        const normalized = normalizeLocation(location);
        if (!normalized.name) {
            console.warn('Impossible de creer un lieu sans nom.');
            return;
        }
        const target = sanitizeString(continent) || 'Divers';
        if (!Array.isArray(this.locationsData[target])) {
            this.locationsData[target] = [];
        }
        this.locationsData[target].push(normalized);
        this.refreshLocations({ focusName: normalized.name });
        this.persistLocations();
    }

    handleDeleteLocation({ originalContinent, originalName }) {
        const continentKey = sanitizeString(originalContinent) || 'Divers';
        const nameKey = sanitizeString(originalName);
        if (!nameKey) {
            return;
        }
        const sourceList = Array.isArray(this.locationsData[continentKey]) ? this.locationsData[continentKey] : [];
        const index = sourceList.findIndex(item => sanitizeString(item?.name) === nameKey);
        if (index === -1) {
            return;
        }
        const [removed] = sourceList.splice(index, 1);
        if (sourceList.length) {
            this.locationsData[continentKey] = sourceList;
        } else {
            delete this.locationsData[continentKey];
        }

        const removedName = removed?.name || originalName || '';
        if (removedName && this.state.hasFavorite(removedName)) {
            this.state.removeFavorite(removedName);
            this.preferences?.setFavorites?.(this.state.getFavorites());
        }
        if (removedName && this.preferences?.getLastLocation?.() === removedName) {
            this.preferences.setLastLocation(null);
        }
        if (this.activeEntry && sanitizeString(this.activeEntry.location?.name) === nameKey) {
            this.infoPanel?.close();
        }

        this.refreshLocations();
        this.persistLocations();

        if (removedName && this.announcer) {
            const message = localized('aria.locationDeleted', `${removedName} supprime.`, { location: removedName });
            this.announcer.polite(message);
        }
    }

    async generateLocationDescription(payload) {
        const response = await fetch('/api/admin/locations/generate-description', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload || {})
        });
        let body = null;
        try {
            body = await response.json();
        } catch (error) {
            body = null;
        }
        if (!response.ok) {
            const message = body?.message || `HTTP ${response.status}`;
            const error = new Error(message);
            error.status = response.status;
            throw error;
        }
        return {
            description: body?.description || '',
            meta: body?.meta || {}
        };
    }

    handleUpdateLocation({ continent, location, originalContinent, originalName }) {
        if (!location) {
            return;
        }
        const normalized = normalizeLocation(location);
        if (!normalized.name) {
            console.warn('Impossible de mettre a jour un lieu sans nom.');
            return;
        }
        const currentName = sanitizeString(originalName);
        const source = sanitizeString(originalContinent) || 'Divers';
        const target = sanitizeString(continent) || 'Divers';
        const sourceList = Array.isArray(this.locationsData[source]) ? this.locationsData[source] : [];
        const index = sourceList.findIndex(item => sanitizeString(item?.name) === currentName);
        if (index !== -1) {
            sourceList.splice(index, 1);
        }
        this.locationsData[source] = sourceList;
        if (!Array.isArray(this.locationsData[target])) {
            this.locationsData[target] = [];
        }
        this.locationsData[target].push(normalized);
        if (!this.locationsData[source].length && source !== target) {
            delete this.locationsData[source];
        }
        if (currentName && normalized.name && currentName !== normalized.name) {
            if (this.state.hasFavorite(currentName)) {
                this.state.removeFavorite(currentName);
                this.state.addFavorite(normalized.name);
                this.preferences?.setFavorites?.(this.state.getFavorites());
            }
            if (this.preferences?.getLastLocation?.() === currentName) {
                this.preferences.setLastLocation(normalized.name);
            }
        }
        this.refreshLocations({ focusName: normalized.name });
        this.persistLocations();
    }

    refreshLocations({ focusName } = {}) {
        this.sortStateDataset();
        this.buildSidebar(this.locationsData);
        this.refreshFilterMetadata({ reapply: false });
        this.state.sidebarView = 'all';
        this.applyFilters();
        this.renderFavoritesView();
        this.updateSidebarView();
        this.updateClusteringMetrics();
        this.updateRandomButtonState();
        if (focusName) {
            const entry = this.entries.find(candidate => candidate.location.name === focusName);
            if (entry) {
                this.ensureEntryVisible(entry);
                this.selectEntry(entry, { focusOnList: true, source: 'editor' });
                return;
            }
        }
        this.updateEditButton(null);
    }

    updateEditButton(location) {
        if (!this.dom.editLocation) {
            return;
        }
        const isAdmin = this.isAdmin();
        if (!isAdmin || !location) {
            this.dom.editLocation.disabled = true;
            this.dom.editLocation.setAttribute('aria-label', 'Modifier le lieu');
            return;
        }
        this.dom.editLocation.disabled = false;
        this.dom.editLocation.setAttribute('aria-label', `Modifier ${location.name}`);
    }

    updateValidationWarnings(warnings = []) {
        const normalized = Array.isArray(warnings)
            ? warnings
                .map(item => (typeof item === 'string' ? item : (item?.message ?? '')))
                .map(item => item.trim())
                .filter(Boolean)
            : [];
        const unique = Array.from(new Set(normalized));
        const previousKey = this.latestValidationWarnings.join('\n');
        const nextKey = unique.join('\n');
        const changed = previousKey !== nextKey;
        this.latestValidationWarnings = unique;

        // Sidebar: toujours masqué pour éviter le doublon avec le panneau admin.
        if (this.dom.validationWarnings) {
            this.dom.validationWarnings.hidden = true;
            this.dom.validationWarnings.setAttribute('aria-hidden', 'true');
        }
        if (this.dom.validationWarningsList) {
            clearElement(this.dom.validationWarningsList);
        }
        if (this.dom.validationWarningsFootnote) {
            this.dom.validationWarningsFootnote.textContent = '';
            this.dom.validationWarningsFootnote.hidden = true;
        }

        // Admin panel rendering
        if (this.adminDom.validationWarningsList) {
            this.adminDom.validationWarningsList.innerHTML = '';
            const MAX_WARNINGS = 24;
            unique.slice(0, MAX_WARNINGS).forEach(message => {
                this.adminDom.validationWarningsList.appendChild(createElement('li', { text: message }));
            });
            if (this.adminDom.validationWarningsFootnote) {
                if (unique.length > MAX_WARNINGS) {
                    const extra = unique.length - MAX_WARNINGS;
                    this.adminDom.validationWarningsFootnote.textContent = `+ ${extra} avertissement(s) supplémentaire(s) masqué(s).`;
                    this.adminDom.validationWarningsFootnote.hidden = false;
                } else {
                    this.adminDom.validationWarningsFootnote.textContent = '';
                    this.adminDom.validationWarningsFootnote.hidden = true;
                }
            }
        }
        if (this.adminDom.validationWarnings) {
            const hasWarnings = unique.length > 0;
            this.adminDom.validationWarnings.hidden = !hasWarnings;
            this.adminDom.validationWarnings.setAttribute('aria-hidden', hasWarnings ? 'false' : 'true');
        }

        if (changed && unique.length && this.announcer?.polite) {
            const label = unique.length > 1 ? `${unique.length} avertissements` : '1 avertissement';
            this.announcer.polite(`${label} de validation detecte${unique.length > 1 ? 's' : ''}.`);
        }
    }
    createContinentSection(continentName, locations, index) {
        const wrapper = createElement('section', {
            className: 'continent',
            dataset: { continent: continentName }
        });

        const toggleButton = createElement('button', {
            className: 'continent-toggle',
            html: `${continentName} <span class="location-count">(${locations.length})</span>`,
            attributes: {
                type: 'button',
                'aria-expanded': 'false',
                'aria-controls': `continent-${index}`
            }
        });

        const content = createElement('div', {
            className: 'continent-content',
            attributes: {
                id: `continent-${index}`,
                'aria-hidden': 'true'
            }
        });
        content.style.display = 'none';

        const section = {
            name: continentName,
            wrapper,
            toggleButton,
            content,
            entries: [],
            pagination: {
                currentPage: Math.max(0, Number(this.preferences?.getPagination?.(continentName)) || 0),
                totalPages: 1,
                controls: null
            }
        };

        toggleButton.addEventListener('click', () => {
            this.setContinentExpanded(section, !this.isContinentExpanded(section));
            this.updateToggleAllState();
        });

        section.entries = locations.map(location => this.createLocationEntry(location, continentName));
        section.pagination.controls = section.entries.length > this.pageSize
            ? this.createPaginationControls(continentName)
            : null;
        section.pagination.totalPages = Math.max(1, Math.ceil(section.entries.length / this.pageSize));

        wrapper.appendChild(toggleButton);
        wrapper.appendChild(content);

        this.renderContinentEntries(section.entries, section.pagination, content);

        return section;
    }

    createLocationEntry(location, continentName) {
        const entry = {
            location,
            continent: continentName,
            matchesFilters: true,
            element: null,
            favoriteButton: null,
            markerEntry: null
        };

        const element = createElement('div', {
            className: 'location',
            dataset: { locationName: location.name },
            attributes: { tabindex: '0' }
        });

        const label = createElement('span', {
            className: 'location-label',
            text: location.name
        });

        const isFavorite = this.state.hasFavorite(location.name);
        const favoriteButton = createElement('button', {
            className: 'location-favorite-toggle',
            text: isFavorite ? favoriteIconActive() : favoriteIconInactive(),
            attributes: { type: 'button' }
        });

        favoriteButton.setAttribute('aria-pressed', String(isFavorite));
        favoriteButton.classList.toggle('active', isFavorite);
        const favoriteTitle = isFavorite
            ? localized('favorites.removeWithName', `Retirer ${location.name} des favoris`, { location: location.name })
            : localized('favorites.addWithName', `Ajouter ${location.name} aux favoris`, { location: location.name });
        favoriteButton.title = favoriteTitle;
        favoriteButton.setAttribute('aria-label', favoriteTitle);

        favoriteButton.addEventListener('click', event => {
            event.stopPropagation();
            this.setFavoriteState(location, !this.state.hasFavorite(location.name));
        });

        this.attachHoverTooltip(favoriteButton, this.favoriteTooltip, { placement: 'left' });

        element.appendChild(label);
        element.appendChild(favoriteButton);

        element.addEventListener('click', () => this.selectEntry(entry, { focusOnList: false, source: 'list' }));
        element.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                this.selectEntry(entry, { focusOnList: false, source: 'keyboard' });
            }
        });
        element.addEventListener('focus', () => element.classList.add('keyboard-focus'));
        element.addEventListener('blur', () => element.classList.remove('keyboard-focus'));

        entry.element = element;
        entry.favoriteButton = favoriteButton;
        entry.element.classList.toggle('is-favorite', isFavorite);
        entry.element.classList.toggle('favorite', isFavorite);

        entry.markerEntry = this.mapController.createEntry({
            location,
            continent: continentName,
            onSelect: () => {
                this.ensureEntryVisible(entry);
                this.selectEntry(entry, { focusOnList: false, source: 'map' });
            },
            onHover: () => element.classList.add('hover'),
            onLeave: () => element.classList.remove('hover')
        });

        entry.filterIndex = this.buildFilterIndexForEntry(entry);
        this.entries.push(entry);
        return entry;
    }

    createPaginationControls(continentName) {
        const container = createElement('div', { className: 'pagination-controls' });
        const previous = createElement('button', {
            className: 'pagination-button pagination-previous',
            text: '<',
            attributes: { type: 'button', 'aria-label': localized('pagination.previous', 'Page precedente') }
        });
        const next = createElement('button', {
            className: 'pagination-button pagination-next',
            text: '>',
            attributes: { type: 'button', 'aria-label': localized('pagination.next', 'Page suivante') }
        });
        const info = createElement('span', { className: 'pagination-info', text: '1/1' });

        container.appendChild(previous);
        container.appendChild(info);
        container.appendChild(next);

        return {
            container,
            previous,
            next,
            info,
            continentName
        };
    }

    renderContinentEntries(entries, pagination, container) {
        if (!container || !pagination) {
            return;
        }

        const controls = pagination.controls;
        if (controls?.container && controls.container.parentElement === container) {
            container.removeChild(controls.container);
        }

        clearElement(container);

        if (!entries.length) {
            const empty = createElement('p', {
                className: 'empty-continent',
                text: localized('search.noResult', 'Aucun lieu')
            });
            container.appendChild(empty);
            if (controls?.container) {
                controls.container.style.display = 'none';
                container.appendChild(controls.container);
            }
            container.style.maxHeight = '0';
            return;
        }

        pagination.totalPages = Math.max(1, Math.ceil(entries.length / this.pageSize));
        pagination.currentPage = Math.min(pagination.currentPage, pagination.totalPages - 1);

        const startIndex = pagination.currentPage * this.pageSize;
        const pageEntries = entries.slice(startIndex, startIndex + this.pageSize);
        pageEntries.forEach(entry => container.appendChild(entry.element));

        const scheduleHeightUpdate = () => {
            if (container.style.display === 'none') {
                return;
            }
            const applyHeight = () => {
                container.style.maxHeight = `${container.scrollHeight}px`;
            };
            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(applyHeight);
            } else {
                applyHeight();
            }
        };

        scheduleHeightUpdate();

        if (!controls?.container) {
            return;
        }

        controls.info.textContent = `${pagination.currentPage + 1}/${pagination.totalPages}`;
        controls.previous.disabled = pagination.currentPage === 0;
        controls.next.disabled = pagination.currentPage >= pagination.totalPages - 1;
        controls.container.style.display = pagination.totalPages > 1 ? '' : 'none';

        controls.previous.onclick = () => {
            if (pagination.currentPage === 0) {
                return;
            }
            pagination.currentPage -= 1;
            this.renderContinentEntries(entries, pagination, container);
            if (this.preferences?.setPagination) {
                this.preferences.setPagination(controls.continentName, pagination.currentPage);
            }
        };

        controls.next.onclick = () => {
            if (pagination.currentPage >= pagination.totalPages - 1) {
                return;
            }
            pagination.currentPage += 1;
            this.renderContinentEntries(entries, pagination, container);
            if (this.preferences?.setPagination) {
                this.preferences.setPagination(controls.continentName, pagination.currentPage);
            }
        };

        controls.container.innerHTML = '';
        controls.container.appendChild(controls.previous);
        controls.container.appendChild(controls.info);
        controls.container.appendChild(controls.next);
        container.appendChild(controls.container);

        scheduleHeightUpdate();
    }
    isAdmin() {
        if (!this.authRequired) {
            return Boolean(this.auth?.authenticated);
        }
        return (this.auth?.role || '').toLowerCase() === 'admin';
    }

    setAuthState({
        authenticated = false,
        role = 'guest',
        username = '',
        avatar = null,
        provider = null,
        discordId = null,
        groups = [],
        groupDetails = [],
        characters = [],
        availability = null,
        profile = null,
        account = null
    } = {}) {
        const previouslyAuthenticated = Boolean(this.auth?.authenticated);
        if (!this.authRequired) {
            if (authenticated) {
                this.auth = {
                    authenticated: true,
                    role: 'admin',
                    username: username || this.auth.username || '',
                    avatar: avatar || this.auth.avatar || null,
                    provider: provider || this.auth.provider || null,
                    discordId: discordId || this.auth.discordId || null,
                    groups: Array.isArray(groups) ? groups : (this.auth.groups || []),
                    groupDetails: Array.isArray(groupDetails) ? groupDetails : (this.auth.groupDetails || []),
                    characters: Array.isArray(characters) ? characters : (this.auth.characters || []),
                    availability: availability ?? this.auth.availability ?? null,
                    profile: profile ?? this.auth.profile ?? null,
                    account: account ?? this.auth.account ?? { lastLoginAt: null, lastSeenAt: null }
                };
            } else {
                this.auth = {
                    authenticated: false,
                    role: 'guest',
                    username: '',
                    avatar: null,
                    provider: null,
                    discordId: null,
                    groups: [],
                    groupDetails: [],
                    characters: [],
                    availability: null,
                    profile: null,
                    account: { lastLoginAt: null, lastSeenAt: null }
                };
            }
        } else {
            this.auth = {
                authenticated: Boolean(authenticated),
                role: (role || 'guest').toLowerCase(),
                username: username || '',
                avatar: avatar || null,
                provider: provider || null,
                discordId: discordId || null,
                groups: Array.isArray(groups) ? groups : [],
                groupDetails: Array.isArray(groupDetails) ? groupDetails : [],
                characters: Array.isArray(characters) ? characters : [],
                availability: availability ?? null,
                profile: profile ?? null,
                account: account ?? { lastLoginAt: null, lastSeenAt: null }
            };
        }
        if (previouslyAuthenticated !== this.auth.authenticated) {
            this.characterFormDirty = false;
            this.charactersDirty = false;
            this.characterDraftMode = false;
            this.availabilityDirty = false;
            this.profileCustomizationDirty = false;
            this.characterSyncPending = false;
            this.availabilitySyncPending = false;
            this.profileCustomizationPending = false;
            this.characterInlineErrors = [];
            this.profileCustomizationInlineErrors = [];
        }
        const nowAuthenticated = Boolean(this.auth?.authenticated);
        if (this.authRequired && !previouslyAuthenticated && nowAuthenticated && !this.questEventsLoaded) {
            this.fetchQuestEvents();
        }
        if (!nowAuthenticated) {
            this.setCharacterStatus('');
        }
        if (!this.charactersDirty) {
            this.profileCharacters = this.normalizeCharacterList(this.auth.characters, { assignIds: true });
            if (this.profileCharacters.length) {
                const exists = this.profileCharacters.some(character => character.id === this.activeCharacterId);
                if (!exists) {
                    const preferred = this.profileCharacters.find(character => character.active);
                    this.activeCharacterId = preferred?.id || this.profileCharacters[0]?.id || null;
                }
            } else {
                this.activeCharacterId = null;
            }
        }
        if (!this.availabilityDirty) {
            const normalized = normalizeAvailabilityPayload(this.auth.availability, this.availabilityTimezone);
            this.availability = normalized;
            if (normalized?.timezone) {
                this.availabilityTimezone = normalized.timezone;
            }
        }
        if (!this.profileCustomizationDirty) {
            this.profileCustomization = this.normalizeProfileCustomization(this.auth.profile);
        }
        this.updateAuthUI();
        this.updateValidationWarnings(this.latestValidationWarnings);
    }
    updateAuthUI() {
        const authenticated = Boolean(this.auth?.authenticated);
        const isAdmin = this.isAdmin();
        if (this.dom.authPanel) {
            this.dom.authPanel.classList.toggle('auth-admin', isAdmin && authenticated);
        }
        if (this.dom.authStatus) {
            if (!this.authRequired) {
                if (authenticated) {
                    this.dom.authStatus.textContent = 'Edition locale active.';
                } else {
                    this.dom.authStatus.textContent = 'Edition reservee aux administrateurs (Discord non configure).';
                }
            } else if (authenticated) {
                const name = this.auth?.username ? ` (${this.auth.username})` : '';
                if (isAdmin) {
                    this.dom.authStatus.textContent = `Connecte en tant qu'administrateur${name}.`;
                } else {
                    this.dom.authStatus.textContent = `Connecte en tant qu'utilisateur${name}. Edition reservee aux administrateurs.`;
                }
            } else {
                this.dom.authStatus.textContent = 'Connexion requise pour modifier les lieux.';
            }
        }
        const username = (this.auth?.username || '').trim();
        const displayName = authenticated
            ? (username || (isAdmin ? 'Administrateur' : 'Utilisateur'))
            : 'Invite';
        const roleLabel = !this.authRequired
            ? (authenticated ? 'Edition locale' : 'Mode lecture')
            : (authenticated ? (isAdmin ? 'Administrateur' : 'Utilisateur') : 'Invite');
        const avatarInitial = (username || (authenticated ? (isAdmin ? 'A' : 'U') : '?')).charAt(0).toUpperCase();
        const avatarUrl = typeof this.auth?.avatar === 'string' ? this.auth.avatar.trim() : '';
        if (this.dom.profileLabel) {
            this.dom.profileLabel.textContent = authenticated ? displayName : 'Profil';
        }
        if (this.dom.authUsername) {
            this.dom.authUsername.textContent = displayName;
        }
        if (this.dom.authRole) {
            this.dom.authRole.textContent = roleLabel;
        }
        if (this.dom.authPresence) {
            const presenceLabel = authenticated
                ? (!this.authRequired ? 'Edition locale' : 'En ligne')
                : 'Hors ligne';
            const presenceClass = authenticated
                ? (!this.authRequired ? 'is-local' : 'is-online')
                : 'is-offline';
            this.dom.authPresence.textContent = presenceLabel;
            this.dom.authPresence.classList.remove('is-online', 'is-offline', 'is-local');
            this.dom.authPresence.classList.add(presenceClass);
        }
        const applyAvatar = element => setAvatarImage(element, avatarUrl, avatarInitial);
        applyAvatar(this.dom.profileAvatar);
        applyAvatar(this.dom.profileAvatarPanel);
        if (this.dom.authGroups) {
            clearElement(this.dom.authGroups);
            const details = Array.isArray(this.auth?.groupDetails) ? this.auth.groupDetails : [];
            const ids = Array.isArray(this.auth?.groups) ? this.auth.groups : [];
            const entries = details.length
                ? details
                : ids.map(id => ({ id, name: id, color: null }));
            if (entries.length) {
                entries.forEach(group => {
                    const chip = createElement('span', {
                        className: 'profile-group-chip',
                        text: group.name || group.id
                    });
                    if (group.color) {
                        chip.style.borderColor = group.color;
                        chip.style.color = group.color;
                    }
                    this.dom.authGroups.appendChild(chip);
                });
            }
            if (this.dom.authGroupsEmpty) {
                this.dom.authGroupsEmpty.hidden = entries.length > 0;
            }
        }
        if (this.dom.loginButton) {
            this.dom.loginButton.hidden = !this.authRequired || authenticated;
        }
        if (this.dom.logoutButton) {
            this.dom.logoutButton.hidden = !this.authRequired || !authenticated;
        }
        if (this.dom.adminPanelButton) {
            const shouldHide = !isAdmin;
            this.dom.adminPanelButton.hidden = shouldHide;
            this.dom.adminPanelButton.classList.toggle('admin-locked', shouldHide);
        }
        if (this.dom.quickAdminUsers) {
            const shouldHide = !isAdmin;
            this.dom.quickAdminUsers.hidden = shouldHide;
            this.dom.quickAdminUsers.classList.toggle('admin-locked', shouldHide);
        }
        if (this.dom.quickAdminGroups) {
            const shouldHide = !isAdmin;
            this.dom.quickAdminGroups.hidden = shouldHide;
            this.dom.quickAdminGroups.classList.toggle('admin-locked', shouldHide);
        }
        if (this.dom.quickThemeToggle) {
            const nextTheme = this.state.theme === 'light' ? 'sombre' : 'clair';
            this.dom.quickThemeToggle.textContent = `Theme ${nextTheme}`;
        }
        if (this.dom.quickFavorites) {
            const count = this.state.getFavorites().length;
            this.dom.quickFavorites.textContent = count > 0
                ? `Mes lieux favoris (${count})`
                : 'Mes lieux favoris';
        }
        if (this.dom.profileAccountSecurity) {
            this.dom.profileAccountSecurity.classList.toggle('is-guest', !authenticated);
        }
        if (this.dom.profileAccountOauth) {
            const oauthLabel = this.authRequired
                ? (authenticated && this.auth?.provider === 'discord' ? 'Discord: connecte' : 'Discord: disponible')
                : 'Discord: local';
            this.dom.profileAccountOauth.textContent = oauthLabel;
            this.dom.profileAccountOauth.classList.toggle('is-connected', authenticated && this.auth?.provider === 'discord');
            this.dom.profileAccountOauth.classList.remove('is-disabled');
        }
        if (this.dom.profileAccountProvider) {
            this.dom.profileAccountProvider.textContent = authenticated
                ? (this.auth?.provider === 'discord' ? 'Discord' : (this.auth?.provider || 'manuel'))
                : 'Invite';
        }
        if (this.dom.profileAccountDiscord) {
            if (authenticated && this.auth?.provider === 'discord') {
                const id = (this.auth?.discordId || '').trim();
                this.dom.profileAccountDiscord.textContent = id ? `ID ${id}` : 'Compte Discord';
            } else {
                this.dom.profileAccountDiscord.textContent = 'Non connecte';
            }
        }
        if (this.dom.profileAccountLastLogin) {
            const lastLoginAt = this.auth?.account?.lastLoginAt || null;
            this.dom.profileAccountLastLogin.textContent = authenticated
                ? this.formatAuthTimestamp(lastLoginAt)
                : '--';
        }
        if (this.dom.profileRevokeSession) {
            this.dom.profileRevokeSession.hidden = !this.authRequired || !authenticated;
            this.dom.profileRevokeSession.disabled = !this.authRequired || !authenticated;
        }
        if (!authenticated) {
            this.setProfileRevokeStatus('');
        }
        if (this.adminDom.userButton) {
            this.adminDom.userButton.disabled = !isAdmin;
        }
        if (this.adminDom.groupButton) {
            this.adminDom.groupButton.disabled = !isAdmin;
        }
        if (this.adminDom.downloadAssetsButton) {
            this.adminDom.downloadAssetsButton.hidden = !isAdmin;
        }
        this.syncScopedAdminEditors();
        if (!isAdmin) {
            this.closeUserAdminPanel(true);
            this.closeAdminPanel(true);
        }
        if (this.dom.addLocation) {
            const shouldHide = !isAdmin;
            this.dom.addLocation.disabled = shouldHide;
            this.dom.addLocation.hidden = shouldHide;
            this.dom.addLocation.setAttribute('aria-disabled', String(shouldHide));
            this.dom.addLocation.classList.toggle('admin-locked', shouldHide);
        }
        if (this.locationEditor?.deleteButton) {
            this.locationEditor.deleteButton.disabled = !isAdmin;
            this.locationEditor.deleteButton.hidden = !isAdmin;
        }
        this.updateEditButton(this.activeEntry?.location || null);
        this.updateAnnotationButton();
        if (this.eventsFeed) {
            this.eventsFeed.setCanDeleteResolver(() => this.isAdmin());
        }
        this.syncProfileCustomizationUI();
        this.syncCharacterForm();
        this.syncAvailabilityUI();
        this.syncProfileFeedbackUI();
    }

    formatAuthTimestamp(value) {
        if (!value || typeof value !== 'string') {
            return '--';
        }
        const timestamp = Date.parse(value);
        if (!Number.isFinite(timestamp)) {
            return '--';
        }
        try {
            return new Intl.DateTimeFormat('fr-FR', {
                dateStyle: 'medium',
                timeStyle: 'short'
            }).format(new Date(timestamp));
        } catch (_error) {
            return new Date(timestamp).toLocaleString('fr-FR');
        }
    }

    setProfileRevokeStatus(message, type = 'neutral') {
        if (!this.dom.profileRevokeStatus) {
            return;
        }
        const text = typeof message === 'string' ? message.trim() : '';
        this.dom.profileRevokeStatus.textContent = text;
        this.dom.profileRevokeStatus.hidden = !text;
        this.dom.profileRevokeStatus.classList.remove('is-error', 'is-success');
        if (text && type === 'error') {
            this.dom.profileRevokeStatus.classList.add('is-error');
        }
        if (text && type === 'success') {
            this.dom.profileRevokeStatus.classList.add('is-success');
        }
    }

    async revokeCurrentSession() {
        if (!this.authRequired || !this.auth?.authenticated) {
            return;
        }
        this.setProfileRevokeStatus('Revocation en cours...');
        if (this.dom.profileRevokeSession) {
            this.dom.profileRevokeSession.disabled = true;
        }
        try {
            let response = await fetch('/auth/session', {
                method: 'DELETE',
                credentials: 'include'
            });
            if (response.status === 404 || response.status === 405) {
                response = await fetch('/auth/logout', {
                    method: 'POST',
                    credentials: 'include'
                });
            }
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            this.setProfileRevokeStatus('Session revoquee.', 'success');
        } catch (error) {
            console.error('[auth] session revoke failed', error);
            this.setProfileRevokeStatus('Impossible de revoquer la session.', 'error');
            if (this.dom.profileRevokeSession) {
                this.dom.profileRevokeSession.disabled = false;
            }
            return;
        }
        await this.fetchSession();
        this.closeCharacterOverlay();
        this.setProfilePanelOpen(false);
    }

    syncCharacterForm() {
        if (!this.dom.characterSection && !this.dom.characterOverlay) {
            return;
        }
        const authenticated = Boolean(this.auth?.authenticated);
        if (this.dom.characterLocked) {
            this.dom.characterLocked.hidden = authenticated;
        }
        if (this.dom.characterOverlayLocked) {
            this.dom.characterOverlayLocked.hidden = authenticated;
        }
        this.updateCharacterSummary();
        this.refreshCharacterGroupOptions();
        this.renderCharacterList();
        const hasCharacters = Array.isArray(this.profileCharacters) && this.profileCharacters.length > 0;
        const hasSelectedCharacter = Boolean(this.getActiveCharacter());
        const showEditor = hasSelectedCharacter || this.characterDraftMode;
        if (this.dom.characterEmptyState) {
            this.dom.characterEmptyState.hidden = !(authenticated && !hasCharacters && !this.characterDraftMode);
        }
        if (this.dom.characterEmpty && this.dom.characterEmptyState && !this.dom.characterEmptyState.hidden) {
            this.dom.characterEmpty.hidden = true;
        }
        if (this.dom.characterFormFields) {
            this.dom.characterFormFields.hidden = !showEditor;
        }
        if (this.dom.characterFormActions) {
            this.dom.characterFormActions.hidden = !showEditor;
        }
        const inputs = [
            this.dom.characterName,
            this.dom.characterBio,
            this.dom.characterAvatar,
            this.dom.characterGroup,
            this.dom.characterActive
        ].filter(Boolean);
        inputs.forEach(input => {
            input.disabled = !authenticated || this.characterSyncPending || !showEditor;
        });
        if (this.dom.characterOpen) {
            this.dom.characterOpen.disabled = false;
            this.dom.characterOpen.setAttribute('aria-expanded', String(this.isCharacterOverlayOpen));
        }
        if (this.dom.characterSave) {
            this.dom.characterSave.disabled = !authenticated || this.characterSyncPending || !showEditor;
        }
        if (this.dom.characterDelete) {
            this.dom.characterDelete.disabled = !authenticated || !this.activeCharacterId || this.characterSyncPending || !showEditor;
            this.dom.characterDelete.hidden = !this.activeCharacterId || !showEditor;
        }
        if (this.dom.characterAdd) {
            this.dom.characterAdd.disabled = !authenticated || this.characterSyncPending;
        }
        if (this.dom.characterDuplicate) {
            this.dom.characterDuplicate.disabled = !authenticated || !this.activeCharacterId || this.characterSyncPending || !showEditor;
            this.dom.characterDuplicate.hidden = !showEditor;
        }
        if (this.dom.characterImport) {
            this.dom.characterImport.disabled = !authenticated || this.characterSyncPending;
        }
        if (this.dom.characterExport) {
            this.dom.characterExport.disabled = this.characterSyncPending || !this.profileCharacters.length;
        }
        if (this.dom.characterErrors && !showEditor) {
            this.dom.characterErrors.hidden = true;
        }
        if (this.dom.characterStatus) {
            this.dom.characterStatus.classList.toggle('is-muted-empty', !showEditor && authenticated && !hasCharacters);
        }
        if (!this.characterFormDirty) {
            const character = this.getActiveCharacter() || {};
            if (this.dom.characterName) {
                this.dom.characterName.value = character.name || '';
            }
            if (this.dom.characterBio) {
                this.dom.characterBio.value = character.bio || '';
            }
            if (this.dom.characterAvatar) {
                this.dom.characterAvatar.value = character.avatar || '';
            }
            if (this.dom.characterActive) {
                this.dom.characterActive.checked = Boolean(character.active);
            }
            this.characterInlineErrors = [];
            this.renderInlineErrors(this.dom.characterErrors, []);
            this.setFieldInvalid(this.dom.characterName, false);
            this.setFieldInvalid(this.dom.characterAvatar, false);
        }
        this.syncProfileFeedbackUI();
    }

    normalizeCharacterList(characters, { assignIds = false } = {}) {
        return normalizeCharacterListValue(characters, {
            assignIds,
            createId: () => this.createCharacterId()
        });
    }

    enforceSingleActiveCharacter(characters) {
        return enforceSingleActiveCharacterValue(characters);
    }

    updateCharacterSummary() {
        if (!this.dom.characterSummary) {
            return;
        }
        const characters = Array.isArray(this.profileCharacters) ? this.profileCharacters : [];
        if (!characters.length) {
            this.dom.characterSummary.textContent = 'Aucun personnage enregistre.';
            this.dom.characterSummary.className = 'profile-character-empty';
            return;
        }
        const active = characters.find(character => character.active)
            || characters.find(character => character.id === this.activeCharacterId)
            || characters[0];
        const total = characters.length;
        const activeLabel = active?.name || 'Aucun';
        this.dom.characterSummary.textContent = `${total} personnage(s) - actif: ${activeLabel}`;
        this.dom.characterSummary.className = 'profile-character-summary';
    }

    refreshCharacterGroupOptions() {
        const select = this.dom.characterGroup;
        const filterSelect = this.dom.characterFilterGroup;
        const groups = Array.isArray(this.groups) ? this.groups : [];
        const characterGroups = new Set();
        (Array.isArray(this.profileCharacters) ? this.profileCharacters : []).forEach(character => {
            const groupId = typeof character?.groupId === 'string' ? character.groupId.trim() : '';
            if (groupId) {
                characterGroups.add(groupId);
            }
        });
        const allGroupIds = Array.from(new Set([
            ...groups.map(group => group?.id).filter(Boolean),
            ...characterGroups
        ]));
        if (select) {
            const currentValue = select.value;
            const desired = this.characterFormDirty
                ? currentValue
                : (this.getActiveCharacter()?.groupId || '');
            select.innerHTML = '';
            const emptyOption = document.createElement('option');
            emptyOption.value = '';
            emptyOption.textContent = 'Aucun groupe';
            select.appendChild(emptyOption);
            allGroupIds.forEach(groupId => {
                const option = document.createElement('option');
                option.value = groupId;
                option.textContent = groups.find(group => group?.id === groupId)?.name || groupId;
                select.appendChild(option);
            });
            select.value = desired && allGroupIds.includes(desired) ? desired : '';
        }
        if (!filterSelect) {
            return;
        }
        const previous = filterSelect.value;
        filterSelect.innerHTML = '';
        const allOption = document.createElement('option');
        allOption.value = '';
        allOption.textContent = 'Tous les groupes';
        filterSelect.appendChild(allOption);
        allGroupIds.forEach(groupId => {
            const option = document.createElement('option');
            option.value = groupId;
            option.textContent = groups.find(group => group?.id === groupId)?.name || groupId;
            filterSelect.appendChild(option);
        });
        const desired = this.characterFilterGroup || previous || '';
        this.characterFilterGroup = desired && allGroupIds.includes(desired) ? desired : '';
        filterSelect.value = this.characterFilterGroup;
    }

    getActiveCharacter() {
        if (!this.activeCharacterId) {
            return null;
        }
        return this.profileCharacters.find(character => character.id === this.activeCharacterId) || null;
    }

    getFilteredCharacters() {
        const normalizedSearch = (this.characterFilterSearch || '').trim().toLowerCase();
        const normalizedGroup = (this.characterFilterGroup || '').trim();
        const activeMode = this.characterFilterActive || 'all';
        const characters = Array.isArray(this.profileCharacters) ? this.profileCharacters : [];
        return characters
            .filter(character => {
                if (normalizedGroup && (character.groupId || '') !== normalizedGroup) {
                    return false;
                }
                if (activeMode === 'active' && !character.active) {
                    return false;
                }
                if (activeMode === 'inactive' && character.active) {
                    return false;
                }
                if (!normalizedSearch) {
                    return true;
                }
                const haystack = [
                    character.name || '',
                    character.bio || '',
                    character.groupId || ''
                ].join(' ').toLowerCase();
                return haystack.includes(normalizedSearch);
            })
            .sort((a, b) => {
                const activeDiff = Number(Boolean(b.active)) - Number(Boolean(a.active));
                if (activeDiff !== 0) {
                    return activeDiff;
                }
                return (a.name || '').localeCompare(b.name || '', 'fr', { sensitivity: 'base' });
            });
    }

    updateCharacterPagination(totalItems = 0) {
        const totalPages = totalItems > 0
            ? Math.max(1, Math.ceil(totalItems / this.characterPageSize))
            : 0;
        const currentPage = totalPages > 0 ? Math.min(this.characterPageIndex + 1, totalPages) : 0;
        if (this.dom.characterPageIndicator) {
            this.dom.characterPageIndicator.textContent = `Page ${currentPage}/${totalPages}`;
            this.dom.characterPageIndicator.hidden = totalPages <= 0;
        }
        if (this.dom.characterCarouselPrev) {
            this.dom.characterCarouselPrev.disabled = totalPages <= 1 || this.characterPageIndex <= 0;
        }
        if (this.dom.characterCarouselNext) {
            this.dom.characterCarouselNext.disabled = totalPages <= 1 || this.characterPageIndex >= totalPages - 1;
        }
    }

    renderCharacterList() {
        const container = this.dom.characterList;
        if (!container) {
            return;
        }
        const carousel = container.closest('.character-carousel');
        clearElement(container);
        const filtered = this.getFilteredCharacters();
        const totalItems = filtered.length;
        if (carousel) {
            carousel.classList.toggle('is-empty', totalItems <= 0);
        }
        const totalPages = totalItems > 0 ? Math.max(1, Math.ceil(totalItems / this.characterPageSize)) : 0;
        if (this.characterPageIndex >= totalPages) {
            this.characterPageIndex = Math.max(0, totalPages - 1);
        }
        const start = this.characterPageIndex * this.characterPageSize;
        const currentPageItems = filtered.slice(start, start + this.characterPageSize);
        if (!currentPageItems.length) {
            if (this.dom.characterEmpty) {
                const hasCharacters = (Array.isArray(this.profileCharacters) ? this.profileCharacters.length : 0) > 0;
                this.dom.characterEmpty.textContent = hasCharacters
                    ? 'Aucun personnage ne correspond aux filtres.'
                    : 'Aucun personnage enregistre.';
                this.dom.characterEmpty.hidden = false;
            }
            this.updateCharacterPagination(totalItems);
            return;
        }
        if (this.dom.characterEmpty) {
            this.dom.characterEmpty.hidden = true;
        }
        currentPageItems.forEach(character => {
            const card = createElement('button', {
                className: `profile-character-card${character.id === this.activeCharacterId ? ' is-active' : ''}`,
                attributes: { type: 'button' }
            });
            const avatar = createElement('span', { className: 'profile-character-avatar' });
            const avatarUrl = typeof character.avatar === 'string' ? character.avatar.trim() : '';
            setAvatarImage(avatar, avatarUrl, character.name, 'has-image');
            const meta = createElement('span', { className: 'profile-character-meta' });
            meta.appendChild(createElement('span', {
                className: 'profile-character-name',
                text: character.name || 'Personnage'
            }));
            if (character.active) {
                meta.appendChild(createElement('span', {
                    className: 'profile-character-tag',
                    text: 'Actif'
                }));
            }
            const groupLabel = this.groups.find(group => group.id === character.groupId)?.name
                || character.groupId
                || '';
            meta.appendChild(createElement('span', {
                className: 'profile-character-sub',
                text: groupLabel ? `Groupe: ${groupLabel}` : 'Aucun groupe'
            }));
            card.appendChild(avatar);
            card.appendChild(meta);
            card.addEventListener('click', () => this.selectCharacter(character.id));
            container.appendChild(card);
        });
        this.updateCharacterPagination(totalItems);
    }

    selectCharacter(characterId) {
        if (!characterId) {
            return;
        }
        this.activeCharacterId = characterId;
        this.characterDraftMode = false;
        const activeCharacter = this.getActiveCharacter();
        if (activeCharacter) {
            this.characterPageIndex = Math.floor(this.getFilteredCharacters().findIndex(entry => entry.id === characterId) / this.characterPageSize);
            if (!Number.isFinite(this.characterPageIndex) || this.characterPageIndex < 0) {
                this.characterPageIndex = 0;
            }
        }
        this.characterFormDirty = false;
        this.charactersDirty = false;
        this.setCharacterStatus('');
        this.syncCharacterForm();
    }

    startNewCharacter() {
        this.activeCharacterId = null;
        this.characterDraftMode = true;
        this.characterFormDirty = false;
        this.charactersDirty = true;
        if (this.dom.characterName) {
            this.dom.characterName.value = '';
        }
        if (this.dom.characterBio) {
            this.dom.characterBio.value = '';
        }
        if (this.dom.characterAvatar) {
            this.dom.characterAvatar.value = '';
        }
        if (this.dom.characterGroup) {
            this.dom.characterGroup.value = '';
        }
        if (this.dom.characterActive) {
            this.dom.characterActive.checked = false;
        }
        this.refreshCharacterGroupOptions();
        this.setCharacterStatus('');
        this.syncCharacterForm();
    }

    duplicateCharacterProfile() {
        if (!this.auth?.authenticated) {
            this.setCharacterStatus('Connexion requise pour dupliquer un personnage.', true);
            return;
        }
        const source = this.getActiveCharacter();
        if (!source) {
            this.setCharacterStatus('Selectionnez un personnage a dupliquer.', true);
            return;
        }
        const baseName = source.name || 'Personnage';
        if (this.dom.characterName) {
            this.dom.characterName.value = `Copie - ${baseName}`;
        }
        if (this.dom.characterBio) {
            this.dom.characterBio.value = source.bio || '';
        }
        if (this.dom.characterAvatar) {
            this.dom.characterAvatar.value = source.avatar || '';
        }
        if (this.dom.characterGroup) {
            this.dom.characterGroup.value = source.groupId || '';
        }
        if (this.dom.characterActive) {
            this.dom.characterActive.checked = false;
        }
        this.activeCharacterId = null;
        this.characterDraftMode = true;
        this.characterFormDirty = true;
        this.charactersDirty = true;
        this.setCharacterStatus('Copie prete. Enregistrez pour creer le personnage.');
        this.syncCharacterForm();
    }

    collectCharacterDraft() {
        const name = this.dom.characterName?.value.trim() || '';
        const bio = this.dom.characterBio?.value.trim() || '';
        const avatar = this.dom.characterAvatar?.value.trim() || '';
        const groupId = this.dom.characterGroup?.value || '';
        const active = Boolean(this.dom.characterActive?.checked);
        return { name, bio, avatar, groupId, active };
    }

    createCharacterId() {
        return createCharacterIdValue();
    }

    setCharacterStatus(message, isError = false) {
        if (!this.dom.characterStatus) {
            return;
        }
        if (!message) {
            this.dom.characterStatus.hidden = true;
            this.dom.characterStatus.textContent = '';
            this.dom.characterStatus.classList.remove('is-error');
            return;
        }
        this.dom.characterStatus.textContent = message;
        this.dom.characterStatus.hidden = false;
        this.dom.characterStatus.classList.toggle('is-error', isError);
        this.syncProfileFeedbackUI();
    }

    setCharacterOverlayOpen(open, { focusName = false } = {}) {
        if (!this.dom.characterOverlay) {
            return;
        }
        this.isCharacterOverlayOpen = Boolean(open);
        this.dom.characterOverlay.hidden = !this.isCharacterOverlayOpen;
        this.dom.characterOverlay.classList.toggle('open', this.isCharacterOverlayOpen);
        if (this.dom.characterOpen) {
            this.dom.characterOpen.setAttribute('aria-expanded', String(this.isCharacterOverlayOpen));
        }
        if (this.isCharacterOverlayOpen) {
            this.refreshCharacterGroupOptions();
            this.renderCharacterList();
            this.syncCharacterForm();
            if (focusName && this.dom.characterName) {
                window.requestAnimationFrame(() => {
                    if (this.dom.characterFormFields && !this.dom.characterFormFields.hidden) {
                        this.dom.characterName?.focus?.();
                        return;
                    }
                    this.dom.characterEmptyCreate?.focus?.();
                });
            }
            return;
        }
        this.characterFormDirty = false;
        this.characterDraftMode = false;
        this.setCharacterStatus('');
    }

    openCharacterOverlay() {
        this.setProfilePanelOpen(false);
        this.setCharacterOverlayOpen(true, { focusName: true });
    }

    closeCharacterOverlay() {
        this.setCharacterOverlayOpen(false);
    }

    async persistCharacters(nextCharacters, successMessage) {
        const normalizedCharacters = this.normalizeCharacterList(nextCharacters, { assignIds: true });
        this.charactersDirty = true;
        this.characterSyncPending = true;
        this.setProfileFeedbackState('saving', 'Sauvegarde des personnages...');
        this.syncCharacterForm();
        this.syncProfileFeedbackUI();
        try {
            const response = await fetch('/api/profile', {
                method: 'PATCH',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ characters: normalizedCharacters })
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const payload = await response.json();
            const profile = payload?.profile || {};
            const characters = this.normalizeCharacterList(profile.characters, { assignIds: true });
            this.profileCharacters = characters;
            this.auth.characters = characters;
            this.characterFormDirty = false;
            this.charactersDirty = false;
            this.characterDraftMode = false;
            if (!characters.some(entry => entry.id === this.activeCharacterId)) {
                const preferred = characters.find(entry => entry.active);
                this.activeCharacterId = preferred?.id || characters[0]?.id || null;
            }
            this.setCharacterStatus(successMessage || 'Personnage enregistre.');
            this.recordProfileEdit('characters', successMessage || 'Personnages mis a jour', 'ok');
            this.syncCharacterForm();
            await this.fetchSession();
            await this.fetchGroups();
        } catch (error) {
            console.error('[profile] update failed', error);
            this.setCharacterStatus('Impossible de mettre a jour les personnages.', true);
            this.recordProfileEdit('characters', 'Echec de mise a jour', 'error');
        } finally {
            this.characterSyncPending = false;
            this.syncCharacterForm();
            this.syncProfileFeedbackUI();
        }
    }

    async saveCharacterProfile() {
        if (!this.auth?.authenticated) {
            this.announcer?.assertive?.('Connexion requise pour creer un personnage.');
            return;
        }
        const inlineErrors = this.validateCharacterDraftInline();
        if (inlineErrors.length) {
            this.setCharacterStatus('Corrigez les erreurs inline avant de sauvegarder.', true);
            this.recordProfileEdit('characters', 'Validation personnage echouee', 'error');
            return;
        }
        const draft = this.collectCharacterDraft();
        const nextCharacters = Array.isArray(this.profileCharacters) ? [...this.profileCharacters] : [];
        let activeId = this.activeCharacterId;
        if (activeId) {
            const index = nextCharacters.findIndex(character => character.id === activeId);
            if (index >= 0) {
                nextCharacters[index] = { ...nextCharacters[index], ...draft, id: activeId };
            } else {
                activeId = this.createCharacterId();
                nextCharacters.push({ ...draft, id: activeId });
            }
        } else {
            activeId = this.createCharacterId();
            nextCharacters.push({ ...draft, id: activeId });
        }
        if (draft.active) {
            nextCharacters.forEach(character => {
                character.active = character.id === activeId;
            });
        }
        this.activeCharacterId = activeId;
        await this.persistCharacters(nextCharacters, 'Personnage enregistre.');
    }

    async deleteCharacterProfile() {
        if (!this.auth?.authenticated) {
            return;
        }
        const activeId = this.activeCharacterId;
        if (!activeId) {
            return;
        }
        const target = this.getActiveCharacter();
        const confirmed = window.confirm(`Supprimer le personnage "${target?.name || 'sans nom'}" ?`);
        if (!confirmed) {
            return;
        }
        const nextCharacters = (Array.isArray(this.profileCharacters) ? this.profileCharacters : [])
            .filter(character => character.id !== activeId);
        const fallbackActive = nextCharacters.find(character => character.active);
        this.activeCharacterId = fallbackActive?.id || nextCharacters[0]?.id || null;
        await this.persistCharacters(nextCharacters, 'Personnage supprime.');
    }

    exportCharacterProfiles() {
        const characters = this.normalizeCharacterList(this.profileCharacters, { assignIds: true });
        if (!characters.length) {
            this.setCharacterStatus('Aucun personnage a exporter.', true);
            return;
        }
        try {
            const payload = {
                version: 1,
                exportedAt: new Date().toISOString(),
                characters
            };
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            const username = (this.auth?.username || 'profil').toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
            anchor.href = url;
            anchor.download = `${username || 'profil'}-personnages.json`;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            URL.revokeObjectURL(url);
            this.setCharacterStatus('Export termine.');
            this.recordProfileEdit('characters', 'Export JSON', 'ok');
        } catch (error) {
            console.error('[profile] export failed', error);
            this.setCharacterStatus('Impossible d\'exporter les personnages.', true);
            this.recordProfileEdit('characters', 'Export JSON echoue', 'error');
        }
    }

    triggerCharacterImport() {
        if (!this.auth?.authenticated) {
            this.setCharacterStatus('Connexion requise pour importer des personnages.', true);
            return;
        }
        const input = this.dom.characterImportFile;
        if (!input) {
            return;
        }
        input.value = '';
        input.click();
    }

    async importCharacterProfiles() {
        if (!this.auth?.authenticated) {
            this.setCharacterStatus('Connexion requise pour importer des personnages.', true);
            return;
        }
        const input = this.dom.characterImportFile;
        const file = input?.files?.[0];
        if (!file) {
            return;
        }
        try {
            const text = await file.text();
            const parsed = JSON.parse(text);
            const source = Array.isArray(parsed)
                ? parsed
                : (Array.isArray(parsed?.characters) ? parsed.characters : []);
            const imported = this.normalizeCharacterList(source, { assignIds: true });
            if (!imported.length) {
                this.setCharacterStatus('Aucun personnage valide trouve dans le fichier.', true);
                this.recordProfileEdit('characters', 'Import JSON invalide', 'error');
                return;
            }
            const nextCharacters = [
                ...(Array.isArray(this.profileCharacters) ? this.profileCharacters : []),
                ...imported
            ];
            const deduped = [];
            const seen = new Set();
            const existingCount = (Array.isArray(this.profileCharacters) ? this.profileCharacters.length : 0);
            let importedActiveId = null;
            nextCharacters.forEach((entry, index) => {
                let id = entry.id;
                while (!id || seen.has(id)) {
                    id = this.createCharacterId();
                }
                seen.add(id);
                const normalizedEntry = { ...entry, id };
                if (index >= existingCount && entry.active && !importedActiveId) {
                    importedActiveId = id;
                }
                deduped.push(normalizedEntry);
            });
            if (importedActiveId) {
                deduped.forEach(entry => {
                    entry.active = entry.id === importedActiveId;
                });
            }
            this.activeCharacterId = deduped[deduped.length - 1]?.id || this.activeCharacterId;
            await this.persistCharacters(deduped, `${imported.length} personnage(s) importe(s).`);
        } catch (error) {
            console.error('[profile] import failed', error);
            this.setCharacterStatus('Import impossible. Verifiez le format JSON.', true);
            this.recordProfileEdit('characters', 'Import JSON echoue', 'error');
        } finally {
            if (input) {
                input.value = '';
            }
        }
    }

    isValidAccentColor(value) {
        return isValidAccentColorValue(value);
    }

    normalizeProfileUrl(value) {
        return normalizeProfileUrlValue(value);
    }

    normalizeProfileCustomization(payload) {
        return normalizeProfileCustomizationValue(payload);
    }

    collectProfileCustomizationDraft() {
        const accentInput = this.dom.profileAccent?.value || '';
        const accent = this.isValidAccentColor(accentInput) ? accentInput.trim() : null;
        return this.normalizeProfileCustomization({
            banner: this.dom.profileBanner?.value || '',
            accentColor: accent,
            bio: this.dom.profileBioMarkdown?.value || '',
            socials: {
                website: this.dom.profileSocialWebsite?.value || '',
                discord: this.dom.profileSocialDiscord?.value || '',
                twitch: this.dom.profileSocialTwitch?.value || '',
                youtube: this.dom.profileSocialYoutube?.value || '',
                x: this.dom.profileSocialX?.value || ''
            }
        });
    }

    setProfileCustomizationStatus(message, isError = false) {
        const target = this.dom.profileCustomizationStatus;
        if (!target) {
            return;
        }
        if (!message) {
            target.hidden = true;
            target.textContent = '';
            target.classList.remove('is-error');
            return;
        }
        target.hidden = false;
        target.textContent = message;
        target.classList.toggle('is-error', isError);
        if (message) {
            this.setProfileFeedbackState(isError ? 'error' : 'saved', message);
        }
        this.syncProfileFeedbackUI();
    }

    renderInlineErrors(listElement, errors = []) {
        if (!listElement) {
            return;
        }
        clearElement(listElement);
        const entries = Array.isArray(errors) ? errors.filter(Boolean) : [];
        listElement.hidden = entries.length === 0;
        entries.forEach(message => {
            const li = createElement('li', { text: message });
            listElement.appendChild(li);
        });
    }

    setFieldInvalid(input, invalid) {
        if (!input) {
            return;
        }
        input.classList.toggle('is-invalid', Boolean(invalid));
        input.setAttribute('aria-invalid', invalid ? 'true' : 'false');
    }

    validateCharacterDraftInline() {
        const errors = [];
        const name = this.dom.characterName?.value.trim() || '';
        const avatar = this.dom.characterAvatar?.value.trim() || '';
        if (!name) {
            errors.push('Le nom du personnage est requis.');
        }
        if (avatar && !this.normalizeProfileUrl(avatar)) {
            errors.push("L'URL d'avatar du personnage est invalide (http(s) ou chemin local).");
        }
        this.setFieldInvalid(this.dom.characterName, !name);
        this.setFieldInvalid(this.dom.characterAvatar, Boolean(avatar) && !this.normalizeProfileUrl(avatar));
        this.characterInlineErrors = errors;
        this.renderInlineErrors(this.dom.characterErrors, errors);
        this.syncProfileFeedbackUI();
        return errors;
    }

    validateProfileCustomizationInline() {
        const errors = [];
        const banner = this.dom.profileBanner?.value.trim() || '';
        const accent = this.dom.profileAccent?.value.trim() || '';
        const socials = [
            ['Site web', this.dom.profileSocialWebsite],
            ['Discord', this.dom.profileSocialDiscord],
            ['Twitch', this.dom.profileSocialTwitch],
            ['YouTube', this.dom.profileSocialYoutube],
            ['X / Twitter', this.dom.profileSocialX]
        ];
        if (banner && !this.normalizeProfileUrl(banner)) {
            errors.push("L'URL de banniere est invalide (http(s) ou chemin local).");
        }
        if (accent && !this.isValidAccentColor(accent)) {
            errors.push('La couleur d’accent doit etre au format #RRGGBB.');
        }
        socials.forEach(([label, input]) => {
            const raw = input?.value?.trim?.() || '';
            if (raw && !this.normalizeProfileUrl(raw)) {
                errors.push(`${label}: URL invalide.`);
            }
        });
        this.setFieldInvalid(this.dom.profileBanner, Boolean(banner) && !this.normalizeProfileUrl(banner));
        this.setFieldInvalid(this.dom.profileAccent, Boolean(accent) && !this.isValidAccentColor(accent));
        this.setFieldInvalid(this.dom.profileSocialWebsite, Boolean(this.dom.profileSocialWebsite?.value?.trim?.()) && !this.normalizeProfileUrl(this.dom.profileSocialWebsite.value));
        this.setFieldInvalid(this.dom.profileSocialDiscord, Boolean(this.dom.profileSocialDiscord?.value?.trim?.()) && !this.normalizeProfileUrl(this.dom.profileSocialDiscord.value));
        this.setFieldInvalid(this.dom.profileSocialTwitch, Boolean(this.dom.profileSocialTwitch?.value?.trim?.()) && !this.normalizeProfileUrl(this.dom.profileSocialTwitch.value));
        this.setFieldInvalid(this.dom.profileSocialYoutube, Boolean(this.dom.profileSocialYoutube?.value?.trim?.()) && !this.normalizeProfileUrl(this.dom.profileSocialYoutube.value));
        this.setFieldInvalid(this.dom.profileSocialX, Boolean(this.dom.profileSocialX?.value?.trim?.()) && !this.normalizeProfileUrl(this.dom.profileSocialX.value));
        this.profileCustomizationInlineErrors = errors;
        this.renderInlineErrors(this.dom.profileCustomizationErrors, errors);
        this.syncProfileFeedbackUI();
        return errors;
    }

    recordProfileEdit(scope, message, status = 'ok') {
        const scopeLabel = ({
            customization: 'Personnalisation',
            characters: 'Personnages',
            availability: 'Disponibilites'
        })[scope] || scope || 'Profil';
        const entry = {
            id: `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
            at: new Date().toISOString(),
            scope: scopeLabel,
            message: message || '',
            status: status === 'error' ? 'error' : 'ok'
        };
        this.profileFeedback.history = [entry, ...(this.profileFeedback.history || [])].slice(0, 8);
        this.syncProfileFeedbackUI();
    }

    setProfileFeedbackState(state = 'idle', detail = '') {
        this.profileFeedback.state = state;
        if (detail) {
            this.profileFeedback.detail = detail;
        } else if (state === 'idle') {
            this.profileFeedback.detail = 'Aucune modification en attente.';
        }
    }

    syncProfileFeedbackUI() {
        const stateNode = this.dom.profileSaveState;
        const detailNode = this.dom.profileSaveDetail;
        const historyNode = this.dom.profileEditHistory;
        const customNode = this.dom.profileCustomizationState;
        const characterNode = this.dom.profileCharactersState;
        const availabilityNode = this.dom.profileAvailabilityState;
        if (!stateNode || !detailNode || !historyNode) {
            return;
        }
        const hasPending = Boolean(this.profileCustomizationPending || this.characterSyncPending || this.availabilitySyncPending);
        const hasDirty = Boolean(this.profileCustomizationDirty || this.charactersDirty || this.availabilityDirty);
        const hasErrors = (this.profileFeedback.state === 'error')
            || (this.profileCustomizationInlineErrors?.length > 0)
            || (this.characterInlineErrors?.length > 0);
        let state = 'idle';
        let label = 'A jour';
        let detail = this.profileFeedback.detail || 'Aucune modification en attente.';
        if (hasPending) {
            state = 'saving';
            label = 'Enregistrement...';
            detail = 'Sauvegarde en cours.';
        } else if (hasErrors) {
            state = 'error';
            label = 'Erreur';
            detail = this.profileFeedback.detail || "Certaines modifications n'ont pas pu etre sauvegardees.";
        } else if (hasDirty) {
            state = 'dirty';
            label = 'Brouillon';
            detail = 'Des modifications ne sont pas encore enregistrees.';
        }
        stateNode.textContent = label;
        stateNode.className = `profile-save-state is-${state}`;
        detailNode.textContent = detail;

        const setChip = (node, name, { dirty = false, pending = false, error = false } = {}) => {
            if (!node) {
                return;
            }
            let suffix = 'a jour';
            let cls = 'is-idle';
            if (pending) {
                suffix = 'enregistrement...';
                cls = 'is-saving';
            } else if (error) {
                suffix = 'erreur';
                cls = 'is-error';
            } else if (dirty) {
                suffix = 'brouillon';
                cls = 'is-dirty';
            }
            node.textContent = `${name}: ${suffix}`;
            node.className = `profile-feedback-chip ${cls}`;
        };
        setChip(customNode, 'Personnalisation', {
            dirty: this.profileCustomizationDirty,
            pending: this.profileCustomizationPending,
            error: (this.profileCustomizationInlineErrors?.length || 0) > 0 || (this.dom.profileCustomizationStatus?.classList.contains('is-error') && !this.dom.profileCustomizationStatus.hidden)
        });
        setChip(characterNode, 'Personnages', {
            dirty: this.charactersDirty,
            pending: this.characterSyncPending,
            error: (this.characterInlineErrors?.length || 0) > 0 || (this.dom.characterStatus?.classList.contains('is-error') && !this.dom.characterStatus.hidden)
        });
        setChip(availabilityNode, 'Disponibilites', {
            dirty: this.availabilityDirty,
            pending: this.availabilitySyncPending,
            error: (this.dom.availabilityStatus?.classList.contains('is-error') && !this.dom.availabilityStatus.hidden)
        });

        clearElement(historyNode);
        const history = Array.isArray(this.profileFeedback.history) ? this.profileFeedback.history : [];
        if (!history.length) {
            historyNode.appendChild(createElement('li', {
                className: 'profile-edit-history-empty',
                text: 'Aucune modification recente.'
            }));
            return;
        }
        history.forEach(entry => {
            const li = createElement('li', {
                className: `profile-edit-history-item ${entry.status === 'error' ? 'is-error' : 'is-ok'}`
            });
            const timeLabel = (() => {
                try {
                    return new Date(entry.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
                } catch {
                    return '--:--';
                }
            })();
            li.appendChild(createElement('span', { className: 'profile-edit-history-time', text: timeLabel }));
            li.appendChild(createElement('span', { className: 'profile-edit-history-scope', text: entry.scope || 'Profil' }));
            li.appendChild(createElement('span', { className: 'profile-edit-history-message', text: entry.message || 'Modification' }));
            historyNode.appendChild(li);
        });
    }

    applyProfileCustomizationTheme(profile) {
        const normalized = this.normalizeProfileCustomization(profile);
        const accent = normalized.accentColor || '#60a5fa';
        if (this.dom.profilePanel) {
            this.dom.profilePanel.style.setProperty('--profile-accent', accent);
        }
        const card = this.dom.profileIdentityCard;
        if (!card) {
            return;
        }
        if (normalized.banner) {
            card.style.backgroundImage = `linear-gradient(145deg, rgba(15, 23, 42, 0.82), rgba(23, 37, 84, 0.5)), url("${normalized.banner}")`;
            card.style.backgroundSize = 'cover';
            card.style.backgroundPosition = 'center';
        } else {
            card.style.backgroundImage = '';
            card.style.backgroundSize = '';
            card.style.backgroundPosition = '';
        }
    }

    renderProfileCustomizationPreview(profile) {
        const normalized = this.normalizeProfileCustomization(profile);
        if (this.dom.profileBioPreview) {
            const html = renderMarkdown(normalized.bio || '');
            if (html) {
                this.dom.profileBioPreview.innerHTML = html;
            } else {
                this.dom.profileBioPreview.innerHTML = '<p class="profile-preview-empty">Aucune bio renseignee.</p>';
            }
        }
        if (this.dom.profileSocialPreview) {
            clearElement(this.dom.profileSocialPreview);
            const entries = Object.entries(normalized.socials || {});
            this.dom.profileSocialPreview.hidden = entries.length === 0;
            entries.forEach(([key, href]) => {
                const label = PROFILE_SOCIAL_LABELS[key] || key;
                const link = createElement('a', {
                    className: 'profile-social-chip',
                    text: label,
                    attributes: {
                        href,
                        target: '_blank',
                        rel: 'noopener noreferrer'
                    }
                });
                this.dom.profileSocialPreview.appendChild(link);
            });
        }
        this.applyProfileCustomizationTheme(normalized);
    }

    syncProfileCustomizationUI() {
        if (!this.dom.profileCustomization) {
            return;
        }
        const authenticated = Boolean(this.auth?.authenticated);
        const disabled = !authenticated || this.profileCustomizationPending;
        const inputs = [
            this.dom.profileBanner,
            this.dom.profileAccent,
            this.dom.profileAccentPicker,
            this.dom.profileBioMarkdown,
            this.dom.profileSocialWebsite,
            this.dom.profileSocialDiscord,
            this.dom.profileSocialTwitch,
            this.dom.profileSocialYoutube,
            this.dom.profileSocialX
        ].filter(Boolean);
        inputs.forEach(input => {
            input.disabled = disabled;
        });
        if (this.dom.profileCustomizationSave) {
            this.dom.profileCustomizationSave.disabled = disabled;
        }
        if (this.dom.profileCustomizationLocked) {
            this.dom.profileCustomizationLocked.hidden = authenticated;
        }
        if (!this.profileCustomizationDirty) {
            const value = this.normalizeProfileCustomization(this.profileCustomization);
            if (this.dom.profileBanner) {
                this.dom.profileBanner.value = value.banner || '';
            }
            if (this.dom.profileAccent) {
                this.dom.profileAccent.value = value.accentColor || '';
            }
            if (this.dom.profileAccentPicker) {
                this.dom.profileAccentPicker.value = value.accentColor || '#60a5fa';
            }
            if (this.dom.profileBioMarkdown) {
                this.dom.profileBioMarkdown.value = value.bio || '';
            }
            if (this.dom.profileSocialWebsite) {
                this.dom.profileSocialWebsite.value = value.socials.website || '';
            }
            if (this.dom.profileSocialDiscord) {
                this.dom.profileSocialDiscord.value = value.socials.discord || '';
            }
            if (this.dom.profileSocialTwitch) {
                this.dom.profileSocialTwitch.value = value.socials.twitch || '';
            }
            if (this.dom.profileSocialYoutube) {
                this.dom.profileSocialYoutube.value = value.socials.youtube || '';
            }
            if (this.dom.profileSocialX) {
                this.dom.profileSocialX.value = value.socials.x || '';
            }
            this.profileCustomizationInlineErrors = [];
            this.renderInlineErrors(this.dom.profileCustomizationErrors, []);
            [
                this.dom.profileBanner,
                this.dom.profileAccent,
                this.dom.profileSocialWebsite,
                this.dom.profileSocialDiscord,
                this.dom.profileSocialTwitch,
                this.dom.profileSocialYoutube,
                this.dom.profileSocialX
            ].forEach(input => this.setFieldInvalid(input, false));
            this.renderProfileCustomizationPreview(value);
            this.syncProfileFeedbackUI();
            return;
        }
        this.validateProfileCustomizationInline();
        this.renderProfileCustomizationPreview(this.collectProfileCustomizationDraft());
        this.syncProfileFeedbackUI();
    }

    async saveProfileCustomization() {
        if (!this.auth?.authenticated) {
            this.setProfileCustomizationStatus('Connexion requise pour enregistrer votre profil.', true);
            return;
        }
        const inlineErrors = this.validateProfileCustomizationInline();
        if (inlineErrors.length) {
            this.setProfileCustomizationStatus('Corrigez les erreurs inline avant de sauvegarder.', true);
            this.recordProfileEdit('customization', 'Validation echouee', 'error');
            return;
        }
        const draft = this.collectProfileCustomizationDraft();
        this.profileCustomizationPending = true;
        this.setProfileFeedbackState('saving', 'Sauvegarde de la personnalisation...');
        this.syncProfileCustomizationUI();
        this.syncProfileFeedbackUI();
        try {
            const response = await fetch('/api/profile', {
                method: 'PATCH',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ profile: draft })
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const payload = await response.json();
            const nextProfile = this.normalizeProfileCustomization(payload?.profile?.profile || payload?.profile?.customization || payload?.profile || draft);
            this.profileCustomization = nextProfile;
            this.auth.profile = nextProfile;
            this.profileCustomizationDirty = false;
            this.setProfileCustomizationStatus('Profil mis a jour.');
            this.recordProfileEdit('customization', 'Personnalisation enregistree', 'ok');
            this.syncProfileCustomizationUI();
            await this.fetchSession();
        } catch (error) {
            console.error('[profile] customization save failed', error);
            this.setProfileCustomizationStatus('Impossible de sauvegarder la personnalisation.', true);
            this.recordProfileEdit('customization', 'Echec de sauvegarde', 'error');
        } finally {
            this.profileCustomizationPending = false;
            this.syncProfileCustomizationUI();
            this.syncProfileFeedbackUI();
        }
    }

    buildAvailabilityGrid() {
        const grid = this.dom.availabilityGrid;
        if (!grid || grid.dataset.ready === 'true') {
            return;
        }
        clearElement(grid);
        const header = createElement('div', { className: 'profile-availability-row profile-availability-header' });
        header.appendChild(createElement('span', { className: 'profile-availability-cell profile-availability-label' }));
        AVAILABILITY_SLOTS.forEach(slot => {
            const label = createElement('span', {
                className: 'profile-availability-cell profile-availability-slot-label',
                text: slot.label,
                title: slot.range ? `${slot.label} (${slot.range})` : slot.label
            });
            header.appendChild(label);
        });
        grid.appendChild(header);
        AVAILABILITY_DAYS.forEach((day, dayIndex) => {
            const row = createElement('div', {
                className: 'profile-availability-row',
                dataset: { dayIndex }
            });
            row.appendChild(createElement('span', {
                className: 'profile-availability-cell profile-availability-day',
                text: day.label
            }));
            AVAILABILITY_SLOTS.forEach((slot, slotIndex) => {
                const button = createElement('button', {
                    className: 'profile-availability-cell profile-availability-slot',
                    dataset: { dayIndex, slotIndex },
                    attributes: {
                        type: 'button',
                        'aria-pressed': 'false',
                        'aria-label': `${day.label} ${slot.label}`
                    },
                    title: slot.range ? `${slot.label} (${slot.range})` : slot.label
                });
                row.appendChild(button);
            });
            grid.appendChild(row);
        });
        grid.addEventListener('click', event => {
            const target = event.target;
            if (!target) {
                return;
            }
            const button = target.closest('.profile-availability-slot');
            if (!button || !grid.contains(button)) {
                return;
            }
            const dayIndex = Number(button.dataset.dayIndex);
            const slotIndex = Number(button.dataset.slotIndex);
            if (!Number.isFinite(dayIndex) || !Number.isFinite(slotIndex)) {
                return;
            }
            this.toggleAvailabilitySlot(dayIndex, slotIndex);
        });
        grid.dataset.ready = 'true';
    }

    getAvailabilityMatrix() {
        const matrix = createAvailabilityMatrix();
        const slots = this.availability?.slots;
        if (!Array.isArray(slots)) {
            return matrix;
        }
        slots.forEach((daySlots, dayIndex) => {
            if (!Array.isArray(daySlots) || !matrix[dayIndex]) {
                return;
            }
            daySlots.forEach((active, slotIndex) => {
                if (matrix[dayIndex] && slotIndex < matrix[dayIndex].length) {
                    matrix[dayIndex][slotIndex] = Boolean(active);
                }
            });
        });
        return matrix;
    }

    setAvailabilityStatus(message, isError = false) {
        if (!this.dom.availabilityStatus) {
            return;
        }
        if (!message) {
            this.dom.availabilityStatus.hidden = true;
            this.dom.availabilityStatus.textContent = '';
            this.dom.availabilityStatus.classList.remove('is-error');
            return;
        }
        this.dom.availabilityStatus.textContent = message;
        this.dom.availabilityStatus.hidden = false;
        this.dom.availabilityStatus.classList.toggle('is-error', isError);
        this.syncProfileFeedbackUI();
    }

    syncAvailabilityUI() {
        if (!this.dom.availabilityGrid) {
            return;
        }
        this.buildAvailabilityGrid();
        const authenticated = Boolean(this.auth?.authenticated);
        if (this.dom.availabilitySave) {
            this.dom.availabilitySave.disabled = !authenticated || this.availabilitySyncPending;
        }
        if (this.dom.availabilityTimezone) {
            const tz = this.availabilityTimezone || resolveLocalTimezone();
            this.dom.availabilityTimezone.textContent = `Fuseau: ${tz}`;
        }
        if (!authenticated) {
            this.setAvailabilityStatus('Connexion requise pour renseigner vos disponibilites.', true);
        } else if (this.dom.availabilityStatus?.textContent === 'Connexion requise pour renseigner vos disponibilites.') {
            this.setAvailabilityStatus('');
        }
        this.renderAvailabilityGrid();
    }

    renderAvailabilityGrid() {
        const grid = this.dom.availabilityGrid;
        if (!grid) {
            return;
        }
        const authenticated = Boolean(this.auth?.authenticated);
        grid.classList.toggle('is-disabled', !authenticated);
        const matrix = this.getAvailabilityMatrix();
        const buttons = grid.querySelectorAll('.profile-availability-slot');
        buttons.forEach(button => {
            const dayIndex = Number(button.dataset.dayIndex);
            const slotIndex = Number(button.dataset.slotIndex);
            const active = Boolean(matrix?.[dayIndex]?.[slotIndex]);
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-pressed', String(active));
            button.disabled = !authenticated;
        });
    }

    toggleAvailabilitySlot(dayIndex, slotIndex) {
        if (!this.auth?.authenticated) {
            this.setAvailabilityStatus('Connexion requise pour renseigner vos disponibilites.', true);
            return;
        }
        const matrix = this.getAvailabilityMatrix();
        if (!matrix[dayIndex] || slotIndex >= matrix[dayIndex].length) {
            return;
        }
        matrix[dayIndex][slotIndex] = !matrix[dayIndex][slotIndex];
        const timezone = this.availabilityTimezone || resolveLocalTimezone();
        this.availability = { timezone, slots: matrix };
        this.availabilityDirty = true;
        this.setAvailabilityStatus('');
        this.setProfileFeedbackState('dirty', 'Des modifications de disponibilites sont en attente.');
        this.renderAvailabilityGrid();
        this.syncProfileFeedbackUI();
    }

    async saveAvailability() {
        if (!this.auth?.authenticated) {
            this.setAvailabilityStatus('Connexion requise pour renseigner vos disponibilites.', true);
            return;
        }
        const matrix = this.getAvailabilityMatrix();
        const timezone = this.availabilityTimezone || resolveLocalTimezone();
        const availability = { timezone, slots: matrix };
        this.availabilitySyncPending = true;
        this.setProfileFeedbackState('saving', 'Sauvegarde des disponibilites...');
        this.syncProfileFeedbackUI();
        if (this.dom.availabilitySave) {
            this.dom.availabilitySave.disabled = true;
        }
        try {
            const response = await fetch('/api/profile', {
                method: 'PATCH',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ availability })
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const payload = await response.json();
            const profile = payload?.profile || {};
            const normalized = normalizeAvailabilityPayload(profile.availability, timezone);
            this.availability = normalized;
            this.auth.availability = normalized;
            this.availabilityDirty = false;
            if (normalized?.timezone) {
                this.availabilityTimezone = normalized.timezone;
            }
            this.setAvailabilityStatus('Disponibilites enregistrees.');
            this.recordProfileEdit('availability', 'Disponibilites enregistrees', 'ok');
            this.renderAvailabilityGrid();
        } catch (error) {
            console.error('[profile] availability save failed', error);
            this.setAvailabilityStatus('Impossible d\'enregistrer les disponibilites.', true);
            this.recordProfileEdit('availability', 'Echec de sauvegarde', 'error');
        } finally {
            this.availabilitySyncPending = false;
            if (this.dom.availabilitySave) {
                this.dom.availabilitySave.disabled = false;
            }
            this.syncProfileFeedbackUI();
        }
    }

    async fetchSession() {
        const generation = this.accessGeneration || 0;
        if (typeof fetch !== 'function') {
            this.authRequired = true;
            this.setAuthState({ authenticated: false, role: 'guest', username: '', avatar: null });
            this.maybeOpenAdminSectionFromQuery();
            return;
        }
        try {
            const response = await fetch('/auth/session', { credentials: 'include' });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const payload = await response.json();
            if (generation !== (this.accessGeneration || 0)) return;
            this.authRequired = payload?.authRequired !== false;
            const authenticated = Boolean(payload?.authenticated);
            const role = payload?.role || (authenticated ? 'user' : 'guest');
            const username = payload?.username || '';
            const avatar = payload?.avatar || null;
            const provider = payload?.provider || null;
            const discordId = payload?.discordId || null;
            const groups = Array.isArray(payload?.groups) ? payload.groups : [];
            const groupDetails = Array.isArray(payload?.groupDetails) ? payload.groupDetails : [];
            const characters = Array.isArray(payload?.characters) ? payload.characters : [];
            const availability = payload?.availability ?? null;
            const profile = payload?.profile ?? null;
            const account = (payload?.account && typeof payload.account === 'object') ? payload.account : null;
            this.setAuthState({ authenticated, role, username, avatar, provider, discordId, groups, groupDetails, characters, availability, profile, account });
            this.maybeOpenAdminSectionFromQuery();
        } catch (error) {
            console.error('[auth] session fetch failed', error);
            this.authRequired = true;
            this.setAuthState({ authenticated: false, role: 'guest', username: '', avatar: null });
        }
    }

    setProfilePanelOpen(open) {
        const shouldOpen = Boolean(open);
        this.isProfileOpen = shouldOpen;
        if (this.dom.authPanel) {
            this.dom.authPanel.hidden = !shouldOpen;
            this.dom.authPanel.classList.toggle('open', shouldOpen);
        }
        if (this.dom.profileButton) {
            this.dom.profileButton.setAttribute('aria-expanded', String(shouldOpen));
        }
    }

    toggleProfilePanel() {
        this.setProfilePanelOpen(!this.isProfileOpen);
    }

    bindAuthPanel() {
        if (!this.dom.authPanel || !this.dom.profileButton) {
            this.authRequired = false;
            this.setAuthState({ authenticated: true, role: 'admin', username: '', avatar: null });
            return;
        }
        if (!this.dom.profileButton.dataset.bound) {
            this.dom.profileButton.addEventListener('click', event => {
                event.preventDefault();
                this.toggleProfilePanel();
            });
            this.dom.profileButton.dataset.bound = 'true';
        }
        if (!this.boundProfileClickHandler) {
            this.boundProfileClickHandler = event => {
                if (!this.isProfileOpen) {
                    return;
                }
                const target = event.target;
                if (!target) {
                    return;
                }
                if (this.dom.profilePanel && this.dom.profilePanel.contains(target)) {
                    return;
                }
                this.setProfilePanelOpen(false);
            };
            document.addEventListener('click', this.boundProfileClickHandler);
        }
        if (!this.boundProfileKeyHandler) {
            this.boundProfileKeyHandler = event => {
                if (event.key !== 'Escape') {
                    return;
                }
                if (this.isCharacterOverlayOpen) {
                    this.closeCharacterOverlay();
                    return;
                }
                if (this.isProfileOpen) {
                    this.setProfilePanelOpen(false);
                }
            };
            document.addEventListener('keydown', this.boundProfileKeyHandler);
        }
        if (this.dom.loginButton) {
            this.dom.loginButton.addEventListener('click', () => {
                const redirectPath = (window.location?.pathname || '/').startsWith('/')
                    ? (window.location.pathname || '/')
                    : '/';
                const loginUrl = `/auth/discord/login?redirect=${encodeURIComponent(redirectPath)}`;
                window.location.href = loginUrl;
            });
        }
        if (this.dom.logoutButton) {
            this.dom.logoutButton.addEventListener('click', async () => {
                try {
                    await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
                } catch (error) {
                    console.error('[auth] logout failed', error);
                }
                await this.fetchSession();
                this.closeCharacterOverlay();
                this.setProfilePanelOpen(false);
            });
        }
        if (this.dom.profileRevokeSession && !this.dom.profileRevokeSession.dataset.bound) {
            this.dom.profileRevokeSession.addEventListener('click', () => this.revokeCurrentSession());
            this.dom.profileRevokeSession.dataset.bound = 'true';
        }
        if (this.dom.quickThemeToggle && !this.dom.quickThemeToggle.dataset.bound) {
            this.dom.quickThemeToggle.addEventListener('click', () => this.toggleThemeQuickAction());
            this.dom.quickThemeToggle.dataset.bound = 'true';
        }
        if (this.dom.quickFavorites && !this.dom.quickFavorites.dataset.bound) {
            this.dom.quickFavorites.addEventListener('click', () => this.openFavoritesQuickAction());
            this.dom.quickFavorites.dataset.bound = 'true';
        }
        if (this.dom.adminPanelButton && !this.dom.adminPanelButton.dataset.bound) {
            this.dom.adminPanelButton.addEventListener('click', () => {
                this.setProfilePanelOpen(false);
                this.openAdminPanel();
            });
            this.dom.adminPanelButton.dataset.bound = 'true';
        }
        if (this.dom.quickAdminUsers && !this.dom.quickAdminUsers.dataset.bound) {
            this.dom.quickAdminUsers.addEventListener('click', () => this.openAdminShortcut('users'));
            this.dom.quickAdminUsers.dataset.bound = 'true';
        }
        if (this.dom.quickAdminGroups && !this.dom.quickAdminGroups.dataset.bound) {
            this.dom.quickAdminGroups.addEventListener('click', () => this.openAdminShortcut('groups'));
            this.dom.quickAdminGroups.dataset.bound = 'true';
        }
        const markProfileCustomizationDirty = () => {
            this.profileCustomizationDirty = true;
            this.setProfileCustomizationStatus('');
            this.validateProfileCustomizationInline();
            this.setProfileFeedbackState('dirty', 'Des modifications de profil sont en attente.');
            this.syncProfileCustomizationUI();
        };
        if (this.dom.profileAccentPicker && !this.dom.profileAccentPicker.dataset.bound) {
            this.dom.profileAccentPicker.addEventListener('input', () => {
                if (this.dom.profileAccent) {
                    this.dom.profileAccent.value = this.dom.profileAccentPicker.value || '';
                }
                markProfileCustomizationDirty();
            });
            this.dom.profileAccentPicker.dataset.bound = 'true';
        }
        if (this.dom.profileAccent && !this.dom.profileAccent.dataset.bound) {
            this.dom.profileAccent.addEventListener('input', () => {
                const value = this.dom.profileAccent.value || '';
                if (this.isValidAccentColor(value) && this.dom.profileAccentPicker) {
                    this.dom.profileAccentPicker.value = value.trim();
                }
                markProfileCustomizationDirty();
            });
            this.dom.profileAccent.dataset.bound = 'true';
        }
        [
            this.dom.profileBanner,
            this.dom.profileBioMarkdown,
            this.dom.profileSocialWebsite,
            this.dom.profileSocialDiscord,
            this.dom.profileSocialTwitch,
            this.dom.profileSocialYoutube,
            this.dom.profileSocialX
        ].forEach(input => {
            if (!input || input.dataset.bound) {
                return;
            }
            input.addEventListener('input', markProfileCustomizationDirty);
            input.dataset.bound = 'true';
        });
        if (this.dom.profileCustomizationSave && !this.dom.profileCustomizationSave.dataset.bound) {
            this.dom.profileCustomizationSave.addEventListener('click', () => this.saveProfileCustomization());
            this.dom.profileCustomizationSave.dataset.bound = 'true';
        }
        if (this.dom.characterOpen && !this.dom.characterOpen.dataset.bound) {
            this.dom.characterOpen.addEventListener('click', () => {
                this.openCharacterOverlay();
            });
            this.dom.characterOpen.dataset.bound = 'true';
        }
        if (this.dom.characterClose && !this.dom.characterClose.dataset.bound) {
            this.dom.characterClose.addEventListener('click', () => this.closeCharacterOverlay());
            this.dom.characterClose.dataset.bound = 'true';
        }
        if (this.dom.characterOverlay && !this.dom.characterOverlay.dataset.bound) {
            this.dom.characterOverlay.addEventListener('click', event => {
                if (event.target === this.dom.characterOverlay) {
                    this.closeCharacterOverlay();
                }
            });
            this.dom.characterOverlay.dataset.bound = 'true';
        }
        const markCharacterDirty = () => {
            this.characterFormDirty = true;
            this.charactersDirty = true;
            this.setCharacterStatus('');
            this.validateCharacterDraftInline();
            this.setProfileFeedbackState('dirty', 'Des modifications de personnages sont en attente.');
        };
        if (this.dom.characterName && !this.dom.characterName.dataset.bound) {
            this.dom.characterName.addEventListener('input', markCharacterDirty);
            this.dom.characterName.dataset.bound = 'true';
        }
        if (this.dom.characterBio && !this.dom.characterBio.dataset.bound) {
            this.dom.characterBio.addEventListener('input', markCharacterDirty);
            this.dom.characterBio.dataset.bound = 'true';
        }
        if (this.dom.characterAvatar && !this.dom.characterAvatar.dataset.bound) {
            this.dom.characterAvatar.addEventListener('input', markCharacterDirty);
            this.dom.characterAvatar.dataset.bound = 'true';
        }
        if (this.dom.characterGroup && !this.dom.characterGroup.dataset.bound) {
            this.dom.characterGroup.addEventListener('change', markCharacterDirty);
            this.dom.characterGroup.dataset.bound = 'true';
        }
        if (this.dom.characterActive && !this.dom.characterActive.dataset.bound) {
            this.dom.characterActive.addEventListener('change', markCharacterDirty);
            this.dom.characterActive.dataset.bound = 'true';
        }
        if (this.dom.characterFilterSearch && !this.dom.characterFilterSearch.dataset.bound) {
            this.dom.characterFilterSearch.addEventListener('input', event => {
                this.characterFilterSearch = event?.target?.value || '';
                this.characterPageIndex = 0;
                this.renderCharacterList();
            });
            this.dom.characterFilterSearch.dataset.bound = 'true';
        }
        if (this.dom.characterFilterGroup && !this.dom.characterFilterGroup.dataset.bound) {
            this.dom.characterFilterGroup.addEventListener('change', event => {
                this.characterFilterGroup = event?.target?.value || '';
                this.characterPageIndex = 0;
                this.renderCharacterList();
            });
            this.dom.characterFilterGroup.dataset.bound = 'true';
        }
        if (this.dom.characterFilterActive && !this.dom.characterFilterActive.dataset.bound) {
            this.dom.characterFilterActive.addEventListener('change', event => {
                this.characterFilterActive = event?.target?.value || 'all';
                this.characterPageIndex = 0;
                this.renderCharacterList();
            });
            this.dom.characterFilterActive.dataset.bound = 'true';
        }
        if (this.dom.characterCarouselPrev && !this.dom.characterCarouselPrev.dataset.bound) {
            this.dom.characterCarouselPrev.addEventListener('click', () => {
                this.characterPageIndex = Math.max(0, this.characterPageIndex - 1);
                this.renderCharacterList();
            });
            this.dom.characterCarouselPrev.dataset.bound = 'true';
        }
        if (this.dom.characterCarouselNext && !this.dom.characterCarouselNext.dataset.bound) {
            this.dom.characterCarouselNext.addEventListener('click', () => {
                this.characterPageIndex += 1;
                this.renderCharacterList();
            });
            this.dom.characterCarouselNext.dataset.bound = 'true';
        }
        if (this.dom.characterSave && !this.dom.characterSave.dataset.bound) {
            this.dom.characterSave.addEventListener('click', () => this.saveCharacterProfile());
            this.dom.characterSave.dataset.bound = 'true';
        }
        if (this.dom.characterDelete && !this.dom.characterDelete.dataset.bound) {
            this.dom.characterDelete.addEventListener('click', () => this.deleteCharacterProfile());
            this.dom.characterDelete.dataset.bound = 'true';
        }
        if (this.dom.characterAdd && !this.dom.characterAdd.dataset.bound) {
            this.dom.characterAdd.addEventListener('click', () => this.startNewCharacter());
            this.dom.characterAdd.dataset.bound = 'true';
        }
        if (this.dom.characterEmptyCreate && !this.dom.characterEmptyCreate.dataset.bound) {
            this.dom.characterEmptyCreate.addEventListener('click', () => this.startNewCharacter());
            this.dom.characterEmptyCreate.dataset.bound = 'true';
        }
        if (this.dom.characterDuplicate && !this.dom.characterDuplicate.dataset.bound) {
            this.dom.characterDuplicate.addEventListener('click', () => this.duplicateCharacterProfile());
            this.dom.characterDuplicate.dataset.bound = 'true';
        }
        if (this.dom.characterExport && !this.dom.characterExport.dataset.bound) {
            this.dom.characterExport.addEventListener('click', () => this.exportCharacterProfiles());
            this.dom.characterExport.dataset.bound = 'true';
        }
        if (this.dom.characterImport && !this.dom.characterImport.dataset.bound) {
            this.dom.characterImport.addEventListener('click', () => this.triggerCharacterImport());
            this.dom.characterImport.dataset.bound = 'true';
        }
        if (this.dom.characterEmptyImport && !this.dom.characterEmptyImport.dataset.bound) {
            this.dom.characterEmptyImport.addEventListener('click', () => this.triggerCharacterImport());
            this.dom.characterEmptyImport.dataset.bound = 'true';
        }
        if (this.dom.characterImportFile && !this.dom.characterImportFile.dataset.bound) {
            this.dom.characterImportFile.addEventListener('change', () => this.importCharacterProfiles());
            this.dom.characterImportFile.dataset.bound = 'true';
        }
        if (this.dom.availabilitySave && !this.dom.availabilitySave.dataset.bound) {
            this.dom.availabilitySave.addEventListener('click', () => this.saveAvailability());
            this.dom.availabilitySave.dataset.bound = 'true';
        }
        this.buildAvailabilityGrid();
        this.setProfilePanelOpen(false);
        this.updateAuthUI();
        this.fetchSession();
    }

    toggleThemeQuickAction() {
        const nextTheme = this.state.theme === 'light' ? 'dark' : 'light';
        this.themeManager.setTheme(nextTheme);
        this.updateAuthUI();
    }

    openFavoritesQuickAction() {
        this.setSidebarView('favorites');
        this.setProfilePanelOpen(false);
        this.announcer?.polite?.('Affichage des lieux favoris.');
    }

    openAdminShortcut(mode = 'users') {
        if (!this.isAdmin()) {
            this.announcer?.assertive?.('Connexion administrateur requise.');
            return;
        }
        this.setProfilePanelOpen(false);
        if (mode === 'users' || mode === 'groups') {
            this.openUserAdminPanel(mode);
            return;
        }
        this.openAdminPanel();
    }

    setupUserAdminPanel() {
        if (!this.dom.userAdminContainer) {
            return;
        }
        if (!this.userAdminPanel) {
            this.userAdminPanel = new UserAdminPanel({
                container: this.dom.userAdminContainer,
                mode: this.userAdminMode,
                onClose: () => this.closeUserAdminPanel(true),
                fetchUsers: () => this.fetchUsersList(),
                onAddUser: payload => this.createUser(payload),
                onUpdateUser: payload => this.updateUser(payload),
                onDeleteUser: user => this.removeUser(user),
                onAddGroup: payload => this.createGroup(payload),
                onUpdateGroup: payload => this.updateGroup(payload),
                onUpdateGroups: groups => this.updateGroups(groups),
                onDeleteGroup: group => this.removeGroup(group),
                onPlaceGroup: group => this.startGroupPlacement(group),
                onClearGroup: group => this.clearGroupPlacement(group)
            });
        }
        if (this.dom.userAdminButton && !this.dom.userAdminButton.dataset.bound) {
            this.dom.userAdminButton.addEventListener('click', () => this.openUserAdminPanel('users'));
            this.dom.userAdminButton.dataset.bound = 'true';
        }
        if (this.dom.userAdminOverlay && !this.dom.userAdminOverlay.dataset.bound) {
            this.dom.userAdminOverlay.addEventListener('click', event => {
                if (event.target === this.dom.userAdminOverlay) {
                    this.closeUserAdminPanel(true);
                }
            });
            this.dom.userAdminOverlay.dataset.bound = 'true';
        }
        this.closeUserAdminPanel(true);
    }

    setAdminPanelScope(scope = 'map') {
        this.adminPanelScope = normalizeAdminPanelScope(scope);
        if (this.adminDom.overlay) {
            this.adminDom.overlay.dataset.adminScope = this.adminPanelScope;
        }
        if (this.adminDom.dialog) {
            this.adminDom.dialog.dataset.adminScope = this.adminPanelScope;
        }
    }

    shouldLoadHomeAdminState(scope = this.adminPanelScope) {
        return normalizeAdminPanelScope(scope) === 'home';
    }

    shouldLoadTimelineAdminState(scope = this.adminPanelScope) {
        return normalizeAdminPanelScope(scope) === 'timeline';
    }

    syncScopedAdminEditors(scope = this.adminPanelScope) {
        const normalizedScope = normalizeAdminPanelScope(scope);
        if (normalizedScope === 'home') {
            this.syncAdminHomeEditor();
        }
        if (normalizedScope === 'timeline') {
            this.syncAdminTimelineEditor();
        }
    }

    openAdminPanel(scope = 'map') {
        if (!this.isAdmin()) {
            this.announcer?.assertive?.('Connexion administrateur requise.');
            return;
        }
        if (!this.adminDom.overlay) {
            return;
        }
        const normalizedScope = normalizeAdminPanelScope(scope);
        this.setAdminPanelScope(normalizedScope);
        this.syncAdminStatus();
        this.syncAdminValidationWarnings();
        this.renderAdminDescriptionAudit();
        this.syncAdminTelemetry();
        if (this.shouldLoadHomeAdminState(normalizedScope)) {
            if (!this.adminSiteConfig) {
                this.setAdminHomeStatus("Chargement de la configuration de l'accueil...");
            }
            this.fetchAdminSiteConfig();
        }
        if (this.shouldLoadTimelineAdminState(normalizedScope)) {
            if (!this.adminTimeline) {
                this.setAdminTimelineStatus('Chargement de la chronologie...');
            }
            this.fetchAdminTimeline();
        }
        this.fetchAdminDescriptionAudit();
        this.startAdminMetrics();
        this.closeCharacterOverlay();
        this.adminDom.overlay.hidden = false;
        this.adminDom.overlay.classList.add('open');
    }

    focusAdminSection(sectionKey = '') {
        const sectionId = ADMIN_ENTRY_SECTION_IDS[sectionKey] || '';
        if (!sectionId) {
            return;
        }
        const section = document.getElementById(sectionId);
        if (!section) {
            return;
        }
        this.adminDom.overlay?.scrollTo?.({ top: 0, behavior: 'auto' });
        this.adminDom.dialog?.querySelectorAll('.admin-section.is-targeted').forEach(node => {
            node.classList.remove('is-targeted');
        });
        section.classList.add('is-targeted');
        section.scrollIntoView({ block: 'start', behavior: 'smooth' });
        const focusTarget = section.querySelector('button, input, textarea, select');
        focusTarget?.focus({ preventScroll: true });
    }

    maybeOpenAdminSectionFromQuery() {
        if (this.hasHandledRequestedAdminSection || !this.requestedAdminSection || !this.isAdmin()) {
            return;
        }
        this.hasHandledRequestedAdminSection = true;
        if (this.requestedAdminSection === 'home' || this.requestedAdminSection === 'timeline') {
            const targetPath = this.requestedAdminSection === 'home' ? '/?admin=home' : '/timeline/?admin=timeline';
            window.location.assign(targetPath);
            return;
        }
        this.openAdminPanel(this.requestedAdminSection);
        window.requestAnimationFrame(() => this.focusAdminSection(this.requestedAdminSection));
        try {
            const url = new URL(window.location.href);
            url.searchParams.delete('adminSection');
            window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
        } catch (_error) {
            // ignore URL cleanup failures
        }
    }

    closeAdminPanel(force = false) {
        if (!this.adminDom.overlay) {
            return;
        }
        this.stopAdminMetrics();
        this.setAdminPanelScope('map');
        this.adminDom.dialog?.querySelectorAll('.admin-section.is-targeted').forEach(node => {
            node.classList.remove('is-targeted');
        });
        this.adminDom.overlay.classList.remove('open');
        this.adminDom.overlay.hidden = true;
        if (force && this.adminDom.overlay) {
            this.adminDom.overlay.scrollTop = 0;
        }
    }

    bindAdminPanel() {
        if (!this.adminDom.overlay) {
            return;
        }
        this.adminDom.overlay.hidden = true;
        this.setAdminPanelScope('map');
        if (this.adminDom.close && !this.adminDom.close.dataset.bound) {
            this.adminDom.close.addEventListener('click', () => this.closeAdminPanel(true));
            this.adminDom.close.dataset.bound = 'true';
        }
        if (this.adminDom.overlay && !this.adminDom.overlay.dataset.bound) {
            this.adminDom.overlay.addEventListener('click', event => {
                if (event.target === this.adminDom.overlay) {
                    this.closeAdminPanel(true);
                }
            });
            this.adminDom.overlay.dataset.bound = 'true';
        }
        if (this.adminDom.userButton && !this.adminDom.userButton.dataset.bound) {
            this.adminDom.userButton.addEventListener('click', () => this.openUserAdminPanel('users'));
            this.adminDom.userButton.dataset.bound = 'true';
        }
        if (this.adminDom.groupButton && !this.adminDom.groupButton.dataset.bound) {
            this.adminDom.groupButton.addEventListener('click', () => this.openUserAdminPanel('groups'));
            this.adminDom.groupButton.dataset.bound = 'true';
        }
        if (this.adminDom.downloadAssetsButton && !this.adminDom.downloadAssetsButton.dataset.bound) {
            this.adminDom.downloadAssetsButton.addEventListener('click', () => this.downloadAssetsArchive());
            this.adminDom.downloadAssetsButton.dataset.bound = 'true';
        }
        if (this.adminDom.descriptionAuditRefresh && !this.adminDom.descriptionAuditRefresh.dataset.bound) {
            this.adminDom.descriptionAuditRefresh.addEventListener('click', () => this.fetchAdminDescriptionAudit());
            this.adminDom.descriptionAuditRefresh.dataset.bound = 'true';
        }
        if (this.adminDom.homeReloadButton && !this.adminDom.homeReloadButton.dataset.bound) {
            this.adminDom.homeReloadButton.addEventListener('click', () => this.fetchAdminSiteConfig());
            this.adminDom.homeReloadButton.dataset.bound = 'true';
        }
        if (this.adminDom.homeSaveButton && !this.adminDom.homeSaveButton.dataset.bound) {
            this.adminDom.homeSaveButton.addEventListener('click', () => this.saveAdminSiteConfig());
            this.adminDom.homeSaveButton.dataset.bound = 'true';
        }
        if (this.adminDom.timelineReloadButton && !this.adminDom.timelineReloadButton.dataset.bound) {
            this.adminDom.timelineReloadButton.addEventListener('click', () => this.fetchAdminTimeline());
            this.adminDom.timelineReloadButton.dataset.bound = 'true';
        }
        if (this.adminDom.timelineSaveButton && !this.adminDom.timelineSaveButton.dataset.bound) {
            this.adminDom.timelineSaveButton.addEventListener('click', () => this.saveAdminTimeline());
            this.adminDom.timelineSaveButton.dataset.bound = 'true';
        }
        if (this.adminDom.timelineAddEntryButton && !this.adminDom.timelineAddEntryButton.dataset.bound) {
            this.adminDom.timelineAddEntryButton.addEventListener('click', () => this.addAdminTimelineEntry());
            this.adminDom.timelineAddEntryButton.dataset.bound = 'true';
        }
        [
            this.adminDom.homeKicker,
            this.adminDom.homeTitle,
            this.adminDom.homeLead,
            this.adminDom.homeAtmosphere,
            this.adminDom.homeTags,
            this.adminDom.homeMetrics,
            this.adminDom.homeBackgroundImage,
            this.adminDom.homeMapImage,
            this.adminDom.homeCharacterImage,
            this.adminDom.homeFloatingTitle,
            this.adminDom.homeFloatingCopy,
            this.adminDom.homeDiscordUrl,
            this.adminDom.homeDiscordTitle,
            this.adminDom.homeDiscordCopy,
            this.adminDom.homeDiscordProofMode,
            this.adminDom.homeDiscordGuildId,
            this.adminDom.homeDiscordManualCount,
            this.adminDom.homeDiscordProofLabel,
            this.adminDom.homeDiscordProofNote,
            this.adminDom.homeYoutubeUrl,
            this.adminDom.homeYoutubeTitle,
            this.adminDom.homeYoutubeCopy,
            this.adminDom.homeRedditUrl,
            this.adminDom.homeRedditTitle,
            this.adminDom.homeRedditCopy,
            this.adminDom.homeSupportUrl,
            this.adminDom.homeContactEmail,
            this.adminDom.homeCreditsUrl,
            this.adminDom.homeFooterNote,
            this.adminDom.homeChangelog
        ].forEach(element => {
            if (element && !element.dataset.bound) {
                element.addEventListener('input', () => this.markAdminSiteConfigDirty());
                element.dataset.bound = 'true';
            }
        });
        [
            this.adminDom.timelineTitle,
            this.adminDom.timelineSubtitle
        ].forEach(element => {
            if (element && !element.dataset.bound) {
                element.addEventListener('input', () => this.markAdminTimelineDirty());
                element.dataset.bound = 'true';
            }
        });
        this.syncScopedAdminEditors();
    }

    syncAdminStatus() {
        if (!this.adminDom.status) {
            return;
        }
        const isAdmin = this.isAdmin();
        const name = this.auth?.username ? ` (${this.auth.username})` : '';
        this.adminDom.status.textContent = isAdmin
            ? `Connecté en tant qu'administrateur${name}.`
            : 'Connexion administrateur requise.';
    }

    syncAdminValidationWarnings() {
        if (!this.adminDom.validationWarnings) {
            return;
        }
        const warnings = Array.isArray(this.latestValidationWarnings) ? this.latestValidationWarnings : [];
        const list = this.adminDom.validationWarningsList;
        const foot = this.adminDom.validationWarningsFootnote;
        if (list) {
            list.innerHTML = '';
            warnings.forEach(message => {
                const li = document.createElement('li');
                li.textContent = message;
                list.appendChild(li);
            });
        }
        if (this.adminDom.validationWarnings) {
            this.adminDom.validationWarnings.hidden = warnings.length === 0;
        }
        if (foot) {
            foot.hidden = true;
        }
    }

    renderAdminDescriptionAudit() {
        const summary = this.adminDom.descriptionAuditSummary;
        const list = this.adminDom.descriptionAuditList;
        const empty = this.adminDom.descriptionAuditEmpty;
        const button = this.adminDom.descriptionAuditRefresh;
        if (!summary || !list || !empty) {
            return;
        }

        clearElement(list);
        if (button) {
            button.disabled = this.adminDescriptionAuditPending;
            button.textContent = this.adminDescriptionAuditPending ? 'Chargement...' : 'Rafraichir';
        }

        const audit = this.adminDescriptionAudit;
        if (this.adminDescriptionAuditPending) {
            summary.textContent = 'Analyse des descriptions en cours...';
            empty.hidden = true;
            return;
        }
        if (!audit || audit.status !== 'ok') {
            summary.textContent = 'Aucun audit lance.';
            empty.hidden = true;
            return;
        }

        const flagged = Number(audit?.summary?.locationsFlagged) || 0;
        const issues = Number(audit?.summary?.issueCount) || 0;
        summary.textContent = flagged > 0
            ? `${flagged} lieu(x) a revoir - ${issues} signalement(s) narratif(s).`
            : 'Aucune incoherence narrative detectee pour le moment.';

        const items = Array.isArray(audit?.items) ? audit.items : [];
        if (!items.length) {
            empty.hidden = false;
            return;
        }

        empty.hidden = true;
        items.forEach(item => {
            const issueCount = Array.isArray(item?.issues) ? item.issues.length : 0;
            const title = `${item?.continent || 'Continent inconnu'} - ${item?.name || 'Lieu sans nom'} (${issueCount})`;
            const details = Array.isArray(item?.issues) ? item.issues.join(' | ') : '';
            list.appendChild(createElement('li', { text: `${title}: ${details}` }));
        });
    }

    syncAdminTelemetry() {
        if (!this.adminDom.telemetryList || !this.adminDom.telemetryEmpty) {
            return;
        }
        const telemetry = Array.isArray(this.telemetryLog) ? this.telemetryLog.slice(-10) : [];
        this.adminDom.telemetryList.innerHTML = '';
        if (!telemetry.length) {
            this.adminDom.telemetryEmpty.hidden = false;
            return;
        }
        this.adminDom.telemetryEmpty.hidden = true;
        telemetry.forEach(entry => {
            const li = document.createElement('li');
            li.textContent = entry?.description || entry?.title || 'Erreur/évènement';
            this.adminDom.telemetryList.appendChild(li);
        });
    }

    normalizeAdminSiteConfig(config = {}) {
        return normalizeAdminSiteConfigModel(config);
    }

    formatAdminSiteConfigTags(tags = []) {
        return formatAdminSiteConfigTagsValue(tags);
    }

    formatAdminSiteConfigMetrics(metrics = []) {
        return formatAdminSiteConfigMetricsValue(metrics);
    }

    formatAdminSiteConfigChangelog(entries = []) {
        return formatAdminSiteConfigChangelogValue(entries);
    }

    parseAdminDelimitedLines(value = '') {
        return parseAdminDelimitedLinesValue(value);
    }

    parseAdminMetrics(value = '') {
        return parseAdminMetricsValue(value);
    }

    parseAdminChangelog(value = '') {
        return parseAdminChangelogValue(value);
    }

    setAdminHomeStatus(message, isError = false) {
        return setAdminHomeStatusPanel(this, message, isError);
    }

    renderAdminHomeErrors(errors = []) {
        return renderAdminHomeErrorsPanel(this, errors);
    }

    syncAdminHomeEditor() {
        return syncAdminHomeEditorPanel(this);
    }

    renderAdminSiteConfig() {
        return renderAdminSiteConfigPanel(this);
    }

    collectAdminSiteConfigDraft() {
        return collectAdminSiteConfigDraftPanel(this);
    }

    validateAdminSiteConfigDraft(config) {
        return validateAdminSiteConfigDraftModel(config);
    }

    markAdminSiteConfigDirty() {
        return markAdminSiteConfigDirtyPanel(this);
    }

    async fetchAdminSiteConfig() {
        return fetchAdminSiteConfigPanel(this);
    }

    async saveAdminSiteConfig() {
        return saveAdminSiteConfigPanel(this);
    }

    normalizeAdminTimeline(config = {}) {
        return normalizeAdminTimelineModel(this.normalizeAdminTimelineEntry.bind(this), config);
    }

    normalizeAdminTimelineEntry(entry = {}, index = 0) {
        return normalizeAdminTimelineEntryModel(entry, index);
    }

    createAdminTimelineEntry(index = 0) {
        return createAdminTimelineEntryModel(this.normalizeAdminTimelineEntry.bind(this), index);
    }

    parseAdminTokenList(value = '') {
        return parseAdminTokenListValue(value);
    }

    setAdminTimelineStatus(message, isError = false) {
        return setAdminTimelineStatusPanel(this, message, isError);
    }

    renderAdminTimelineErrors(errors = []) {
        return renderAdminTimelineErrorsPanel(this, errors);
    }

    syncAdminTimelineEditor() {
        return syncAdminTimelineEditorPanel(this);
    }

    renderAdminTimelineConfig() {
        return renderAdminTimelineConfigPanel(this);
    }

    renderAdminTimelineList() {
        return renderAdminTimelineListPanel(this);
    }

    createAdminTimelineEntryCard(entry, index) {
        return createAdminTimelineEntryCardPanel(this, entry, index);
    }

    addAdminTimelineEntry() {
        return addAdminTimelineEntryPanel(this);
    }

    moveAdminTimelineEntry(index, direction) {
        return moveAdminTimelineEntryPanel(this, index, direction);
    }

    removeAdminTimelineEntry(index) {
        return removeAdminTimelineEntryPanel(this, index);
    }

    collectAdminTimelineDraft() {
        return collectAdminTimelineDraftPanel(this);
    }

    validateAdminTimelineDraft(timeline) {
        return validateAdminTimelineDraftModel(timeline);
    }

    markAdminTimelineDirty() {
        return markAdminTimelineDirtyPanel(this);
    }

    async fetchAdminTimeline() {
        return fetchAdminTimelinePanel(this);
    }

    async saveAdminTimeline() {
        return saveAdminTimelinePanel(this);
    }

    renderAdminMetrics() {
        const container = this.adminDom.liveMetrics;
        const empty = this.adminDom.liveEmpty;
        if (!container || !empty) {
            return;
        }
        clearElement(container);
        const metrics = this.adminMetrics;
        if (!metrics || metrics.status !== 'ok') {
            empty.hidden = false;
            return;
        }
        empty.hidden = true;

        const sse = metrics.sse || {};
        const uptimeMs = Number(metrics.uptimeMs) || 0;
        const uptimeMinutes = Math.floor(uptimeMs / 60000);
        const uptimeHours = Math.floor(uptimeMinutes / 60);
        const uptimeLabel = uptimeHours > 0
            ? `${uptimeHours}h ${uptimeMinutes % 60}m`
            : `${uptimeMinutes}m`;

        const items = [
            { label: 'Clients SSE', value: sse.clients ?? 0 },
            { label: 'Evenements SSE', value: sse.broadcastCount ?? 0 },
            { label: 'Dernier event', value: sse.lastEventName || '-' },
            { label: 'Dernier envoi', value: sse.lastEventAt ? new Date(sse.lastEventAt).toLocaleTimeString() : '-' },
            { label: 'Uptime', value: uptimeLabel },
            { label: 'Latence', value: metrics.latencyMs ? `${Math.round(metrics.latencyMs)} ms` : '-' }
        ];

        items.forEach(item => {
            const card = createElement('div', { className: 'admin-live-card' });
            card.appendChild(createElement('span', { className: 'admin-live-label', text: item.label }));
            card.appendChild(createElement('span', { className: 'admin-live-value', text: String(item.value) }));
            container.appendChild(card);
        });
    }

    async fetchAdminDescriptionAudit() {
        if (!this.adminDom.descriptionAuditSummary || !this.adminDom.descriptionAuditList || !this.adminDom.descriptionAuditEmpty) {
            return;
        }
        if (!this.isAdmin()) {
            this.adminDescriptionAudit = null;
            this.adminDescriptionAuditPending = false;
            this.renderAdminDescriptionAudit();
            return;
        }
        this.adminDescriptionAuditPending = true;
        this.renderAdminDescriptionAudit();
        try {
            const response = await fetch('/api/admin/locations/description-audit', {
                credentials: 'include',
                cache: 'no-store'
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            this.adminDescriptionAudit = await response.json();
        } catch (error) {
            console.error('[admin] description audit fetch failed', error);
            this.adminDescriptionAudit = null;
        } finally {
            this.adminDescriptionAuditPending = false;
            this.renderAdminDescriptionAudit();
        }
    }

    async fetchAdminMetrics() {
        if (!this.adminDom.liveMetrics || !this.adminDom.liveEmpty) {
            return;
        }
        if (!this.isAdmin()) {
            this.adminMetrics = null;
            this.renderAdminMetrics();
            return;
        }
        const start = performance.now();
        try {
            const response = await fetch('/api/admin/metrics', { credentials: 'include', cache: 'no-store' });
            const latencyMs = performance.now() - start;
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const payload = await response.json();
            this.adminMetrics = { ...payload, latencyMs };
            this.renderAdminMetrics();
        } catch (error) {
            console.error('[admin] metrics fetch failed', error);
            this.adminMetrics = null;
            this.renderAdminMetrics();
        }
    }

    startAdminMetrics() {
        if (!this.adminDom.liveMetrics) {
            return;
        }
        if (this.adminMetricsInterval) {
            clearInterval(this.adminMetricsInterval);
        }
        this.fetchAdminMetrics();
        this.adminMetricsInterval = setInterval(() => {
            if (!this.adminDom.overlay || this.adminDom.overlay.hidden) {
                this.stopAdminMetrics();
                return;
            }
            this.fetchAdminMetrics();
        }, 5000);
    }

    stopAdminMetrics() {
        if (this.adminMetricsInterval) {
            clearInterval(this.adminMetricsInterval);
            this.adminMetricsInterval = null;
        }
    }

    bindAssetsDownloadButton() {
        const button = this.adminDom.downloadAssetsButton || this.dom.downloadAssetsButton;
        if (!button || button.dataset.bound) {
            return;
        }
        button.addEventListener('click', event => {
            event.preventDefault();
            this.downloadAssetsArchive();
        });
        button.dataset.bound = 'true';
    }

    async fetchUsersList() {
        const response = await fetch('/api/admin/users', { credentials: 'include' });
        if (!response.ok) {
            const error = new Error(`HTTP ${response.status}`);
            error.status = response.status;
            this.logTelemetryEvent({
                title: 'Admin users - chargement echoue',
                description: error.message,
                route: '/api/admin/users',
                method: 'GET',
                status: response.status
            });
            throw error;
        }
        const payload = await response.json();
        return Array.isArray(payload?.users) ? payload.users : [];
    }

    async fetchGroupsList() {
        const response = await fetch('/api/admin/groups', { credentials: 'include' });
        if (!response.ok) {
            const error = new Error(`HTTP ${response.status}`);
            error.status = response.status;
            this.logTelemetryEvent({
                title: 'Admin groups - chargement echoue',
                description: error.message,
                route: '/api/admin/groups',
                method: 'GET',
                status: response.status
            });
            throw error;
        }
        const payload = await response.json();
        return Array.isArray(payload?.groups) ? payload.groups : [];
    }

    async createUser(payload) {
        try {
            const response = await fetch('/api/admin/users', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    provider: 'manual',
                    username: payload.username,
                    role: payload.role
                })
            });
            if (!response.ok) {
                const error = new Error(`HTTP ${response.status}`);
                error.status = response.status;
                this.logTelemetryEvent({
                    title: 'Admin users - creation',
                    description: error.message,
                    route: '/api/admin/users',
                    method: 'POST',
                    status: response.status
                });
                throw error;
            }
            const result = await response.json();
            if (result?.token) {
                window.prompt('Nouvel utilisateur cree. Copiez le token API :', result.token);
            }
            await this.refreshUserAdminPanel();
            this.userAdminPanel?.resetAddForm();
            this.announcer?.polite?.('Utilisateur manuel ajoute.');
        } catch (error) {
            console.error('[admin] create user failed', error);
            this.announcer?.assertive?.("Impossible de creer l'utilisateur.");
            this.logTelemetryEvent({
                title: 'Admin users - creation',
                description: error?.message || 'Echec creation utilisateur',
                route: '/api/admin/users',
                method: 'POST',
                status: error?.status || null
            });
        }
    }

    async createGroup(payload) {
        const name = (payload?.name || '').toString().trim();
        if (!name) {
            this.announcer?.assertive?.('Nom de groupe manquant.');
            return;
        }
        try {
            const response = await fetch('/api/admin/groups', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    color: payload?.color || ''
                })
            });
            if (!response.ok) {
                const error = new Error(`HTTP ${response.status}`);
                error.status = response.status;
                this.logTelemetryEvent({
                    title: 'Admin groups - creation',
                    description: error.message,
                    route: '/api/admin/groups',
                    method: 'POST',
                    status: response.status
                });
                throw error;
            }
            await this.refreshUserAdminPanel();
            this.userAdminPanel?.resetGroupForm();
            await this.fetchSession();
            await this.fetchGroups();
            this.announcer?.polite?.('Groupe cree.');
        } catch (error) {
            console.error('[admin] create group failed', error);
            this.announcer?.assertive?.('Impossible de creer le groupe.');
            this.logTelemetryEvent({
                title: 'Admin groups - creation',
                description: error?.message || 'Echec creation groupe',
                route: '/api/admin/groups',
                method: 'POST',
                status: error?.status || null
            });
        }
    }

    async updateUser(payload) {
        try {
            const response = await fetch('/api/admin/users', {
                method: 'PATCH',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!response.ok) {
                const error = new Error(`HTTP ${response.status}`);
                error.status = response.status;
                this.logTelemetryEvent({
                    title: 'Admin users - mise a jour',
                    description: error.message,
                    route: '/api/admin/users',
                    method: 'PATCH',
                    status: response.status
                });
                throw error;
            }
            const result = await response.json();
            if (result?.token) {
                window.prompt('Nouveau token genere :', result.token);
            }
            await this.refreshUserAdminPanel();
            this.announcer?.polite?.('Utilisateur mis a jour.');
        } catch (error) {
            console.error('[admin] update user failed', error);
            this.announcer?.assertive?.('Mise a jour impossible.');
            this.logTelemetryEvent({
                title: 'Admin users - mise a jour',
                description: error?.message || 'Echec mise a jour utilisateur',
                route: '/api/admin/users',
                method: 'PATCH',
                status: error?.status || null
            });
        }
    }

    async updateGroup(payload) {
        const id = (payload?.id || '').toString().trim();
        const name = (payload?.name || '').toString().trim();
        if (!id || !name) {
            this.announcer?.assertive?.('Groupe invalide.');
            return;
        }
        try {
            const response = await fetch('/api/admin/groups', {
                method: 'PATCH',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id,
                    name,
                    color: payload?.color || ''
                })
            });
            if (!response.ok) {
                const error = new Error(`HTTP ${response.status}`);
                error.status = response.status;
                this.logTelemetryEvent({
                    title: 'Admin groups - mise a jour',
                    description: error.message,
                    route: '/api/admin/groups',
                    method: 'PATCH',
                    status: response.status
                });
                throw error;
            }
            await this.refreshUserAdminPanel();
            await this.fetchSession();
            await this.fetchGroups();
            this.announcer?.polite?.('Groupe mis a jour.');
        } catch (error) {
            console.error('[admin] update group failed', error);
            this.announcer?.assertive?.('Mise a jour du groupe impossible.');
            this.logTelemetryEvent({
                title: 'Admin groups - mise a jour',
                description: error?.message || 'Echec mise a jour groupe',
                route: '/api/admin/groups',
                method: 'PATCH',
                status: error?.status || null
            });
        }
    }

    async updateGroups(groups) {
        if (!Array.isArray(groups) || !groups.length) {
            this.announcer?.assertive?.('Aucun groupe a mettre a jour.');
            return;
        }
        try {
            const response = await fetch('/api/admin/groups', {
                method: 'PATCH',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ groups })
            });
            if (!response.ok) {
                const error = new Error(`HTTP ${response.status}`);
                error.status = response.status;
                this.logTelemetryEvent({
                    title: 'Admin groups - mise a jour globale',
                    description: error.message,
                    route: '/api/admin/groups',
                    method: 'PATCH',
                    status: response.status
                });
                throw error;
            }
            await this.refreshUserAdminPanel();
            await this.fetchSession();
            await this.fetchGroups();
            this.announcer?.polite?.('Tous les groupes ont ete mis a jour.');
        } catch (error) {
            console.error('[admin] update all groups failed', error);
            this.announcer?.assertive?.('Mise a jour des groupes impossible.');
            this.logTelemetryEvent({
                title: 'Admin groups - mise a jour globale',
                description: error?.message || 'Echec mise a jour groupes',
                route: '/api/admin/groups',
                method: 'PATCH',
                status: error?.status || null
            });
        }
    }

    async removeUser(user) {
        const confirmed = window.confirm(`Supprimer l'utilisateur "${user.username || user.id}" ?`);
        if (!confirmed) {
            return;
        }
        try {
            const response = await fetch('/api/admin/users', {
                method: 'DELETE',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: user.id })
            });
            if (!response.ok) {
                const error = new Error(`HTTP ${response.status}`);
                error.status = response.status;
                this.logTelemetryEvent({
                    title: 'Admin users - suppression',
                    description: error.message,
                    route: '/api/admin/users',
                    method: 'DELETE',
                    status: response.status
                });
                throw error;
            }
            await this.refreshUserAdminPanel();
            this.announcer?.polite?.('Utilisateur supprime.');
        } catch (error) {
            console.error('[admin] delete user failed', error);
            this.announcer?.assertive?.('Suppression impossible.');
            this.logTelemetryEvent({
                title: 'Admin users - suppression',
                description: error?.message || 'Echec suppression utilisateur',
                route: '/api/admin/users',
                method: 'DELETE',
                status: error?.status || null
            });
        }
    }

    async removeGroup(group) {
        const confirmed = window.confirm(`Supprimer le groupe "${group.name || group.id}" ?`);
        if (!confirmed) {
            return;
        }
        try {
            const response = await fetch('/api/admin/groups', {
                method: 'DELETE',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: group.id })
            });
            if (!response.ok) {
                const error = new Error(`HTTP ${response.status}`);
                error.status = response.status;
                this.logTelemetryEvent({
                    title: 'Admin groups - suppression',
                    description: error.message,
                    route: '/api/admin/groups',
                    method: 'DELETE',
                    status: response.status
                });
                throw error;
            }
            await this.refreshUserAdminPanel();
            await this.fetchSession();
            await this.fetchGroups();
            this.announcer?.polite?.('Groupe supprime.');
        } catch (error) {
            console.error('[admin] delete group failed', error);
            this.announcer?.assertive?.('Suppression du groupe impossible.');
            this.logTelemetryEvent({
                title: 'Admin groups - suppression',
                description: error?.message || 'Echec suppression groupe',
                route: '/api/admin/groups',
                method: 'DELETE',
                status: error?.status || null
            });
        }
    }

    async refreshUserAdminPanel() {
        if (!this.userAdminPanel) {
            return;
        }
        try {
            const mode = this.userAdminMode || 'users';
            let users = [];
            let groups = [];
            if (mode === 'users') {
                users = await this.fetchUsersList();
                try {
                    groups = await this.fetchGroupsList();
                } catch (error) {
                    console.error('[admin] fetch groups failed', error);
                    this.logTelemetryEvent({
                        title: 'Admin groups - chargement',
                        description: error?.message || 'Echec chargement groupes',
                        route: '/api/admin/groups',
                        method: 'GET',
                        status: error?.status || null
                    });
                }
            } else {
                try {
                    groups = await this.fetchGroupsList();
                } catch (error) {
                    console.error('[admin] fetch groups failed', error);
                    this.logTelemetryEvent({
                        title: 'Admin groups - chargement',
                        description: error?.message || 'Echec chargement groupes',
                        route: '/api/admin/groups',
                        method: 'GET',
                        status: error?.status || null
                    });
                }
            }
            await this.userAdminPanel.refresh({ users, groups });
        } catch (error) {
            console.error('[admin] fetch users failed', error);
            this.announcer?.assertive?.('Impossible de charger la liste des utilisateurs.');
            this.logTelemetryEvent({
                title: 'Admin users - chargement',
                description: error?.message || 'Echec chargement utilisateurs',
                route: '/api/admin/users',
                method: 'GET',
                status: error?.status || null
            });
        }
    }

    async downloadAssetsArchive() {
        if (!this.isAdmin()) {
            this.announcer?.assertive?.('Connexion administrateur requise.');
            return;
        }
        const button = this.adminDom.downloadAssetsButton || this.dom.downloadAssetsButton;
        if (button) {
            button.disabled = true;
        }
        try {
            await this.triggerAssetsDownload();
            this.announcer?.polite?.('Téléchargement des assets lancé (vérifie tes téléchargements).');
        } catch (error) {
            console.error('[admin] assets download failed', error);
            this.announcer?.assertive?.(error?.message || 'Téléchargement échoué.');
            this.logTelemetryEvent({
                title: 'Download assets',
                description: error?.message || 'Echec telechargement assets',
                route: '/api/admin/assets.zip',
                method: 'GET',
                status: error?.status || null
            });
        } finally {
            if (button) {
                setTimeout(() => {
                    button.disabled = false;
                }, 800);
            }
        }
    }

    async triggerAssetsDownload() {
        // Crée un lien invisible et clique dessus pour n'envoyer qu'une requête.
        const anchor = document.createElement('a');
        anchor.href = '/api/admin/assets.zip';
        anchor.download = 'assets.zip';
        anchor.rel = 'noopener';
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
    }

    async openUserAdminPanel(mode = 'users') {
        if (!this.isAdmin()) {
            this.announcer?.assertive?.('Connexion administrateur requise.');
            return;
        }
        if (!this.dom.userAdminOverlay || !this.userAdminPanel) {
            return;
        }
        if (mode !== 'users' && mode !== 'groups') {
            mode = 'users';
        }
        this.userAdminMode = mode;
        this.userAdminPanel.setMode?.(mode);
        await this.refreshUserAdminPanel();
        this.closeCharacterOverlay();
        this.dom.userAdminOverlay.hidden = false;
        this.dom.userAdminOverlay.classList.add('open');
    }

    closeUserAdminPanel(force = false) {
        if (!this.dom.userAdminOverlay) {
            return;
        }
        this.dom.userAdminOverlay.classList.remove('open');
        this.dom.userAdminOverlay.hidden = true;
        if (force) {
            this.dom.userAdminOverlay.scrollTop = 0;
        }
    }

    bindTabs() {
        const attach = (button, view) => {
            if (!button) {
                return;
            }
            button.addEventListener('click', () => this.setSidebarView(view));
            button.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    this.setSidebarView(view);
                }
            });
        };

        attach(this.dom.tabAll, 'all');
        attach(this.dom.tabFavorites, 'favorites');
    }

    bindLocationLinks() {
        const container = this.dom.infoSidebar;
        if (!container || container.dataset.locationLinksBound) {
            return;
        }
        container.dataset.locationLinksBound = 'true';
        container.addEventListener('click', event => {
            const link = event.target?.closest('a');
            if (!link) {
                return;
            }
            const href = link.getAttribute('href') || '';
            if (!href.startsWith('#location:')) {
                return;
            }
            event.preventDefault();
            const fromDataset = link.dataset?.location;
            let name = fromDataset || '';
            if (!name) {
                try {
                    name = decodeURIComponent(href.slice('#location:'.length));
                } catch (error) {
                    name = href.slice('#location:'.length);
                }
            }
            if (!name) {
                return;
            }
            this.focusLocationByName(name);
        });
    }

    bindToggleAll() {
        if (!this.dom.toggleAll) {
            return;
        }
        this.updateToggleAllLabel();
        this.dom.toggleAll.addEventListener('click', () => {
            this.toggleAllState = !this.toggleAllState;
            this.continents.forEach(section => this.setContinentExpanded(section, this.toggleAllState));
            this.updateToggleAllLabel();
        });
    }

    bindClustering() {
        const toggle = this.dom.clusteringToggle;
        if (!toggle) {
            return;
        }
        const stored = Boolean(this.preferences?.getClustering?.());
        toggle.checked = stored;
        this.mapController.setClusteringEnabled(stored);

        toggle.addEventListener('change', () => {
            const enabled = toggle.checked;
            this.mapController.setClusteringEnabled(enabled);
            if (this.preferences?.setClustering) {
                this.preferences.setClustering(enabled);
            }
            this.updateClusteringMetrics();
            this.dismissOnboarding('clustering');
        });

        const container = toggle.closest('#clustering-container') || toggle;
        this.attachHoverTooltip(container, this.clusteringTooltip, { placement: 'bottom' });
    }

    bindMarkerScale() {
        const input = this.dom.markerScaleInput;
        if (!input) {
            return;
        }
        const stored = this.preferences?.getMarkerScale?.();
        if (typeof stored === 'number') {
            this.setMarkerScale(stored, { persist: false });
            input.value = String(Math.round(stored));
        } else {
            this.setMarkerScale(Number(input.value) || 100, { persist: false });
        }

        input.addEventListener('input', () => {
            this.setMarkerScale(input.value, { persist: false });
        });

        input.addEventListener('change', () => {
            this.setMarkerScale(input.value, { persist: true });
        });
    }

    bindFavoriteToggle() {
        if (!this.dom.favoriteToggle) {
            return;
        }
        this.dom.favoriteToggle.addEventListener('click', () => {
            if (!this.activeEntry) {
                return;
            }
            const location = this.activeEntry.location;
            this.setFavoriteState(location, !this.state.hasFavorite(location.name));
        });
        this.attachHoverTooltip(this.dom.favoriteToggle, this.favoriteTooltip, { placement: 'left' });
    }

    bindRandomButton() {
        if (!this.dom.randomButton) {
            return;
        }
        this.dom.randomButton.addEventListener('click', () => this.goToRandomLocation());
    }

    bindCoordinateTool() {
        const button = this.dom.captureCoordinates;
        if (!button) {
            return;
        }

        this.updateCoordinateButton();
        button.addEventListener('click', () => {
            if (this.coordinateTool.active) {
                this.stopCoordinateMode(true);
            } else {
                this.startCoordinateMode();
            }
        });
    }

    bindMeasurementTool() {
        const button = this.dom.measureDistance;
        if (!button) {
            return;
        }

        this.updateMeasurementButton();
        button.addEventListener('click', () => {
            if (this.measurement.active) {
                this.stopMeasurementMode(true);
            } else {
                this.startMeasurementMode();
            }
        });
    }

    startMeasurementMode() {
        if (this.measurement.active) {
            return;
        }
        if (this.coordinateTool.active) {
            this.stopCoordinateMode(false);
        }
        if (this.annotationTool.active) {
            this.stopAnnotationMode(false);
        }
        if (this.temporaryPaintTool.active) {
            this.stopTemporaryPaintMode(false);
        }
        this.measurement.active = true;
        this.measurement.points = [];
        if (!this.measurementClickUnsubscribe && this.mapController) {
            this.measurementClickUnsubscribe = this.mapController.onMapClick(event => this.handleMeasurementClick(event));
        }
        this.updateMeasurementButton();
        const message = localized('distance.active', 'Outil de mesure actif. Cliquez deux points sur la carte pour calculer la distance.');
        this.announcer?.polite(message);
        this.showControlMessage({
            button: this.dom.measureDistance,
            tooltip: this.measureTooltip,
            message,
            duration: 3000
        });
    }

    stopMeasurementMode(announce = false) {
        if (!this.measurement.active) {
            return;
        }
        this.measurement.active = false;
        this.measurement.points = [];
        if (this.measurementClickUnsubscribe) {
            this.measurementClickUnsubscribe();
            this.measurementClickUnsubscribe = null;
        }
        this.updateMeasurementButton();
        this.clearControlMessage(this.measureTooltip);
        if (announce) {
            const message = localized('distance.cancelled', 'Outil de mesure desactive.');
            this.announcer?.polite(message);
        }
    }

    handleMeasurementClick(event) {
        if (!this.measurement.active) {
            return;
        }
        const coords = this.mapController?.toPixelCoordinates(event?.latlng);
        if (!coords) {
            return;
        }
        const roundedX = Math.round(coords.x);
        const roundedY = Math.round(coords.y);
        this.measurement.points.push({ x: coords.x, y: coords.y });
        console.info(`Mesure - point ${this.measurement.points.length} -> x: ${roundedX}, y: ${roundedY}`);

        if (this.measurement.points.length === 1) {
            const message = localized('distance.pointStored', `Point de depart enregistre : x ${roundedX}, y ${roundedY}.`, { x: roundedX, y: roundedY });
            this.announcer?.polite(message);
            this.showControlMessage({
                button: this.dom.measureDistance,
                tooltip: this.measureTooltip,
                message,
                duration: 3000
            });
            return;
        }

        const start = this.measurement.points.shift();
        const dx = coords.x - start.x;
        const dy = coords.y - start.y;
        const distancePx = Math.hypot(dx, dy);
        const distanceKm = distancePx * KM_PER_PIXEL;
        const message = localized(
            'distance.result',
            `Distance : ${distanceKm.toFixed(1)} km (${distancePx.toFixed(1)} px).`,
            { distance: distanceKm.toFixed(1), pixels: distancePx.toFixed(1) }
        );
        console.info(`Mesure - distance = ${distancePx.toFixed(2)} px (${distanceKm.toFixed(2)} km)`);
        this.announcer?.polite(message);
        this.showControlMessage({
            button: this.dom.measureDistance,
            tooltip: this.measureTooltip,
            message,
            duration: 5000
        });
        this.measurement.points = [];
    }

    updateMeasurementButton() {
        const button = this.dom.measureDistance;
        if (!button) {
            return;
        }
        const active = Boolean(this.measurement.active);
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
        const label = localized(
            active ? 'distance.active' : 'distance.enable',
            active
                ? 'Outil de mesure actif. Cliquez deux points sur la carte pour calculer la distance.'
                : 'Activer la mesure de distance'
        );
        button.setAttribute('aria-label', label);
        button.title = label;
    }

    updateCoordinateButton() {
        const button = this.dom.captureCoordinates;
        if (!button) {
            return;
        }
        const active = Boolean(this.coordinateTool.active);
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
        const label = localized(
            active ? 'coords.active' : 'coords.enable',
            active
                ? 'Outil de capture actif. Cliquez sur la carte pour obtenir les coordonnees.'
                : 'Activer l\'outil d\'obtention des coordonnees'
        );
        button.setAttribute('aria-label', label);
        button.title = label;
    }

    startCoordinateMode() {
        if (this.coordinateTool.active) {
            return;
        }
        if (this.measurement.active) {
            this.stopMeasurementMode(false);
        }
        if (this.annotationTool.active) {
            this.stopAnnotationMode(false);
        }
        if (this.temporaryPaintTool.active) {
            this.stopTemporaryPaintMode(false);
        }
        this.coordinateTool.active = true;
        if (!this.coordinateClickUnsubscribe && this.mapController) {
            this.coordinateClickUnsubscribe = this.mapController.onMapClick(event => this.handleCoordinateClick(event));
        }
        this.updateCoordinateButton();
        const message = localized('coords.active', 'Outil de capture actif. Cliquez sur la carte pour obtenir les coordonnees.');
        this.announcer?.polite(message);
        this.showControlMessage({
            button: this.dom.captureCoordinates,
            tooltip: this.coordinateTooltip,
            message,
            duration: 3000
        });
    }

    stopCoordinateMode(announce = false) {
        if (!this.coordinateTool.active) {
            return;
        }
        this.coordinateTool.active = false;
        if (this.coordinateClickUnsubscribe) {
            this.coordinateClickUnsubscribe();
            this.coordinateClickUnsubscribe = null;
        }
        this.updateCoordinateButton();
        this.clearControlMessage(this.coordinateTooltip);
        if (announce) {
            const message = localized('coords.cancelled', 'Outil de coordonnees desactive.');
            this.announcer?.polite(message);
        }
    }

    handleCoordinateClick(event) {
        if (!this.coordinateTool.active) {
            return;
        }
        const coords = this.mapController?.toPixelCoordinates(event?.latlng);
        if (!coords) {
            return;
        }
        const roundedX = Math.round(coords.x);
        const roundedY = Math.round(coords.y);
        console.info(`Coordonnees - x: ${roundedX}, y: ${roundedY}`);
        const message = localized('coords.result', `Coordonnees : x ${roundedX} px, y ${roundedY} px.`, { x: roundedX, y: roundedY });
        this.announcer?.polite(message);
        this.showControlMessage({
            button: this.dom.captureCoordinates,
            tooltip: this.coordinateTooltip,
            message,
            duration: 4000
        });
    }

    bindAnnotationTool() {
        const button = this.dom.annotationButton;
        if (!button) {
            return;
        }
        this.updateAnnotationButton();
        button.addEventListener('click', () => {
            if (this.annotationTool.active) {
                this.stopAnnotationMode(true);
            } else {
                this.startAnnotationMode();
            }
        });
    }

    bindTemporaryPaintTool() {
        const paintButton = this.dom.temporaryPaintButton;
        if (paintButton) {
            this.updateTemporaryPaintButton();
            paintButton.addEventListener('click', () => {
                if (this.temporaryPaintTool.active) {
                    this.stopTemporaryPaintMode(true);
                } else {
                    this.startTemporaryPaintMode();
                }
            });
        }

        const clearButton = this.dom.clearTemporaryPaintButton;
        if (clearButton) {
            clearButton.addEventListener('click', () => this.clearTemporaryPaint(true));
        }
    }

    updateTemporaryPaintButton() {
        const button = this.dom.temporaryPaintButton;
        if (!button) {
            return;
        }
        const active = Boolean(this.temporaryPaintTool.active);
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
        const label = active
            ? 'Peinture ephemere active. Cliquez sur la carte pour tracer un schema temporaire.'
            : 'Activer la peinture ephemere';
        button.setAttribute('aria-label', label);
        button.title = label;
    }

    startTemporaryPaintMode() {
        if (this.temporaryPaintTool.active) {
            return;
        }
        if (this.measurement.active) {
            this.stopMeasurementMode(false);
        }
        if (this.coordinateTool.active) {
            this.stopCoordinateMode(false);
        }
        if (this.annotationTool.active) {
            this.stopAnnotationMode(false);
        }
        if (this.groupPlacement?.active) {
            this.stopGroupPlacement(false);
        }
        this.temporaryPaintTool.active = true;
        if (!this.temporaryPaintClickUnsubscribe && this.mapController) {
            this.temporaryPaintClickUnsubscribe = this.mapController.onMapClick(event => this.handleTemporaryPaintClick(event));
        }
        this.updateTemporaryPaintButton();
        const message = 'Peinture ephemere active. Cliquez plusieurs points sur la carte pour tracer un schema local, puis effacez-le avec le bouton gomme.';
        this.announcer?.polite(message);
        this.showControlMessage({
            button: this.dom.temporaryPaintButton,
            tooltip: this.temporaryPaintTooltip,
            message,
            duration: 5000
        });
    }

    stopTemporaryPaintMode(announce = false) {
        if (!this.temporaryPaintTool.active) {
            return;
        }
        this.temporaryPaintTool.active = false;
        if (this.temporaryPaintClickUnsubscribe) {
            this.temporaryPaintClickUnsubscribe();
            this.temporaryPaintClickUnsubscribe = null;
        }
        this.updateTemporaryPaintButton();
        this.clearControlMessage(this.temporaryPaintTooltip);
        if (announce) {
            this.announcer?.polite('Peinture ephemere desactivee.');
        }
    }

    handleTemporaryPaintClick(event) {
        if (!this.temporaryPaintTool.active) {
            return;
        }
        const coords = this.mapController?.toPixelCoordinates(event?.latlng);
        if (!coords) {
            return;
        }
        const count = this.mapController.addTemporaryPaintPoint({
            x: coords.x,
            y: coords.y
        });
        const roundedX = Math.round(coords.x);
        const roundedY = Math.round(coords.y);
        const message = count > 1
            ? `Trace temporaire mise a jour : ${count} points.`
            : `Premier point temporaire place : x ${roundedX}, y ${roundedY}.`;
        this.announcer?.polite(message);
    }

    clearTemporaryPaint(announce = false) {
        this.mapController?.clearTemporaryPaint?.();
        if (announce) {
            this.announcer?.polite('Traces temporaires effacees.');
        }
    }

    updateAnnotationButton() {
        const button = this.dom.annotationButton;
        if (!button) {
            return;
        }
        button.setAttribute('aria-pressed', String(Boolean(this.annotationTool.active)));
        const disabled = !this.auth?.authenticated;
        button.disabled = disabled;
        button.setAttribute('aria-disabled', String(disabled));
        if (disabled && this.annotationTool.active) {
            this.stopAnnotationMode(false);
        }
    }

    startAnnotationMode() {
        if (this.annotationTool.active) {
            return;
        }
        if (!this.auth?.authenticated) {
            this.announcer?.assertive?.('Connexion requise pour ajouter une annotation.');
            return;
        }
        if (this.measurement.active) {
            this.stopMeasurementMode(false);
        }
        if (this.coordinateTool.active) {
            this.stopCoordinateMode(false);
        }
        if (this.temporaryPaintTool.active) {
            this.stopTemporaryPaintMode(false);
        }
        this.annotationTool.active = true;
        if (!this.annotationTool.clickUnsubscribe && this.mapController) {
            this.annotationTool.clickUnsubscribe = this.mapController.onMapClick(event => this.handleAnnotationClick(event));
        }
        this.updateAnnotationButton();
        const message = 'Cliquez sur la carte pour placer une annotation.';
        this.announcer?.polite(message);
        this.showControlMessage({
            button: this.dom.annotationButton,
            tooltip: this.annotationTooltip,
            message,
            duration: 4000
        });
    }

    stopAnnotationMode(announce = false) {
        if (!this.annotationTool.active) {
            return;
        }
        this.annotationTool.active = false;
        if (this.annotationTool.clickUnsubscribe) {
            this.annotationTool.clickUnsubscribe();
            this.annotationTool.clickUnsubscribe = null;
        }
        this.updateAnnotationButton();
        this.clearControlMessage(this.annotationTooltip);
        if (announce) {
            this.announcer?.polite('Mode annotation desactive.');
        }
    }

    async handleAnnotationClick(event) {
        if (!this.annotationTool.active) {
            return;
        }
        const coords = this.mapController?.toPixelCoordinates(event?.latlng);
        if (!coords) {
            return;
        }
        const roundedX = Math.round(coords.x);
        const roundedY = Math.round(coords.y);
        const details = this.promptAnnotationDetails({ x: roundedX, y: roundedY });
        if (!details) {
            this.stopAnnotationMode(false);
            return;
        }
        await this.createAnnotation({
            x: roundedX,
            y: roundedY,
            label: details.label,
            color: details.color,
            icon: details.icon || null,
            scope: details.scope, groupId: details.groupId, confirm: details.confirm
        });
        this.stopAnnotationMode(false);
    }

    promptAnnotationDetails({ x, y }) {
        const labelInput = window.prompt(`Annotation - (${x}, ${y})\nTitre de l'annotation :`, '');
        const label = labelInput ? labelInput.trim() : '';
        if (!label) {
            this.announcer?.polite('Annotation annulee.');
            return null;
        }
        const colorInput = window.prompt('Couleur hex (ex: #ff8a00) ou laissez vide :', '#ff8a00') || '#ff8a00';
        const color = this.normalizeAnnotationColor(colorInput);
        const normalizedScope = (window.prompt('Portée : PRIVATE, GROUP ou GM (PUBLIC réservé aux administrateurs)', 'PRIVATE') || 'PRIVATE').trim().toUpperCase();
        if (!['PRIVATE', 'GROUP', 'GM', 'PUBLIC', 'ADMIN'].includes(normalizedScope)) return null;
        const groupId = ['GROUP', 'GM'].includes(normalizedScope) ? window.prompt('Identifiant du groupe autorisé :', '')?.trim() : undefined;
        const confirm = normalizedScope === 'PUBLIC' ? window.confirm('Publier cette annotation pour tous les visiteurs ?') : undefined;
        return {
            label,
            color,
            scope: normalizedScope, groupId, confirm
        };
    }

    normalizeAnnotationColor(value) {
        return normalizeAnnotationColorValue(value);
    }

    async createAnnotation(annotation) {
        if (!annotation || !this.auth?.authenticated) {
            return;
        }
        try {
            const locationName = this.activeEntry?.location?.name || '';
            const response = await fetch('/api/annotations', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    x: annotation.x,
                    y: annotation.y,
                    label: annotation.label,
                    color: annotation.color,
                    scope: annotation.scope, groupId: annotation.groupId, confirm: annotation.confirm,
                    locationName: locationName
                })
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const payload = await response.json();
            if (payload?.annotation) {
                const annotationId = normalizeAnnotationId(payload.annotation.id);
                if (!annotationId) {
                    throw new Error('Missing annotation id');
                }
                payload.annotation.id = annotationId;
                this.announcer?.polite('Annotation ajoutee. Elle apparaitra sur la carte.');
                this.annotations.set(annotationId, payload.annotation);
                this.mapController.addAnnotation(payload.annotation);
            }
        } catch (error) {
            console.error('[annotations] creation failed', error);
            this.announcer?.assertive?.('Impossible de creer l\'annotation.');
        }
    }

    async requestAnnotationDeletion(annotationId) {
        const normalizedId = normalizeAnnotationId(annotationId);
        if (!this.isAdmin() || !normalizedId) {
            return;
        }
        const confirmation = window.confirm('Supprimer cette annotation ?');
        if (!confirmation) {
            return;
        }
        try {
            const response = await fetch(`/api/annotations/${encodeURIComponent(normalizedId)}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            if (!response.ok && response.status !== 204) {
                throw new Error(`HTTP ${response.status}`);
            }
            this.announcer?.polite('Annotation supprimee.');
            this.annotations.delete(normalizedId);
            this.mapController.removeAnnotation(normalizedId);
        } catch (error) {
            console.error('[annotations] suppression impossible', error);
            this.announcer?.assertive?.('Erreur lors de la suppression de l\'annotation.');
        }
    }

    startGroupPlacement(group) {
        if (!this.isAdmin()) {
            this.announcer?.assertive?.('Connexion administrateur requise.');
            return;
        }
        if (!group?.id || !this.mapController) {
            return;
        }
        if (this.groupPlacement?.active) {
            this.stopGroupPlacement(false);
        }
        if (this.measurement.active) {
            this.stopMeasurementMode(false);
        }
        if (this.coordinateTool.active) {
            this.stopCoordinateMode(false);
        }
        if (this.annotationTool.active) {
            this.stopAnnotationMode(false);
        }
        if (this.temporaryPaintTool.active) {
            this.stopTemporaryPaintMode(false);
        }
        this.groupPlacement.active = true;
        this.groupPlacement.group = group;
        this.groupPlacement.clickUnsubscribe = this.mapController.onMapClick(event => this.handleGroupPlacementClick(event));
        this.closeUserAdminPanel(true);
        this.closeAdminPanel(true);
        const label = group.name || group.id;
        this.announcer?.polite?.(`Cliquez sur la carte pour placer le groupe ${label}.`);
    }

    stopGroupPlacement(announce = false) {
        if (!this.groupPlacement?.active) {
            return;
        }
        this.groupPlacement.active = false;
        this.groupPlacement.group = null;
        if (this.groupPlacement.clickUnsubscribe) {
            this.groupPlacement.clickUnsubscribe();
            this.groupPlacement.clickUnsubscribe = null;
        }
        if (announce) {
            this.announcer?.polite?.('Placement du groupe annule.');
        }
    }

    async handleGroupPlacementClick(event) {
        if (!this.groupPlacement?.active) {
            return;
        }
        const coords = this.mapController?.toPixelCoordinates(event?.latlng);
        const group = this.groupPlacement.group;
        if (!coords || !group?.id) {
            return;
        }
        const x = Math.round(coords.x);
        const y = Math.round(coords.y);
        await this.updateGroupPosition({ id: group.id, x, y });
        this.stopGroupPlacement(false);
    }

    async clearGroupPlacement(group) {
        if (!group?.id) {
            return;
        }
        const confirmation = window.confirm(`Retirer le placement du groupe "${group.name || group.id}" ?`);
        if (!confirmation) {
            return;
        }
        await this.updateGroupPosition({ id: group.id, x: null, y: null });
    }

    async updateGroupPosition({ id, x, y }) {
        if (!id) {
            return;
        }
        try {
            const response = await fetch('/api/admin/groups', {
                method: 'PATCH',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, x, y })
            });
            if (!response.ok) {
                const error = new Error(`HTTP ${response.status}`);
                error.status = response.status;
                this.logTelemetryEvent({
                    title: 'Admin groups - placement',
                    description: error.message,
                    route: '/api/admin/groups',
                    method: 'PATCH',
                    status: response.status
                });
                throw error;
            }
            await this.refreshUserAdminPanel();
            await this.fetchGroups();
            this.announcer?.polite?.('Placement du groupe mis a jour.');
        } catch (error) {
            console.error('[admin] group placement failed', error);
            this.announcer?.assertive?.('Mise a jour du placement impossible.');
            this.logTelemetryEvent({
                title: 'Admin groups - placement',
                description: error?.message || 'Echec placement groupe',
                route: '/api/admin/groups',
                method: 'PATCH',
                status: error?.status || null
            });
        }
    }

    async createQuestEvent({ locationName, questId, status, milestone, progress, note }) {
        if (!this.isAdmin()) {
            throw new Error('Droits administrateur requis pour creer un evenement de quete.');
        }
        const payload = {
            locationName,
            questId,
            status,
            milestone: milestone || undefined,
            note: note || undefined
        };
        if (progress && typeof progress === 'object') {
            const normalized = {};
            if (Number.isFinite(progress.current)) {
                normalized.current = Number(progress.current);
            }
            if (Number.isFinite(progress.max)) {
                normalized.max = Number(progress.max);
            }
            if (Object.keys(normalized).length) {
                payload.progress = normalized;
            }
        }

        try {
            const response = await fetch('/api/quest-events', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!response.ok) {
                let message = `HTTP ${response.status}`;
                try {
                    const errorPayload = await response.json();
                    if (errorPayload?.message) {
                        message = errorPayload.message;
                    }
                } catch (error) {
                    // ignore parse errors
                }
                throw new Error(message);
            }
            const result = await response.json();
            if (result?.event) {
                this.handleQuestUpdated({ event: result.event });
            }
            return result;
        } catch (error) {
            console.error('[quest-event] creation failed', error);
            throw error;
        }
    }

    async updateQuestEvent({ id, locationName, questId, status, milestone, progress, note }) {
        if (!this.isAdmin()) {
            throw new Error('Droits administrateur requis pour modifier un evenement de quete.');
        }
        if (!id) {
            throw new Error('Identifiant de evenement requis.');
        }
        const payload = {
            questId,
            locationName,
            status,
            milestone: milestone || undefined,
            note: note || undefined
        };
        if (progress && typeof progress === 'object') {
            const normalized = {};
            if (Number.isFinite(progress.current)) {
                normalized.current = Number(progress.current);
            }
            if (Number.isFinite(progress.max)) {
                normalized.max = Number(progress.max);
            }
            if (Object.keys(normalized).length) {
                payload.progress = normalized;
            }
        }
        try {
            const response = await fetch(`/api/quest-events/${encodeURIComponent(id)}`, {
                method: 'PATCH',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!response.ok) {
                let message = `HTTP ${response.status}`;
                try {
                    const errorPayload = await response.json();
                    if (errorPayload?.message) {
                        message = errorPayload.message;
                    }
                } catch (error) {
                    // ignore parse errors
                }
                throw new Error(message);
            }
            const result = await response.json();
            if (result?.event) {
                this.handleQuestUpdated({ event: result.event });
            }
            return result;
        } catch (error) {
            console.error('[quest-event] update failed', error);
            throw error;
        }
    }

    async deleteQuestEvent(eventId) {
        if (!this.isAdmin()) {
            throw new Error('Droits administrateur requis pour supprimer un evenement de quete.');
        }
        if (!eventId) {
            return;
        }
        const existing = this.questEvents.get(eventId) || null;
        const response = await fetch(`/api/quest-events/${encodeURIComponent(eventId)}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        if (!response.ok && response.status !== 204) {
            let message = `HTTP ${response.status}`;
            try {
                const errorPayload = await response.json();
                if (errorPayload?.message) {
                    message = errorPayload.message;
                }
            } catch (error) {
                // ignore parse errors
            }
            throw new Error(message);
        }
        if (existing) {
            this.questEvents.delete(existing.id);
            this.removeQuestEventFromLocation(existing);
            this.eventsFeed.addEvent({
                id: `quest-delete-${existing.id}-${Date.now()}`,
                type: 'quests',
                title: 'Quete supprimee',
                description: existing.questId ? `Quete ${existing.questId} retiree.` : 'Quete retiree.',
                timestamp: new Date().toISOString(),
                questId: existing.questId || null
            });
        }
        this.syncLocationEditorQuestEvents();
    }

    removeQuestEventFromLocation(event) {
        const locationName = sanitizeString(event?.locationName);
        if (!locationName) {
            return;
        }
        this.rebuildQuestSummariesForLocation(locationName);
    }

    rebuildQuestSummariesForLocation(locationName) {
        const normalizedTarget = sanitizeString(locationName).toLowerCase();
        if (!normalizedTarget) {
            return;
        }
        Object.values(this.locationsData || {}).forEach(list => {
            list?.forEach(location => {
                if (sanitizeString(location.name).toLowerCase() !== normalizedTarget) {
                    return;
                }
                const base = Array.isArray(location.quests) ? location.quests : [];
                location.quests = base.filter(entry => !entry.startsWith('[LIVE]'));
            });
        });
        const entry = this.entries.find(candidate => sanitizeString(candidate.location.name).toLowerCase() === normalizedTarget);
        if (entry) {
            const base = Array.isArray(entry.location.quests) ? entry.location.quests : [];
            entry.location.quests = base.filter(item => !item.startsWith('[LIVE]'));
        }
        const relevant = Array.from(this.questEvents.values()).filter(event => sanitizeString(event.locationName).toLowerCase() === normalizedTarget);
        relevant
            .slice()
            .sort((a, b) => new Date(a?.updatedAt || a?.createdAt || 0).getTime() - new Date(b?.updatedAt || b?.createdAt || 0).getTime())
            .forEach(event => this.applyQuestEventToLocation(event));
    }

    showControlMessage({ button, tooltip, message, duration = 4000, placement = 'top' }) {
        if (!button || !tooltip || !message) {
            return;
        }
        this.clearControlMessage(tooltip, false);
        const textNode = tooltip.querySelector('.ui-tooltip-text');
        if (textNode) {
            textNode.textContent = message;
        } else {
            tooltip.textContent = message;
        }
        this.showTooltip(button, tooltip, { placement, persistent: false });
        const timeoutId = window.setTimeout(() => {
            this.hideTooltip(tooltip);
            this.controlTooltipTimeouts.delete(tooltip);
        }, Math.max(1500, duration));
        this.controlTooltipTimeouts.set(tooltip, timeoutId);
    }

    clearControlMessage(tooltip, hide = true) {
        if (!tooltip) {
            return;
        }
        const timeoutId = this.controlTooltipTimeouts.get(tooltip);
        if (timeoutId) {
            clearTimeout(timeoutId);
            this.controlTooltipTimeouts.delete(tooltip);
        }
        if (hide) {
            this.hideTooltip(tooltip);
        }
    }

    bindMapKeyboardShortcuts() {
        if (this.boundKeyboardShortcuts) {
            return;
        }
        this.keyboardHandler = event => {
            if (event.defaultPrevented || isInteractiveTextField(event.target)) {
                return;
            }
            if (event.key === 'f' || event.key === 'F') {
                if (this.activeEntry) {
                    this.setFavoriteState(this.activeEntry.location, !this.state.hasFavorite(this.activeEntry.location.name));
                }
            } else if (event.key === 'r' || event.key === 'R') {
                this.goToRandomLocation();
            } else if (event.key === 'm' || event.key === 'M') {
                if (this.measurement.active) {
                    this.stopMeasurementMode(true);
                } else {
                    this.startMeasurementMode();
                }
            } else if (event.key === 'o' || event.key === 'O') {
                if (this.coordinateTool.active) {
                    this.stopCoordinateMode(true);
                } else {
                    this.startCoordinateMode();
                }
            } else if (event.key === 'p' || event.key === 'P') {
                if (this.temporaryPaintTool.active) {
                    this.stopTemporaryPaintMode(true);
                } else {
                    this.startTemporaryPaintMode();
                }
            } else if (event.key === 'c' || event.key === 'C') {
                if (this.dom.clusteringToggle) {
                    this.dom.clusteringToggle.checked = !this.dom.clusteringToggle.checked;
                    this.dom.clusteringToggle.dispatchEvent(new Event('change'));
                }
            }
        };
        document.addEventListener('keydown', this.keyboardHandler);
        this.boundKeyboardShortcuts = true;
    }

    bindMapBackgroundDismissal() {
        if (!this.mapController || !this.infoPanel) {
            return;
        }

        if (typeof this.mapClickUnsubscribe === 'function') {
            this.mapClickUnsubscribe();
        }

        this.mapClickUnsubscribe = this.mapController.onMapClick(event => {
            if (this.measurement?.active || this.coordinateTool?.active || this.annotationTool?.active || this.temporaryPaintTool?.active || this.groupPlacement?.active) {
                return;
            }
            const sidebar = this.dom.infoSidebar;
            if (!sidebar?.classList.contains('open')) {
                return;
            }

            const originalEvent = event?.originalEvent;
            if (originalEvent?.defaultPrevented) {
                return;
            }

            if (typeof originalEvent?.button === 'number' && originalEvent.button !== 0) {
                return;
            }

            const target = originalEvent?.target;
            if (target && typeof target.closest === 'function') {
                if (target.closest('.leaflet-interactive') || target.closest('.leaflet-control')) {
                    return;
                }
            }

            this.infoPanel.close();
        });
    }

    restoreMapState() {
        const mapState = this.preferences?.getMapState?.();
        if (mapState) {
            this.mapController.setMapState(mapState);
            this.state.mapState = mapState;
        }
    }

    restoreLastLocation() {
        const lastLocationName = this.preferences?.getLastLocation?.();
        if (!lastLocationName) {
            return;
        }
        const entry = this.entries.find(candidate => candidate.location.name === lastLocationName);
        if (!entry || !entry.matchesFilters) {
            return;
        }
        this.ensureEntryVisible(entry);
        this.selectEntry(entry, { focusOnList: false, source: 'restore' });
    }

    async loadRealtimeData() {
        try {
            await Promise.allSettled([
                this.fetchAnnotations(),
                this.fetchQuestEvents(),
                this.fetchGroups()
            ]);
        } catch (error) {
            console.warn('[realtime] Erreur lors du chargement des donnees temps reel', error);
        }
    }

    async fetchAnnotations() {
        const generation = this.accessGeneration || 0;
        try {
            const response = await fetch('/api/annotations', { cache: 'no-store', credentials: 'include' });
            if (!response.ok) {
                return;
            }
            const payload = await response.json();
            if (generation !== (this.accessGeneration || 0)) return;
            if (!Array.isArray(payload?.annotations)) {
                return;
            }
            this.applyAnnotationBootstrap(payload.annotations);
        } catch (error) {
            console.warn('[realtime] Impossible de charger les annotations', error);
        }
    }

    async fetchGroups() {
        const generation = this.accessGeneration || 0;
        try {
            const response = await fetch('/api/groups', { cache: 'no-store', credentials: 'include' });
            if (!response.ok) {
                return;
            }
            const payload = await response.json();
            if (generation !== (this.accessGeneration || 0)) return;
            if (!Array.isArray(payload?.groups)) {
                return;
            }
            this.applyGroupBootstrap(payload.groups);
        } catch (error) {
            console.warn('[realtime] Impossible de charger les groupes', error);
        }
    }

    applyAnnotationBootstrap(list = []) {
        const registry = new Map();
        list.forEach(annotation => {
            const annotationId = normalizeAnnotationId(annotation?.id);
            if (annotationId) {
                registry.set(annotationId, { ...annotation, id: annotationId });
            }
        });
        this.annotations = registry;
        this.mapController.setAnnotations(Array.from(registry.values()));
        for (const annotation of registry.values()) this.eventsFeed.addEvent({ id: 'annotation-' + annotation.id, type: 'annotations', title: annotation.label || 'Annotation', description: annotation.scope || '', timestamp: annotation.createdAt || null, annotationId: annotation.id });
    }

    applyGroupBootstrap(list = []) {
        this.groups = Array.isArray(list) ? list : [];
        if (this.mapController?.setGroups) {
            this.mapController.setGroups(this.groups);
        }
        this.syncCharacterForm();
    }

    handleAnnotationCreated(data) {
        if (!data || typeof data !== 'object') {
            return;
        }
        const annotation = data.annotation || data;
        const annotationId = normalizeAnnotationId(annotation?.id);
        if (!annotationId) {
            return;
        }
        const normalizedAnnotation = { ...annotation, id: annotationId };
        this.annotations.set(annotationId, normalizedAnnotation);
        this.mapController.addAnnotation(normalizedAnnotation);
        const locationLabel = sanitizeString(annotation.locationName);
        const messageParts = [
            annotation.label || 'Annotation ajoutee',
            locationLabel ? `@ ${locationLabel}` : null
        ].filter(Boolean);
        if (messageParts.length) {
            this.announcer?.polite(messageParts.join(' - '));
        }
        const descriptionParts = [
            locationLabel ? `@ ${locationLabel}` : null,
            annotation.scope ? `Portee : ${annotation.scope}` : null,
            Number.isFinite(annotation.x) && Number.isFinite(annotation.y)
                ? `(${Math.round(annotation.x)}, ${Math.round(annotation.y)})`
                : null
        ].filter(Boolean);
        this.eventsFeed.addEvent({
            id: `annotation-${annotationId}-${annotation.updatedAt || annotation.createdAt || Date.now()}`,
            type: 'annotations',
            title: annotation.label || 'Annotation ajoutee',
            description: descriptionParts.join(' - ') || 'Annotation creee.',
            timestamp: annotation.updatedAt || annotation.createdAt || new Date().toISOString(),
            annotationId
        });
    }

    handleAnnotationDeleted(payload) {
        const annotationId = normalizeAnnotationId(payload?.id || payload?.annotationId || payload?.annotation?.id);
        if (!annotationId) {
            return;
        }
        const previous = this.annotations.get(annotationId) || payload?.annotation || null;
        this.annotations.delete(annotationId);
        this.mapController.removeAnnotation(annotationId);
        const label = previous?.label ? ` "${previous.label}"` : '';
        this.announcer?.polite(`Annotation${label || ''} supprimee.`);
        const descriptionParts = [
            previous?.locationName ? `@ ${sanitizeString(previous.locationName)}` : null,
            Number.isFinite(previous?.x) && Number.isFinite(previous?.y)
                ? `(${Math.round(previous.x)}, ${Math.round(previous.y)})`
                : null
        ].filter(Boolean);
        this.eventsFeed.addEvent({
            id: `annotation-delete-${annotationId}-${Date.now()}`,
            type: 'annotations',
            title: 'Annotation supprimee',
            description: descriptionParts.join(' - ') || 'Annotation retiree de la carte.',
            timestamp: new Date().toISOString(),
            annotationId
        });
    }

    async fetchQuestEvents() {
        const generation = this.accessGeneration || 0;
        try {
            const response = await fetch('/api/quest-events', { cache: 'no-store', credentials: 'include' });
            if (!response.ok) {
                return;
            }
            const payload = await response.json();
            if (generation !== (this.accessGeneration || 0)) return;
            if (!Array.isArray(payload?.events)) {
                return;
            }
            this.applyQuestEventBootstrap(payload.events);
            this.questEventsLoaded = true;
        } catch (error) {
            console.warn('[realtime] Impossible de charger les evenements de quete', error);
        }
    }

    applyQuestEventBootstrap(events = []) {
        const registry = new Map();
        events.forEach(event => {
            if (event?.id) {
                registry.set(event.id, event);
            }
        });
        this.questEvents = registry;
        this.questEventsLoaded = true;
        registry.forEach(event => this.applyQuestEventToLocation(event));
        const recent = events.slice(-5);
        recent.forEach(event => {
            this.eventsFeed.addEvent({
                id: `quest-${event.id}`,
                type: 'quests',
                title: this.formatQuestEventLabel(event),
                description: event.note || `Quete ${event.questId || 'inconnue'} mise a jour.`,
                timestamp: event.updatedAt || new Date().toISOString(),
                questId: event.questId || null
            });
        });
        this.refreshFilterMetadata({ reapply: true });
        this.syncLocationEditorQuestEvents();
    }

    collectQuestEventsFromDataset() {
        const events = [];
        Object.values(this.locationsData || {}).forEach(list => {
            if (!Array.isArray(list)) {
                return;
            }
            list.forEach(location => {
                const baseName = sanitizeString(location?.name);
                const questEvents = Array.isArray(location?.questEvents) ? location.questEvents : [];
                questEvents.forEach(event => {
                    events.push({
                        ...event,
                        locationName: event?.locationName || baseName
                    });
                });
            });
        });
        return events;
    }

    handleQuestUpdated(payload) {
        const event = payload?.event || payload;
        if (!event?.id) {
            return;
        }
        this.questEvents.set(event.id, event);
        this.applyQuestEventToLocation(event);
        const message = [
            event.questId,
            event.status,
            event.milestone,
            event.locationName ? `@ ${event.locationName}` : null,
            event.progress && Number.isFinite(event.progress.current)
                ? (Number.isFinite(event.progress.max)
                    ? `${event.progress.current}/${event.progress.max}`
                    : `${event.progress.current}`)
                : null
        ].filter(Boolean).join(' - ');
        if (message) {
            this.announcer?.polite(message);
        }
        this.eventsFeed.addEvent({
            id: `quest-${event.id}-${event.updatedAt || Date.now()}`,
            type: 'quests',
            title: this.formatQuestEventLabel(event),
            description: event.note || `Quete ${event.questId || 'inconnue'} mise a jour.`,
            timestamp: event.updatedAt || new Date().toISOString(),
            questId: event.questId || null
        });
        this.refreshFilterMetadata({ reapply: true });
        this.syncLocationEditorQuestEvents();
    }

    handleQuestDeleted(payload) {
        const id = payload?.id;
        if (!id) {
            return;
        }
        const existing = this.questEvents.get(id);
        if (!existing) {
            return;
        }
        this.questEvents.delete(id);
        this.removeQuestEventFromLocation(existing);
        this.eventsFeed.addEvent({
            id: `quest-delete-${id}-${Date.now()}`,
            type: 'quests',
            title: 'Quete supprimee',
            description: existing.questId ? `Quete ${existing.questId} retiree.` : 'Quete retiree.',
            timestamp: new Date().toISOString(),
            questId: existing.questId || null
        });
        this.refreshFilterMetadata({ reapply: true });
        this.syncLocationEditorQuestEvents();
    }

    formatQuestEventLabel(event) {
        if (!event) {
            return '';
        }
        const parts = [
            event.questId,
            event.milestone,
            event.status,
            event.progress && Number.isFinite(event.progress.current)
                ? (Number.isFinite(event.progress.max)
                    ? `${event.progress.current}/${event.progress.max}`
                    : `${event.progress.current}`)
                : null,
            event.note,
            event.locationName ? `@ ${event.locationName}` : null
        ].filter(Boolean);
        return parts.length ? `[LIVE] ${parts.join(' - ')}` : '[LIVE] Mise a jour de quete';
    }

    applyQuestEventToLocation(event) {
        const locationName = sanitizeString(event?.locationName);
        if (!locationName) {
            return;
        }
        const label = this.formatQuestEventLabel(event);
        const questId = sanitizeString(event?.questId);
        const isSameQuest = entry => {
            if (!questId) {
                return false;
            }
            return entry.startsWith('[LIVE]') && entry.includes(questId);
        };
        const normalizedTarget = locationName.toLowerCase();

        Object.values(this.locationsData || {}).forEach(list => {
            list?.forEach(location => {
                if (sanitizeString(location.name).toLowerCase() !== normalizedTarget) {
                    return;
                }
                const current = Array.isArray(location.quests) ? location.quests.slice() : [];
                const filtered = questId ? current.filter(entry => !isSameQuest(entry)) : current;
                filtered.push(label);
                location.quests = filtered;
            });
        });

        const entry = this.entries.find(candidate => sanitizeString(candidate.location.name).toLowerCase() === normalizedTarget);
        if (entry) {
            const current = Array.isArray(entry.location.quests) ? entry.location.quests.slice() : [];
            const filtered = questId ? current.filter(item => !isSameQuest(item)) : current;
            filtered.push(label);
            entry.location.quests = filtered;
            if (this.activeEntry && this.activeEntry.location === entry.location) {
                this.infoPanel.show(this.activeEntry);
            }
        }
    }

    syncLocationEditorQuestEvents() {
        if (!this.locationEditor?.isOpen || typeof this.locationEditor.getLocationName !== 'function') {
            return;
        }
        const name = this.locationEditor.getLocationName();
        if (!name) {
            return;
        }
        const events = this.getQuestEventsForLocation(name);
        this.locationEditor.setQuestEvents(events);
    }

    async handleLocationsSync(payload) {
        if (!payload || payload.sync === 'error') {
            return;
        }
        const created = Array.isArray(payload?.diff?.created) ? payload.diff.created.length : 0;
        const updated = Array.isArray(payload?.diff?.updated) ? payload.diff.updated.length : 0;
        const deleted = Array.isArray(payload?.diff?.deleted) ? payload.diff.deleted.length : 0;
        this.eventsFeed.addEvent({
            id: `sync-${payload?.timestamp || Date.now()}`,
            type: 'sync',
            title: 'Donnees synchronisees',
            description: `Creees: ${created} - Modifiees: ${updated} - Supprimees: ${deleted}`,
            timestamp: payload?.timestamp || new Date().toISOString()
        });
        await this.refreshLocationsDataset();
    }

    async refreshLocationsDataset() {
        const generation = this.accessGeneration || 0;
        try {
            const response = await fetch('/api/locations', { cache: 'no-store', credentials: 'include' });
            if (!response.ok) {
                this.locationsData = {}; this.buildSidebar({}); this.infoPanel.close();
                return;
            }
            const payload = await response.json();
            if (generation !== (this.accessGeneration || 0)) return;
            if (payload?.status !== 'ok' || typeof payload.locations !== 'object') {
                return;
            }

            const previousSelection = this.activeEntry?.location?.name || null;
            this.infoPanel.invalidatePermissions(); this.activeEntry = null;
            this.locationsData = normalizeSharedDataset(payload.locations, { sanitizeKeys: true });
            this.buildSidebar(this.locationsData);
            this.refreshFilterMetadata({ reapply: false });
            this.applyFilters();
            this.updateSidebarView();
            this.updateClusteringMetrics();
            this.updateRandomButtonState();
            if (previousSelection) {
                this.focusLocationByName(previousSelection);
            }
            this.questEvents.forEach(event => this.applyQuestEventToLocation(event));
            this.mapController.setAnnotations(Array.from(this.annotations.values()));
            this.syncLocationEditorQuestEvents();
        } catch (error) {
            console.warn('[realtime] Impossible de rafraichir le dataset', error);
        }
    }

    focusLocationByName(name) {
        const target = sanitizeString(name).toLowerCase();
        if (!target) {
            return;
        }
        const entry = this.entries.find(candidate => sanitizeString(candidate.location.name).toLowerCase() === target);
        if (entry) {
            this.ensureEntryVisible(entry);
            this.selectEntry(entry, { focusOnList: false, source: 'sync' });
        }
    }

    setupRealtimeStream() {
        if (typeof window === 'undefined' || typeof window.EventSource !== 'function') {
            return;
        }

        if (this.realtimeSource) {
            this.realtimeCleanup?.();
            this.realtimeSource.close();
            this.realtimeSource = null;
        }

        try {
            const source = new window.EventSource('/api/events/stream');
            this.realtimeSource = source;

            const handleConnected = event => {
                let payload = null;
                try {
                    payload = event?.data ? JSON.parse(event.data) : null;
                } catch (error) {
                    payload = null;
                }
                if (payload?.timestamp) {
                    this.announcer?.polite('Flux temps reel synchronise.');
                }
            };

            const handleLocationsSync = event => {
                if (!event?.data) {
                    return;
                }
                try {
                    const payload = JSON.parse(event.data);
                    this.handleLocationsSync(payload);
                } catch (error) {
                    console.warn('[sse] Flux locations.sync invalide', error);
                }
            };

            const handleAnnotationCreated = event => {
                if (!event?.data) {
                    return;
                }
                try {
                    const payload = JSON.parse(event.data);
                    this.handleAnnotationCreated(payload);
                } catch (error) {
                    console.warn('[sse] Annotation created invalide', error);
                }
            };

            const handleAnnotationDeleted = event => {
                if (!event?.data) {
                    return;
                }
                try {
                    const payload = JSON.parse(event.data);
                    this.handleAnnotationDeleted(payload);
                } catch (error) {
                    console.warn('[sse] Annotation deleted invalide', error);
                }
            };

            const handleQuestUpdated = event => {
                if (!event?.data) {
                    return;
                }
                try {
                    const payload = JSON.parse(event.data);
                    this.handleQuestUpdated(payload);
                } catch (error) {
                    console.warn('[sse] Quest updated invalide', error);
                }
            };

            const handleQuestDeleted = event => {
                if (!event?.data) {
                    return;
                }
                try {
                    const payload = JSON.parse(event.data);
                    this.handleQuestDeleted(payload);
                } catch (error) {
                    console.warn('[sse] Quest deleted invalide', error);
                }
            };

            const handlePermissionsChanged = async event => {
                const initial = event.type === 'permissions.ready';
                window.dispatchEvent(new Event('carte:permissions-updated'));
                this.accessGeneration = (this.accessGeneration || 0) + 1;
                if (!initial) { this.infoPanel.invalidatePermissions(); this.activeEntry = null; }
                this.eventsFeed.clear();
                this.questEvents.clear(); this.annotations.clear();
                this.applyAnnotationBootstrap([]); this.applyGroupBootstrap([]);
                if (!initial) { this.locationsData = {}; this.buildSidebar({}); }
                await this.fetchSession();
                await Promise.all([this.fetchAnnotations(), this.fetchQuestEvents(), this.fetchGroups()]);
                await this.refreshLocationsDataset();
            };
            source.addEventListener('permissions.ready', handlePermissionsChanged);
            source.addEventListener('permissions.changed', handlePermissionsChanged);
            source.addEventListener('connected', handleConnected);
            source.addEventListener('locations.sync', handleLocationsSync);
            source.addEventListener('annotation.created', handleAnnotationCreated);
            source.addEventListener('annotation.deleted', handleAnnotationDeleted);
            source.addEventListener('quest.updated', handleQuestUpdated);
            source.addEventListener('quest.deleted', handleQuestDeleted);
            source.addEventListener('heartbeat', () => {});
            source.onerror = error => {
                console.warn('[sse] Flux temps reel en erreur, EventSource gere la reconnexion automatique.', error?.message || error);
            };

            const handleUnload = () => {
                source.close();
            };
            window.addEventListener('beforeunload', handleUnload, { once: true });

            this.realtimeCleanup = () => {
                window.removeEventListener('beforeunload', handleUnload);
                source.removeEventListener('permissions.ready', handlePermissionsChanged);
                source.removeEventListener('permissions.changed', handlePermissionsChanged);
                source.removeEventListener('connected', handleConnected);
                source.removeEventListener('locations.sync', handleLocationsSync);
                source.removeEventListener('annotation.created', handleAnnotationCreated);
                source.removeEventListener('annotation.deleted', handleAnnotationDeleted);
                source.removeEventListener('quest.updated', handleQuestUpdated);
                source.removeEventListener('quest.deleted', handleQuestDeleted);
            };
        } catch (error) {
            console.error('[sse] Impossible d\'ouvrir le flux SSE', error);
        }
    }

    applyFilters() {
        const filters = this.state.getFilters();
        const prepared = prepareFilters(filters);

        let visibleCount = 0;

        this.continents.forEach(section => {
            const visibleEntries = section.entries.filter(entry => {
                if (!entry.filterIndex) {
                    entry.filterIndex = this.buildFilterIndexForEntry(entry);
                }
                const matches = locationMatchesFilters(entry.filterIndex, prepared);
                entry.matchesFilters = matches;

                if (entry.element) {
                    entry.element.style.display = matches ? '' : 'none';
                }

                this.mapController.setEntryVisibility(entry.markerEntry, matches);
                entry.element?.classList.toggle('is-favorite', this.state.hasFavorite(entry.location.name));

                if (matches) {
                    visibleCount += 1;
                }
                return matches;
            });

            const countSpan = section.toggleButton?.querySelector('.location-count');
            if (countSpan) {
                countSpan.textContent = `(${visibleEntries.length}/${section.entries.length})`;
            }

            this.renderContinentEntries(visibleEntries, section.pagination, section.content);
        });

        this.filtersManager.updateResults({
            visibleCount,
            totalCount: this.entries.length
        });

        if (this.activeEntry && !this.activeEntry.matchesFilters) {
            this.infoPanel.close();
        }

        if (this.state.sidebarView === 'favorites') {
            this.renderFavoritesView();
        }

        this.updateClusteringMetrics();
        this.updateRandomButtonState();
    }

    renderFavoritesView() {
        const container = this.dom.favoritesContainer;
        if (!container) {
            return;
        }
        clearElement(container);

        const favorites = this.state.getFavorites();
        const totalFavorites = favorites.length;

        const summary = createElement('div', {
            className: 'favorites-summary',
            attributes: { 'aria-live': 'polite' }
        });
        summary.appendChild(createElement('span', {
            className: 'favorites-summary-label',
            text: localized('favorites.summaryLabel', 'Favoris enregistres')
        }));
        const summaryCountKey = totalFavorites === 1 ? 'favorites.summaryCountSingle' : 'favorites.summaryCountPlural';
        const summaryCountText = localized(summaryCountKey, `${totalFavorites} favoris`, { count: totalFavorites });
        summary.appendChild(createElement('span', {
            className: 'favorites-summary-count',
            text: summaryCountText
        }));
        container.appendChild(summary);

        if (!favorites.length) {
            container.appendChild(createElement('p', {
                className: 'favorites-empty',
                text: favoritesEmptyMessage()
            }));
            return;
        }

        const list = createElement('div', { className: 'favorites-list' });

        favorites
            .map(name => this.entries.find(entry => entry.location.name === name))
            .filter(Boolean)
            .sort((a, b) => a.location.name.localeCompare(b.location.name, 'fr', { sensitivity: 'base' }))
            .forEach(entry => {
                const isActive = this.activeEntry && this.activeEntry.location.name === entry.location.name;
                const isFilteredOut = !entry.matchesFilters;

                const classes = ['location', 'favorite-entry'];
                if (isActive) {
                    classes.push('active');
                }
                if (isFilteredOut) {
                    classes.push('is-filtered');
                }

                const item = createElement('div', {
                    className: classes.join(' '),
                    dataset: { locationName: entry.location.name },
                    attributes: {
                        tabindex: isFilteredOut ? '-1' : '0',
                        role: 'button',
                        'aria-disabled': String(isFilteredOut)
                    }
                });

                const info = createElement('div', { className: 'favorite-info' });
                info.appendChild(createElement('span', {
                    className: 'favorite-name',
                    text: entry.location.name
                }));

                const tags = createElement('div', { className: 'favorite-tags' });
                const typeLabel = entry.location.type && entry.location.type !== 'default'
                    ? (this.typeData[entry.location.type]?.label || entry.location.type)
                    : '';
                if (typeLabel) {
                    tags.appendChild(createElement('span', {
                        className: 'favorite-chip favorite-chip-type',
                        text: typeLabel
                    }));
                }
                if (entry.continent) {
                    tags.appendChild(createElement('span', {
                        className: 'favorite-chip favorite-chip-continent',
                        text: entry.continent
                    }));
                }
                if (tags.childElementCount > 0) {
                    info.appendChild(tags);
                }

                item.appendChild(info);

                const removeButton = createElement('button', {
                    className: 'location-favorite-toggle active',
                    text: favoriteIconActive(),
                    attributes: {
                        type: 'button',
                        'aria-label': localized('favorites.removeWithName', `Retirer ${entry.location.name} des favoris`, { location: entry.location.name })
                    }
                });
                removeButton.addEventListener('click', event => {
                    event.stopPropagation();
                    this.setFavoriteState(entry.location, false);
                });
                this.attachHoverTooltip(removeButton, this.favoriteTooltip, { placement: 'left' });
                item.appendChild(removeButton);

                if (isFilteredOut) {
                    item.title = favoritesFilteredHint();
                } else {
                    const openEntry = () => {
                        if (this.state.sidebarView !== 'all') {
                            this.setSidebarView('all');
                        }
                        this.ensureEntryVisible(entry);
                        this.selectEntry(entry, { focusOnList: false, source: 'favorites' });
                    };
                    item.addEventListener('click', openEntry);
                    item.addEventListener('keydown', event => {
                        if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            openEntry();
                        }
                    });
                }

                list.appendChild(item);
            });

        container.appendChild(list);
    }

    updateClusteringMetrics() {
        const metrics = this.dom.clusteringMetrics;
        if (!metrics) {
            return;
        }

        const total = this.entries.length;
        if (!total) {
            metrics.textContent = `${clusteringEmptyIcon()} 0/0`;
            metrics.title = localized('clustering.tooltipEmpty', 'Aucun lieu charge');
            metrics.dataset.state = 'empty';
            return;
        }

        const visible = this.entries.filter(entry => entry.matchesFilters).length;
        const clustered = this.mapController.isClusteringEnabled();
        const icon = clusteringIcon(clustered);

        metrics.textContent = `${icon} ${visible}/${total}`;

        const baseTooltip = visible === 1
            ? localized('clustering.tooltipBaseSingle', `${visible} lieu visible sur ${total}`, { visible, total })
            : localized('clustering.tooltipBasePlural', `${visible} lieux visibles sur ${total}`, { visible, total });

        const filters = normalizeFilterState(this.state.getFilters());
        const parts = [baseTooltip];

        if ((filters.text && filters.text.trim()) || filters.types.length || filters.tags.length || filters.statuses.length || filters.quests !== 'any') {
            parts.push(localized('clustering.tooltipFilters', 'filtres actifs'));
        }

        parts.push(clustered
            ? localized('clustering.tooltipClusterOn', 'clustering active')
            : localized('clustering.tooltipClusterOff', 'clustering desactive')
        );

        metrics.title = parts.filter(Boolean).join(CLUSTERING_TOOLTIP_SEPARATOR);
        metrics.dataset.state = clustered ? 'on' : 'off';
    }

    updateRandomButtonState() {
        if (!this.dom.randomButton) {
            return;
        }
        const isFavoritesView = this.state.sidebarView === 'favorites';
        const pool = this.entries.filter(entry => {
            if (!entry.matchesFilters) {
                return false;
            }
            if (isFavoritesView && !this.state.hasFavorite(entry.location.name)) {
                return false;
            }
            return true;
        });
        const disabled = pool.length === 0;
        this.dom.randomButton.disabled = disabled;
        this.dom.randomButton.setAttribute('aria-disabled', String(disabled));
        this.dom.randomButton.title = disabled
            ? (isFavoritesView ? randomDisabledFavoritesMessage() : randomDisabledDefaultMessage())
            : localized('filters.randomHint', 'Selectionner un lieu aleatoire.');
    }

    goToRandomLocation() {
        const isFavoritesView = this.state.sidebarView === 'favorites';
        const pool = this.entries.filter(entry => {
            if (!entry.matchesFilters) {
                return false;
            }
            if (isFavoritesView && !this.state.hasFavorite(entry.location.name)) {
                return false;
            }
            return true;
        });
        if (!pool.length) {
            return;
        }
        const entry = pool[Math.floor(Math.random() * pool.length)];
        if (this.state.sidebarView !== 'all') {
            this.setSidebarView('all');
        }
        this.ensureEntryVisible(entry);
        this.selectEntry(entry, { focusOnList: true, source: 'random' });
    }

    ensureEntryVisible(entry) {
        if (!entry) {
            return;
        }
        const section = this.continents.get(entry.continent);
        if (!section) {
            return;
        }
        const index = section.entries.indexOf(entry);
        if (index === -1) {
            return;
        }
        const targetPage = Math.floor(index / this.pageSize);
        if (section.pagination.currentPage !== targetPage) {
            section.pagination.currentPage = targetPage;
            const visibleEntries = section.entries.filter(candidate => candidate.matchesFilters);
            this.renderContinentEntries(visibleEntries, section.pagination, section.content);
            if (this.preferences?.setPagination) {
                this.preferences.setPagination(section.name, targetPage);
            }
        }
        if (section.content.style.display === 'none') {
            this.setContinentExpanded(section, true);
        }
    }

    selectEntry(entry, { focusOnList = true, source = 'unknown', pushHistory = true } = {}) {
        if (!entry) {
            return;
        }

        if (this.activeEntry?.element) {
            this.activeEntry.element.classList.remove('active');
        }

        this.activeEntry = entry;

        if (entry.element) {
            entry.element.classList.add('active');
            if (focusOnList) {
                entry.element.scrollIntoView({ block: 'nearest' });
            }
        }

        this.state.activeLocationName = entry.location.name;

        this.setProfilePanelOpen(false);
        this.infoPanel.show(entry);
        this.updateEditButton(entry.location);
        this.updateFavoriteToggle(entry.location);

        if (this.announcer) {
            const message = localized(
                'aria.locationSelected',
                `${entry.location.name} selectionne.`,
                { location: entry.location.name }
            );
            this.announcer.polite(message);
        }

        this.mapController.setSelectedEntry(entry.markerEntry);
        this.mapController.focusOnEntry(entry.markerEntry, { animate: source !== 'history' });

        this.maybeShowFavoritesOnboarding();

        if (pushHistory) {
            this.historyManager.push({
                locationName: entry.location.name,
                mapState: this.mapController.getMapState()
            });
        }

        if (this.preferences?.setLastLocation) {
            this.preferences.setLastLocation(entry.location.name);
        }
    }

    handleHistorySelect(item) {
        if (!item) {
            return;
        }
        const entry = this.entries.find(candidate => candidate.location.name === item.locationName);
        if (entry) {
            this.ensureEntryVisible(entry);
            this.selectEntry(entry, { focusOnList: false, source: 'history', pushHistory: false });
        }
        if (item.mapState) {
            this.mapController.setMapState(item.mapState);
        }
    }

    handlePanelClosed() {
        this.mapController.clearSelectedEntry();
        this.activeEntry = null;
        this.updateFavoriteToggle(null);
        this.updateEditButton(null);
        this.updateRandomButtonState();
        this.hideTooltip(this.favoriteTooltip);
        this.hideTooltip(this.favoriteOnboardingTooltip);
        if (this.announcer) {
            const message = localized('aria.infoClosed', 'Panneau d\'information ferme.');
            this.announcer.polite(message);
        }
    }

    updateFavoriteToggle(location) {
        if (!this.dom.favoriteToggle) {
            return;
        }
        const hasLocation = Boolean(location?.name);
        const isFavorite = hasLocation && this.state.hasFavorite(location.name);

        this.dom.favoriteToggle.disabled = !hasLocation;
        this.dom.favoriteToggle.textContent = isFavorite ? favoriteIconActive() : favoriteIconInactive();

        const label = hasLocation
            ? (isFavorite
                ? localized('favorites.removeWithName', `Retirer ${location.name} des favoris`, { location: location.name })
                : localized('favorites.addWithName', `Ajouter ${location.name} aux favoris`, { location: location.name }))
            : localized('favorites.add', 'Ajouter aux favoris');

        this.dom.favoriteToggle.title = label;
        this.dom.favoriteToggle.setAttribute('aria-label', label);
        this.dom.favoriteToggle.setAttribute('aria-pressed', String(isFavorite));
        this.dom.favoriteToggle.classList.toggle('active', isFavorite);
    }

    setFavoriteState(location, shouldFavorite) {
        if (!location?.name) {
            return;
        }

        const name = location.name;

        if (shouldFavorite) {
            this.state.addFavorite(name);
        } else {
            this.state.removeFavorite(name);
        }

        const favorites = this.state.getFavorites();
        if (this.preferences?.setFavorites) {
            this.preferences.setFavorites(favorites);
        }

        const entry = this.entries.find(candidate => candidate.location.name === name);
        if (entry?.favoriteButton) {
            entry.favoriteButton.textContent = shouldFavorite ? favoriteIconActive() : favoriteIconInactive();
            entry.favoriteButton.setAttribute('aria-pressed', String(shouldFavorite));
            entry.favoriteButton.classList.toggle('active', shouldFavorite);
            const label = shouldFavorite
                ? localized('favorites.removeWithName', `Retirer ${name} des favoris`, { location: name })
                : localized('favorites.addWithName', `Ajouter ${name} aux favoris`, { location: name });
            entry.favoriteButton.title = label;
            entry.favoriteButton.setAttribute('aria-label', label);
            entry.element?.classList.toggle('is-favorite', shouldFavorite);
            entry.element?.classList.toggle('favorite', shouldFavorite);
        }

        if (this.activeEntry && this.activeEntry.location.name === name) {
            this.updateFavoriteToggle(this.activeEntry.location);
        }

        this.dismissOnboarding('favorites');

        if (this.announcer) {
            const message = localized(
                shouldFavorite ? 'aria.favoriteAdded' : 'aria.favoriteRemoved',
                shouldFavorite ? `${name} ajoute aux favoris.` : `${name} retire des favoris.`,
                { location: name }
            );
            this.announcer.polite(message);
        }

        this.renderFavoritesView();
        if (this.dom.quickFavorites) {
            const count = this.state.getFavorites().length;
            this.dom.quickFavorites.textContent = count > 0
                ? `Mes lieux favoris (${count})`
                : 'Mes lieux favoris';
        }
        this.updateRandomButtonState();
    }

    setSidebarView(view) {
        if (view !== 'all' && view !== 'favorites') {
            return;
        }
        if (this.state.sidebarView === view) {
            return;
        }
        this.state.sidebarView = view;
        this.updateSidebarView();
        this.updateRandomButtonState();
        if (view === 'favorites') {
            this.renderFavoritesView();
        }
    }

    updateSidebarView() {
        const view = this.state.sidebarView;

        if (this.dom.tabAll) {
            const isAll = view === 'all';
            this.dom.tabAll.classList.toggle('active', isAll);
            this.dom.tabAll.setAttribute('aria-pressed', String(isAll));
        }

        if (this.dom.tabFavorites) {
            const isFavorites = view === 'favorites';
            this.dom.tabFavorites.classList.toggle('active', isFavorites);
            this.dom.tabFavorites.setAttribute('aria-pressed', String(isFavorites));
        }

        if (this.dom.continentsContainer) {
            this.dom.continentsContainer.hidden = view !== 'all';
        }

        if (this.dom.favoritesContainer) {
            this.dom.favoritesContainer.hidden = view !== 'favorites';
        }
    }

    setMarkerScale(value, { persist = true } = {}) {
        const numeric = Number(value);
        const normalized = Number.isFinite(numeric) ? Math.max(70, Math.min(130, numeric)) : 100;
        document.documentElement.style.setProperty('--marker-scale', (normalized / 100).toFixed(2));

        if (this.dom.markerScaleValue) {
            this.dom.markerScaleValue.textContent = `${normalized}%`;
        }
        if (this.dom.markerScaleInput && this.dom.markerScaleInput.value !== String(normalized)) {
            this.dom.markerScaleInput.value = String(normalized);
        }
        if (persist && this.preferences?.setMarkerScale) {
            this.preferences.setMarkerScale(normalized);
        }
    }

    setContinentExpanded(section, shouldExpand) {
        if (!section?.content || !section?.toggleButton) {
            return;
        }
        this.expandedContinents ||= new Set();
        if (shouldExpand) this.expandedContinents.add(section.name); else this.expandedContinents.delete(section.name);
        const content = section.content;
        const button = section.toggleButton;
        const wasHidden = content.style.display === 'none';

        if (shouldExpand) {
            content.style.display = 'block';
            content.classList.add('is-open');
            content.setAttribute('aria-hidden', 'false');
            button.setAttribute('aria-expanded', 'true');

            // force reflow before calculating height
            if (wasHidden) {
                content.style.maxHeight = '0';
            }
            const targetHeight = content.scrollHeight;
            content.style.maxHeight = `${targetHeight}px`;

            const handleTransitionEnd = event => {
                if (event.target === content) {
                    content.removeEventListener('transitionend', handleTransitionEnd);
                }
            };
            content.addEventListener('transitionend', handleTransitionEnd, { once: true });
        } else {
            content.classList.remove('is-open');
            content.setAttribute('aria-hidden', 'true');
            button.setAttribute('aria-expanded', 'false');
            content.style.maxHeight = '0';

            // hide content after collapsing to avoid keyboard focus
            const handleTransitionEnd = event => {
                if (event.target === content && !content.classList.contains('is-open')) {
                    content.style.display = 'none';
                    content.removeEventListener('transitionend', handleTransitionEnd);
                }
            };

            content.addEventListener('transitionend', handleTransitionEnd, { once: true });

            // fallback in case transitions are disabled
            if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
                handleTransitionEnd({ target: content });
            }
        }
        button.classList.toggle('is-open', shouldExpand);
    }

    isContinentExpanded(section) {
        return section?.content?.style.display !== 'none';
    }

    updateToggleAllLabel() {
        if (!this.dom.toggleAll) {
            return;
        }
        const label = toggleAllLabel(this.toggleAllState);
        if (label) {
            this.dom.toggleAll.textContent = label;
            this.dom.toggleAll.title = label;
            this.dom.toggleAll.setAttribute('aria-label', label);
        }
    }

    updateToggleAllState() {
        const sections = Array.from(this.continents.values());
        if (!sections.length) {
            this.toggleAllState = false;
            this.updateToggleAllLabel();
            return;
        }
        this.toggleAllState = sections.every(section => this.isContinentExpanded(section));
        this.updateToggleAllLabel();
    }
}
