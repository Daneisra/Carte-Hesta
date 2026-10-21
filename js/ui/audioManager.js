import { getString } from '../i18n.js';

export class AudioManager {
    constructor({
        player,
        titleElement,
        container,
        fallbackButton,
        statusElement,
        playButton = null,
        pauseButton = null,
        stopButton = null,
        volumeSlider = null,
        loopToggle = null,
        playToggle = null,
        progressBar = null,
        currentLabel = null,
        durationLabel = null,
        volumeButton = null,
        downloadLink = null,
        speedSelect = null
    }) {
        this.player = player;
        this.titleElement = titleElement;
        this.container = container;
        this.fallbackButton = fallbackButton;
        this.statusElement = statusElement;
        this.playButton = playButton;
        this.pauseButton = pauseButton;
        this.stopButton = stopButton;
        this.volumeSlider = volumeSlider;
        this.loopToggle = loopToggle;
        this.playToggle = playToggle;
        this.progressBar = progressBar;
        this.currentLabel = currentLabel;
        this.durationLabel = durationLabel;
        this.volumeButton = volumeButton;
        this.downloadLink = downloadLink;
        this.speedSelect = speedSelect;
        this.bound = false;
        this.playRequestId = 0;
        this.defaultVolume = 1;
        this.scrubbing = false;
    }

    initialize() {
        if (this.bound || !this.player) {
            return;
        }

        if (this.fallbackButton) {
            this.fallbackButton.textContent = getString('audio.fallbackButton');
            this.fallbackButton.addEventListener('click', () => {
                if (!this.player.src) {
                    return;
                }
                this.fallbackButton.disabled = true;
                const playback = this.player.play();
                if (playback && typeof playback.then === 'function') {
                    playback
                        .then(() => this.hideFallback())
                        .catch(() => this.showFallback(getString('audio.fallbackBlocked')))
                        .finally(() => {
                            this.fallbackButton.disabled = false;
                        });
                } else {
                    this.fallbackButton.disabled = false;
                }
            });
        }

        this.player.addEventListener('play', () => this.hideFallback());
        this.player.addEventListener('ended', () => this.hideFallback());
        this.player.addEventListener('error', () => this.showFallback(getString('audio.fallbackMissing')));
        this.player.addEventListener('play', () => this.updateControlsState());
        this.player.addEventListener('pause', () => this.updateControlsState());
        this.player.addEventListener('ended', () => this.updateControlsState());
        this.player.addEventListener('volumechange', () => this.syncVolume());
        this.player.addEventListener('timeupdate', () => this.syncProgress());
        for (const event of ['durationchange', 'progress', 'canplay', 'seeked']) {
            this.player.addEventListener(event, () => this.syncProgress());
        }
        this.player.addEventListener('loadedmetadata', () => {
            this.syncProgress(true);
            this.updateControlsAvailability(Boolean(this.player.src));
        });

        this.bindControls();
        this.updateControlsAvailability(false);
        this.bound = true;
    }

    update({ location }) {
        if (!this.player || !this.container || !this.titleElement) {
            return;
        }

        const requestId = ++this.playRequestId;
        this.scrubbing = false;

        if (!location || !location.audio) {
            this.player.removeAttribute('src');
            this.player.load();
            this.container.style.display = 'none';
            this.titleElement.textContent = `🎧 ${getString('audio.titleDefault')}`;
            this.hideFallback();
            this.syncDownloadLink('', '');
            this.syncProgress(true);
            this.updateControlsAvailability(false);
            return;
        }

        this.container.style.display = 'block';
        this.player.pause();
        this.player.currentTime = 0;
        this.player.src = location.audio;
        this.titleElement.textContent = `🎧 ${getString('audio.titleForLocation', { location: location.name })}`;
        this.player.load();
        this.player.playbackRate = Number(this.speedSelect?.value) || 1;
        this.player.loop = Boolean(this.loopToggle?.checked);
        this.syncVolume();
        this.syncDownloadLink(location.audio, location.name);
        this.syncProgress(true);
        this.hideFallback();
        this.tryAutoplay(requestId);
        this.updateControlsState();
        this.updateControlsAvailability(true);
    }

