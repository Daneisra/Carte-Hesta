import {
    normalizeAdminTimeline,
    normalizeAdminTimelineEntry,
    createAdminTimelineEntry,
    markAdminTimelineDirty,
    fetchAdminTimeline,
    saveAdminTimeline,
    renderAdminTimelineConfig
} from './adminTimeline.js';

const normalizeText = value => (typeof value === 'string' ? value.trim() : '');
const ADMIN_PANEL_STYLESHEET = '/admin-panels.css';

const readRequestedOpen = () => {
    try {
        const params = new URLSearchParams(window.location.search);
        return normalizeText(params.get('admin')).toLowerCase() === 'timeline';
    } catch (_error) {
        return false;
    }
};

const clearRequestedOpen = () => {
    try {
        const url = new URL(window.location.href);
        url.searchParams.delete('admin');
        window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    } catch (_error) {
        // ignore cleanup failures
    }
};

const buildMarkup = () => `
    <div id="timeline-admin-overlay" class="admin-overlay" role="presentation" hidden>
        <div class="admin-dialog" id="timeline-admin-dialog" role="dialog" aria-modal="true" aria-labelledby="timeline-admin-title">
            <header class="admin-header">
                <h2 id="timeline-admin-title">Administration chronologie</h2>
                <button id="timeline-admin-close" class="admin-close" type="button" aria-label="Fermer le panneau admin chronologie">x</button>
            </header>
            <div class="admin-content">
                <section class="admin-section">
                    <h3>Statut</h3>
                    <p id="timeline-admin-auth-status">Connexion administrateur requise.</p>
                </section>
                <section class="admin-section">
                    <h3>Navigation admin</h3>
                    <div class="admin-actions">
                        <a class="secondary-button" href="/?admin=home">Admin accueil</a>
                        <a class="secondary-button" href="/map/">Admin carte</a>
                    </div>
                </section>
                <section class="admin-section" id="timeline-admin-section-config">
                    <div class="admin-section-heading">
                        <h3>Chronologie</h3>
                        <div class="admin-section-heading-actions">
                            <button id="admin-timeline-reload" class="tertiary-button" type="button">Recharger</button>
                            <button id="admin-timeline-save" class="secondary-button" type="button">Enregistrer la chronologie</button>
                        </div>
                    </div>
                    <p class="admin-home-hint">Page /timeline, detail des evenements, ordre d affichage et visibilite publique.</p>
                    <ul id="admin-timeline-errors" class="profile-inline-errors" hidden></ul>
                    <div class="admin-home-grid admin-timeline-grid">
                        <fieldset class="admin-home-fieldset">
                            <legend>Meta</legend>
                            <label for="admin-timeline-title">Titre</label>
                            <input id="admin-timeline-title" type="text" autocomplete="off" />
                            <label for="admin-timeline-subtitle">Sous-titre</label>
                            <textarea id="admin-timeline-subtitle" rows="4"></textarea>
                            <div class="admin-timeline-toolbar">
                                <button id="admin-timeline-add-entry" class="secondary-button" type="button">Ajouter un evenement</button>
                            </div>
                        </fieldset>
                        <div class="admin-home-fieldset admin-timeline-fieldset">
                            <div class="admin-timeline-list-header">
                                <strong>Evenements</strong>
                                <span id="admin-timeline-count" class="admin-timeline-count">0 entree</span>
                            </div>
                            <div id="admin-timeline-list" class="admin-timeline-list"></div>
                            <p id="admin-timeline-empty" class="admin-timeline-empty">Aucun evenement configure.</p>
                        </div>
                    </div>
                    <p id="admin-timeline-status" class="admin-home-status" role="status" aria-live="polite" hidden></p>
                </section>
            </div>
        </div>
    </div>
`;

