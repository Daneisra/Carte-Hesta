import { extractYoutubeId as extractYouTubeId, youtubePreview } from './youtube.mjs';
import { createElement, clearElement } from './dom.js';
import { renderMarkdown } from './markdown.mjs';

const DRAFT_STORAGE_KEY_PREFIX = 'interactive-map-markdown-draft';
const DRAFT_STORAGE_VERSION = 1;
const DRAFT_STORAGE_TTL = 1000 * 60 * 60 * 24 * 7;
const DRAFT_SAVE_DEBOUNCE = 400;
const LINK_SUGGESTION_DEBOUNCE = 300;
const WORD_CHAR_REGEX = (() => {
    try {
        return new RegExp('[\\p{L}\\p{N}]', 'u');
    } catch (error) {
        return /[A-Za-z0-9]/;
    }
})();

const canUseDraftStorage = () => {
    try {
        return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
    } catch (error) {
        return false;
    }
};

const normalizeDraftIdentifier = value => (value ?? '').toString().trim().toLowerCase();

const formatDraftTimestamp = value => {
    if (!Number.isFinite(value)) {
        return '';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '';
    }
    return date.toLocaleString('fr-FR', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
    });
};

const readDraftRecord = key => {
    if (!key || !canUseDraftStorage()) {
        return null;
    }
    try {
        const raw = window.localStorage.getItem(key);
        if (!raw) {
            return null;
        }
        const payload = JSON.parse(raw);
        if (!payload || typeof payload !== 'object' || typeof payload.value !== 'string') {
            window.localStorage.removeItem(key);
            return null;
        }
        const updatedAt = Number(payload.updatedAt);
        if (!Number.isFinite(updatedAt)) {
            window.localStorage.removeItem(key);
            return null;
        }
        if (payload.version !== DRAFT_STORAGE_VERSION) {
            window.localStorage.removeItem(key);
            return null;
        }
        if (DRAFT_STORAGE_TTL > 0 && Date.now() - updatedAt > DRAFT_STORAGE_TTL) {
            window.localStorage.removeItem(key);
            return null;
        }
        return {
            value: payload.value,
            updatedAt
        };
    } catch (error) {
        return null;
    }
};

const writeDraftRecord = (key, value) => {
    if (!key || !canUseDraftStorage()) {
        return null;
    }
    try {
        const payload = {
            version: DRAFT_STORAGE_VERSION,
            value,
            updatedAt: Date.now()
        };
        window.localStorage.setItem(key, JSON.stringify(payload));
        return payload.updatedAt;
    } catch (error) {
        return null;
    }
};

const removeDraftRecord = key => {
    if (!key || !canUseDraftStorage()) {
        return;
    }
    try {
        window.localStorage.removeItem(key);
    } catch (error) {
        // ignore storage errors
    }
};

const MARKDOWN_SECTION_CONFIG = {
    history: {
        label: 'Historique',
        placeholder: 'Entree historique (Markdown)',
        emptyText: 'Previsualisation de cet historique.',
        removeLabel: 'Supprimer cet historique'
    },
    quests: {
        label: 'Quetes',
        placeholder: 'Entree de quete (Markdown)',
        emptyText: 'Previsualisation de cette quete.',
        removeLabel: 'Supprimer cette entree de quete'
    },
    lore: {
        label: 'Lore',
        placeholder: 'Entree de lore (Markdown)',
        emptyText: 'Previsualisation de cet element de lore.',
        removeLabel: 'Supprimer cet element de lore'
    },
    instances: {
        label: 'Instances',
        placeholder: 'Instance (Markdown)',
        emptyText: 'Previsualisation de cette instance.',
        removeLabel: 'Supprimer cette instance'
    },
    nobleFamilies: {
        label: 'Familles nobles',
        placeholder: 'Famille noble (Markdown)',
        emptyText: 'Previsualisation de cette famille.',
        removeLabel: 'Supprimer cette famille noble'
    }
};

const MARKDOWN_SECTION_TYPES = Object.keys(MARKDOWN_SECTION_CONFIG);

const DEFAULT_LOCATION = {
    name: '',
    type: 'default',
    x: 0,
    y: 0,
    description: '',
    audio: '',
    images: [],
    videos: [],
    history: [],
    quests: [],
    lore: [],
    instances: [],
    nobleFamilies: [],
    pnjs: [],
    tags: []
};

const UPLOAD_ENDPOINT = '/api/upload';
const UPLOAD_TYPES = { image: 'image', audio: 'audio' };
const MAX_UPLOAD_SIZE = 25 * 1024 * 1024;
const UPLOAD_FILE_RULES = {
    [UPLOAD_TYPES.image]: {
        mimePrefix: 'image/',
        extensions: ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']
    },
    [UPLOAD_TYPES.audio]: {
        mimePrefix: 'audio/',
        extensions: ['.mp3', '.ogg', '.wav', '.flac', '.aac', '.m4a']
    }
};

