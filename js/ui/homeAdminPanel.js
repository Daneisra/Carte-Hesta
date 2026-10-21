import {
    fetchAdminSiteConfig,
    saveAdminSiteConfig,
    markAdminSiteConfigDirty,
    syncAdminHomeEditor
} from './adminHome.js';

const HOME_ADMIN_FIELD_IDS = [
    'homeKicker',
    'homeTitle',
    'homeLead',
    'homeAtmosphere',
    'homeTags',
    'homeMetrics',
    'homeBackgroundImage',
    'homeMapImage',
    'homeCharacterImage',
    'homeFloatingTitle',
    'homeFloatingCopy',
    'homeDiscordUrl',
    'homeDiscordTitle',
    'homeDiscordCopy',
    'homeDiscordProofMode',
    'homeDiscordGuildId',
    'homeDiscordManualCount',
    'homeDiscordProofLabel',
    'homeDiscordProofNote',
    'homeYoutubeUrl',
    'homeYoutubeTitle',
    'homeYoutubeCopy',
    'homeRedditUrl',
    'homeRedditTitle',
    'homeRedditCopy',
    'homeSupportUrl',
    'homeContactEmail',
    'homeCreditsUrl',
    'homeFooterNote',
    'homeChangelog'
];
const ADMIN_PANEL_STYLESHEET = '/admin-panels.css';

const normalizeText = value => (typeof value === 'string' ? value.trim() : '');

