import { normalizeFilterState } from '../shared/searchFilters.mjs';

export class UiState {
    constructor({
        filters = {},
        favorites = [],
        theme = 'dark'
    } = {}) {
        this.filters = normalizeFilterState(filters);
        this.favorites = new Set(
            Array.isArray(favorites)
                ? favorites.filter(name => typeof name === 'string' && name.trim())
                : []
        );
        this.theme = theme === 'light' ? 'light' : 'dark';
        this.sidebarView = 'all';
        this.activeLocationName = null;
        this.mapState = null;
    }

    setFilters(patch = {}) {
        const merged = { ...this.filters, ...(patch || {}) };
        this.filters = normalizeFilterState(merged);
    }

    getFilters() {
        return { ...this.filters };
    }

    setTheme(theme) {
        this.theme = theme === 'light' ? 'light' : 'dark';
    }

    addFavorite(name) {
        if (name && typeof name === 'string') {
            this.favorites.add(name);
        }
    }

    removeFavorite(name) {
        this.favorites.delete(name);
    }

    setFavorites(list) {
        this.favorites = new Set(
            Array.isArray(list)
                ? list.filter(name => typeof name === 'string' && name.trim())
                : []
        );
    }

    hasFavorite(name) {
        return this.favorites.has(name);
    }

    getFavorites() {
        return Array.from(this.favorites);
    }
}