const ensurePanelStylesheet = () => {
    const existing = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
        .some(link => link.getAttribute('href') === ADMIN_PANEL_STYLESHEET);
    if (existing) {
        return;
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = ADMIN_PANEL_STYLESHEET;
    document.head.appendChild(link);
};

export class TimelineAdminPanel {
    constructor({ onSave } = {}) {
        ensurePanelStylesheet();
        this.onSave = typeof onSave === 'function' ? onSave : null;
        this.session = { authenticated: false, role: 'guest' };
        this.returnFocusElement = null;
        this.lastActiveElement = null;
        this.adminTimeline = null;
        this.adminTimelineDirty = false;
        this.adminTimelinePending = false;
        this.adminTimelineErrors = [];
        this.announcer = null;
        this.requestedOpen = readRequestedOpen();
        this.hasHandledRequestedOpen = false;
        this.adminDom = this.createDom();
        this.bind();
        this.syncAuthStatus();
    }

    createDom() {
        let overlay = document.getElementById('timeline-admin-overlay');
        if (!overlay) {
            document.body.insertAdjacentHTML('beforeend', buildMarkup());
            overlay = document.getElementById('timeline-admin-overlay');
        }
        return {
            overlay,
            dialog: document.getElementById('timeline-admin-dialog'),
            content: document.querySelector('#timeline-admin-dialog .admin-content'),
            close: document.getElementById('timeline-admin-close'),
            authStatus: document.getElementById('timeline-admin-auth-status'),
            timelineReloadButton: document.getElementById('admin-timeline-reload'),
            timelineSaveButton: document.getElementById('admin-timeline-save'),
            timelineErrors: document.getElementById('admin-timeline-errors'),
            timelineStatus: document.getElementById('admin-timeline-status'),
            timelineTitle: document.getElementById('admin-timeline-title'),
            timelineSubtitle: document.getElementById('admin-timeline-subtitle'),
            timelineAddEntryButton: document.getElementById('admin-timeline-add-entry'),
            timelineList: document.getElementById('admin-timeline-list'),
            timelineCount: document.getElementById('admin-timeline-count'),
            timelineEmpty: document.getElementById('admin-timeline-empty')
        };
    }

    isAdmin() {
        return Boolean(this.session?.authenticated) && normalizeText(this.session?.role).toLowerCase() === 'admin';
    }

    setSession(payload = {}) {
        this.session = payload && typeof payload === 'object' ? payload : { authenticated: false, role: 'guest' };
        this.syncAuthStatus();
        if (!this.isAdmin()) {
            this.close(true);
            return;
        }
        if (this.requestedOpen && !this.hasHandledRequestedOpen) {
            this.hasHandledRequestedOpen = true;
            this.open();
            clearRequestedOpen();
        }
    }

    syncAuthStatus() {
        if (!this.adminDom.authStatus) {
            return;
        }
        this.adminDom.authStatus.textContent = this.isAdmin()
            ? 'Connecte en tant qu administrateur. Les modifications s enregistrent dans la chronologie.'
            : 'Connexion administrateur requise.';
    }

    bindTrigger(element) {
        if (!element || element.dataset.adminTimelineBound) {
            return;
        }
        element.addEventListener('click', event => {
            event.preventDefault();
            this.returnFocusElement = element;
            this.open();
        });
        element.dataset.adminTimelineBound = 'true';
    }

    bindTriggers(elements = []) {
        elements.forEach(element => this.bindTrigger(element));
    }

    bind() {
        this.adminDom.close?.addEventListener('click', () => this.close(true));
        this.adminDom.overlay?.addEventListener('click', event => {
            if (event.target === this.adminDom.overlay) {
                this.close(true);
            }
        });
        document.addEventListener('keydown', event => {
            if (!this.isOpen()) {
                return;
            }
            if (event.key === 'Escape') {
                this.close(true);
                return;
            }
            if (event.key === 'Tab') {
                this.handleFocusTrap(event);
            }
        });
        this.adminDom.timelineReloadButton?.addEventListener('click', () => this.fetchAdminTimeline());
        this.adminDom.timelineSaveButton?.addEventListener('click', () => this.saveAdminTimeline());
        this.adminDom.timelineAddEntryButton?.addEventListener('click', () => this.addAdminTimelineEntry());
        [this.adminDom.timelineTitle, this.adminDom.timelineSubtitle].forEach(element => {
            if (!element) {
                return;
            }
            element.addEventListener('input', () => this.markAdminTimelineDirty());
        });
    }

    isOpen() {
        return Boolean(this.adminDom.overlay) && !this.adminDom.overlay.hidden;
    }

    getFocusableElements() {
        if (!this.adminDom.dialog) {
            return [];
        }
        return Array.from(this.adminDom.dialog.querySelectorAll(
            'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )).filter(element => !element.hidden && !element.closest('[hidden]'));
    }

    focusFirstElement() {
        const [target] = this.getFocusableElements();
        target?.focus?.({ preventScroll: true });
    }

    handleFocusTrap(event) {
        const focusable = this.getFocusableElements();
        if (!focusable.length) {
            event.preventDefault();
            this.adminDom.dialog?.focus?.();
            return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (event.shiftKey && active === first) {
            event.preventDefault();
            last.focus();
            return;
        }
        if (!event.shiftKey && active === last) {
            event.preventDefault();
            first.focus();
        }
    }

    restoreFocus() {
        const target = this.returnFocusElement?.isConnected ? this.returnFocusElement : this.lastActiveElement;
        if (target?.focus) {
            window.requestAnimationFrame(() => target.focus({ preventScroll: true }));
        }
        this.lastActiveElement = null;
    }

    open() {
        if (!this.isAdmin() || !this.adminDom.overlay) {
            return;
        }
        this.syncAuthStatus();
        if (!this.returnFocusElement?.isConnected) {
            this.returnFocusElement = document.getElementById('timeline-admin-entry');
        }
        this.lastActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        this.adminDom.overlay.hidden = false;
        this.adminDom.overlay.classList.add('open');
        document.body.classList.add('admin-surface-open');
        if (!this.adminTimeline && !this.adminTimelinePending) {
            this.fetchAdminTimeline();
        } else {
            renderAdminTimelineConfig(this);
        }
        window.requestAnimationFrame(() => this.focusFirstElement());
    }

    close(force = false) {
        if (!this.adminDom.overlay) {
            return;
        }
        this.adminDom.overlay.classList.remove('open');
        this.adminDom.overlay.hidden = true;
        document.body.classList.remove('admin-surface-open');
        if (force && this.adminDom.overlay) {
            this.adminDom.overlay.scrollTop = 0;
            if (this.adminDom.content) {
                this.adminDom.content.scrollTop = 0;
            }
        }
        this.restoreFocus();
    }

    normalizeAdminTimeline(config = {}) {
        return normalizeAdminTimeline(this.normalizeAdminTimelineEntry.bind(this), config);
    }

    normalizeAdminTimelineEntry(entry = {}, index = 0) {
        return normalizeAdminTimelineEntry(entry, index);
    }

    createAdminTimelineEntry(index = 0) {
        return createAdminTimelineEntry(this.normalizeAdminTimelineEntry.bind(this), index);
    }

    markAdminTimelineDirty() {
        return markAdminTimelineDirty(this);
    }

    addAdminTimelineEntry() {
        if (!this.adminTimeline) {
            this.adminTimeline = this.normalizeAdminTimeline({});
        }
        this.adminTimeline.entries.push(this.createAdminTimelineEntry(this.adminTimeline.entries.length));
        renderAdminTimelineConfig(this);
        this.markAdminTimelineDirty();
    }

    moveAdminTimelineEntry(index, direction) {
        if (!Array.isArray(this.adminTimeline?.entries)) {
            return;
        }
        const targetIndex = index + direction;
        if (targetIndex < 0 || targetIndex >= this.adminTimeline.entries.length) {
            return;
        }
        const [entry] = this.adminTimeline.entries.splice(index, 1);
        this.adminTimeline.entries.splice(targetIndex, 0, entry);
        renderAdminTimelineConfig(this);
        this.markAdminTimelineDirty();
    }

    removeAdminTimelineEntry(index) {
        if (!Array.isArray(this.adminTimeline?.entries)) {
            return;
        }
        this.adminTimeline.entries.splice(index, 1);
        renderAdminTimelineConfig(this);
        this.markAdminTimelineDirty();
    }

    async fetchAdminTimeline() {
        return fetchAdminTimeline(this);
    }

    async saveAdminTimeline() {
        await saveAdminTimeline(this);
        if (this.onSave && this.adminTimeline && !this.adminTimelineDirty) {
            this.onSave(this.adminTimeline);
        }
    }
}
