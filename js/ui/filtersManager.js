
import { getString } from '../i18n.js';
import { normalizeFilterState } from '../shared/searchFilters.mjs';

const localize = (key, fallback, params = undefined) => {
    const resolved = params === undefined ? getString(key) : getString(key, params);
    if (!resolved || resolved === key) {
        return fallback;
    }
    return resolved;
};

const DEFAULT_FILTERS = normalizeFilterState();

const slugifyFilterValue = (value, fallback) => {
    const base = (value ?? '')
        .toString()
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    if (base) {
        return base;
    }
    return fallback ? fallback.toString() : 'option';
};

export class FiltersManager {
    constructor({
        state,
        searchInput,
        clearButton,
        resetButton,
        resultsBadge,
        advancedToggle,
        advancedPanel,
        typeContainer,
        tagContainer,
        statusContainer,
        onFiltersChanged
    }) {
        this.state = state;
        this.searchInput = searchInput || null;
        this.clearButton = clearButton || null;
        this.resetButton = resetButton || null;
        this.resultsBadge = resultsBadge || null;
        this.advancedToggle = advancedToggle || null;
        this.advancedPanel = advancedPanel || null;
        this.typeContainer = typeContainer || null;
        this.tagContainer = tagContainer || null;
        this.statusContainer = statusContainer || null;
        this.onFiltersChanged = typeof onFiltersChanged === 'function' ? onFiltersChanged : () => {};

        this.facets = { types: [], tags: [], statuses: [], quests: { with: 0, without: 0 } };
        this.typeEmptyMessage = this.advancedPanel?.querySelector('[data-empty="types"]') || null;
        this.tagEmptyMessage = this.advancedPanel?.querySelector('[data-empty="tags"]') || null;
        this.statusEmptyMessage = this.advancedPanel?.querySelector('[data-empty="statuses"]') || null;
        this.questRadios = this.advancedPanel
            ? Array.from(this.advancedPanel.querySelectorAll('input[name="filter-quests"]'))
            : [];
        this.questLabels = new Map(
            this.questRadios.map(radio => {
                const label = radio.closest('label');
                const span = label ? label.querySelector('span') : null;
                return [radio.value, span];
            })
        );

        if (this.typeContainer) {
            this.typeContainer.dataset.filterGroup = 'types';
        }
        if (this.tagContainer) {
            this.tagContainer.dataset.filterGroup = 'tags';
        }
        if (this.statusContainer) {
            this.statusContainer.dataset.filterGroup = 'statuses';
        }
    }

    initialize() {
        const filters = this.state.getFilters();

        if (this.searchInput) {
            this.searchInput.value = filters.text || '';
            const placeholder = localize('search.placeholder', this.searchInput.placeholder || 'Rechercher un lieu...');
            const ariaLabel = localize('search.inputAria', 'Rechercher un lieu');
            this.searchInput.placeholder = placeholder;
            this.searchInput.setAttribute('aria-label', ariaLabel);
            this.searchInput.autocomplete = 'off';
            this.searchInput.addEventListener('input', () => this.handleSearchInput());
        }

        if (this.clearButton) {
            const label = localize('search.clearAria', 'Effacer la recherche');
            this.clearButton.title = label;
            this.clearButton.setAttribute('aria-label', label);
            this.clearButton.addEventListener('click', () => this.handleClearSearch());
        }

        if (this.resetButton) {
            const label = localize('filters.resetAria', 'Réinitialiser les filtres');
            this.resetButton.title = label;
            this.resetButton.setAttribute('aria-label', label);
            this.resetButton.addEventListener('click', () => this.handleReset());
        }

        if (this.advancedToggle) {
            this.advancedToggle.addEventListener('click', () => this.toggleAdvancedPanel());
            this.updateAdvancedToggle(false);
        }

        if (this.typeContainer) {
            this.typeContainer.addEventListener('change', event => this.handleChoiceChange(event));
        }
        if (this.tagContainer) {
            this.tagContainer.addEventListener('change', event => this.handleChoiceChange(event));
        }
        if (this.statusContainer) {
            this.statusContainer.addEventListener('change', event => this.handleChoiceChange(event));
        }

        this.questRadios.forEach(radio => {
            radio.addEventListener('change', () => {
                if (radio.checked) {
                    this.updateFilterState({ quests: radio.value });
                }
            });
        });

        this.syncUIFromState();
    }