    stop() {
        if (!this.player) {
            return;
        }
        this.playRequestId += 1;
        this.player.pause();
        this.player.currentTime = 0;
        this.player.removeAttribute('src');
        this.player.load();
        this.hideFallback();
        this.updateControlsState();
        this.updateControlsAvailability(false);
    }

    showFallback(message) {
        if (this.fallbackButton) {
            this.fallbackButton.hidden = false;
            this.fallbackButton.disabled = false;
        }
        if (this.statusElement) {
            this.statusElement.hidden = false;
            this.statusElement.textContent = message || getString('audio.fallbackDefault');
        }
    }

    hideFallback() {
        if (this.fallbackButton) {
            this.fallbackButton.hidden = true;
        }
        if (this.statusElement) {
            this.statusElement.hidden = true;
            this.statusElement.textContent = '';
        }
    }

    tryAutoplay(requestId) {
        if (!this.player) {
            return;
        }

        const handleBlocked = error => {
            if (this.playRequestId !== requestId) {
                return;
            }
            if (error && error.name === 'AbortError') {
                return;
            }
            this.showFallback(getString('audio.fallbackBlocked'));
        };

        try {
            const playback = this.player.play();
            if (playback && typeof playback.then === 'function') {
                playback
                    .then(() => {
                        if (this.playRequestId === requestId) {
                            this.hideFallback();
                        }
                    })
                    .catch(handleBlocked);
            } else {
                this.hideFallback();
                this.updateControlsState();
            }
        } catch (error) {
            handleBlocked(error);
        }
    }