const readRequestedOpen = () => {
    try {
        const params = new URLSearchParams(window.location.search);
        return normalizeText(params.get('admin')).toLowerCase() === 'home';
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
    <div id="home-admin-overlay" class="admin-overlay" role="presentation" hidden>
        <div class="admin-dialog" id="home-admin-dialog" role="dialog" aria-modal="true" aria-labelledby="home-admin-title">
            <header class="admin-header">
                <h2 id="home-admin-title">Administration accueil</h2>
                <button id="home-admin-close" class="admin-close" type="button" aria-label="Fermer le panneau admin accueil">x</button>
            </header>
            <div class="admin-content">
                <section class="admin-section">
                    <h3>Statut</h3>
                    <p id="home-admin-auth-status">Connexion administrateur requise.</p>
                </section>
                <section class="admin-section">
                    <h3>Navigation admin</h3>
                    <div class="admin-actions">
                        <a class="secondary-button" href="/timeline/?admin=timeline">Admin chronologie</a>
                        <a class="secondary-button" href="/map/">Admin carte</a>
                    </div>
                </section>
                <section class="admin-section" id="home-admin-section-config">
                    <div class="admin-section-heading">
                        <h3>Accueil</h3>
                        <div class="admin-section-heading-actions">
                            <button id="admin-home-reload" class="tertiary-button" type="button">Recharger</button>
                            <button id="admin-home-save" class="secondary-button" type="button">Enregistrer l'accueil</button>
                        </div>
                    </div>
                    <p class="admin-home-hint">Textes, hero, liens communautaires et patch notes de la page d'accueil.</p>
                    <ul id="admin-home-errors" class="profile-inline-errors" hidden></ul>
                    <div class="admin-home-grid">
                        <fieldset class="admin-home-fieldset">
                            <legend>Hero</legend>
                            <label for="admin-home-kicker">Kicker</label>
                            <input id="admin-home-kicker" type="text" autocomplete="off" />
                            <label for="admin-home-title">Titre</label>
                            <input id="admin-home-title" type="text" autocomplete="off" />
                            <label for="admin-home-lead">Intro</label>
                            <textarea id="admin-home-lead" rows="4"></textarea>
                            <label for="admin-home-atmosphere">Bloc ambiance</label>
                            <input id="admin-home-atmosphere" type="text" autocomplete="off" />
                            <label for="admin-home-tags">Tags hero (une ligne = un tag)</label>
                            <textarea id="admin-home-tags" rows="5" placeholder="Carte narrative&#10;Quetes live"></textarea>
                            <label for="admin-home-metrics">Metriques hero (Label | Valeur)</label>
                            <textarea id="admin-home-metrics" rows="5" placeholder="Hub | Carte + Communaute&#10;Acces | Lecture / Discord / Admin"></textarea>
                            <label for="admin-home-background-image">Fond hero</label>
                            <input id="admin-home-background-image" type="text" placeholder="/assets/home/backgrounds/hero-main.png" autocomplete="off" />
                            <label for="admin-home-map-image">Mockup carte</label>
                            <input id="admin-home-map-image" type="text" placeholder="/assets/home/mockups/map-preview-main.png" autocomplete="off" />
                            <label for="admin-home-character-image">Render personnage</label>
                            <input id="admin-home-character-image" type="text" placeholder="/assets/home/characters/character.png" autocomplete="off" />
                            <label for="admin-home-floating-title">Carte flottante - titre</label>
                            <input id="admin-home-floating-title" type="text" autocomplete="off" />
                            <label for="admin-home-floating-copy">Carte flottante - texte</label>
                            <textarea id="admin-home-floating-copy" rows="4"></textarea>
                        </fieldset>
                        <fieldset class="admin-home-fieldset">
                            <legend>Communaute et liens</legend>
                            <label for="admin-home-discord-url">URL Discord</label>
                            <input id="admin-home-discord-url" type="url" placeholder="https://discord.gg/..." autocomplete="off" />
                            <label for="admin-home-discord-title">Bloc Discord</label>
                            <input id="admin-home-discord-title" type="text" autocomplete="off" />
                            <label for="admin-home-discord-copy">Texte Discord</label>
                            <textarea id="admin-home-discord-copy" rows="3"></textarea>
                            <label for="admin-home-discord-proof-mode">Compteur Discord</label>
                            <select id="admin-home-discord-proof-mode">
                                <option value="discord">Auto (widget Discord)</option>
                                <option value="manual">Manuel</option>
                            </select>
                            <label for="admin-home-discord-guild-id">Guild ID / Widget</label>
                            <input id="admin-home-discord-guild-id" type="text" placeholder="123456789012345678" autocomplete="off" />
                            <label for="admin-home-discord-manual-count">Compteur manuel</label>
                            <input id="admin-home-discord-manual-count" type="number" min="0" step="1" placeholder="0" autocomplete="off" />
                            <label for="admin-home-discord-proof-label">Libelle compteur</label>
                            <input id="admin-home-discord-proof-label" type="text" placeholder="membres sur Discord" autocomplete="off" />
                            <label for="admin-home-discord-proof-note">Sous-texte compteur</label>
                            <input id="admin-home-discord-proof-note" type="text" placeholder="Sessions, annonces et coordination." autocomplete="off" />
                            <label for="admin-home-youtube-url">URL YouTube</label>
                            <input id="admin-home-youtube-url" type="url" placeholder="https://youtube.com/..." autocomplete="off" />
                            <label for="admin-home-youtube-title">Bloc YouTube</label>
                            <input id="admin-home-youtube-title" type="text" autocomplete="off" />
                            <label for="admin-home-youtube-copy">Texte YouTube</label>
                            <textarea id="admin-home-youtube-copy" rows="3"></textarea>
                            <label for="admin-home-reddit-url">URL Reddit</label>
                            <input id="admin-home-reddit-url" type="url" placeholder="https://reddit.com/..." autocomplete="off" />
                            <label for="admin-home-reddit-title">Bloc Reddit</label>
                            <input id="admin-home-reddit-title" type="text" autocomplete="off" />
                            <label for="admin-home-reddit-copy">Texte Reddit</label>
                            <textarea id="admin-home-reddit-copy" rows="3"></textarea>
                        </fieldset>
                        <fieldset class="admin-home-fieldset">
                            <legend>Footer et support</legend>
                            <label for="admin-home-support-url">URL support / bugs</label>
                            <input id="admin-home-support-url" type="url" placeholder="https://..." autocomplete="off" />
                            <label for="admin-home-contact-email">Contact</label>
                            <input id="admin-home-contact-email" type="text" placeholder="contact@..." autocomplete="off" />
                            <label for="admin-home-credits-url">URL credits</label>
                            <input id="admin-home-credits-url" type="text" placeholder="/docs/ASSETS-CREDITS.md" autocomplete="off" />
                            <label for="admin-home-footer-note">Note footer</label>
                            <textarea id="admin-home-footer-note" rows="4"></textarea>
                            <label for="admin-home-changelog">Patch notes (Date | Titre | Resume)</label>
                            <textarea id="admin-home-changelog" rows="8" placeholder="2026-02-28 | Accueil pre-carte en ligne | Nouvelle page d'accueil..."></textarea>
                        </fieldset>
                    </div>
                    <p id="admin-home-status" class="admin-home-status" role="status" aria-live="polite" hidden></p>
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

export class HomeAdminPanel {
    constructor({ onSave } = {}) {
        ensurePanelStylesheet();
        this.onSave = typeof onSave === 'function' ? onSave : null;
        this.session = { authenticated: false, role: 'guest' };
        this.sessionReady = false;
        this.returnFocusElement = null;
        this.lastActiveElement = null;
        this.adminSiteConfig = null;
        this.adminSiteConfigSource = 'unloaded';
        this.adminSiteConfigDirty = false;
        this.adminSiteConfigPending = false;
        this.adminSiteConfigErrors = [];
        this.announcer = null;
        this.logTelemetryEvent = () => {};
        this.requestedOpen = readRequestedOpen();
        this.hasHandledRequestedOpen = false;
        this.adminDom = this.createDom();
        this.bind();
        this.syncAuthStatus();
        syncAdminHomeEditor(this);
    }

    createDom() {
        let overlay = document.getElementById('home-admin-overlay');
        if (!overlay) {
            document.body.insertAdjacentHTML('beforeend', buildMarkup());
            overlay = document.getElementById('home-admin-overlay');
        }
        return {
            overlay,
            dialog: document.getElementById('home-admin-dialog'),
            content: document.querySelector('#home-admin-dialog .admin-content'),
            close: document.getElementById('home-admin-close'),
            authStatus: document.getElementById('home-admin-auth-status'),
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
            homeChangelog: document.getElementById('admin-home-changelog')
        };
    }

    isAdmin() {
        return Boolean(this.session?.authenticated) && normalizeText(this.session?.role).toLowerCase() === 'admin';
    }

    setSession(payload = {}) {
        this.session = payload && typeof payload === 'object' ? payload : { authenticated: false, role: 'guest' };
        this.sessionReady = true;
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
            ? 'Connecte en tant qu administrateur. Les modifications s enregistrent dans la configuration d accueil.'
            : 'Connexion administrateur requise.';
    }

    bindTrigger(element) {
        if (!element || element.dataset.adminHomeBound) {
            return;
        }
        element.addEventListener('click', event => {
            event.preventDefault();
            this.returnFocusElement = element;
            if (!this.sessionReady) { this.requestedOpen = true; return; }
            this.open();
        });
        element.dataset.adminHomeBound = 'true';
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
        this.adminDom.homeReloadButton?.addEventListener('click', () => this.fetchAdminSiteConfig());
        this.adminDom.homeSaveButton?.addEventListener('click', () => this.saveAdminSiteConfig());
        HOME_ADMIN_FIELD_IDS.forEach(key => {
            const element = this.adminDom[key];
            if (!element) {
                return;
            }
            element.addEventListener('input', () => this.markAdminSiteConfigDirty());
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
            this.returnFocusElement = document.getElementById('home-admin-entry');
        }
        this.lastActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        this.adminDom.overlay.hidden = false;
        this.adminDom.overlay.classList.add('open');
        document.body.classList.add('admin-surface-open');
        if (!this.adminSiteConfig && !this.adminSiteConfigPending) {
            this.fetchAdminSiteConfig();
        } else {
            syncAdminHomeEditor(this);
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

    markAdminSiteConfigDirty() {
        return markAdminSiteConfigDirty(this);
    }

    async fetchAdminSiteConfig() {
        return fetchAdminSiteConfig(this);
    }

    async saveAdminSiteConfig() {
        await saveAdminSiteConfig(this);
        if (this.onSave && this.adminSiteConfig && !this.adminSiteConfigDirty) {
            this.onSave(this.adminSiteConfig);
        }
    }
}
