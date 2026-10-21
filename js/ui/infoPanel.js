import { extractYoutubeId } from './youtube.mjs';
import { clearElement, createElement, qsa } from './dom.js';
import { getString } from '../i18n.js';
import { renderMarkdown } from './markdown.mjs';

export class InfoPanel {
    constructor({
        sidebar,
        titleElement,
        descriptionElement,
        descriptionContainer,
        galleryElement,
        historySection,
        questsSection,
        pnjsSection,
        loreSection,
        timelineSection,
        instancesSection,
        nobleFamiliesSection,
        audioManager,
        closeButton,
        lightbox = null,
        tabsSelector = '.info-tab',
        tabContentSelector = '.info-content'
    }) {
        this.sidebar = sidebar;
        this.titleElement = titleElement;
        this.descriptionElement = descriptionElement;
        this.descriptionContainer = descriptionContainer;
        this.galleryElement = galleryElement;
        this.historySection = historySection;
        this.questsSection = questsSection;
        this.pnjsSection = pnjsSection;
        this.loreSection = loreSection;
        this.timelineSection = timelineSection;
        this.instancesSection = instancesSection;
        this.nobleFamiliesSection = nobleFamiliesSection;
        this.audioManager = audioManager;
        this.closeButton = closeButton;
        this.onClose = () => {};
        this.tabs = tabsSelector ? qsa(tabsSelector) : [];
        this.tabContents = tabContentSelector ? qsa(tabContentSelector) : [];
        this.lightbox = {
            container: lightbox?.container || null,
            image: lightbox?.image || null,
            caption: lightbox?.caption || null,
            closeButton: lightbox?.closeButton || null,
            previousFocus: null,
            ready: false
        };
        this.boundLightboxKeyHandler = null;
        this.timelineEntries = null;
        this.timelineRequest = null;
        this.activeLocationName = '';
    }

    initialize({ onClose }) {
        this.onClose = typeof onClose === 'function' ? onClose : () => {};
        if (this.closeButton) {
            this.closeButton.addEventListener('click', () => this.close());
        }
        if (this.audioManager) {
            this.audioManager.initialize();
        }
        this.bindTabs();
        this.setupTabsAccessibility();
        this.setupLightbox();
    }

    bindTabs() {
        if (!this.tabs.length || !this.tabContents.length) {
            return;
        }
        this.tabs.forEach((tab, index) => {
            tab.addEventListener('click', () => {
                const target = tab.dataset.tab || 'description';
                this.setActiveTab(target);
            });
            tab.addEventListener('keydown', event => {
                this.handleTabKeydown(event, index);
            });
        });
    }

    setActiveTab(target) {
        this.tabs.forEach(tab => {
            const isActive = tab.dataset.tab === target;
            tab.classList.toggle('active', isActive);
            tab.setAttribute('aria-selected', String(isActive));
            tab.setAttribute('tabindex', isActive ? '0' : '-1');
        });
        this.tabContents.forEach(content => {
            const isMatch = content.id === `${target}-content`;
            content.classList.toggle('active', isMatch);
            content.setAttribute('aria-hidden', String(!isMatch));
            content.setAttribute('tabindex', isMatch ? '0' : '-1');
        });
    }

    show(entry) {
        if (!entry || !entry.location) {
            return;
        }
        const location = entry.location;
        this.activeLocationName = location.name || '';

        if (this.titleElement) {
            this.titleElement.textContent = location.name;
        }
        if (this.descriptionElement) {
            this.descriptionElement.classList.add('markdown-content');
            const description = location.description || getString('info.noDescription');
            this.descriptionElement.innerHTML = renderMarkdown(description);
        }

        this.renderSection(this.loreSection, location.lore, 'info.lore');
        this.renderSection(this.historySection, location.history, 'info.history');
        this.renderSection(this.questsSection, location.quests, 'info.quests');
        this.renderTimelineSection(location);
        this.renderSection(this.instancesSection, location.instances, 'info.instances', 'Instances');
        this.renderSection(this.nobleFamiliesSection, location.nobleFamilies, 'info.nobleFamilies', 'Familles nobles');
        this.renderPnjsSection(location.pnjs);
        this.renderGallery(location);

        if (this.audioManager) {
            this.audioManager.update({ location });
        }

        if (this.sidebar) {
            this.setActiveTab('description');
            this.sidebar.style.display = 'block';
            this.sidebar.classList.add('open');
            document.body.classList.add('info-sidebar-open');
        }
    }