    bindControls() {
        if (this.playToggle) {
            this.playToggle.addEventListener('click', () => {
                if (!this.player) return;
                if (this.player.paused) {
                    this.tryManualPlay();
                } else {
                    this.player.pause();
                }
            });
        }
        if (this.playButton) {
            this.playButton.addEventListener('click', () => this.tryManualPlay());
        }
        if (this.pauseButton) {
            this.pauseButton.addEventListener('click', () => {
                this.player?.pause();
                this.updateControlsState();
            });
        }
        if (this.stopButton) {
            this.stopButton.addEventListener('click', () => this.stop());
        }
        if (this.volumeSlider) {
            this.volumeSlider.addEventListener('input', event => {
                const value = Number(event.target.value);
                if (Number.isFinite(value) && this.player) {
                    this.player.volume = Math.min(1, Math.max(0, value));
                }
            });
            this.volumeSlider.value = this.player?.volume ?? this.defaultVolume;
        }
        if (this.volumeButton) {
            this.volumeButton.addEventListener('click', () => {
                if (!this.player) return;
                this.player.muted = !this.player.muted;
                this.updateControlsState();
            });
        }
        if (this.loopToggle) {
            this.loopToggle.addEventListener('change', () => {
                if (this.player) {
                    this.player.loop = Boolean(this.loopToggle.checked);
                }
            });
        }
        if (this.progressBar) {
            this.progressBar.addEventListener('input', event => {
                const duration = this.player?.duration, value = Number(event.target.value);
                if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(value)) return;
                this.scrubbing = true;
                if (this.currentLabel) this.currentLabel.textContent = this.formatTime(Math.min(100, Math.max(0, value)) * duration / 100);
            });
            this.progressBar.addEventListener('change', event => {
                const duration = this.player?.duration, value = Number(event.target.value);
                this.scrubbing = false;
                if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(value)) return;
                this.player.currentTime = Math.min(100, Math.max(0, value)) * duration / 100;
                this.syncProgress();
            });
            this.progressBar.addEventListener('pointercancel', () => { this.scrubbing = false; this.syncProgress(); });
        }
        if (this.speedSelect) {
            this.speedSelect.addEventListener('change', () => {
                const value = Number(this.speedSelect.value);
                if (this.player && Number.isFinite(value) && value > 0) {
                    this.player.playbackRate = value;
                }
            });
        }
        this.updateControlsState();
        this.updateControlsAvailability(Boolean(this.player?.src));
    }

    tryManualPlay() {
        if (!this.player || !this.player.src) {
            return;
        }
        const id = ++this.playRequestId;
        this.tryAutoplay(id);
    }

    updateControlsState() {
        const hasSource = Boolean(this.player?.src);
        const playing = hasSource && !this.player.paused && !this.player.ended;
        if (this.playToggle) {
            this.playToggle.textContent = playing ? '⏸' : '▶';
            this.playToggle.disabled = !hasSource;
        }
        if (this.playButton) {
            this.playButton.disabled = !hasSource || playing;
        }
        if (this.pauseButton) {
            this.pauseButton.disabled = !playing;
        }
        if (this.stopButton) {
            this.stopButton.disabled = !hasSource;
        }
        if (this.loopToggle && this.player) {
            this.loopToggle.checked = Boolean(this.player.loop);
        }
        if (this.volumeButton && this.player) {
            this.volumeButton.textContent = this.player.muted || this.player.volume === 0 ? '🔈' : '🔊';
            this.volumeButton.disabled = !hasSource;
        }
        this.syncVolume();
        this.syncProgress();
    }

    updateControlsAvailability(enabled) {
        const controls = [
            this.playToggle,
            this.progressBar,
            this.volumeButton,
            this.volumeSlider,
            this.speedSelect,
            this.loopToggle,
            this.downloadLink
        ];
        controls.forEach(ctrl => {
            if (!ctrl) return;
            if ('disabled' in ctrl) {
                ctrl.disabled = !enabled;
            }
            if (ctrl.tagName === 'A') {
                ctrl.hidden = !enabled;
            }
        });
        this.syncProgress();
    }

    syncVolume() {
        if (!this.player) {
            return;
        }
        if (this.volumeSlider) {
            const vol = Number.isFinite(this.player.volume) ? this.player.volume : this.defaultVolume;
            this.volumeSlider.value = vol.toFixed(2);
        }
        if (this.volumeButton) {
            this.volumeButton.textContent = this.player.muted || this.player.volume === 0 ? '🔈' : '🔊';
        }
    }

    syncProgress(force = false) {
        if (!this.player) return;
        const duration = Number.isFinite(this.player.duration) ? this.player.duration : 0;
        const current = Number.isFinite(this.player.currentTime) ? this.player.currentTime : 0;
        if (this.durationLabel && (force || duration)) {
            this.durationLabel.textContent = this.formatTime(duration);
        }
        if (this.scrubbing && !force) return;
        if (this.currentLabel) {
            this.currentLabel.textContent = this.formatTime(current);
        }
        if (this.progressBar && duration > 0) {
            const percent = Math.min(100, Math.max(0, (current / duration) * 100));
            this.progressBar.max = 100;
            this.progressBar.value = percent;
            this.progressBar.disabled = false;
        } else if (this.progressBar && duration === 0) {
            this.progressBar.value = 0;
            this.progressBar.disabled = true;
        }
    }

    formatTime(seconds) {
        if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    syncDownloadLink(src, name = '') {
        if (!this.downloadLink) return;
        if (!src) {
            this.downloadLink.hidden = true;
            this.downloadLink.removeAttribute('href');
            this.downloadLink.removeAttribute('download');
            return;
        }
        this.downloadLink.hidden = false;
        this.downloadLink.href = src;
        const safeName = name ? name.replace(/\\s+/g, '_') : 'audio';
        this.downloadLink.download = `${safeName}.mp3`;
    }
}