    setAvailableFilters(facets = {}) {
        this.facets = {
            types: facets.types || [],
            tags: facets.tags || [],
            statuses: facets.statuses || [],
            quests: facets.quests || { with: 0, without: 0 }
        };

        this.renderChoiceGroup(this.typeContainer, this.facets.types, new Set(this.state.getFilters().types));
        this.renderChoiceGroup(this.tagContainer, this.facets.tags, new Set(this.state.getFilters().tags));
        this.renderChoiceGroup(this.statusContainer, this.facets.statuses, new Set(this.state.getFilters().statuses));
        this.updateQuestLabels(this.facets.quests);
        this.syncQuestRadios(this.state.getFilters().quests);
    }

    updateResults({ visibleCount, totalCount }) {
        if (!this.resultsBadge) {
            return;
        }
        const safeVisible = Number.isFinite(visibleCount) ? visibleCount : 0;
        const safeTotal = Number.isFinite(totalCount) ? totalCount : 0;
        const filtersActive = this.hasActiveFilters(this.state.getFilters());

        if (!safeTotal) {
            this.resultsBadge.textContent = localize('search.noResult', 'Aucun lieu');
            this.resultsBadge.dataset.state = 'empty';
            return;
        }

        if (filtersActive) {
            const key = safeVisible === 1 ? 'search.resultsFilteredSingle' : 'search.resultsFilteredPlural';
            this.resultsBadge.textContent = localize(key, `${safeVisible} / ${safeTotal} lieux`, {
                visible: safeVisible,
                total: safeTotal,
                totalLabel: localize(safeTotal === 1 ? 'search.resultsSingle' : 'search.resultsPlural', `${safeTotal} lieux`, { count: safeTotal })
            });
            this.resultsBadge.dataset.state = 'filtered';
        } else {
            const key = safeVisible === 1 ? 'search.resultsSingle' : 'search.resultsPlural';
            this.resultsBadge.textContent = localize(key, `${safeVisible} lieux`, { count: safeVisible });
            this.resultsBadge.dataset.state = 'all';
        }
    }

    hasActiveFilters(filters = this.state.getFilters()) {
        const normalized = normalizeFilterState(filters);
        return Boolean(
            (normalized.text || '').trim() ||
            normalized.types.length ||
            normalized.tags.length ||
            normalized.statuses.length ||
            normalized.quests !== 'any'
        );
    }

    handleSearchInput() {
        const value = this.searchInput?.value ?? '';
        this.updateFilterState({ text: value });
    }

    handleClearSearch() {
        if (!this.searchInput) {
            return;
        }
        this.searchInput.value = '';
        this.updateFilterState({ text: '' });
        this.searchInput.focus();
    }

    handleReset() {
        this.state.setFilters(DEFAULT_FILTERS);
        this.syncUIFromState();
        this.onFiltersChanged(this.state.getFilters());
    }

    handleChoiceChange(event) {
        const input = event.target;
        if (!(input instanceof HTMLInputElement) || input.type !== 'checkbox') {
            return;
        }
        const group = event.currentTarget?.dataset?.filterGroup;
        if (!group) {
            return;
        }
        const filters = this.state.getFilters();
        const next = new Set(Array.isArray(filters[group]) ? filters[group] : []);
        if (input.checked) {
            next.add(input.value);
        } else {
            next.delete(input.value);
        }
        this.updateFilterState({ [group]: Array.from(next) });
    }

    toggleAdvancedPanel(forceState = null) {
        if (!this.advancedToggle || !this.advancedPanel) {
            return;
        }
        const currentlyOpen = this.advancedToggle.getAttribute('aria-expanded') === 'true';
        const nextState = forceState === null ? !currentlyOpen : Boolean(forceState);
        this.updateAdvancedToggle(nextState);
    }