    normalizeTimelineText(value) {
        return String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .trim();
    }

    async loadTimelineEntries() {
        if (Array.isArray(this.timelineEntries)) {
            return this.timelineEntries;
        }
        if (!this.timelineRequest) {
            const generation = this.accessGeneration || 0;
            this.timelineRequest = fetch('/api/timeline', { cache: 'no-store' })
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                    }
                    return response.json();
                })
                .then(payload => {
                    if (generation !== (this.accessGeneration || 0)) return [];
                    const source = payload?.timeline && typeof payload.timeline === 'object'
                        ? payload.timeline
                        : payload;
                    this.timelineEntries = Array.isArray(source?.entries) ? source.entries : [];
                    return this.timelineEntries;
                })
                .catch(error => {
                    if (generation !== (this.accessGeneration || 0)) return [];
                    this.timelineEntries = [];
                    throw error;
                })
                .finally(() => {
                    if (generation === (this.accessGeneration || 0)) this.timelineRequest = null;
                });
        }
        return this.timelineRequest;
    }

    invalidatePermissions() {
        this.accessGeneration = (this.accessGeneration || 0) + 1;
        this.activeLocationName = '';
        this.timelineEntries = null;
        this.timelineRequest = null;
        for (const key of ['titleElement', 'descriptionElement', 'loreSection', 'historySection', 'questsSection', 'timelineSection', 'instancesSection', 'nobleFamiliesSection', 'pnjsSection', 'galleryElement']) this[key]?.replaceChildren();
        this.audioManager?.update({ location: { audio: null } });
        this.close();
    }

    renderTimelineSection(location) {
        if (!this.timelineSection) {
            return;
        }

        clearElement(this.timelineSection);
        this.timelineSection.hidden = false;
        this.timelineSection.classList.add('extra-section');
        this.timelineSection.dataset.section = 'timeline';

        const title = createElement('h4', { text: 'Chronologie liee' });
        const status = createElement('p', {
            className: 'timeline-link-empty',
            text: 'Recherche des evenements lies...'
        });

        this.timelineSection.append(title, status);

        const locationName = location?.name || '';
        const expectedKey = this.normalizeTimelineText(locationName);

        this.loadTimelineEntries()
            .then(entries => {
                if (this.activeLocationName !== locationName) {
                    return;
                }

                const matches = (Array.isArray(entries) ? entries : [])
                    .filter(entry => {
                        const locationNames = Array.isArray(entry?.locationNames) ? entry.locationNames : [];
                        return locationNames.some(name => this.normalizeTimelineText(name) === expectedKey);
                    })
                    .sort((left, right) => Number(left?.year || 0) - Number(right?.year || 0));

                clearElement(this.timelineSection);
                this.timelineSection.appendChild(title);

                if (!matches.length) {
                    this.timelineSection.appendChild(createElement('p', {
                        className: 'timeline-link-empty',
                        text: 'Aucun evenement relie a ce lieu pour le moment.'
                    }));
                    return;
                }

                const list = createElement('div', { className: 'timeline-link-list' });
                matches.forEach(eventEntry => {
                    const item = createElement('article', { className: 'timeline-link-card' });
                    item.appendChild(createElement('span', {
                        className: 'timeline-link-year',
                        text: eventEntry.yearLabel || String(eventEntry.year || '--')
                    }));
                    item.appendChild(createElement('strong', {
                        className: 'timeline-link-title',
                        text: eventEntry.title || 'Evenement'
                    }));
                    if (eventEntry.summary) {
                        item.appendChild(createElement('p', {
                            className: 'timeline-link-summary',
                            text: eventEntry.summary
                        }));
                    }
                    item.appendChild(createElement('a', {
                        className: 'timeline-link-button',
                        text: 'Voir dans la chronologie',
                        attributes: {
                            href: `/timeline/?event=${encodeURIComponent(eventEntry.id || '')}&location=${encodeURIComponent(locationName)}`
                        }
                    }));
                    list.appendChild(item);
                });

                this.timelineSection.appendChild(list);
            })
            .catch(error => {
                console.error('[timeline] unable to load linked events', error);
                if (this.activeLocationName !== locationName) {
                    return;
                }
                clearElement(this.timelineSection);
                this.timelineSection.appendChild(title);
                this.timelineSection.appendChild(createElement('p', {
                    className: 'timeline-link-empty',
                    text: 'Impossible de charger la chronologie liee pour le moment.'
                }));
            });
    }

    renderGallery(location) {
        if (!this.galleryElement) {
            return;
        }
        clearElement(this.galleryElement);
        let hasContent = false;
        const lightboxEnabled = Boolean(this.lightbox.container && this.lightbox.image);

        if (Array.isArray(location.images)) {
            location.images
                .filter(src => typeof src === 'string' && src.trim())
                .forEach((src, index) => {
                    const attributes = {
                        src,
                        alt: `${location.name} - image ${index + 1}`
                    };
                    if (lightboxEnabled) {
                        attributes.tabindex = '0';
                        attributes.role = 'button';
                        attributes['aria-label'] = `${location.name} - agrandir l'image ${index + 1}`;
                    }
                    const img = createElement('img', {
                        className: 'gallery-image',
                        attributes
                    });
                    img.addEventListener('error', () => img.remove());
                    if (lightboxEnabled) {
                        const open = () => this.openLightbox({
                            src,
                            alt: img.alt,
                            caption: location.name
                        });
                        img.addEventListener('click', open);
                        img.addEventListener('keydown', event => {
                            if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                open();
                            }
                        });
                    }
                    this.galleryElement.appendChild(img);
                    hasContent = true;
                });
        }

        if (Array.isArray(location.videos)) {
            location.videos.forEach((videoEntry, index) => {
                const { element, url, title } = this.createVideoThumbnail({
                    videoEntry,
                    location,
                    index
                });

                if (element) {
                    this.galleryElement.appendChild(element);
                    hasContent = true;
                    return;
                }

                if (url) {
                    const watchLabel = title || getString('info.watchVideo') || 'Voir la vidéo';
                    const fallbackLink = createElement('a', {
                        className: 'gallery-video-link',
                        text: watchLabel,
                        attributes: { href: url, target: '_blank', rel: 'noopener noreferrer' }
                    });
                    this.galleryElement.appendChild(fallbackLink);
                    hasContent = true;
                }
            });
        }

        if (!hasContent) {
            const empty = createElement('p', {
                className: 'gallery-empty',
                text: getString('info.noMedia') || 'Aucun media disponible'
            });
            this.galleryElement.appendChild(empty);
        }
    }

    renderSection(sectionElement, items, titleKey, fallbackTitle = '') {
        if (!sectionElement) {
            return;
        }
        clearElement(sectionElement);

        const normalizedItems = Array.isArray(items) ? items : [items];
        const visibleItems = normalizedItems.filter(value => Boolean(value));
        if (!visibleItems.length) {
            sectionElement.hidden = true;
            return;
        }

        sectionElement.hidden = false;
        sectionElement.classList.add('extra-section');
        const localized = getString(`${titleKey}.title`);
        const titleText = localized && localized !== `${titleKey}.title`
            ? localized
            : (fallbackTitle || localized || '');
        const title = createElement('h4', { text: titleText });
        sectionElement.appendChild(title);

        const list = createElement('ul');
        visibleItems.forEach(item => {
            const li = createElement('li', { className: 'markdown-content' });
            li.innerHTML = renderMarkdown(item);
            list.appendChild(li);
        });
        sectionElement.appendChild(list);
    }

    setupTabsAccessibility() {
        if (!this.tabs.length || !this.tabContents.length) {
            return;
        }

        const tablist = this.tabs[0].parentElement;
        if (tablist) {
            tablist.setAttribute('role', 'tablist');
            const label = getString('info.tabsAriaLabel');
            if (label && label !== 'info.tabsAriaLabel') {
                tablist.setAttribute('aria-label', label);
            }
        }

        this.tabs.forEach(tab => {
            const tabId = tab.id || `info-tab-${tab.dataset.tab || ''}`;
            tab.id = tabId;
            tab.setAttribute('role', 'tab');
            const panelId = `${tab.dataset.tab || 'description'}-content`;
            tab.setAttribute('aria-controls', panelId);
        });

        this.tabContents.forEach(content => {
            const tabName = content.id.replace('-content', '');
            const controller = this.tabs.find(tab => tab.dataset.tab === tabName);
            if (controller) {
                content.setAttribute('role', 'tabpanel');
                content.setAttribute('aria-labelledby', controller.id);
            }
        });
    }

    handleTabKeydown(event, index) {
        switch (event.key) {
            case 'ArrowRight':
            case 'ArrowLeft': {
                event.preventDefault();
                const offset = event.key === 'ArrowRight' ? 1 : -1;
                this.focusTabByOffset(index, offset);
                break;
            }
            case 'Home':
                event.preventDefault();
                this.focusTab(0);
                break;
            case 'End':
                event.preventDefault();
                this.focusTab(this.tabs.length - 1);
                break;
            case 'Enter':
            case ' ': {
                event.preventDefault();
                const target = this.tabs[index]?.dataset.tab;
                if (target) {
                    this.setActiveTab(target);
                }
                break;
            }
            default:
                break;
        }
    }

    focusTabByOffset(currentIndex, offset) {
        if (!this.tabs.length) {
            return;
        }
        const count = this.tabs.length;
        const nextIndex = (currentIndex + offset + count) % count;
        this.focusTab(nextIndex);
    }

    focusTab(targetIndex) {
        const targetTab = this.tabs[targetIndex];
        if (!targetTab) {
            return;
        }
        const targetName = targetTab.dataset.tab || 'description';
        this.setActiveTab(targetName);
        targetTab.focus();
    }

    createVideoThumbnail({ videoEntry, location, index }) {
        let url = '';
        let providedTitle = '';

        if (typeof videoEntry === 'string') {
            url = videoEntry.trim();
        } else if (videoEntry && typeof videoEntry === 'object') {
            if (typeof videoEntry.url === 'string') {
                url = videoEntry.url.trim();
            }
            if (typeof videoEntry.title === 'string') {
                providedTitle = videoEntry.title.trim();
            }
        }

        if (!url) {
            return { element: null, url: '', title: '' };
        }

        const videoId = InfoPanel.extractYoutubeId(url);
        const videoTitle = providedTitle || `${location.name} - vidéo ${index + 1}`;
        const watchLabel = getString('info.watchVideo') || 'Voir la vidéo';

        if (!videoId) {
            return { element: null, url, title: videoTitle };
        }

        const container = createElement('div', {
            className: 'gallery-video-container'
        });

        const link = createElement('a', {
            className: 'gallery-video',
            attributes: {
                href: url,
                target: '_blank',
                rel: 'noopener noreferrer',
                'aria-label': `${watchLabel} - ${videoTitle}`
            }
        });

        const thumbnail = createElement('img', {
            className: 'gallery-thumbnail',
            attributes: {
                src: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
                alt: videoTitle
            }
        });

        thumbnail.addEventListener('error', () => {
            thumbnail.hidden = true;
            link.textContent = watchLabel + ' - ' + videoTitle;
        }, { once: true });
        link.appendChild(thumbnail);
        container.appendChild(link);

        container.appendChild(createElement('span', {
            className: 'gallery-video-title',
            text: videoTitle
        }));

        return { element: container, url, title: videoTitle };
    }

    static extractYoutubeId(url) { return extractYoutubeId(url); }

    renderPnjsSection(pnjs) {
        if (!this.pnjsSection) {
            return;
        }
        clearElement(this.pnjsSection);
        if (!pnjs || !pnjs.length) {
            this.pnjsSection.hidden = true;
            return;
        }
        this.pnjsSection.hidden = false;
        this.pnjsSection.classList.add('extra-section');
        const title = createElement('h4', { text: getString('info.pnjs.title') });
        this.pnjsSection.appendChild(title);
        const list = createElement('ul');
        pnjs.forEach(pnj => {
            const item = createElement('li');
            const name = createElement('strong', { text: pnj.name || getString('info.pnjs.unknown') });
            item.appendChild(name);
            if (pnj.role) {
                item.appendChild(document.createTextNode(` - ${pnj.role}`));
            }
            if (pnj.description) {
                const desc = createElement('p', { className: 'markdown-content' });
                desc.innerHTML = renderMarkdown(pnj.description);
                item.appendChild(desc);
            }
            list.appendChild(item);
        });
        this.pnjsSection.appendChild(list);
    }

    close() {
        if (this.sidebar) {
            this.sidebar.classList.remove('open');
            document.body.classList.remove('info-sidebar-open');
            setTimeout(() => {
                if (this.sidebar && !this.sidebar.classList.contains('open')) {
                    this.sidebar.style.display = 'none';
                }
            }, 250);
        }
        if (this.audioManager) {
            this.audioManager.stop();
        }
        this.closeLightbox();
        this.onClose();
    }

    setupLightbox() {
        const { container, closeButton } = this.lightbox;
        if (!container || this.lightbox.ready) {
            return;
        }
        container.setAttribute('tabindex', '-1');
        container.addEventListener('click', event => {
            if (event.target === container) {
                this.closeLightbox();
            }
        });
        if (closeButton) {
            closeButton.addEventListener('click', () => this.closeLightbox());
        }
        this.lightbox.ready = true;
    }

    openLightbox({ src, alt, caption }) {
        const { container, image, caption: captionElement, closeButton } = this.lightbox;
        if (!container || !image) {
            return;
        }
        this.lightbox.previousFocus = document.activeElement;
        image.src = src;
        image.alt = alt || '';
        if (captionElement) {
            const text = caption || alt || '';
            captionElement.textContent = text;
            captionElement.hidden = !text;
        }
        container.hidden = false;
        container.classList.add('open');
        this.boundLightboxKeyHandler = event => {
            if (event.key === 'Escape') {
                this.closeLightbox();
            }
        };
        document.addEventListener('keydown', this.boundLightboxKeyHandler);
        (closeButton || container).focus?.();
    }

    closeLightbox() {
        const { container, image, caption } = this.lightbox;
        if (!container || container.hidden) {
            return;
        }
        container.classList.remove('open');
        container.hidden = true;
        if (image) {
            image.src = '';
            image.alt = '';
        }
        if (caption) {
            caption.textContent = '';
            caption.hidden = true;
        }
        if (this.boundLightboxKeyHandler) {
            document.removeEventListener('keydown', this.boundLightboxKeyHandler);
            this.boundLightboxKeyHandler = null;
        }
        this.lightbox.previousFocus?.focus?.();
        this.lightbox.previousFocus = null;
    }
}
