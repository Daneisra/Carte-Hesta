import { getString } from '../i18n.js';

export class ThemeManager {
    constructor({ buttons, state, preferences }) {
        this.buttons = Array.isArray(buttons) ? buttons : [];
        this.state = state;
        this.preferences = preferences;
    }

    initialize() {
        this.applyTheme(this.state.theme);
        this.buttons.forEach(button => {
            const theme = button.dataset.theme === 'light' ? 'light' : 'dark';
            const label = theme === 'light'
                ? getString('mapControls.themeLight')
                : getString('mapControls.themeDark');
            button.title = label;
            button.setAttribute('aria-label', label);
            button.addEventListener('click', () => this.setTheme(theme));
            button.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    this.setTheme(theme);
                }
            });
        });
    }

    setTheme(theme) {
        const normalized = theme === 'light' ? 'light' : 'dark';
        const hasChanged = this.state.theme !== normalized;
        this.applyTheme(normalized);
        if (hasChanged && this.preferences && typeof this.preferences.setTheme === 'function') {
            this.preferences.setTheme(normalized);
        }
    }

    applyTheme(theme) {
        const normalized = theme === 'light' ? 'light' : 'dark';
        this.state.setTheme(normalized);
        document.body.setAttribute('data-theme', normalized);
        document.documentElement.style.colorScheme = normalized;
        this.buttons.forEach(button => {
            const isActive = button.dataset.theme === normalized;
            button.classList.toggle('active', isActive);
            button.setAttribute('aria-pressed', String(isActive));
        });
    }
}