const isValidUrl = value => {
    if (!value || typeof value !== 'string') {
        return false;
    }
    const trimmed = value.trim();
    if (!trimmed.length) {
        return false;
    }
    if (trimmed.startsWith('assets/')) {
        return true;
    }
    try {
        const url = new URL(trimmed);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (error) {
        return false;
    }
};

const partitionFilesByType = (files = [], uploadType) => {
    const rule = UPLOAD_FILE_RULES[uploadType];
    if (!rule) {
        return { accepted: [], rejected: [] };
    }
    const accepted = [];
    const rejected = [];
    files.forEach(file => {
        if (!file) {
            return;
        }
        const name = (file.name || '').toLowerCase();
        const matchesMime = file.type && rule.mimePrefix && file.type.startsWith(rule.mimePrefix);
        const matchesExtension = rule.extensions.some(ext => name.endsWith(ext));
        if (matchesMime || matchesExtension) {
            accepted.push(file);
        } else {
            rejected.push(file);
        }
    });
    return { accepted, rejected };
};

const describeAllowedExtensions = uploadType => {
    const rule = UPLOAD_FILE_RULES[uploadType];
    if (!rule) {
        return '';
    }
    return rule.extensions
        .map(ext => ext.replace(/^\./, '').toUpperCase())
        .join(', ');
};

const buildDeleteConfirmation = name => {
    if (name) {
        return `Supprimer definitivement "${name}" ?`;
    }
    return 'Supprimer ce lieu ?';
};

const copyLocation = source => {
    if (!source) {
        return { ...DEFAULT_LOCATION };
    }
    return {
        ...DEFAULT_LOCATION,
        ...source,
        images: Array.isArray(source.images) ? [...source.images] : [],
        videos: Array.isArray(source.videos) ? source.videos.map(video => ({ ...video })) : [],
        history: Array.isArray(source.history) ? [...source.history] : [],
        quests: Array.isArray(source.quests) ? [...source.quests] : [],
        lore: Array.isArray(source.lore) ? [...source.lore] : [],
        instances: Array.isArray(source.instances) ? [...source.instances] : [],
        pnjs: Array.isArray(source.pnjs) ? source.pnjs.map(pnj => ({ ...pnj })) : [],
        tags: Array.isArray(source.tags) ? [...source.tags] : []
    };
};

const sanitizeText = value => (value ?? '').toString().trim();
const normalizeAssetUrl = value => {
    const input = sanitizeText(value);
    if (!input) {
        return '';
    }
    if (/^(https?:)?\/\//i.test(input) || input.startsWith('/')) {
        return input;
    }
    if (input.startsWith('assets/')) {
        return `/${input}`;
    }
    return input;
};

const countSentences = value => {
    const text = sanitizeText(value);
    if (!text) {
        return 0;
    }
    const matches = text.match(/[.!?]+(?=\s|$)/g);
    return matches ? matches.length : 1;
};

const formatQuestTimestamp = value => {
    if (!value) {
        return '';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '';
    }
    return date.toLocaleString('fr-FR', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
};

const formatQuestProgress = progress => {
    if (!progress || typeof progress !== 'object') {
        return '';
    }
    const { current, max } = progress;
    const hasCurrent = Number.isFinite(current);
    const hasMax = Number.isFinite(max);
    if (hasCurrent && hasMax) {
        return `${current}/${max}`;
    }
    if (hasCurrent) {
        return `${current}`;
    }
    return '';
};

export class LocationEditor {
    constructor({
        container,
        types = {},
        onCreate = null,
        onUpdate = null,
        onDelete = null,
        onGenerateDescription = null,
        onCreateQuestEvent = null,
        onUpdateQuestEvent = null,
        onDeleteQuestEvent = null
    } = {}) {
        this.container = container;
        this.dialog = container?.querySelector('.editor-dialog') || null;
        this.form = container?.querySelector('#location-editor-form') || null;
        this.closeButton = container?.querySelector('#location-editor-close') || null;
        this.cancelButton = this.form?.querySelector('[data-action="cancel"]') || null;
        this.submitButton = this.form?.querySelector('[data-action="submit"]') || null;
        this.deleteButton = this.form?.querySelector('[data-action="delete"]') || null;
        this.headerTitle = container?.querySelector('#location-editor-title') || null;
        this.imageList = this.form?.querySelector('[data-role="image-list"]') || null;
        this.videoList = this.form?.querySelector('[data-role="video-list"]') || null;
        this.pnjList = this.form?.querySelector('[data-role="pnj-list"]') || null;
        this.tagsList = this.form?.querySelector('[data-role="tags-list"]') || null;
        this.tagsInput = this.form?.querySelector('#editor-tags') || null;
        this.tagsAddButton = this.form?.querySelector('[data-action="add-tag"]') || null;
        this.tagsSuggestions = this.form?.querySelector('#editor-tags-suggestions') || null;
        this.addImageButton = this.form?.querySelector('[data-action="add-image"]') || null;
        this.addVideoButton = this.form?.querySelector('[data-action="add-video"]') || null;
        this.addPnjButton = this.form?.querySelector('[data-action="add-pnj"]') || null;
        this.uploadImageButton = this.form?.querySelector('[data-action="upload-image"]') || null;
        this.uploadAudioButton = this.form?.querySelector('[data-action="upload-audio"]') || null;
        this.imageUploadInput = this.form?.querySelector('#editor-image-upload') || null;
        this.audioUploadInput = this.form?.querySelector('#editor-audio-upload') || null;
        this.imagePreview = this.form?.querySelector('[data-preview="images"]') || null;
        this.videoPreview = this.form?.querySelector('[data-preview="videos"]') || null;
        this.pnjPreview = this.form?.querySelector('[data-preview="pnjs"]') || null;
        this.typeSelect = this.form?.querySelector('#editor-type') || null;
        this.typeOptionGrid = this.form?.querySelector('[data-role="type-option-grid"]') || null;
        this.imageDropZone = this.form?.querySelector('[data-drop-zone="image"]') || null;
        this.audioDropZone = this.form?.querySelector('[data-drop-zone="audio"]') || null;
        this.descriptionInput = this.form?.elements?.description || null;
        this.descriptionToolbar = this.form?.querySelector('[data-role="description-toolbar"]') || null;
        this.descriptionPreview = this.form?.querySelector('[data-preview="description-markdown"]') || null;
        this.descriptionPreviewBody = this.form?.querySelector('[data-role="description-preview-body"]') || null;
        this.descriptionPreviewEmpty = this.descriptionPreview?.querySelector('.markdown-preview-empty') || null;
        this.descriptionDraftStatus = this.form?.querySelector('[data-role="description-draft-status"]') || null;
        this.descriptionDraftMessage = this.form?.querySelector('[data-role="description-draft-message"]') || null;
        this.descriptionDraftTimestamp = this.form?.querySelector('[data-role="description-draft-timestamp"]') || null;
        this.descriptionDraftClearButton = this.form?.querySelector('[data-action="clear-description-draft"]') || null;
        this.descriptionGenerateButton = this.form?.querySelector('[data-action="generate-description"]') || null;
        this.descriptionImproveButton = this.form?.querySelector('[data-action="improve-description"]') || null;
        this.descriptionAssistantNote = this.form?.querySelector('[data-role="description-assistant-note"]') || null;
        this.markdownLists = {
            history: this.form?.querySelector('[data-role="history-list"]') || null,
            quests: this.form?.querySelector('[data-role="quests-list"]') || null,
            lore: this.form?.querySelector('[data-role="lore-list"]') || null,
            instances: this.form?.querySelector('[data-role="instances-list"]') || null,
            nobleFamilies: this.form?.querySelector('[data-role="noble-families-list"]') || null
        };
        this.markdownAddButtons = {
            history: this.form?.querySelector('[data-action="add-history-entry"]') || null,
            quests: this.form?.querySelector('[data-action="add-quests-entry"]') || null,
            lore: this.form?.querySelector('[data-action="add-lore-entry"]') || null,
            instances: this.form?.querySelector('[data-action="add-instances-entry"]') || null,
            nobleFamilies: this.form?.querySelector('[data-action="add-noble-families-entry"]') || null
        };
        this.questEventsContainer = this.form?.querySelector('[data-role="quest-events"]') || null;
        this.questEventsList = this.form?.querySelector('[data-role="quest-events-list"]') || null;
        this.questEventsEmpty = this.form?.querySelector('[data-role="quest-events-empty"]') || null;
        this.questEventsDisabled = this.form?.querySelector('[data-role="quest-events-disabled"]') || null;
        this.questEventForm = this.form?.querySelector('[data-role="quest-event-form"]') || null;
        this.questEventSubmitButton = this.form?.querySelector('[data-action="quest-event-submit"]') || null;
        this.questEventError = this.form?.querySelector('.form-error[data-error-for="quest-events"]') || null;
        this.questEventQuestId = this.form?.querySelector('[data-role="quest-event-quest-id"]') || null;
        this.questEventStatus = this.form?.querySelector('[data-role="quest-event-status"]') || null;
        this.questEventMilestone = this.form?.querySelector('[data-role="quest-event-milestone"]') || null;
        this.questEventProgressCurrent = this.form?.querySelector('[data-role="quest-event-progress-current"]') || null;
        this.questEventProgressMax = this.form?.querySelector('[data-role="quest-event-progress-max"]') || null;
        this.questEventNote = this.form?.querySelector('[data-role="quest-event-note"]') || null;
        this.questEventCancelButton = this.form?.querySelector('[data-action="quest-event-cancel"]') || null;
        this.warningsPanel = this.form?.querySelector('[data-role="validation-warnings"]') || null;
        this.warningsList = this.form?.querySelector('[data-role="validation-warnings-list"]') || null;
        this.warningsFootnote = this.form?.querySelector('[data-role="validation-warnings-footnote"]') || null;
        this.linkSuggestionsPanel = this.form?.querySelector('[data-role="link-suggestions"]') || null;
        this.linkSuggestionsList = this.form?.querySelector('[data-role="link-suggestions-list"]') || null;
        this.linkSuggestionsEmpty = this.form?.querySelector('[data-role="link-suggestions-empty"]') || null;
        this.linkSuggestionsRefreshButton = this.form?.querySelector('[data-action="refresh-link-suggestions"]') || null;
        this.linkSuggestionsApplyAllButton = this.form?.querySelector('[data-action="apply-link-suggestions"]') || null;
        this.latestWarnings = [];
        this.editingQuestEventId = null;
        this.linkSuggestions = [];
        this.availableLocations = [];
        this.linkSuggestionTimer = null;
        this.ignoredLinkSuggestions = new Set();
        this.draggedMarkdownRow = null;

        this.callbacks = {
            onCreate,
            onUpdate,
            onDelete,
            onGenerateDescription,
            onCreateQuestEvent,
            onUpdateQuestEvent,
            onDeleteQuestEvent
        };
        this.types = types || {};
        this.mode = 'create';
        this.currentContext = null;
        this.disallowedNames = new Set();
        this.boundKeyHandler = null;
        this.previousFocus = null;
        this.isOpen = false;
        this.questEvents = [];
        this.isSubmittingQuestEvent = false;
        this.descriptionDraftKey = null;
        this.lastSavedDescriptionDraft = '';
        this.lastDraftSavedAt = null;
        this.descriptionDraftSkipOnce = false;
        this.draftSaveTimeout = null;
        this.draftStatusHideTimeout = null;
        this.descriptionAssistantBusy = false;
        this.boundBeforeUnload = null;
        this.markdownSections = [...MARKDOWN_SECTION_TYPES];
        this.markdownSectionConfig = MARKDOWN_SECTION_CONFIG;
        this.markdownEntryCounters = {};
        this.availableTags = [];
        this.resetMarkdownEntryCounters();
        if (this.descriptionPreviewBody) {
            this.descriptionPreviewBody.hidden = true;
        }
        this.descriptionToolbarButtons = this.descriptionToolbar ? Array.from(this.descriptionToolbar.querySelectorAll('[data-md]')) : [];

        this.updateDescriptionPreview();


        if (this.deleteButton) {
            this.deleteButton.hidden = true;
            this.deleteButton.disabled = true;
        }

        if (this.form) {
            this.registerEvents();
            this.renderTypeOptions();
        }

        if (typeof window !== 'undefined') {
            this.boundBeforeUnload = () => {
                if (this.isOpen) {
                    this.flushDescriptionDraftSave();
                }
            };
            window.addEventListener('beforeunload', this.boundBeforeUnload);
        }
    }

    registerEvents() {
        if (this.descriptionInput) {
            this.descriptionInput.addEventListener('input', () => {
                this.updateDescriptionPreview();
                this.updateNarrativeWarnings();
                this.updateDescriptionAssistantActions();
                this.scheduleDescriptionDraftSave();
                this.scheduleLinkSuggestions();
            });
            this.descriptionInput.addEventListener('blur', () => this.flushDescriptionDraftSave());
        }

        if (this.descriptionDraftClearButton) {
            this.descriptionDraftClearButton.addEventListener('click', () => {
                this.clearDescriptionDraft({ showMessage: true });
            });
        }
        if (this.descriptionGenerateButton) {
            this.descriptionGenerateButton.addEventListener('click', event => {
                event.preventDefault();
                this.handleDescriptionAssistant('generate');
            });
        }
        if (this.descriptionImproveButton) {
            this.descriptionImproveButton.addEventListener('click', event => {
                event.preventDefault();
                this.handleDescriptionAssistant('improve');
            });
        }
        if (this.descriptionToolbarButtons && this.descriptionToolbarButtons.length) {
            this.descriptionToolbarButtons.forEach(button => {
                button.addEventListener('click', () => this.insertMarkdownSnippet(button.dataset.md || ''));
            });
        }

        if (this.tagsAddButton) {
            this.tagsAddButton.addEventListener('click', event => {
                event.preventDefault();
                this.addTagsFromInput();
            });
        }
        if (this.tagsInput) {
            this.tagsInput.addEventListener('keydown', event => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    this.addTagsFromInput();
                }
            });
        }
        if (this.tagsList) {
            this.tagsList.addEventListener('click', event => {
                if (event.target?.dataset?.action === 'remove-tag') {
                    const value = event.target.dataset.value || '';
                    this.removeTag(value);
                }
            });
        }

        this.form.addEventListener('submit', event => {
            event.preventDefault();
            this.handleSubmit();
        });

        this.form.addEventListener('input', event => {
            const target = event.target;
            if (!target) {
                return;
            }
            if (target.name === 'name' || target.name === 'continent') {
                this.validateField(target.name);
            }
            if (target.name === 'x' || target.name === 'y') {
                this.validateCoordinates();
            }
            if (target.dataset?.role === 'image-input') {
                this.validateImages();
                this.updateImagePreview();
            }
            if (target.dataset?.role === 'markdown-entry-input') {
                const entryType = target.dataset?.entryType || '';
                if (entryType === 'history' || entryType === 'lore') {
                    this.updateNarrativeWarnings();
                }
            }
            if (target.dataset?.role === 'video-url' || target.dataset?.role === 'video-title') {
                this.validateVideos();
                this.updateVideoPreview();
            }
            if (target.dataset?.role === 'pnj-name' || target.dataset?.role === 'pnj-role' || target.dataset?.role === 'pnj-description') {
                this.validatePnjs();
                this.updatePnjPreview();
            }
            if (target.name === 'type') {
                this.validateField('type');
                this.updateTypeOptionSelection();
            }
            if (target.name === 'audio') {
                this.validateAudio();
            }
            if (target.dataset?.role === 'markdown-entry-input') {
                this.updateMarkdownEntryPreview(target);
                this.scheduleLinkSuggestions();
            }
        });

        if (this.linkSuggestionsRefreshButton) {
            this.linkSuggestionsRefreshButton.addEventListener('click', () => this.refreshLinkSuggestions());
        }
        if (this.linkSuggestionsApplyAllButton) {
            this.linkSuggestionsApplyAllButton.addEventListener('click', () => this.applyAllLinkSuggestions());
        }
        if (this.linkSuggestionsList) {
            this.linkSuggestionsList.addEventListener('click', event => {
                const button = event.target?.closest('button');
                if (!button) {
                    return;
                }
                const action = button.dataset?.action || '';
                const id = button.dataset?.suggestionId || '';
                if (!id) {
                    return;
                }
                if (action === 'apply-link-suggestion') {
                    this.applyLinkSuggestion(id);
                } else if (action === 'ignore-link-suggestion') {
                    this.ignoreLinkSuggestion(id);
                }
            });
        }

        if (this.addImageButton) {
            this.addImageButton.addEventListener('click', () => {
                this.addImageField('');
                this.validateImages();
            });
        }

        if (this.addVideoButton) {
            this.addVideoButton.addEventListener('click', () => {
                this.addVideoField({ url: '', title: '' });
                this.validateVideos();
            });
        }
        if (this.addPnjButton) {
            this.addPnjButton.addEventListener('click', () => {
                this.addPnjField({ name: '', role: '', description: '' });
                this.validatePnjs();
            });
        }

        const handleMarkdownListClick = event => {
            const button = event.target?.closest('[data-action="remove-markdown-entry"], [data-action="move-markdown-entry"]');
            if (!button) {
                return;
            }
            event.preventDefault();
            if (button.dataset?.action === 'remove-markdown-entry') {
                this.handleRemoveMarkdownEntry(button);
            } else {
                this.handleMoveMarkdownEntry(button);
            }
        };

        this.markdownSections.forEach(type => {
            const addButton = this.markdownAddButtons[type];
            if (addButton) {
                addButton.addEventListener('click', () => {
                    const row = this.addMarkdownEntry(type, '');
                    const textarea = row?.querySelector('textarea[data-role="markdown-entry-input"]');
                    if (textarea) {
                        textarea.focus();
                        const length = textarea.value.length;
                        try {
                            textarea.setSelectionRange(length, length);
                        } catch (error) {
                            // ignore selection errors (e.g., non-supported inputs)
                        }
                    }
                });
            }
            const list = this.markdownLists[type];
            if (list) {
                list.addEventListener('click', handleMarkdownListClick);
                this.bindMarkdownListDragHandlers(list, type);
            }
        });

        if (this.uploadImageButton && this.imageUploadInput) {
            this.uploadImageButton.addEventListener('click', () => this.imageUploadInput.click());
        }

        if (this.uploadAudioButton && this.audioUploadInput) {
            this.uploadAudioButton.addEventListener('click', () => this.audioUploadInput.click());
        }

        if (this.questEventSubmitButton) {
            this.questEventSubmitButton.addEventListener('click', () => this.handleQuestEventSubmit());
        }
        if (this.questEventCancelButton) {
            this.questEventCancelButton.addEventListener('click', () => this.cancelQuestEventEdit());
        }

        if (this.imageUploadInput) {
            this.imageUploadInput.addEventListener('change', event => {
                const files = Array.from(event.target?.files || []);
                if (files.length) {
                    this.handleImageFiles(files);
                }
                event.target.value = '';
            });
        }

        if (this.audioUploadInput) {
            this.audioUploadInput.addEventListener('change', event => {
                const files = Array.from(event.target?.files || []);
                if (files.length) {
                    this.handleAudioFiles(files);
                }
                event.target.value = '';
            });
        }

        if (this.imageList) {
            this.imageList.addEventListener('click', event => {
                if (event.target?.dataset?.action === 'remove-image') {
                    const row = event.target.closest('.editor-list-row');
                    row?.remove();
                    this.validateImages();
                    this.updateImagePreview();
                }
            });
        }

        if (this.videoList) {
            this.videoList.addEventListener('click', event => {
                if (event.target?.dataset?.action === 'remove-video') {
                    const row = event.target.closest('.editor-list-row');
                    row?.remove();
                    this.validateVideos();
                    this.updateVideoPreview();
                }
            });
        }

        if (this.pnjList) {
            this.pnjList.addEventListener('click', event => {
                if (event.target?.dataset?.action === 'remove-pnj') {
                    const row = event.target.closest('.editor-list-row');
                    row?.remove();
                    this.validatePnjs();
                    this.updatePnjPreview();
                }
            });
        }

        this.setupDropZone(this.imageDropZone, UPLOAD_TYPES.image);
        this.setupDropZone(this.audioDropZone, UPLOAD_TYPES.audio);

        if (this.deleteButton) {
            this.deleteButton.addEventListener('click', () => this.handleDelete());
        }

        if (this.cancelButton) {
            this.cancelButton.addEventListener('click', () => this.close());
        }

        if (this.typeOptionGrid) {
            this.typeOptionGrid.addEventListener('click', event => {
                const button = event.target?.closest('[data-action="select-type-option"]');
                const value = button?.dataset?.typeValue || '';
                if (!value || !this.typeSelect || (value !== 'default' && !this.types[value])) {
                    return;
                }
                this.typeSelect.value = value;
                this.updateTypeOptionSelection();
                this.validateField('type');
            });
        }

        if (this.closeButton) {
            this.closeButton.addEventListener('click', () => this.close());
        }

        if (this.container) {
            this.container.addEventListener('click', event => {
                if (event.target === this.container) {
                    this.close();
                }
            });
        }
    }

    setTypes(types = {}) {
        this.types = types || {};
        this.renderTypeOptions();
    }

    renderTypeOptions() {
        if (!this.typeSelect) {
            return;
        }
        const current = this.typeSelect.value;
        clearElement(this.typeSelect);
        const entries = Object.keys(this.types || {}).sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));
        entries.unshift('default');
        entries.forEach(typeName => {
            const option = createElement('option', { text: typeName, attributes: { value: typeName } });
            this.typeSelect.appendChild(option);
        });
        if (current && entries.includes(current)) {
            this.typeSelect.value = current;
        }
        this.renderTypeOptionGrid(entries);
        this.updateTypeOptionSelection();
    }

    renderTypeOptionGrid(entries = []) {
        if (!this.typeOptionGrid) {
            return;
        }
        clearElement(this.typeOptionGrid);
        entries.forEach(typeName => {
            const meta = this.getTypeMeta(typeName);
            const button = createElement('button', {
                className: 'type-picker-option',
                dataset: {
                    action: 'select-type-option',
                    typeValue: typeName
                },
                attributes: {
                    type: 'button',
                    'aria-pressed': 'false'
                }
            });
            if (meta.icon) {
                button.appendChild(createElement('img', {
                    className: 'type-picker-icon',
                    attributes: {
                        src: meta.icon,
                        alt: '',
                        loading: 'lazy'
                    }
                }));
            } else {
                button.appendChild(createElement('span', {
                    className: 'type-picker-fallback',
                    text: '•',
                    attributes: { 'aria-hidden': 'true' }
                }));
            }
            button.appendChild(createElement('span', {
                className: 'type-picker-label',
                text: meta.label
            }));
            this.typeOptionGrid.appendChild(button);
        });
    }

    getTypeMeta(typeName = '') {
        const entry = this.types?.[typeName];
        const label = sanitizeText(entry?.label || typeName || 'default');
        const icon = normalizeAssetUrl(entry?.icon || '');
        return {
            label,
            icon
        };
    }

    updateTypeOptionSelection() {
        if (!this.typeOptionGrid) {
            return;
        }
        const current = this.typeSelect?.value || 'default';
        Array.from(this.typeOptionGrid.querySelectorAll('[data-action="select-type-option"]')).forEach(button => {
            const isActive = (button.dataset?.typeValue || '') === current;
            button.classList.toggle('is-active', isActive);
            button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });
    }

    open({ mode = 'create', location = null, continent = '', disallowedNames = [], questEvents = [], availableLocations = [] } = {}) {
        if (!this.container) {
            return;
        }
        this.mode = mode;
        this.disallowedNames = new Set(
            (Array.isArray(disallowedNames) ? disallowedNames : [])
                .map(name => (name ?? '').toString().trim().toLowerCase())
                .filter(Boolean)
        );
        this.currentContext = {
            location: copyLocation(location),
            continent: continent || (location?.continent || ''),
            originalName: location?.name || ''
        };
        this.questEvents = Array.isArray(questEvents) ? [...questEvents] : [];
        this.setAvailableLocations(availableLocations);
        this.descriptionDraftKey = this.buildDescriptionDraftKey();
        this.descriptionDraftSkipOnce = false;
        this.lastSavedDescriptionDraft = '';
        this.lastDraftSavedAt = null;
        this.ignoredLinkSuggestions.clear();

        if (this.deleteButton) {
            const isEditMode = mode === 'edit';
            this.deleteButton.hidden = !isEditMode;
            this.deleteButton.disabled = !isEditMode;
            const name = this.currentContext?.originalName || '';
            const label = isEditMode && name
                ? `Supprimer ${name}`
                : 'Supprimer ce lieu';
            this.deleteButton.setAttribute('aria-label', label);
        }

        this.populateForm();
        this.resetErrors();
        this.setDescriptionAssistantNote('Utilisez Historique et Lore comme sources longues, puis generez ici un brouillon court a relire avant enregistrement.', 'info');
        this.setDescriptionAssistantBusy(false);
        this.updateDescriptionAssistantActions();
        this.updateNarrativeWarnings();
        this.renderWarnings();
        this.updateImagePreview();
        this.updateVideoPreview();
        this.updatePnjPreview();
        this.updateQuestEventsSection();
        this.restoreDescriptionDraft();
        this.refreshLinkSuggestions();

        if (this.headerTitle) {
            this.headerTitle.textContent = mode === 'edit' ? 'Modifier un lieu' : 'Creer un lieu';
        }
        if (this.submitButton) {
            this.submitButton.textContent = mode === 'edit' ? 'Enregistrer' : 'Creer';
        }

        this.previousFocus = document.activeElement;
        this.container.hidden = false;
        this.container.classList.add('open');
        this.dialog?.focus?.();
        this.isOpen = true;

        this.boundKeyHandler = event => {
            if (event.key === 'Escape') {
                this.close();
            }
        };
        document.addEventListener('keydown', this.boundKeyHandler);
    }

    close() {
        if (!this.container || !this.isOpen) {
            return;
        }
        this.flushDescriptionDraftSave();
        if (this.draftStatusHideTimeout) {
            clearTimeout(this.draftStatusHideTimeout);
            this.draftStatusHideTimeout = null;
        }
        this.container.classList.remove('open');
        this.container.hidden = true;
        if (this.boundKeyHandler) {
            document.removeEventListener('keydown', this.boundKeyHandler);
            this.boundKeyHandler = null;
        }
        if (this.deleteButton) {
            this.deleteButton.disabled = true;
            this.deleteButton.hidden = true;
            this.deleteButton.removeAttribute('aria-label');
        }
        this.isOpen = false;
        this.descriptionDraftKey = null;
        this.lastSavedDescriptionDraft = '';
        this.lastDraftSavedAt = null;
        this.descriptionDraftSkipOnce = false;
        if (this.linkSuggestionTimer) {
            clearTimeout(this.linkSuggestionTimer);
            this.linkSuggestionTimer = null;
        }
        this.linkSuggestions = [];
        this.ignoredLinkSuggestions.clear();
        if (this.linkSuggestionsPanel) {
            this.linkSuggestionsPanel.hidden = true;
        }
        this.setDescriptionAssistantBusy(false);
        this.setDescriptionAssistantNote('Utilisez Historique et Lore comme sources longues, puis generez ici un brouillon court a relire avant enregistrement.', 'info');
        this.latestWarnings = [];
        this.renderWarnings();
        this.clearError('descriptionAssistant');
        this.setDescriptionDraftStatus(null);
        this.currentContext = null;
        this.disallowedNames.clear();
        this.questEvents = [];
        this.clearQuestEventForm();
        this.setQuestEventError('');
        this.previousFocus?.focus?.();
        this.previousFocus = null;
    }

    populateForm() {
        if (!this.form || !this.currentContext) {
            return;
        }
        const { location, continent } = this.currentContext;
        this.form.reset();
        this.form.elements.name.value = location.name || '';
        this.form.elements.continent.value = continent || '';
        if (this.typeSelect) {
            this.typeSelect.value = location.type && this.types[location.type] ? location.type : 'default';
        }
        this.form.elements.x.value = Number.isFinite(location.x) ? Math.round(location.x) : '';
        this.form.elements.y.value = Number.isFinite(location.y) ? Math.round(location.y) : '';
        if (this.descriptionInput) {
            this.descriptionInput.value = location.description || '';
            this.updateDescriptionPreview();
        }
        this.form.elements.audio.value = location.audio || '';
        this.resetMarkdownEntryCounters();
        this.setMarkdownEntries('history', location.history);
        this.setMarkdownEntries('quests', location.quests);
        this.setMarkdownEntries('lore', location.lore);
        this.setMarkdownEntries('instances', location.instances);
        this.setMarkdownEntries('nobleFamilies', location.nobleFamilies);
        this.setTags(location.tags);

        if (this.imageList) {
            clearElement(this.imageList);
            const images = Array.isArray(location.images) && location.images.length ? location.images : [''];
            images.forEach(url => this.addImageField(url));
        }

        if (this.videoList) {
            clearElement(this.videoList);
            const videos = Array.isArray(location.videos) && location.videos.length
                ? location.videos
                : [{ url: '', title: '' }];
            videos.forEach(video => this.addVideoField(video));
        }

        if (this.pnjList) {
            clearElement(this.pnjList);
            const pnjs = Array.isArray(location.pnjs) && location.pnjs.length
                ? location.pnjs
                : [{ name: '', role: '', description: '' }];
            pnjs.forEach(pnj => this.addPnjField(pnj));
        }
        this.updateImagePreview();
        this.updateVideoPreview();
        this.updatePnjPreview();

    }

    updateDescriptionPreview() {
        if (!this.descriptionPreview || !this.descriptionInput) {
            return;
        }
        const value = this.descriptionInput.value || '';
        const html = renderMarkdown(value);
        if (!html.trim()) {
            if (this.descriptionPreviewBody) {
                this.descriptionPreviewBody.innerHTML = '';
                this.descriptionPreviewBody.hidden = true;
            } else {
                this.descriptionPreview.innerHTML = '';
            }
            if (this.descriptionPreviewEmpty) {
                this.descriptionPreviewEmpty.hidden = false;
                if (!this.descriptionPreview.contains(this.descriptionPreviewEmpty)) {
                    this.descriptionPreview.appendChild(this.descriptionPreviewEmpty);
                }
            }
            return;
        }
        if (this.descriptionPreviewEmpty) {
            this.descriptionPreviewEmpty.hidden = true;
        }
        if (this.descriptionPreviewBody) {
            this.descriptionPreviewBody.hidden = false;
            this.descriptionPreviewBody.innerHTML = html;
        } else {
            this.descriptionPreview.innerHTML = html;
        }
    }

    insertMarkdownSnippet(snippet) {
        if (!this.descriptionInput || !snippet) {
            return;
        }
        const textarea = this.descriptionInput;
        const start = textarea.selectionStart ?? textarea.value.length;
        const end = textarea.selectionEnd ?? start;
        const placeholderIndex = snippet.indexOf('|');
        let insertText = snippet;
        let caretPosition = start;
        if (placeholderIndex !== -1) {
            insertText = snippet.replace('|', '');
            caretPosition = start + placeholderIndex;
        } else {
            caretPosition = start + insertText.length;
        }
        const before = textarea.value.slice(0, start);
        const after = textarea.value.slice(end);
        textarea.value = before + insertText + after;
        textarea.focus();
        textarea.selectionStart = textarea.selectionEnd = caretPosition;
        this.updateDescriptionPreview();
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }

    buildDescriptionDraftKey() {
        const base = `${DRAFT_STORAGE_KEY_PREFIX}:${this.mode === 'edit' ? 'edit' : 'create'}`;
        if (this.mode === 'edit') {
            const name = normalizeDraftIdentifier(this.currentContext?.originalName);
            if (name) {
                return `${base}:${name}`;
            }
            return `${base}:unnamed`;
        }
        return base;
    }

    restoreDescriptionDraft() {
        if (!this.descriptionInput || !canUseDraftStorage()) {
            this.setDescriptionDraftStatus(null);
            return;
        }
        const key = this.descriptionDraftKey || this.buildDescriptionDraftKey();
        if (!key) {
            this.setDescriptionDraftStatus(null);
            return;
        }
        const draft = readDraftRecord(key);
        if (!draft) {
            this.lastSavedDescriptionDraft = '';
            this.lastDraftSavedAt = null;
            this.setDescriptionDraftStatus(null);
            return;
        }
        this.descriptionDraftKey = key;
        this.lastSavedDescriptionDraft = draft.value;
        this.lastDraftSavedAt = draft.updatedAt;
        const currentValue = typeof this.descriptionInput.value === 'string' ? this.descriptionInput.value : '';
        const shouldRestore = draft.value !== currentValue;
        if (shouldRestore) {
            this.descriptionInput.value = draft.value;
            this.updateDescriptionPreview();
        }
        this.setDescriptionDraftStatus(draft.updatedAt, { restored: shouldRestore });
    }

    scheduleDescriptionDraftSave() {
        if (!this.descriptionInput || !canUseDraftStorage() || !this.isOpen) {
            return;
        }
        if (!this.descriptionDraftKey) {
            this.descriptionDraftKey = this.buildDescriptionDraftKey();
        }
        if (this.draftSaveTimeout) {
            clearTimeout(this.draftSaveTimeout);
        }
        this.draftSaveTimeout = setTimeout(() => {
            this.draftSaveTimeout = null;
            this.saveDescriptionDraft();
        }, DRAFT_SAVE_DEBOUNCE);
    }

    flushDescriptionDraftSave() {
        if (this.draftSaveTimeout) {
            clearTimeout(this.draftSaveTimeout);
            this.draftSaveTimeout = null;
        }
        if (!this.descriptionInput || !canUseDraftStorage() || !this.isOpen) {
            return;
        }
        if (this.descriptionDraftSkipOnce) {
            this.descriptionDraftSkipOnce = false;
            return;
        }
        this.saveDescriptionDraft();
    }

    saveDescriptionDraft() {
        if (!this.descriptionInput || !canUseDraftStorage()) {
            return;
        }
        if (!this.descriptionDraftKey) {
            this.descriptionDraftKey = this.buildDescriptionDraftKey();
        }
        const key = this.descriptionDraftKey;
        if (!key) {
            return;
        }
        const rawValue = typeof this.descriptionInput.value === 'string'
            ? this.descriptionInput.value
            : (this.descriptionInput.value ?? '').toString();
        if (!rawValue.trim()) {
            this.clearDescriptionDraft();
            return;
        }
        if (rawValue === this.lastSavedDescriptionDraft) {
            if (this.lastDraftSavedAt) {
                this.setDescriptionDraftStatus(this.lastDraftSavedAt);
            }
            return;
        }
        const savedAt = writeDraftRecord(key, rawValue);
        if (Number.isFinite(savedAt)) {
            this.lastSavedDescriptionDraft = rawValue;
            this.lastDraftSavedAt = savedAt;
            this.setDescriptionDraftStatus(savedAt);
        }
    }

    clearDescriptionDraft({ showMessage = false } = {}) {
        if (this.descriptionDraftKey && canUseDraftStorage()) {
            removeDraftRecord(this.descriptionDraftKey);
        }
        this.descriptionDraftSkipOnce = true;
        this.lastSavedDescriptionDraft = '';
        this.lastDraftSavedAt = null;
        if (this.draftSaveTimeout) {
            clearTimeout(this.draftSaveTimeout);
            this.draftSaveTimeout = null;
        }
        if (this.draftStatusHideTimeout) {
            clearTimeout(this.draftStatusHideTimeout);
            this.draftStatusHideTimeout = null;
        }
        if (showMessage && this.descriptionDraftStatus) {
            if (this.descriptionDraftMessage) {
                this.descriptionDraftMessage.textContent = 'Brouillon supprime';
            }
            if (this.descriptionDraftTimestamp) {
                this.descriptionDraftTimestamp.textContent = '';
            }
            this.descriptionDraftStatus.hidden = false;
            this.descriptionDraftStatus.dataset.state = 'cleared';
            this.draftStatusHideTimeout = setTimeout(() => {
                if (this.descriptionDraftStatus) {
                    this.descriptionDraftStatus.hidden = true;
                    this.descriptionDraftStatus.dataset.state = '';
                }
                this.draftStatusHideTimeout = null;
            }, 2400);
        } else {
            this.setDescriptionDraftStatus(null);
        }
    }

    setDescriptionDraftStatus(timestamp, { restored = false } = {}) {
        if (!this.descriptionDraftStatus) {
            return;
        }
        if (this.draftStatusHideTimeout) {
            clearTimeout(this.draftStatusHideTimeout);
            this.draftStatusHideTimeout = null;
        }
        if (!timestamp) {
            this.descriptionDraftStatus.hidden = true;
            this.descriptionDraftStatus.dataset.state = '';
            if (this.descriptionDraftMessage) {
                this.descriptionDraftMessage.textContent = '';
            }
            if (this.descriptionDraftTimestamp) {
                this.descriptionDraftTimestamp.textContent = '';
            }
            return;
        }
        const formatted = formatDraftTimestamp(timestamp);
        if (this.descriptionDraftMessage) {
            this.descriptionDraftMessage.textContent = restored ? 'Brouillon restaure' : 'Brouillon enregistre';
        }
        if (this.descriptionDraftTimestamp) {
            this.descriptionDraftTimestamp.textContent = formatted ? `- ${formatted}` : '';
        }
        this.descriptionDraftStatus.hidden = false;
        if (restored) {
            this.descriptionDraftStatus.dataset.state = 'restored';
        } else {
            this.descriptionDraftStatus.dataset.state = 'saved';
        }
    }

    resetMarkdownEntryCounters() {
        if (!this.markdownEntryCounters) {
            this.markdownEntryCounters = {};
        }
        (this.markdownSections || []).forEach(type => {
            this.markdownEntryCounters[type] = 0;
        });
    }

    getMarkdownConfig(type) {
        return this.markdownSectionConfig?.[type] || {};
    }

    getMarkdownList(type) {
        return this.markdownLists?.[type] || null;
    }

    addMarkdownEntry(type, value = '') {
        const list = this.getMarkdownList(type);
        if (!list) {
            return null;
        }
        if (typeof this.markdownEntryCounters[type] !== 'number') {
            this.markdownEntryCounters[type] = 0;
        }
        const index = this.markdownEntryCounters[type]++;
        const row = this.createMarkdownEntryRow(type, value, index);
        list.appendChild(row);
        const textarea = row.querySelector('textarea[data-role="markdown-entry-input"]');
        if (textarea) {
            this.updateMarkdownEntryPreview(textarea);
        }
        this.updateMarkdownEntryOrderControls(type);
        return row;
    }

    createMarkdownEntryRow(type, value = '', index = 0) {
        const config = this.getMarkdownConfig(type);
        const row = createElement('div', {
            className: 'markdown-entry-row',
            dataset: { entryType: type }
        });
        const actions = createElement('div', { className: 'markdown-entry-actions' });
        const dragHandle = createElement('span', {
            className: 'markdown-entry-drag-handle',
            text: 'Deplacer',
            title: 'Glisser pour reordonner ce bloc',
            attributes: {
                draggable: 'true',
                'aria-hidden': 'true'
            }
        });
        const moveUpButton = createElement('button', {
            className: 'tertiary-button markdown-entry-move',
            text: 'Monter',
            dataset: { action: 'move-markdown-entry', direction: 'up', entryType: type },
            attributes: {
                type: 'button',
                'aria-label': `Monter ${config.label || 'ce bloc'}`
            }
        });
        const moveDownButton = createElement('button', {
            className: 'tertiary-button markdown-entry-move',
            text: 'Descendre',
            dataset: { action: 'move-markdown-entry', direction: 'down', entryType: type },
            attributes: {
                type: 'button',
                'aria-label': `Descendre ${config.label || 'ce bloc'}`
            }
        });
        const removeButton = createElement('button', {
            className: 'tertiary-button markdown-entry-remove',
            text: 'Supprimer',
            dataset: { action: 'remove-markdown-entry', entryType: type },
            attributes: {
                type: 'button',
                'aria-label': config.removeLabel || 'Supprimer cet element'
            }
        });
        actions.append(dragHandle, moveUpButton, moveDownButton, removeButton);
        row.appendChild(actions);
        const textarea = createElement('textarea', {
            className: 'markdown-entry-input',
            dataset: { role: 'markdown-entry-input', entryType: type },
            attributes: {
                id: `${type}-entry-${index}`,
                rows: 4,
                placeholder: config.placeholder || 'Texte Markdown...'
            }
        });
        textarea.value = value || '';
        row.appendChild(textarea);
        const preview = createElement('div', {
            className: 'markdown-preview',
            dataset: { role: 'markdown-entry-preview' }
        });
        const empty = createElement('p', {
            className: 'markdown-preview-empty',
            text: config.emptyText || 'Previsualisation Markdown.',
            dataset: { role: 'markdown-entry-preview-empty' }
        });
        const body = createElement('div', {
            className: 'markdown-preview-body markdown-content',
            dataset: { role: 'markdown-entry-preview-body' },
            attributes: { hidden: '' }
        });
        preview.appendChild(empty);
        preview.appendChild(body);
        row.appendChild(preview);
        return row;
    }

    setMarkdownEntries(type, entries) {
        const list = this.getMarkdownList(type);
        if (!list) {
            return;
        }
        clearElement(list);
        const values = Array.isArray(entries) && entries.length ? entries : [''];
        values.forEach(value => {
            this.addMarkdownEntry(type, value);
        });
        this.updateMarkdownEntryOrderControls(type);
    }

    collectMarkdownEntries(type) {
        const list = this.getMarkdownList(type);
        if (!list) {
            return [];
        }
        const rows = Array.from(list.querySelectorAll('.markdown-entry-row'));
        return rows
            .filter(row => (row.dataset?.entryType || '') === type)
            .map(row => {
                const textarea = row.querySelector('textarea[data-role="markdown-entry-input"]');
                return (textarea?.value || '').trim();
            })
            .filter(value => value.length);
    }

    updateMarkdownEntryPreview(input) {
        if (!input) {
            return;
        }
        const row = input.closest('.markdown-entry-row');
        if (!row) {
            return;
        }
        const previewBody = row.querySelector('[data-role="markdown-entry-preview-body"]');
        const previewEmpty = row.querySelector('[data-role="markdown-entry-preview-empty"]');
        if (!previewBody || !previewEmpty) {
            return;
        }
        const value = input.value || '';
        const html = renderMarkdown(value);
        if (!html.trim()) {
            previewBody.innerHTML = '';
            previewBody.hidden = true;
            previewEmpty.hidden = false;
        } else {
            previewBody.innerHTML = html;
            previewBody.hidden = false;
            previewEmpty.hidden = true;
        }
    }

    handleRemoveMarkdownEntry(button) {
        if (!button) {
            return;
        }
        const row = button.closest('.markdown-entry-row');
        const type = button.dataset?.entryType || row?.dataset?.entryType;
        if (!row || !type) {
            return;
        }
        const list = this.getMarkdownList(type);
        const nextRow = row.nextElementSibling || row.previousElementSibling || null;
        row.remove();
        let focusTarget = nextRow?.querySelector?.('textarea[data-role="markdown-entry-input"]') || null;
        if (list && !list.querySelector('.markdown-entry-row')) {
            const replacement = this.addMarkdownEntry(type, '');
            focusTarget = replacement?.querySelector('textarea[data-role="markdown-entry-input"]') || focusTarget;
        }
        this.updateMarkdownEntryOrderControls(type);
        focusTarget?.focus?.();
        this.scheduleLinkSuggestions();
    }

    handleMoveMarkdownEntry(button) {
        if (!button) {
            return;
        }
        const row = button.closest('.markdown-entry-row');
        const type = button.dataset?.entryType || row?.dataset?.entryType;
        const direction = button.dataset?.direction;
        const list = this.getMarkdownList(type);
        if (!row || !type || !list) {
            return;
        }
        if (direction === 'up' && row.previousElementSibling) {
            list.insertBefore(row, row.previousElementSibling);
        } else if (direction === 'down' && row.nextElementSibling) {
            list.insertBefore(row.nextElementSibling, row);
        }
        this.updateMarkdownEntryOrderControls(type);
        this.scheduleLinkSuggestions();
        row.querySelector('textarea[data-role="markdown-entry-input"]')?.focus?.();
    }

    bindMarkdownListDragHandlers(list, type) {
        if (!list || list.dataset.dragBound === 'true') {
            return;
        }
        list.dataset.dragBound = 'true';
        list.addEventListener('dragstart', event => this.handleMarkdownDragStart(event, type));
        list.addEventListener('dragover', event => this.handleMarkdownDragOver(event, type));
        list.addEventListener('drop', event => this.handleMarkdownDrop(event, type));
        list.addEventListener('dragend', () => this.handleMarkdownDragEnd(type));
    }

    handleMarkdownDragStart(event, type) {
        const row = event.target?.closest?.('.markdown-entry-row');
        const isHandle = event.target?.closest?.('.markdown-entry-drag-handle');
        if (!row || !isHandle || row.dataset?.entryType !== type) {
            event.preventDefault();
            return;
        }
        this.draggedMarkdownRow = row;
        row.classList.add('is-dragging');
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', type);
        }
    }

    handleMarkdownDragOver(event, type) {
        const list = this.getMarkdownList(type);
        const dragged = this.draggedMarkdownRow;
        if (!list || !dragged || dragged.dataset?.entryType !== type) {
            return;
        }
        event.preventDefault();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'move';
        }
        const target = event.target?.closest?.('.markdown-entry-row');
        if (!target || target === dragged || target.parentElement !== list) {
            return;
        }
        const rect = target.getBoundingClientRect();
        const insertAfter = event.clientY > rect.top + rect.height / 2;
        list.insertBefore(dragged, insertAfter ? target.nextSibling : target);
    }

    handleMarkdownDrop(event, type) {
        const dragged = this.draggedMarkdownRow;
        if (!dragged || dragged.dataset?.entryType !== type) {
            return;
        }
        event.preventDefault();
        this.handleMarkdownDragEnd(type);
        this.scheduleLinkSuggestions();
    }

    handleMarkdownDragEnd(type = '') {
        if (this.draggedMarkdownRow) {
            this.draggedMarkdownRow.classList.remove('is-dragging');
            this.draggedMarkdownRow = null;
        }
        if (type) {
            this.updateMarkdownEntryOrderControls(type);
        }
    }

    updateMarkdownEntryOrderControls(type) {
        const list = this.getMarkdownList(type);
        if (!list) {
            return;
        }
        const rows = Array.from(list.querySelectorAll('.markdown-entry-row'))
            .filter(row => row.dataset?.entryType === type);
        rows.forEach((row, index) => {
            row.dataset.order = String(index + 1);
            const moveUp = row.querySelector('[data-action="move-markdown-entry"][data-direction="up"]');
            const moveDown = row.querySelector('[data-action="move-markdown-entry"][data-direction="down"]');
            if (moveUp) {
                moveUp.disabled = index === 0;
            }
            if (moveDown) {
                moveDown.disabled = index === rows.length - 1;
            }
        });
    }

    setQuestEvents(events = []) {
        this.questEvents = Array.isArray(events) ? [...events] : [];
        this.renderQuestEvents();
    }

    updateQuestEventsSection() {
        const locationName = this.getLocationName();
        const isEditMode = this.mode === 'edit' && Boolean(locationName);

        if (this.questEventsDisabled) {
            this.questEventsDisabled.hidden = isEditMode;
        }
        if (this.questEventsContainer) {
            this.questEventsContainer.hidden = !isEditMode;
        }
        if (this.questEventForm) {
            this.questEventForm.hidden = !isEditMode;
            const fields = this.questEventForm.querySelectorAll('input, textarea, select, button');
            fields.forEach(field => {
                field.disabled = !isEditMode;
            });
        }

        if (!isEditMode) {
            this.clearQuestEventForm();
            this.setQuestEventError('');
        }
        this.renderQuestEvents();
    }

    renderQuestEvents() {
        if (!this.questEventsList) {
            return;
        }
        clearElement(this.questEventsList);
        const events = Array.isArray(this.questEvents) ? [...this.questEvents] : [];
        events.sort((eventA, eventB) => {
            const timeA = new Date(eventA?.updatedAt || eventA?.timestamp || eventA?.createdAt || 0).getTime();
            const timeB = new Date(eventB?.updatedAt || eventB?.timestamp || eventB?.createdAt || 0).getTime();
            return timeB - timeA;
        });

        if (this.questEventsEmpty) {
            this.questEventsEmpty.hidden = events.length > 0;
        }

        if (!events.length) {
            return;
        }

        events.forEach(event => {
            const questId = sanitizeText(event?.questId) || 'Quete';
            const status = sanitizeText(event?.status);
            const milestone = sanitizeText(event?.milestone);
            const progressLabel = formatQuestProgress(event?.progress);
            const timestamp = formatQuestTimestamp(event?.updatedAt || event?.timestamp || event?.createdAt);
            const note = sanitizeText(event?.note);

            const item = createElement('li', { className: 'quest-events-item', dataset: { eventId: event?.id || '' } });
            const header = createElement('div', { className: 'quest-events-item-header' });
            header.appendChild(createElement('span', { text: questId }));
            if (status) {
                header.appendChild(createElement('span', { className: 'quest-events-item-status', text: status }));
            }
            item.appendChild(header);

            const meta = createElement('div', { className: 'quest-events-item-meta' });
            const metaEntries = [];
            if (milestone) {
                metaEntries.push(`Jalon : ${milestone}`);
            }
            if (progressLabel) {
                metaEntries.push(`Progression : ${progressLabel}`);
            }
            if (timestamp) {
                metaEntries.push(timestamp);
            }
            metaEntries.forEach(entry => {
                meta.appendChild(createElement('span', { text: entry }));
            });
            if (metaEntries.length) {
                item.appendChild(meta);
            }

            if (note) {
                item.appendChild(createElement('p', {
                    className: 'quest-events-item-note',
                    text: note
                }));
            }

            const actions = createElement('div', { className: 'quest-events-item-actions' });
            const editButton = createElement('button', {
                className: 'secondary-button',
                text: 'Modifier',
                attributes: { type: 'button' }
            });
            editButton.addEventListener('click', () => this.loadQuestEventForEdit(event));
            actions.appendChild(editButton);

            if (typeof this.callbacks.onDeleteQuestEvent === 'function') {
                const deleteButton = createElement('button', {
                    className: 'danger-button',
                    text: 'Supprimer',
                    attributes: { type: 'button' }
                });
                deleteButton.addEventListener('click', () => this.handleQuestEventDelete(event));
                actions.appendChild(deleteButton);
            }
            item.appendChild(actions);

            this.questEventsList.appendChild(item);
        });
    }

    loadQuestEventForEdit(event) {
        if (!event || !event.id) {
            return;
        }
        this.editingQuestEventId = event.id;
        if (this.questEventQuestId) {
            this.questEventQuestId.value = sanitizeText(event.questId);
        }
        if (this.questEventStatus) {
            this.questEventStatus.value = sanitizeText(event.status) || 'en cours';
        }
        if (this.questEventMilestone) {
            this.questEventMilestone.value = sanitizeText(event.milestone);
        }
        if (this.questEventProgressCurrent) {
            this.questEventProgressCurrent.value = event.progress && Number.isFinite(event.progress.current) ? event.progress.current : '';
        }
        if (this.questEventProgressMax) {
            this.questEventProgressMax.value = event.progress && Number.isFinite(event.progress.max) ? event.progress.max : '';
        }
        if (this.questEventNote) {
            this.questEventNote.value = sanitizeText(event.note);
        }
        if (this.questEventSubmitButton) {
            this.questEventSubmitButton.textContent = 'Mettre a jour l\'evenement';
        }
        if (this.questEventCancelButton) {
            this.questEventCancelButton.hidden = false;
        }
        this.setQuestEventError('');
    }

    cancelQuestEventEdit() {
        this.clearQuestEventForm();
        this.setQuestEventError('');
    }

    async handleQuestEventDelete(event) {
        if (!event?.id || typeof this.callbacks.onDeleteQuestEvent !== 'function') {
            return;
        }
        const confirmed = window.confirm('Supprimer cet evenement de quete ?');
        if (!confirmed) {
            return;
        }
        try {
            await this.callbacks.onDeleteQuestEvent(event.id);
            this.questEvents = Array.isArray(this.questEvents) ? this.questEvents.filter(item => item?.id !== event.id) : [];
            this.renderQuestEvents();
            if (this.editingQuestEventId === event.id) {
                this.clearQuestEventForm();
            }
        } catch (error) {
            console.error('[quest-event] suppression impossible', error);
            this.setQuestEventError(error?.message || 'Suppression impossible.');
        }
    }

    clearQuestEventForm() {
        this.editingQuestEventId = null;
        if (this.questEventQuestId) {
            this.questEventQuestId.value = '';
        }
        if (this.questEventStatus) {
            this.questEventStatus.value = 'en cours';
        }
        if (this.questEventMilestone) {
            this.questEventMilestone.value = '';
        }
        if (this.questEventProgressCurrent) {
            this.questEventProgressCurrent.value = '';
        }
        if (this.questEventProgressMax) {
            this.questEventProgressMax.value = '';
        }
        if (this.questEventNote) {
            this.questEventNote.value = '';
        }
        if (this.questEventSubmitButton) {
            this.questEventSubmitButton.textContent = 'Enregistrer un evenement';
        }
        if (this.questEventCancelButton) {
            this.questEventCancelButton.hidden = true;
        }
    }

    setQuestEventError(message) {
        if (this.questEventError) {
            if (message) {
                this.questEventError.textContent = message;
                this.questEventError.hidden = false;
            } else {
                this.questEventError.textContent = '';
                this.questEventError.hidden = true;
            }
        }
    }

    getLocationName() {
        const formName = this.form?.elements?.name?.value;
        const fallback = this.currentContext?.originalName || this.currentContext?.location?.name || '';
        if (this.mode === 'edit' && fallback) {
            return sanitizeText(fallback);
        }
        return sanitizeText(formName || fallback);
    }    async handleQuestEventSubmit() {
        if (this.mode !== 'edit' || this.isSubmittingQuestEvent) {
            return;
        }
        const isEditing = Boolean(this.editingQuestEventId);
        const callback = isEditing ? this.callbacks.onUpdateQuestEvent : this.callbacks.onCreateQuestEvent;
        if (typeof callback !== 'function') {
            return;
        }

        const locationName = this.getLocationName();
        if (!locationName) {
            this.setQuestEventError('Impossible de determiner le lieu cible.');
            return;
        }

        const questId = sanitizeText(this.questEventQuestId?.value);
        if (!questId) {
            this.setQuestEventError('Identifiant de quete requis.');
            this.questEventQuestId?.focus();
            return;
        }

        const status = sanitizeText(this.questEventStatus?.value) || 'en cours';
        const milestone = sanitizeText(this.questEventMilestone?.value);
        const note = sanitizeText(this.questEventNote?.value);

        const progressCurrentRaw = sanitizeText(this.questEventProgressCurrent?.value);
        const progressMaxRaw = sanitizeText(this.questEventProgressMax?.value);

        let progress = null;
        if (progressCurrentRaw || progressMaxRaw) {
            const current = progressCurrentRaw ? Number(progressCurrentRaw) : null;
            const max = progressMaxRaw ? Number(progressMaxRaw) : null;
            if (progressCurrentRaw && !Number.isFinite(current)) {
                this.setQuestEventError('Progression actuelle invalide.');
                this.questEventProgressCurrent?.focus();
                return;
            }
            if (progressMaxRaw && !Number.isFinite(max)) {
                this.setQuestEventError('Progression maximale invalide.');
                this.questEventProgressMax?.focus();
                return;
            }
            progress = {
                current: Number.isFinite(current) ? current : null,
                max: Number.isFinite(max) ? max : null
            };
        }

        this.setQuestEventError('');
        this.isSubmittingQuestEvent = true;
        if (this.questEventSubmitButton) {
            this.questEventSubmitButton.disabled = true;
            this.questEventSubmitButton.textContent = isEditing ? 'Mise a jour...' : 'Enregistrement...';
        }

        try {
            const payload = {
                locationName,
                questId,
                status,
                milestone,
                progress,
                note
            };
            if (isEditing) {
                payload.id = this.editingQuestEventId;
            }
            const result = await callback(payload);
            this.clearQuestEventForm();
            this.setQuestEventError('');
            if (result?.event) {
                const next = Array.isArray(this.questEvents) ? this.questEvents.filter(evt => evt?.id !== result.event.id) : [];
                next.push(result.event);
                this.setQuestEvents(next);
            }
        } catch (error) {
            console.error('[quest-event] submit failed', error);
            this.setQuestEventError(error?.message || 'Impossible de traiter l\'evenement de quete.');
        } finally {
            this.isSubmittingQuestEvent = false;
            if (this.questEventSubmitButton) {
                this.questEventSubmitButton.disabled = false;
                this.questEventSubmitButton.textContent = isEditing ? 'Mettre a jour l\'evenement' : 'Enregistrer un evenement';
            }
        }
    }

    addImageField(value = '') {
        if (!this.imageList) {
            return;
        }
        const row = createElement('div', { className: 'editor-list-row' });
        const input = createElement('input', {
            attributes: {
                type: 'url',
                placeholder: 'https://example.com/image.jpg',
                'data-role': 'image-input'
            }
        });
        input.value = value || '';
        row.appendChild(input);
        const remove = createElement('button', {
            className: 'tertiary-button',
            text: 'Supprimer',
            attributes: { type: 'button', 'data-action': 'remove-image' }
        });
        row.appendChild(remove);
        this.imageList.appendChild(row);
    }

    addVideoField(video = { url: '', title: '' }) {
        if (!this.videoList) {
            return;
        }
        const row = createElement('div', { className: 'editor-list-row video-row' });
        const titleInput = createElement('input', {
            attributes: {
                type: 'text',
                placeholder: 'Titre',
                'data-role': 'video-title'
            }
        });
        titleInput.value = video?.title || '';
        const urlInput = createElement('input', {
            attributes: {
                type: 'url',
                placeholder: 'https://youtu.be/…',
                'data-role': 'video-url'
            }
        });
        urlInput.value = video?.url || '';
        const remove = createElement('button', {
            className: 'tertiary-button',
            text: 'Supprimer',
            attributes: { type: 'button', 'data-action': 'remove-video' }
        });
        row.appendChild(titleInput);
        row.appendChild(urlInput);
        row.appendChild(remove);
        this.videoList.appendChild(row);
    }

    setAvailableTags(tags = []) {
        const unique = new Set();
        this.availableTags = [];
        tags.forEach(entry => {
            const value = typeof entry === 'string'
                ? entry
                : (entry?.value || entry?.label || '');
            const trimmed = (value || '').toString().trim();
            if (!trimmed) {
                return;
            }
            const key = trimmed.toLowerCase();
            if (unique.has(key)) {
                return;
            }
            unique.add(key);
            this.availableTags.push({
                value: key,
                label: entry?.label || trimmed
            });
        });
        this.renderTagSuggestions();
    }

    renderTagSuggestions() {
        if (!this.tagsSuggestions) {
            return;
        }
        clearElement(this.tagsSuggestions);
        this.availableTags.forEach(tag => {
            const option = createElement('option', { attributes: { value: tag.label || tag.value } });
            this.tagsSuggestions.appendChild(option);
        });
    }

    setAvailableLocations(locations = []) {
        const unique = new Set();
        this.availableLocations = [];
        (Array.isArray(locations) ? locations : []).forEach(entry => {
            const value = typeof entry === 'string'
                ? entry
                : (entry?.name || entry?.label || '');
            const trimmed = (value || '').toString().trim();
            if (!trimmed) {
                return;
            }
            const key = trimmed.toLocaleLowerCase('fr');
            if (unique.has(key)) {
                return;
            }
            unique.add(key);
            this.availableLocations.push(trimmed);
        });
        if (this.isOpen) {
            this.refreshLinkSuggestions();
        }
    }

    scheduleLinkSuggestions() {
        if (!this.isOpen) {
            return;
        }
        if (this.linkSuggestionTimer) {
            clearTimeout(this.linkSuggestionTimer);
        }
        this.linkSuggestionTimer = setTimeout(() => {
            this.linkSuggestionTimer = null;
            this.refreshLinkSuggestions();
        }, LINK_SUGGESTION_DEBOUNCE);
    }

    refreshLinkSuggestions() {
        if (!this.linkSuggestionsPanel || !this.linkSuggestionsList) {
            return;
        }
        this.linkSuggestions = this.buildLinkSuggestions();
        this.renderLinkSuggestions();
    }

    buildLinkSuggestions() {
        const suggestions = [];
        const sources = this.getLinkSuggestionSources();
        if (!sources.length || !this.availableLocations.length) {
            return suggestions;
        }
        const currentName = (this.form?.elements?.name?.value || this.currentContext?.originalName || '').toString().trim();
        const currentKey = currentName ? currentName.toLocaleLowerCase('fr') : '';
        const seen = new Set();
        this.availableLocations.forEach(name => {
            const targetKey = name.toLocaleLowerCase('fr');
            if (!targetKey || targetKey === currentKey) {
                return;
            }
            const matchOptions = this.getLinkMatchOptions(name);
            sources.forEach(source => {
                const text = source.textarea?.value || '';
                if (!text) {
                    return;
                }
                matchOptions.forEach(option => {
                    if (!this.hasEligibleMatch(text, option.matchText)) {
                        return;
                    }
                    const matchKey = option.matchText.toLocaleLowerCase('fr');
                    const suggestionKey = `${source.key}::${targetKey}::${matchKey}`;
                    if (this.ignoredLinkSuggestions.has(suggestionKey) || seen.has(suggestionKey)) {
                        return;
                    }
                    seen.add(suggestionKey);
                    suggestions.push({
                        id: suggestionKey,
                        fieldKey: source.key,
                        fieldLabel: source.label,
                        target: name,
                        matchText: option.matchText,
                        textarea: source.textarea,
                        updatePreview: source.updatePreview
                    });
                });
            });
        });
        return suggestions;
    }

    getLinkMatchOptions(name) {
        const trimmed = (name || '').toString().trim();
        if (!trimmed) {
            return [];
        }
        const options = [];
        const unique = new Set();
        const push = value => {
            const candidate = (value || '').toString().trim();
            if (!candidate || candidate.length < 3) {
                return;
            }
            const key = candidate.toLocaleLowerCase('fr');
            if (unique.has(key)) {
                return;
            }
            unique.add(key);
            options.push({ matchText: candidate });
        };
        push(trimmed);
        const stripped = trimmed.replace(/^(l'|la|le|les)\s+/i, '');
        if (stripped && stripped !== trimmed) {
            push(stripped);
        }
        const words = stripped.split(/[\s,.;:!?()]+/).filter(Boolean);
        if (words.length > 1) {
            const first = words[0];
            if (first.length >= 4 && !this.isStopWord(first)) {
                push(first);
            }
        }
        return options;
    }

    isStopWord(word) {
        const normalized = (word || '').toString().trim().toLocaleLowerCase('fr');
        return ['la', 'le', 'les', 'du', 'des', "d'", "l'"].includes(normalized);
    }

    getLinkSuggestionSources() {
        const sources = [];
        if (this.descriptionInput) {
            sources.push({
                key: 'description',
                label: 'Description',
                textarea: this.descriptionInput,
                updatePreview: () => this.updateDescriptionPreview()
            });
        }
        (this.markdownSections || []).forEach(type => {
            const list = this.markdownLists?.[type];
            if (!list) {
                return;
            }
            const labelBase = this.getMarkdownConfig(type)?.label || type;
            const rows = Array.from(list.querySelectorAll('.markdown-entry-row'));
            rows.forEach((row, index) => {
                const textarea = row.querySelector('textarea[data-role=\"markdown-entry-input\"]');
                if (!textarea) {
                    return;
                }
                sources.push({
                    key: `${type}-${index + 1}`,
                    label: `${labelBase} ${index + 1}`,
                    textarea,
                    updatePreview: () => this.updateMarkdownEntryPreview(textarea)
                });
            });
        });
        return sources;
    }

    renderLinkSuggestions() {
        if (!this.linkSuggestionsPanel || !this.linkSuggestionsList) {
            return;
        }
        clearElement(this.linkSuggestionsList);
        this.linkSuggestionsPanel.hidden = false;
        const hasSuggestions = this.linkSuggestions.length > 0;
        if (this.linkSuggestionsEmpty) {
            this.linkSuggestionsEmpty.hidden = hasSuggestions;
        }
        if (this.linkSuggestionsApplyAllButton) {
            this.linkSuggestionsApplyAllButton.disabled = !hasSuggestions;
        }
        if (!hasSuggestions) {
            return;
        }
        this.linkSuggestions.forEach(suggestion => {
            const item = createElement('li', { className: 'form-suggestion-item' });
            const display = suggestion.matchText && suggestion.matchText !== suggestion.target
                ? `${suggestion.matchText} -> ${suggestion.target}`
                : suggestion.target;
            const text = createElement('span', {
                className: 'form-suggestion-text',
                text: `${suggestion.fieldLabel}: ${display}`
            });
            const meta = createElement('div', { className: 'form-suggestion-meta' });
            const applyButton = createElement('button', {
                className: 'tertiary-button',
                text: 'Appliquer',
                attributes: {
                    type: 'button',
                    'data-action': 'apply-link-suggestion',
                    'data-suggestion-id': suggestion.id
                }
            });
            const ignoreButton = createElement('button', {
                className: 'tertiary-button',
                text: 'Ignorer',
                attributes: {
                    type: 'button',
                    'data-action': 'ignore-link-suggestion',
                    'data-suggestion-id': suggestion.id
                }
            });
            meta.appendChild(applyButton);
            meta.appendChild(ignoreButton);
            item.appendChild(text);
            item.appendChild(meta);
            this.linkSuggestionsList.appendChild(item);
        });
    }

    applyLinkSuggestion(id) {
        const suggestion = this.linkSuggestions.find(entry => entry.id === id);
        if (!suggestion || !suggestion.textarea) {
            return;
        }
        const text = suggestion.textarea.value || '';
        const result = this.replaceEligibleMatches(text, suggestion.matchText || suggestion.target, suggestion.target);
        if (!result.changed) {
            return;
        }
        suggestion.textarea.value = result.text;
        suggestion.updatePreview?.();
        this.refreshLinkSuggestions();
    }

    ignoreLinkSuggestion(id) {
        if (!id) {
            return;
        }
        this.ignoredLinkSuggestions.add(id);
        this.refreshLinkSuggestions();
    }

    applyAllLinkSuggestions() {
        if (!this.linkSuggestions.length) {
            return;
        }
        const current = [...this.linkSuggestions];
        current.forEach(suggestion => {
            if (!suggestion.textarea) {
                return;
            }
            const result = this.replaceEligibleMatches(
                suggestion.textarea.value || '',
                suggestion.matchText || suggestion.target,
                suggestion.target
            );
            if (!result.changed) {
                return;
            }
            suggestion.textarea.value = result.text;
            suggestion.updatePreview?.();
        });
        this.refreshLinkSuggestions();
    }

    hasEligibleMatch(text, target) {
        const haystack = (text || '').toString();
        const needle = (target || '').toString().trim();
        if (!haystack || !needle) {
            return false;
        }
        const lowerText = haystack.toLocaleLowerCase('fr');
        const lowerNeedle = needle.toLocaleLowerCase('fr');
        let index = 0;
        while (index <= lowerText.length) {
            const found = lowerText.indexOf(lowerNeedle, index);
            if (found === -1) {
                return false;
            }
            if (this.isEligibleMatch(haystack, found, needle.length)) {
                return true;
            }
            index = found + lowerNeedle.length;
        }
        return false;
    }

    replaceEligibleMatches(text, matchText, target) {
        const source = (text || '').toString();
        const needle = (matchText || '').toString().trim();
        const linkTarget = (target || '').toString().trim();
        if (!source || !needle) {
            return { text: source, changed: false };
        }
        const lowerText = source.toLocaleLowerCase('fr');
        const lowerNeedle = needle.toLocaleLowerCase('fr');
        let result = '';
        let index = 0;
        let changed = false;
        while (index < source.length) {
            const found = lowerText.indexOf(lowerNeedle, index);
            if (found === -1) {
                result += source.slice(index);
                break;
            }
            if (!this.isEligibleMatch(source, found, needle.length)) {
                result += source.slice(index, found + needle.length);
                index = found + needle.length;
                continue;
            }
            result += source.slice(index, found);
            const matchedText = source.slice(found, found + needle.length);
            const targetLabel = linkTarget || needle;
            const link = matchedText === targetLabel
                ? `[[${targetLabel}]]`
                : `[[${matchedText}|${targetLabel}]]`;
            result += link;
            index = found + needle.length;
            changed = true;
        }
        return { text: result, changed };
    }

    isEligibleMatch(text, start, length) {
        const end = start + length;
        const before = start > 0 ? text[start - 1] : '';
        const after = end < text.length ? text[end] : '';
        if (before && WORD_CHAR_REGEX.test(before)) {
            return false;
        }
        if (after && WORD_CHAR_REGEX.test(after)) {
            return false;
        }
        if (before === '[' || after === ']') {
            return false;
        }
        if (this.isInsideDoubleBrackets(text, start) || this.isInsideMarkdownLink(text, start)) {
            return false;
        }
        return true;
    }

    isInsideDoubleBrackets(text, index) {
        const before = text.slice(0, index);
        const lastOpen = before.lastIndexOf('[[');
        if (lastOpen === -1) {
            return false;
        }
        const lastClose = before.lastIndexOf(']]');
        if (lastClose > lastOpen) {
            return false;
        }
        const nextClose = text.indexOf(']]', index);
        return nextClose !== -1;
    }

    isInsideMarkdownLink(text, index) {
        const before = text.slice(0, index);
        const lastOpen = before.lastIndexOf('[');
        if (lastOpen === -1) {
            return false;
        }
        const lastClose = before.lastIndexOf(']');
        if (lastClose > lastOpen) {
            return false;
        }
        const nextClose = text.indexOf(']', index);
        if (nextClose === -1) {
            return false;
        }
        return text.slice(nextClose, nextClose + 2) === '](';
    }

    setTags(tags = []) {
        if (!this.tagsList) {
            return;
        }
        clearElement(this.tagsList);
        const entries = Array.isArray(tags) ? tags : [];
        entries.forEach(tag => this.addTag(tag));
    }

    addTagsFromInput() {
        if (!this.tagsInput) {
            return;
        }
        const raw = this.tagsInput.value || '';
        const parts = raw.split(/[,;]+/).map(part => part.trim()).filter(Boolean);
        if (!parts.length && raw.trim()) {
            parts.push(raw.trim());
        }
        parts.forEach(part => this.addTag(part));
        this.tagsInput.value = '';
    }

    addTag(value) {
        const label = (value ?? '').toString().trim();
        if (!label || !this.tagsList) {
            return;
        }
        const key = label.toLowerCase();
        const existing = Array.from(this.tagsList.querySelectorAll('.tag-chip')).some(chip => {
            const val = chip.dataset?.value || chip.textContent || '';
            return val.toLowerCase() === key;
        });
        if (existing) {
            return;
        }
        const chip = createElement('span', {
            className: 'tag-chip',
            text: label,
            attributes: { 'data-value': label }
        });
        const remove = createElement('button', {
            text: '×',
            attributes: {
                type: 'button',
                'data-action': 'remove-tag',
                'data-value': label,
                'aria-label': `Retirer le tag ${label}`
            }
        });
        chip.appendChild(remove);
        this.tagsList.appendChild(chip);
    }

    removeTag(value) {
        if (!this.tagsList) {
            return;
        }
        const key = (value || '').toString().trim().toLowerCase();
        Array.from(this.tagsList.querySelectorAll('.tag-chip')).forEach(chip => {
            const val = (chip.dataset?.value || '').toLowerCase();
            if (val === key) {
                chip.remove();
            }
        });
    }

    collectTags() {
        if (!this.tagsList) {
            return [];
        }
        const tags = [];
        const seen = new Set();
        Array.from(this.tagsList.querySelectorAll('.tag-chip')).forEach(chip => {
            const value = (chip.dataset?.value || chip.textContent || '').trim();
            if (!value) {
                return;
            }
            const key = value.toLowerCase();
            if (seen.has(key)) {
                return;
            }
            seen.add(key);
            tags.push(value);
        });
        return tags;
    }

    addPnjField(pnj = { name: '', role: '', description: '' }) {
        if (!this.pnjList) {
            return;
        }
        const row = createElement('div', { className: 'editor-list-row' });
        const nameInput = createElement('input', {
            attributes: {
                type: 'text',
                placeholder: 'Nom',
                'data-role': 'pnj-name'
            }
        });
        nameInput.value = pnj?.name || '';
        const roleInput = createElement('input', {
            attributes: {
                type: 'text',
                placeholder: 'Rôle',
                'data-role': 'pnj-role'
            }
        });
        roleInput.value = pnj?.role || '';
        const descriptionInput = createElement('input', {
            attributes: {
                type: 'text',
                placeholder: 'Description',
                'data-role': 'pnj-description'
            }
        });
        descriptionInput.value = pnj?.description || '';
        const remove = createElement('button', {
            className: 'tertiary-button',
            text: 'Supprimer',
            attributes: { type: 'button', 'data-action': 'remove-pnj' }
        });
        row.appendChild(nameInput);
        row.appendChild(roleInput);
        row.appendChild(descriptionInput);
        row.appendChild(remove);
        this.pnjList.appendChild(row);
    }

    handleSubmit() {
        const result = this.collectFormData();
        this.resetErrors();
        Object.entries(result.errors).forEach(([key, message]) => {
            this.showError(key, message);
        });

        if (!result.valid) {
            this.showError('form', 'Merci de corriger les champs indiques avant de continuer.');
            return;
        }

        if (this.mode === 'edit' && typeof this.callbacks.onUpdate === 'function') {
            this.callbacks.onUpdate({
                continent: result.continent,
                location: result.location,
                originalContinent: this.currentContext?.continent || '',
                originalName: this.currentContext?.originalName || ''
            });
        }

        if (this.mode !== 'edit' && typeof this.callbacks.onCreate === 'function') {
            this.callbacks.onCreate({
                continent: result.continent,
                location: result.location
            });
        }

        this.clearDescriptionDraft();
        this.close();
    }

    buildDescriptionAssistantPayload() {
        return {
            name: sanitizeText(this.form?.elements?.name?.value || this.currentContext?.originalName || ''),
            continent: sanitizeText(this.form?.elements?.continent?.value || this.currentContext?.continent || ''),
            type: this.typeSelect?.value || 'default',
            description: sanitizeText(this.descriptionInput?.value || ''),
            tags: this.collectTags(),
            history: this.collectMarkdownEntries('history'),
            lore: this.collectMarkdownEntries('lore')
        };
    }

    async handleDescriptionAssistant(mode = 'generate') {
        if (this.descriptionAssistantBusy || typeof this.callbacks.onGenerateDescription !== 'function') {
            return;
        }
        this.clearError('descriptionAssistant');
        const payload = this.buildDescriptionAssistantPayload();
        const hasNarrativeSources = payload.history.length > 0 || payload.lore.length > 0;
        if (!hasNarrativeSources && !(mode === 'improve' && payload.description)) {
            this.showError('descriptionAssistant', 'Ajoutez du lore ou de l historique avant de generer une description.');
            return;
        }
        if (payload.description) {
            const confirmMessage = mode === 'improve'
                ? 'Remplacer la description actuelle par une version amelioree ?'
                : 'Remplacer la description actuelle par un brouillon genere depuis lore / historique ?';
            if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm(confirmMessage)) {
                return;
            }
        }

        try {
            this.setDescriptionAssistantBusy(true);
            this.setDescriptionAssistantNote(
                mode === 'improve'
                    ? 'Amelioration de la description en cours...'
                    : 'Generation de la description en cours...',
                'info'
            );
            const result = await this.callbacks.onGenerateDescription({
                action: mode,
                location: payload
            });
            const generated = sanitizeText(result?.description);
            if (!generated) {
                throw new Error('Aucune description generee.');
            }
            if (this.descriptionInput) {
                this.descriptionInput.value = generated;
            }
            this.updateDescriptionPreview();
            this.updateDescriptionAssistantActions();
            this.updateNarrativeWarnings();
            this.scheduleDescriptionDraftSave();
            this.refreshLinkSuggestions();
            this.clearError('description');
            this.setDescriptionAssistantNote(
                this.buildDescriptionAssistantSuccessMessage(result?.meta),
                'success'
            );
            this.descriptionInput?.focus?.();
            const length = this.descriptionInput?.value?.length || 0;
            this.descriptionInput?.setSelectionRange?.(length, length);
        } catch (error) {
            this.showError('descriptionAssistant', error?.message || 'Generation de la description impossible.');
            this.setDescriptionAssistantNote('La generation a echoue. Corrigez les sources ou reessayez.', 'error');
        } finally {
            this.setDescriptionAssistantBusy(false);
        }
    }

    buildDescriptionAssistantSuccessMessage(meta = {}) {
        const sources = Array.isArray(meta?.usedSources)
            ? meta.usedSources.filter(source => source && source !== 'fallback')
            : [];
        const sourceLabel = sources.length
            ? `Sources utilisees : ${sources.join(', ')}.`
            : 'Generation basee sur un resume de secours.';
        return `${sourceLabel} Relisez la description avant enregistrement.`;
    }

    setDescriptionAssistantBusy(isBusy) {
        this.descriptionAssistantBusy = Boolean(isBusy);
        if (this.descriptionGenerateButton) {
            this.descriptionGenerateButton.disabled = this.descriptionAssistantBusy;
            this.descriptionGenerateButton.textContent = this.descriptionAssistantBusy
                ? 'Generation...'
                : '';
        }
        if (this.descriptionImproveButton) {
            this.descriptionImproveButton.disabled = this.descriptionAssistantBusy;
            this.descriptionImproveButton.textContent = this.descriptionAssistantBusy
                ? 'Patientez...'
                : '';
        }
        if (!this.descriptionAssistantBusy) {
            this.updateDescriptionAssistantActions();
        }
    }

    setDescriptionAssistantNote(message, state = 'info') {
        if (!this.descriptionAssistantNote) {
            return;
        }
        this.descriptionAssistantNote.textContent = sanitizeText(message);
        this.descriptionAssistantNote.dataset.state = state || 'info';
    }

    updateDescriptionAssistantActions() {
        const hasDescription = Boolean(sanitizeText(this.descriptionInput?.value || ''));
        if (this.descriptionGenerateButton && !this.descriptionAssistantBusy) {
            this.descriptionGenerateButton.textContent = hasDescription
                ? 'Regenerer depuis lore / historique'
                : 'Generer depuis lore / historique';
        }
        if (this.descriptionImproveButton && !this.descriptionAssistantBusy) {
            this.descriptionImproveButton.textContent = 'Ameliorer la description';
            this.descriptionImproveButton.disabled = !hasDescription;
        }
    }

    updateNarrativeWarnings() {
        const warnings = [];
        const description = sanitizeText(this.descriptionInput?.value || '');
        const history = this.collectMarkdownEntries('history');
        const lore = this.collectMarkdownEntries('lore');
        const hasSources = history.length > 0 || lore.length > 0;
        const sentenceCount = countSentences(description);
        const looksStructured = /(^|\n)\s*(#|[-*+]\s)/m.test(description);

        if (hasSources && !description) {
            warnings.push('Historique ou Lore est renseigne sans resume court : generez une description pour la carte.');
        }
        if (description.length > 520 && !hasSources) {
            warnings.push('Description tres longue sans Historique ni Lore : deplacez le detail narratif dans les champs sources.');
        }
        if (sentenceCount > 4) {
            warnings.push('Description dense : gardez plutot un resume de 2 a 4 phrases pour la carte.');
        }
        if (looksStructured) {
            warnings.push('Description structuree en titres ou listes : reservez plutot ce format a Historique ou Lore.');
        }

        this.showWarnings(warnings);
    }

    collectFormData() {
        const errors = {};
        const location = copyLocation(this.currentContext?.location || {});

        const name = (this.form.elements.name.value || '').trim();
        const continent = (this.form.elements.continent.value || '').trim();
        const type = this.typeSelect?.value || 'default';
        const xRaw = this.form.elements.x.value;
        const yRaw = this.form.elements.y.value;
        const description = (this.form.elements.description.value || '').trim();
        const audio = (this.form.elements.audio.value || '').trim();

        const x = Number(xRaw);
        const y = Number(yRaw);

        if (!name) {
            errors.name = 'Le nom est obligatoire.';
        } else if (this.mode === 'create' && this.disallowedNames.has(name.toLowerCase())) {
            errors.name = 'Un lieu avec ce nom existe deja.';
        } else if (this.mode === 'edit' && name.toLowerCase() !== (this.currentContext?.originalName || '').toLowerCase() && this.disallowedNames.has(name.toLowerCase())) {
            errors.name = 'Un lieu avec ce nom existe deja.';
        }

        if (!continent) {
            errors.continent = 'Le continent est obligatoire.';
        }

        if (!this.types[type]) {
            errors.type = 'Selectionnez un type valide.';
        }

        if (!Number.isFinite(x)) {
            errors.x = 'Coordonnee invalide.';
        }
        if (!Number.isFinite(y)) {
            errors.y = 'Coordonnee invalide.';
        }

        if (audio && !isValidUrl(audio)) {
            errors.audio = 'Lien audio invalide (URL ou chemin assets/).';
        }

        const images = this.collectImages();
        if (images.some(image => !isValidUrl(image))) {
            errors.images = 'Toutes les images doivent etre des URLs valides ou des chemins commençant par assets/.';
        }

        const videos = this.collectVideos();
        const invalidVideos = videos.filter(video => video.url && !isValidUrl(video.url));
        if (invalidVideos.length || videos.some(video => !video.url && video.title)) {
            errors.videos = 'Chaque video doit avoir une URL valide.';
        }

        const pnjs = this.collectPnjs();
        const invalidPnjs = pnjs.filter(pnj => !pnj.name);
        if (invalidPnjs.length) {
            errors.pnjs = 'Chaque PNJ doit avoir un nom.';
        }

        location.name = name;
        location.type = type;
        location.x = Number.isFinite(x) ? x : 0;
        location.y = Number.isFinite(y) ? y : 0;
        location.description = description;
        location.audio = audio || '';
        location.images = images.filter(Boolean);
        location.videos = videos.filter(video => video.url);
        location.pnjs = pnjs;
        location.tags = this.collectTags();
        location.history = this.collectMarkdownEntries('history');
        location.quests = this.collectMarkdownEntries('quests');
        location.lore = this.collectMarkdownEntries('lore');
        location.instances = this.collectMarkdownEntries('instances');
        location.nobleFamilies = this.collectMarkdownEntries('nobleFamilies');

        const valid = Object.keys(errors).length === 0;
        return {
            valid,
            errors,
            continent,
            location
        };
    }

    collectImages() {
        if (!this.imageList) {
            return [];
        }
        return Array.from(this.imageList.querySelectorAll('input[data-role="image-input"]'))
            .map(input => (input.value || '').trim())
            .filter(value => value.length);
    }

    collectVideos() {
        if (!this.videoList) {
            return [];
        }
        const rows = Array.from(this.videoList.querySelectorAll('.editor-list-row'));
        return rows.map(row => {
            const title = (row.querySelector('input[data-role="video-title"]')?.value || '').trim();
            const url = (row.querySelector('input[data-role="video-url"]')?.value || '').trim();
            return { title, url };
        }).filter(video => video.url || video.title);
    }

    collectPnjs() {
        if (!this.pnjList) {
            return [];
        }
        const rows = Array.from(this.pnjList.querySelectorAll('.editor-list-row'));
        return rows.map(row => {
            const name = (row.querySelector('input[data-role="pnj-name"]')?.value || '').trim();
            const role = (row.querySelector('input[data-role="pnj-role"]')?.value || '').trim();
            const description = (row.querySelector('input[data-role="pnj-description"]')?.value || '').trim();
            if (!name && !role && !description) {
                return null;
            }
            return { name, role, description };
        }).filter(Boolean);
    }

    validateField(name) {
        if (name === 'name') {
            const value = (this.form.elements.name.value || '').trim();
            if (!value) {
                this.showError('name', 'Le nom est obligatoire.');
            } else if (this.mode === 'create' && this.disallowedNames.has(value.toLowerCase())) {
                this.showError('name', 'Un lieu avec ce nom existe deja.');
            } else if (this.mode === 'edit' && value.toLowerCase() !== (this.currentContext?.originalName || '').toLowerCase() && this.disallowedNames.has(value.toLowerCase())) {
                this.showError('name', 'Un lieu avec ce nom existe deja.');
            } else {
                this.clearError('name');
            }
        }

        if (name === 'continent') {
            const value = (this.form.elements.continent.value || '').trim();
            if (!value) {
                this.showError('continent', 'Le continent est obligatoire.');
            } else {
                this.clearError('continent');
            }
        }

        if (name === 'type' && this.typeSelect) {
            const value = this.typeSelect.value;
            if (!this.types[value]) {
                this.showError('type', 'Selectionnez un type valide.');
            } else {
                this.clearError('type');
            }
        }
    }

    validateCoordinates() {
        const x = Number(this.form.elements.x.value);
        const y = Number(this.form.elements.y.value);
        if (!Number.isFinite(x)) {
            this.showError('x', 'Coordonnee invalide.');
        } else {
            this.clearError('x');
        }
        if (!Number.isFinite(y)) {
            this.showError('y', 'Coordonnee invalide.');
        } else {
            this.clearError('y');
        }
    }

    validateImages() {
        const images = this.collectImages();
        if (images.length === 0) {
            this.clearError('images');
            return;
        }
        const hasInvalid = images.some(url => !isValidUrl(url));
        if (hasInvalid) {
            this.showError('images', 'Chaque image doit etre une URL valide ou un chemin assets/.');
        } else {
            this.clearError('images');
        }
    }

    async handleImageFiles(fileList) {
        const { accepted: files } = partitionFilesByType(Array.from(fileList || []), UPLOAD_TYPES.image);
        if (!files.length) {
            const formats = describeAllowedExtensions(UPLOAD_TYPES.image);
            this.showError('form', 'Aucune image valide detectee (formats acceptes : ' + formats + ').');
            return;
        }
        this.clearError('form');
        for (const file of files) {
            try {
                const uploadedPath = await this.processFileUpload(file, UPLOAD_TYPES.image);
                const emptyInput = Array.from(this.imageList?.querySelectorAll('input[data-role="image-input"]') || []).find(input => !input.value);
                if (emptyInput) {
                    emptyInput.value = uploadedPath;
                } else {
                    this.addImageField(uploadedPath);
                }
            } catch (error) {
                this.showError('form', error?.message || 'Erreur lors de l\'import de l\'image.');
                return;
            }
        }
        this.validateImages();
        this.updateImagePreview();
    }

    async handleAudioFiles(fileList) {
        const { accepted: files } = partitionFilesByType(Array.from(fileList || []), UPLOAD_TYPES.audio);
        if (!files.length) {
            const formats = describeAllowedExtensions(UPLOAD_TYPES.audio);
            this.showError('form', 'Aucun fichier audio valide (formats acceptes : ' + formats + ').');
            return;
        }
        const audioFile = files[0];
        try {
            const uploadedPath = await this.processFileUpload(audioFile, UPLOAD_TYPES.audio);
            if (this.form?.elements?.audio) {
                this.form.elements.audio.value = uploadedPath;
            }
            this.validateAudio();
            this.clearError('form');
        } catch (error) {
            this.showError('form', error?.message || 'Erreur lors de l\'import audio.');
        }
    }

    readFileAsDataURL(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Impossible de lire le fichier.'));
            reader.readAsDataURL(file);
        });
    }

    async processFileUpload(file, uploadType) {
        if (!file) {
            throw new Error('Fichier manquant.');
        }
        if (file.size > MAX_UPLOAD_SIZE) {
            throw new Error('Fichier trop volumineux (limite 25 Mo).');
        }
        const dataUrl = await this.readFileAsDataURL(file);
        let response;
        try {
            response = await fetch(UPLOAD_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    type: uploadType,
                    filename: file.name,
                    data: dataUrl
                })
            });
        } catch (error) {
            throw new Error('Serveur indisponible pendant le televersement.');
        }
        let payload = {};
        let rawText = '';
        try {
            rawText = await response.text();
            payload = rawText ? JSON.parse(rawText) : {};
        } catch (error) {
            payload = {};
        }
        if (!response.ok || payload.status !== 'ok' || !payload.path) {
            const message = payload?.message || rawText || `Televersement echoue (HTTP ${response.status}).`;
            throw new Error(message);
        }
        return payload.path;
    }

    setupDropZone(element, type) {
        if (!element) {
            return;
        }
        let dragDepth = 0;
        const addHighlight = () => element.classList.add('is-drag-over');
        const removeHighlight = () => element.classList.remove('is-drag-over');
        const onDragEnter = event => {
            event.preventDefault();
            dragDepth += 1;
            addHighlight();
        };
        const onDragOver = event => {
            event.preventDefault();
        };
        const onDragLeave = event => {
            event.preventDefault();
            dragDepth = Math.max(dragDepth - 1, 0);
            if (dragDepth === 0) {
                removeHighlight();
            }
        };
        const onDrop = event => {
            event.preventDefault();
            dragDepth = 0;
            removeHighlight();
            const files = Array.from(event.dataTransfer?.files || []);
            if (!files.length) {
                return;
            }
            if (type === UPLOAD_TYPES.image) {
                this.handleImageFiles(files);
            } else if (type === UPLOAD_TYPES.audio) {
                this.handleAudioFiles(files);
            }
            event.dataTransfer?.clearData?.();
        };
        element.addEventListener('dragenter', onDragEnter);
        element.addEventListener('dragover', onDragOver);
        element.addEventListener('dragleave', onDragLeave);
        element.addEventListener('drop', onDrop);
    }

    handleDelete() {
        if (this.mode !== 'edit' || !this.currentContext) {
            return;
        }
        const originalName = this.currentContext.originalName || '';
        const confirmation = buildDeleteConfirmation(originalName);
        let confirmed = true;
        if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
            confirmed = window.confirm(confirmation);
        }
        if (!confirmed) {
            return;
        }
        if (typeof this.callbacks.onDelete === 'function') {
            this.callbacks.onDelete({
                continent: this.currentContext.continent || '',
                originalContinent: this.currentContext.continent || '',
                originalName: originalName
            });
        }
        this.clearDescriptionDraft();
        this.close();
    }

    validateVideos() {
        const videos = this.collectVideos();
        if (!videos.length) {
            this.clearError('videos');
            return;
        }
        const hasInvalid = videos.some(video => video.url && !isValidUrl(video.url));
        if (hasInvalid) {
            this.showError('videos', 'Chaque video doit avoir une URL valide.');
        } else {
            this.clearError('videos');
        }
    }

    validatePnjs() {
        const pnjs = this.collectPnjs();
        if (!pnjs.length) {
            this.clearError('pnjs');
            return;
        }
        const hasInvalid = pnjs.some(pnj => !pnj.name);
        if (hasInvalid) {
            this.showError('pnjs', 'Chaque PNJ doit avoir un nom.');
        } else {
            this.clearError('pnjs');
        }
    }

    validateAudio() {
        const audio = (this.form.elements.audio.value || '').trim();
        if (audio && !isValidUrl(audio)) {
            this.showError('audio', 'Lien audio invalide (URL ou chemin assets/).');
        } else {
            this.clearError('audio');
        }
    }

    updateImagePreview() {
        if (!this.imagePreview) {
            return;
        }
        clearElement(this.imagePreview);
        const images = this.collectImages();
        if (!images.length) {
            const empty = createElement('p', { className: 'preview-empty', text: 'Ajoutez une image pour la previsualiser.' });
            this.imagePreview.appendChild(empty);
            return;
        }
        images.forEach(url => {
            const figure = createElement('figure', { className: 'preview-card' });
            const img = createElement('img', { attributes: { src: url, alt: '' } });
            img.addEventListener('error', () => figure.classList.add('preview-error'));
            figure.appendChild(img);
            const caption = createElement('figcaption', { text: url });
            figure.appendChild(caption);
            this.imagePreview.appendChild(figure);
        });
    }

    updateVideoPreview() {
        if (!this.videoPreview) {
            return;
        }
        clearElement(this.videoPreview);
        const videos = this.collectVideos().filter(video => video.url);
        if (!videos.length) {
            const empty = createElement('p', { className: 'preview-empty', text: 'Ajoutez une video pour la previsualiser.' });
            this.videoPreview.appendChild(empty);
            return;
        }
        videos.forEach(video => {
            const wrapper = createElement('div', { className: 'preview-card video-preview' });
            const title = createElement('p', { className: 'preview-title', text: video.title || 'Sans titre' });
            wrapper.appendChild(title);
            const youtubeId = extractYouTubeId(video.url);
            if (youtubeId) {
                wrapper.appendChild(youtubePreview(video.url, video.title || 'Aperçu vidéo'));
            } else {
                const link = createElement('a', { text: video.url, attributes: { href: video.url, target: '_blank', rel: 'noopener noreferrer' } });
                wrapper.appendChild(link);
            }
            this.videoPreview.appendChild(wrapper);
        });
    }
    updatePnjPreview() {
        if (!this.pnjPreview) {
            return;
        }
        clearElement(this.pnjPreview);
        const pnjs = this.collectPnjs();
        if (!pnjs.length) {
            const empty = createElement('p', { className: 'preview-empty', text: 'Ajoutez un PNJ pour le previsualiser.' });
            this.pnjPreview.appendChild(empty);
            return;
        }
        pnjs.forEach(pnj => {
            const card = createElement('div', { className: 'preview-card pnj-preview' });
            const title = createElement('p', { className: 'preview-title', text: pnj.name });
            card.appendChild(title);
            if (pnj.role) {
                card.appendChild(createElement('p', { className: 'preview-sub', text: pnj.role }));
            }
            if (pnj.description) {
                card.appendChild(createElement('p', { text: pnj.description }));
            }
            this.pnjPreview.appendChild(card);
        });
    }

    resetErrors() {
        if (!this.form) {
            return;
        }
        const messages = this.form.querySelectorAll('.form-error');
        messages.forEach(message => {
            message.textContent = '';
            message.hidden = true;
        });
    }

    showError(field, message) {
        const target = this.form.querySelector(`.form-error[data-error-for="${field}"]`);
        if (target) {
            target.textContent = message;
            target.hidden = false;
        }
    }

    clearError(field) {
        const target = this.form.querySelector(`.form-error[data-error-for="${field}"]`);
        if (target) {
            target.textContent = '';
            target.hidden = true;
        }
    }

    renderWarnings() {
        if (!this.warningsPanel || !this.warningsList) {
            return;
        }
        const warnings = Array.isArray(this.latestWarnings) ? this.latestWarnings : [];
        const LIMIT = 8;
        clearElement(this.warningsList);
        if (!warnings.length) {
            this.warningsPanel.hidden = true;
            if (this.warningsFootnote) {
                this.warningsFootnote.textContent = '';
                this.warningsFootnote.hidden = true;
            }
            return;
        }
        warnings.slice(0, LIMIT).forEach(message => {
            this.warningsList.appendChild(createElement('li', { text: message }));
        });
        if (this.warningsFootnote) {
            if (warnings.length > LIMIT) {
                const extra = warnings.length - LIMIT;
                this.warningsFootnote.textContent = `+ ${extra} avertissement(s) supplémentaire(s) masqué(s).`;
                this.warningsFootnote.hidden = false;
            } else {
                this.warningsFootnote.textContent = '';
                this.warningsFootnote.hidden = true;
            }
        }
        this.warningsPanel.hidden = false;
    }

    showWarnings(warnings = []) {
        const normalized = Array.isArray(warnings)
            ? warnings.map(item => (typeof item === 'string' ? item : '')).map(item => item.trim()).filter(Boolean)
            : [];
        this.latestWarnings = Array.from(new Set(normalized));
        this.renderWarnings();
    }
}
