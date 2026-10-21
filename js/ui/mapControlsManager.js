import { getString } from '../i18n.js';

export class MapControlsManager {
    constructor({
        mapController,
        zoomInButton,
        zoomOutButton,
        resetButton,
        fullscreenButton,
        zoomDisplay,
        preferences
    }) {
        this.mapController = mapController;
        this.zoomInButton = zoomInButton;
        this.zoomOutButton = zoomOutButton;
        this.resetButton = resetButton;
        this.fullscreenButton = fullscreenButton;
        this.zoomDisplay = zoomDisplay;
        this.preferences = preferences;
    }

    initialize() {
        if (this.zoomInButton) {
            const label = getString('mapControls.zoomIn');
            this.zoomInButton.title = label;
            this.zoomInButton.setAttribute('aria-label', label);
            this.zoomInButton.addEventListener('click', () => this.mapController.zoomIn());
        }

        if (this.zoomOutButton) {
            const label = getString('mapControls.zoomOut');
            this.zoomOutButton.title = label;
            this.zoomOutButton.setAttribute('aria-label', label);
            this.zoomOutButton.addEventListener('click', () => this.mapController.zoomOut());
        }

        if (this.resetButton) {
            const label = getString('mapControls.recenter');
            this.resetButton.title = label;
            this.resetButton.setAttribute('aria-label', label);
            this.resetButton.addEventListener('click', () => this.mapController.resetView());
        }

        if (this.fullscreenButton) {
            const label = getString('mapControls.fullscreen');
            this.fullscreenButton.title = label;
            this.fullscreenButton.setAttribute('aria-label', label);
            this.fullscreenButton.addEventListener('click', () => this.toggleFullscreen());
        }

        this.mapController.onMapStateChange(state => {
            if (this.preferences && typeof this.preferences.setMapState === 'function') {
                this.preferences.setMapState(state);
            }
            this.updateZoomDisplay(this.mapController.getZoomPercentage());
        });

        this.updateZoomDisplay(this.mapController.getZoomPercentage());
    }

    toggleFullscreen() {
        const fullscreenElement = document.fullscreenElement
            || document.webkitFullscreenElement
            || document.mozFullScreenElement
            || document.msFullscreenElement;

        if (!fullscreenElement) {
            const target = document.documentElement || document.body;
            const request = target.requestFullscreen
                || target.webkitRequestFullscreen
                || target.mozRequestFullScreen
                || target.msRequestFullscreen;
            if (typeof request === 'function') {
                request.call(target);
            }
            return;
        }

        const exit = document.exitFullscreen
            || document.webkitExitFullscreen
            || document.mozCancelFullScreen
            || document.msExitFullscreen;
        if (typeof exit === 'function') {
            exit.call(document);
        }
    }

    updateZoomDisplay(percentage) {
        if (!this.zoomDisplay) {
            return;
        }
        if (!Number.isFinite(percentage)) {
            this.zoomDisplay.textContent = '—';
            return;
        }
        let displayValue = percentage;
        if (percentage < 10) {
            displayValue = Math.round(percentage * 10) / 10;
        } else {
            displayValue = Math.round(percentage);
        }
        this.zoomDisplay.textContent = `${displayValue}%`;
    }
}
