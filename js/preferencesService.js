import { normalizeFilterState } from './shared/searchFilters.mjs';

const STORAGE_KEY = 'interactive-map-preferences';
const DEFAULT_FILTERS = normalizeFilterState();

const SAFE_DEFAULT = {
    filters: DEFAULT_FILTERS,
    clustering: false,
    markerScale: 100,
    favorites: [],
    map: null,
    lastLocation: null,
    pagination: {},
    theme: 'dark',
    onboarding: {
        favorites: false,
        clustering: false
    }
};

const hasStorageSupport = () => {
    try {
        return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
    } catch (error) {
        return false;
    }
};

export class PreferencesService {
    constructor(storageKey = STORAGE_KEY) {
        this.storageKey = storageKey;
        this.supported = hasStorageSupport();
        this.state = this.supported ? this.#read() : { ...SAFE_DEFAULT };
    }

    getFilters() {
        return { ...DEFAULT_FILTERS, ...normalizeFilterState(this.state.filters) };
    }

    setFilters(filters) {
        const merged = { ...this.getFilters(), ...(filters || {}) };
        this.state.filters = normalizeFilterState(merged);
        this.#write();
    }

    getClustering() {
        return Boolean(this.state.clustering);
    }

    setClustering(value) {
        this.state.clustering = Boolean(value);
        this.#write();
    }

    getMarkerScale() {
        const value = Number(this.state.markerScale);
        if (!Number.isFinite(value)) {
            return SAFE_DEFAULT.markerScale;
        }
        return Math.max(70, Math.min(130, value));
    }

    setMarkerScale(value) {
        const numeric = Number(value);
        this.state.markerScale = Number.isFinite(numeric)
            ? Math.max(70, Math.min(130, numeric))
            : SAFE_DEFAULT.markerScale;
        this.#write();
    }

    getFavorites() {
        const favorites = Array.isArray(this.state.favorites) ? this.state.favorites : [];
        return Array.from(new Set(favorites.filter(name => typeof name === 'string' && name.trim())));
    }

    setFavorites(favorites) {
        const sanitized = Array.isArray(favorites)
            ? Array.from(new Set(favorites.filter(name => typeof name === 'string' && name.trim())))
            : [];
        this.state.favorites = sanitized;
        this.#write();
    }

    getMapState() {
        return this.state.map || null;
    }

    setMapState(state) {
        this.state.map = state || null;
        this.#write();
    }

    getPagination(continent) {
        if (!continent) {
            return { ...SAFE_DEFAULT.pagination, ...(this.state.pagination || {}) };
        }
        const pagination = this.state.pagination || {};
        return Number.isInteger(pagination[continent]) ? pagination[continent] : 0;
    }

    setPagination(continent, pageIndex) {
        if (!continent) {
            return;
        }
        if (!this.state.pagination) {
            this.state.pagination = {};
        }
        this.state.pagination[continent] = Math.max(0, Number(pageIndex) || 0);
        this.#write();
    }

    getLastLocation() {
        return this.state.lastLocation || null;
    }

    setLastLocation(name) {
        this.state.lastLocation = name || null;
        this.#write();
    }

    getTheme() {
        const theme = this.state.theme || SAFE_DEFAULT.theme;
        return theme === 'light' ? 'light' : 'dark';
    }

    setTheme(theme) {
        const normalized = theme === 'light' ? 'light' : 'dark';
        this.state.theme = normalized;
        this.#write();
    }

    hasSeenOnboarding(step) {
        if (!step) {
            return false;
        }
        const onboarding = this.state.onboarding || SAFE_DEFAULT.onboarding;
        return Boolean(onboarding[step]);
    }

    setOnboardingSeen(step, value = true) {
        if (!step) {
            return;
        }
        if (!this.state.onboarding) {
            this.state.onboarding = { ...SAFE_DEFAULT.onboarding };
        }
        this.state.onboarding[step] = Boolean(value);
        this.#write();
    }

    reset() {
        this.state = { ...SAFE_DEFAULT };
        this.#write();
    }

    #read() {
        if (!this.supported) {
            return { ...SAFE_DEFAULT };
        }
        try {
            const raw = window.localStorage.getItem(this.storageKey);
            if (!raw) {
                return { ...SAFE_DEFAULT };
            }
            const parsed = JSON.parse(raw);
            const next = { ...SAFE_DEFAULT, ...(parsed || {}) };
            next.filters = normalizeFilterState(parsed?.filters);
            return next;
        } catch (error) {
            return { ...SAFE_DEFAULT };
        }
    }

    #write() {
        if (!this.supported) {
            return;
        }
        try {
            window.localStorage.setItem(this.storageKey, JSON.stringify(this.state));
        } catch (error) {
            // storage might be full or denied - silently ignore
        }
    }
}