    updateAdvancedToggle(isOpen) {
        if (!this.advancedToggle || !this.advancedPanel) {
            return;
        }
        this.advancedToggle.setAttribute('aria-expanded', String(isOpen));
        this.advancedPanel.hidden = !isOpen;
        const labelKey = isOpen ? 'filters.advancedHide' : 'filters.advancedShow';
        this.advancedToggle.textContent = localize(labelKey, isOpen ? 'Masquer les filtres' : 'Filtres avancés');
    }

    updateFilterState(patch) {
        this.state.setFilters(patch || {});
        this.syncUIFromState();
        this.onFiltersChanged(this.state.getFilters());
    }

    syncUIFromState() {
        const filters = this.state.getFilters();
        if (this.searchInput && this.searchInput.value !== (filters.text || '')) {
            this.searchInput.value = filters.text || '';
        }
        this.syncChoiceSelection(this.typeContainer, new Set(filters.types));
        this.syncChoiceSelection(this.tagContainer, new Set(filters.tags));
        this.syncChoiceSelection(this.statusContainer, new Set(filters.statuses));
        this.syncQuestRadios(filters.quests);
    }

    syncChoiceSelection(container, selectedSet) {
        if (!container) {
            return;
        }
        container.querySelectorAll('input[type="checkbox"]').forEach(input => {
            const isChecked = selectedSet.has(input.value);
            input.checked = isChecked;
            input.setAttribute('aria-pressed', String(isChecked));
            const label = input.closest('label.filter-chip');
            if (label) {
                label.classList.toggle('filter-chip-active', isChecked);
            }
        });
    }

    syncQuestRadios(selectedValue) {
        this.questRadios.forEach(radio => {
            radio.checked = radio.value === selectedValue;
        });
    }

    renderChoiceGroup(container, items, selectedSet) {
        if (!container) {
            return;
        }
        container.innerHTML = '';
        const groupName = container.dataset.filterGroup || 'filters';
        const emptyIndicator = this.getEmptyIndicatorForContainer(container);
        if (!items.length) {
            if (emptyIndicator) {
                emptyIndicator.hidden = false;
            }
            return;
        }
        if (emptyIndicator) {
            emptyIndicator.hidden = true;
        }
        items.forEach((item, index) => {
            const label = document.createElement('label');
            label.className = 'filter-chip';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.value = item.value;
            const slug = slugifyFilterValue(item.value, `item-${index}`);
            const optionId = `filter-${groupName}-${index}-${slug}`;
            const labelId = `${optionId}-label`;
            input.id = optionId;
            input.name = `${groupName}[]`;
            input.checked = selectedSet.has(item.value);
            input.setAttribute('aria-pressed', String(input.checked));
            input.setAttribute('aria-labelledby', labelId);

            const span = document.createElement('span');
            span.className = 'filter-chip-label';
            span.textContent = item.label || item.value;
            span.id = labelId;
            if (Number.isFinite(item.count)) {
                const counter = document.createElement('small');
                counter.textContent = String(item.count);
                span.appendChild(counter);
            }

            label.appendChild(input);
            label.appendChild(span);
            label.htmlFor = optionId;
            label.classList.toggle('filter-chip-active', input.checked);
            container.appendChild(label);
        });
    }

    updateQuestLabels(quests) {
        const withCount = Number.isFinite(quests?.with) ? quests.with : 0;
        const withoutCount = Number.isFinite(quests?.without) ? quests.without : 0;
        const total = withCount + withoutCount;
        const allLabel = this.questLabels.get('any');
        const withLabel = this.questLabels.get('with');
        const withoutLabel = this.questLabels.get('without');

        if (allLabel) {
            allLabel.textContent = localize('filters.quests.any', `Toutes (${total})`, { count: total });
        }
        if (withLabel) {
            withLabel.textContent = localize('filters.quests.with', `Avec quêtes (${withCount})`, { count: withCount });
        }
        if (withoutLabel) {
            withoutLabel.textContent = localize('filters.quests.without', `Sans quête (${withoutCount})`, { count: withoutCount });
        }
    }

    getEmptyIndicatorForContainer(container) {
        if (!container) {
            return null;
        }
        if (container === this.typeContainer) {
            return this.typeEmptyMessage;
        }
        if (container === this.tagContainer) {
            return this.tagEmptyMessage;
        }
        if (container === this.statusContainer) {
            return this.statusEmptyMessage;
        }
        return null;
    }
}
