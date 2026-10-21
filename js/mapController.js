import { startTimer, endTimer, logMetric } from './utils/metrics.js';

const DEFAULT_BOUNDS = [[0, 0], [6144, 8192]];
const DEFAULT_IMAGE = 'assets/map.png';
const DEFAULT_POSITION = [3072, 4096];
const DEFAULT_ZOOM = -3;
const DEFAULT_MIN_ZOOM = -5;
const DEFAULT_MAX_ZOOM = 0;
const DEFAULT_NATIVE_ZOOM = 0;

export class MapController {
    constructor({
        mapId = 'map',
        bounds = DEFAULT_BOUNDS,
        imageUrl = DEFAULT_IMAGE,
        initialPosition = DEFAULT_POSITION,
        initialZoom = DEFAULT_ZOOM,
        minZoom = DEFAULT_MIN_ZOOM,
        maxZoom = DEFAULT_MAX_ZOOM,
        nativeZoom = DEFAULT_NATIVE_ZOOM
    } = {}) {
        this.bounds = bounds;
        this.minZoom = Number.isFinite(minZoom) ? minZoom : DEFAULT_MIN_ZOOM;

        const sanitizedMaxZoom = Number.isFinite(maxZoom) ? maxZoom : DEFAULT_MAX_ZOOM;
        this.maxZoom = Math.max(this.minZoom, sanitizedMaxZoom);

        const normalizedNativeZoom = Number.isFinite(nativeZoom) ? nativeZoom : DEFAULT_NATIVE_ZOOM;
        this.nativeZoom = Math.max(this.minZoom, Math.min(this.maxZoom, normalizedNativeZoom));

        this.initialPosition = initialPosition;
        const safeInitialZoom = Number.isFinite(initialZoom) ? initialZoom : DEFAULT_ZOOM;
        this.initialZoom = this.clampZoom(safeInitialZoom);

        this.map = L.map(mapId, {
            crs: L.CRS.Simple,
            minZoom: this.minZoom,
            maxZoom: this.maxZoom
        });

        this.typeData = {};
        this.typeZoomCache = new Map();
        this.entries = [];
        this.selectedEntry = null;
        this.markerLayer = L.layerGroup().addTo(this.map);
        this.annotationLayer = L.layerGroup().addTo(this.map);
        this.annotationMarkers = new Map();
        this.temporaryPaintLayer = L.layerGroup().addTo(this.map);
        this.temporaryPaintPoints = [];
        this.temporaryPaintLine = null;
        this.groupLayer = L.layerGroup().addTo(this.map);
        this.groupMarkers = new Map();
        this.clusterGroup = null;
        this.clusteringEnabled = false;
        this.mapStateListeners = new Set();

        L.imageOverlay(imageUrl, bounds).addTo(this.map);
        this.map.fitBounds(bounds);

        this.map.on('moveend', () => this.notifyMapStateChange());
        this.map.on('zoomend', () => this.notifyMapStateChange());
        this.map.on('click', event => this.logPixelCoordinates(event));
    }

    setTypeData(typeData) {
        this.typeData = typeData || {};
        this.typeZoomCache = new Map();
        this.entries.forEach(entry => {
            const type = entry?.location?.type;
            entry.zoomPercentage = this.getZoomPercentageForType(type);
            entry.preferredZoom = this.getZoomLevelForType(type);
        });
        if (this.clusterGroup) {
            this.clusterGroup.options.iconCreateFunction = cluster => this.createClusterIcon(cluster);
            this.clusterGroup.refreshClusters();
        }
    }

    getZoomPercentageForType(type) {
        const payload = (type && this.typeData?.[type]) || this.typeData?.default;
        const value = Number(payload?.zoom);
        if (!Number.isFinite(value) || value <= 0) {
            return null;
        }
        return Math.max(1, value);
    }

    getZoomLevelForType(type) {
        if (!type) {
            return null;
        }
        if (!this.typeZoomCache) {
            this.typeZoomCache = new Map();
        }
        if (this.typeZoomCache.has(type)) {
            return this.typeZoomCache.get(type);
        }
        const percentage = this.getZoomPercentageForType(type);
        if (!Number.isFinite(percentage)) {
            this.typeZoomCache.set(type, null);
            return null;
        }
        const zoomLevel = this.zoomFromPercentage(percentage);
        this.typeZoomCache.set(type, zoomLevel);
        return zoomLevel;
    }

    createEntry({ location, continent, onSelect, onHover, onLeave }) {
        const marker = L.marker([location.y, location.x], {
            icon: this.createCustomIcon(location.type),
            locationType: location.type || 'default'
        });

        this.addMarkerToLayer(marker);

        marker.bindTooltip(location.name, {
            direction: 'top',
            offset: [0, -35],
            sticky: true,
            className: 'marker-tooltip'
        });

        const zoomPercentage = this.getZoomPercentageForType(location.type);
        const preferredZoom = this.getZoomLevelForType(location.type);

        const entry = {
            location,
            continent,
            marker,
            visible: true,
            zoomPercentage,
            preferredZoom
        };

        marker.on('click', () => {
            onLeave?.(entry);
            onSelect?.(entry);
        });

        marker.on('mouseover', () => {
            this.setMarkerHighlight(marker, true);
            onHover?.(entry);
        });

        marker.on('mouseout', () => {
            if (this.selectedEntry?.marker !== marker) {
                this.setMarkerHighlight(marker, false);
            }
            onLeave?.(entry);
        });

        this.entries.push(entry);
        return entry;
    }

    setEntryVisibility(entry, isVisible) {
        if (!entry || !entry.marker) {
            return;
        }

        if (isVisible) {
            if (!entry.visible) {
                this.addMarkerToLayer(entry.marker);
            }
        } else {
            if (entry.visible) {
                this.removeMarkerFromLayers(entry.marker);
            }
            if (this.selectedEntry === entry) {
                this.selectedEntry = null;
            }
        }

        entry.visible = Boolean(isVisible);
    }

    focusOnEntry(entry, { zoom = null, zoomPercentage = null, animate = true, duration = 1.5 } = {}) {
        if (!entry || !entry.marker) {
            return;
        }
        let targetZoom = null;
        if (Number.isFinite(zoom)) {
            targetZoom = this.clampZoom(zoom);
        } else if (Number.isFinite(zoomPercentage)) {
            targetZoom = this.zoomFromPercentage(zoomPercentage);
        } else if (Number.isFinite(entry?.preferredZoom)) {
            targetZoom = this.clampZoom(entry.preferredZoom);
        }
        const resolvedZoom = Number.isFinite(targetZoom) ? targetZoom : this.map.getZoom();
        this.map.flyTo([entry.location.y, entry.location.x], resolvedZoom, { animate, duration });
    }

    animateEntry(entry) {
        if (!entry || !entry.marker) {
            return;
        }

        this.setMarkerHighlight(entry.marker, true);

        let isVisible = true;
        const marker = entry.marker;
        const blinkInterval = setInterval(() => {
            isVisible = !isVisible;
            marker.setOpacity(isVisible ? 1 : 0.4);
        }, 300);

        setTimeout(() => {
            clearInterval(blinkInterval);
            marker.setOpacity(1);
            if (this.selectedEntry !== entry) {
                this.setMarkerHighlight(marker, false);
            }
        }, 1200);
    }

    previewEntry(entry, isActive) {
        if (!entry || !entry.marker) {
            return;
        }
        if (this.selectedEntry === entry) {
            return;
        }
        this.setMarkerHighlight(entry.marker, Boolean(isActive));
    }

    setSelectedEntry(entry) {
        if (this.selectedEntry && this.selectedEntry !== entry) {
            this.setMarkerHighlight(this.selectedEntry.marker, false);
        }

        this.selectedEntry = entry;
        if (entry) {
            this.setMarkerHighlight(entry.marker, true);
        }
    }

    clearSelectedEntry() {
        if (this.selectedEntry) {
            this.setMarkerHighlight(this.selectedEntry.marker, false);
        }
        this.selectedEntry = null;
    }

    forEachEntry(callback) {
        this.entries.forEach(callback);
    }

    clearEntries() {
        this.entries.forEach(entry => {
            if (entry.marker) {
                this.removeMarkerFromLayers(entry.marker);
            }
        });

        this.markerLayer.clearLayers();
        if (this.clusterGroup) {
            this.clusterGroup.clearLayers();
        }

        this.entries = [];
        this.selectedEntry = null;
    }

    addMarkerToLayer(marker) {
        if (!marker) {
            return;
        }

        if (this.clusteringEnabled) {
            if (!this.clusterGroup) {
                this.clusterGroup = L.markerClusterGroup({
                    showCoverageOnHover: false,
                    spiderfyOnMaxZoom: true,
                    maxClusterRadius: 80
                });
            }
            if (!this.map.hasLayer(this.clusterGroup)) {
                this.map.addLayer(this.clusterGroup);
            }
            this.clusterGroup.addLayer(marker);
        } else {
            this.markerLayer.addLayer(marker);
        }
    }

    removeMarkerFromLayers(marker) {
        if (!marker) {
            return;
        }

        if (this.markerLayer.hasLayer(marker)) {
            this.markerLayer.removeLayer(marker);
        }
        if (this.clusterGroup && this.clusterGroup.hasLayer(marker)) {
            this.clusterGroup.removeLayer(marker);
        }
    }

    setClusteringEnabled(isEnabled) {
        const nextState = Boolean(isEnabled);
        if (nextState === this.clusteringEnabled) {
            logMetric('cluster.toggle.noop', { requestedState: nextState });
            return;
        }

        this.clusteringEnabled = nextState;

        const timer = startTimer('cluster.toggle', { targetState: nextState });

        if (this.clusteringEnabled) {
            if (typeof L.markerClusterGroup !== 'function') {
                endTimer(timer, { status: 'error', reason: 'plugin-missing' });
                console.warn('Clustering indisponible : plugin Leaflet.markercluster manquant.');
                this.clusteringEnabled = false;
                return;
            }

            if (!this.clusterGroup) {
                this.clusterGroup = L.markerClusterGroup({
                    showCoverageOnHover: false,
                    spiderfyOnMaxZoom: true,
                    maxClusterRadius: 80,
                    disableClusteringAtZoom: Math.max(this.minZoom, this.maxZoom - 1),
                    iconCreateFunction: cluster => this.createClusterIcon(cluster)
                });
            } else {
                this.clusterGroup.options.iconCreateFunction = cluster => this.createClusterIcon(cluster);
            }

            if (!this.map.hasLayer(this.clusterGroup)) {
                this.map.addLayer(this.clusterGroup);
            }

            this.entries.forEach(entry => {
                if (!entry.marker || !entry.visible) {
                    return;
                }
                this.markerLayer.removeLayer(entry.marker);
                this.clusterGroup.addLayer(entry.marker);
            });

            this.clusterGroup.refreshClusters();
        } else if (this.clusterGroup) {
            this.entries.forEach(entry => {
                if (!entry.marker || !entry.visible) {
                    return;
                }
                this.clusterGroup.removeLayer(entry.marker);
                this.markerLayer.addLayer(entry.marker);
            });
            this.clusterGroup.clearLayers();
            if (this.map.hasLayer(this.clusterGroup)) {
                this.map.removeLayer(this.clusterGroup);
            }
        }

        const visibleCount = this.entries.filter(entry => entry.visible).length;
        endTimer(timer, {
            status: 'ok',
            mode: this.clusteringEnabled ? 'enabled' : 'disabled',
            visibleCount,
            totalEntries: this.entries.length
        });
    }

    isClusteringEnabled() {
        return this.clusteringEnabled;
    }

    getMapState() {
        const center = this.map.getCenter();
        return {
            center: [center.lat, center.lng],
            zoom: this.map.getZoom()
        };
    }

    setMapState(state = {}) {
        if (!state) {
            return;
        }
        const { center, zoom } = state;
        const hasArrayCenter = Array.isArray(center) && center.length === 2 && center.every(val => typeof val === 'number');
        const hasObjectCenter = center && typeof center.lat === 'number' && typeof center.lng === 'number';
        const targetCenter = hasArrayCenter ? center : hasObjectCenter ? [center.lat, center.lng] : null;
        const targetZoom = typeof zoom === 'number' ? zoom : null;
        const clampedZoom = targetZoom !== null ? this.clampZoom(targetZoom) : null;

        if (targetCenter) {
            this.map.setView([targetCenter[0], targetCenter[1]], clampedZoom ?? this.map.getZoom(), { animate: false });
        } else if (clampedZoom !== null) {
            this.map.setZoom(clampedZoom, { animate: false });
        }
    }

    notifyMapStateChange() {
        if (!this.mapStateListeners.size) {
            return;
        }
        const snapshot = this.getMapState();
        this.mapStateListeners.forEach(callback => {
            try {
                callback(snapshot);
            } catch (error) {
                console.error("Erreur lors de la notification de l'état de la carte :", error);
            }
        });
    }

    onMapStateChange(callback) {
        if (typeof callback === 'function') {
            this.mapStateListeners.add(callback);
        }
    }

    resetView({ animate = true, duration = 0.5 } = {}) {
        const defaultCenter = this.map.getCenter();
        const targetCenter = Array.isArray(this.initialPosition) && this.initialPosition.length === 2
            ? [this.initialPosition[0], this.initialPosition[1]]
            : [defaultCenter.lat, defaultCenter.lng];
        const targetZoom = typeof this.initialZoom === 'number' ? this.initialZoom : this.map.getZoom();
        this.map.flyTo([targetCenter[0], targetCenter[1]], this.clampZoom(targetZoom), { animate, duration });
    }

    onMapClick(callback) {
        if (typeof callback !== 'function') {
            return () => {};
        }
        this.map.on('click', callback);
        return () => {
            this.map.off('click', callback);
        };
    }

    addTemporaryPaintPoint(point) {
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
            return 0;
        }
        const latLng = [point.y, point.x];
        this.temporaryPaintPoints.push(latLng);
        L.circleMarker(latLng, {
            radius: 5,
            color: '#f97316',
            weight: 2,
            fillColor: '#fed7aa',
            fillOpacity: 0.95,
            interactive: false,
            className: 'temporary-paint-point'
        }).addTo(this.temporaryPaintLayer);

        if (this.temporaryPaintPoints.length >= 2) {
            if (this.temporaryPaintLine) {
                this.temporaryPaintLine.setLatLngs(this.temporaryPaintPoints);
            } else {
                this.temporaryPaintLine = L.polyline(this.temporaryPaintPoints, {
                    color: '#f97316',
                    weight: 4,
                    opacity: 0.92,
                    dashArray: '10 8',
                    lineCap: 'round',
                    lineJoin: 'round',
                    interactive: false,
                    className: 'temporary-paint-line'
                }).addTo(this.temporaryPaintLayer);
            }
        }
        return this.temporaryPaintPoints.length;
    }

    clearTemporaryPaint() {
        this.temporaryPaintLayer.clearLayers();
        this.temporaryPaintPoints = [];
        this.temporaryPaintLine = null;
    }

    zoomIn(step = 1) {
        this.map.zoomIn(step);
    }

    zoomOut(step = 1) {
        this.map.zoomOut(step);
    }

    getZoomPercentage() {
        const currentZoom = this.map.getZoom();
        const scale = this.map.getZoomScale(currentZoom, this.nativeZoom);
        if (!Number.isFinite(scale)) {
            return 100;
        }
        return scale * 100;
    }

    zoomFromPercentage(percentage) {
        const numeric = Number(percentage);
        if (!Number.isFinite(numeric) || numeric <= 0) {
            return null;
        }
        const scale = numeric / 100;
        if (!Number.isFinite(scale) || scale <= 0) {
            return null;
        }
        const logarithm = typeof Math.log2 === 'function'
            ? Math.log2(scale)
            : Math.log(scale) / Math.LN2;
        if (!Number.isFinite(logarithm)) {
            return null;
        }
        const zoom = this.nativeZoom + logarithm;
        return this.clampZoom(zoom);
    }

    clampZoom(zoom) {
        if (!Number.isFinite(zoom)) {
            return this.map ? this.map.getZoom() : this.nativeZoom;
        }
        return Math.max(this.minZoom, Math.min(this.maxZoom, zoom));
    }

    toPixelCoordinates(latlng) {
        if (!latlng || typeof latlng.lat !== 'number' || typeof latlng.lng !== 'number') {
            return null;
        }
        return { x: latlng.lng, y: latlng.lat };
    }

    logPixelCoordinates(event) {
        const coords = this.toPixelCoordinates(event?.latlng);
        if (!coords) {
            return;
        }
        const x = Math.round(coords.x);
        const y = Math.round(coords.y);
        console.info(`Carte · coordonnées px → x: ${x}, y: ${y}`);
    }

    setAnnotations(annotations = []) {
        this.clearAnnotations();
        if (!Array.isArray(annotations)) {
            return;
        }
        annotations.forEach(annotation => {
            this.addAnnotation(annotation);
        });
    }

    addAnnotation(annotation) {
        if (!annotation || typeof annotation !== 'object') {
            return null;
        }
        const annotationId = this.normalizeAnnotationId(annotation.id);
        if (!annotationId || !Number.isFinite(annotation.x) || !Number.isFinite(annotation.y)) {
            return null;
        }
        const latlng = [annotation.y, annotation.x];
        const color = annotation.color || '#ff8a00';
        const existing = this.annotationMarkers.get(annotationId);
        if (existing) {
            existing.setLatLng(latlng);
            existing.setStyle({
                color,
                fillColor: color
            });
            if (existing.getTooltip()) {
                existing.setTooltipContent(annotation.label || 'Annotation');
            }
            existing.annotation = { ...annotation, id: annotationId };
            return existing;
        }
        const marker = L.circleMarker(latlng, {
            radius: 6,
            color,
            fillColor: color,
            fillOpacity: 0.85,
            weight: 2,
            opacity: 1,
            bubblingMouseEvents: true
        });
        marker.annotation = { ...annotation, id: annotationId };
        marker.bindTooltip(annotation.label || 'Annotation', {
            direction: 'top',
            offset: [0, -8],
            sticky: true,
            className: 'annotation-tooltip'
        });
        marker.on('click', () => {
            const desiredZoom = Math.max(this.map.getZoom(), this.maxZoom - 1);
            this.map.flyTo(latlng, this.clampZoom(Math.min(this.maxZoom, desiredZoom)), { animate: true, duration: 0.6 });
        });
        this.annotationLayer.addLayer(marker);
        this.annotationMarkers.set(annotationId, marker);
        return marker;
    }

    removeAnnotation(annotationId) {
        const normalizedId = this.normalizeAnnotationId(annotationId);
        if (!normalizedId) {
            return;
        }
        const marker = this.annotationMarkers.get(normalizedId);
        if (marker) {
            this.annotationLayer.removeLayer(marker);
            if (typeof marker.remove === 'function') {
                marker.remove();
            }
            this.annotationMarkers.delete(normalizedId);
        }
        this.annotationMarkers.forEach((entry, key) => {
            const entryId = this.normalizeAnnotationId(entry?.annotation?.id);
            if (entryId !== normalizedId) {
                return;
            }
            this.annotationLayer.removeLayer(entry);
            if (typeof entry.remove === 'function') {
                entry.remove();
            }
            this.annotationMarkers.delete(key);
        });
    }

    clearAnnotations() {
        this.annotationMarkers.forEach(marker => {
            this.annotationLayer.removeLayer(marker);
        });
        this.annotationMarkers.clear();
    }

    normalizeAnnotationId(annotationId) {
        if (annotationId === null || annotationId === undefined) {
            return '';
        }
        return String(annotationId).trim();
    }

    setGroups(groups = []) {
        this.clearGroups();
        if (!Array.isArray(groups)) {
            return;
        }
        groups.forEach(group => {
            this.addGroupMarker(group);
        });
    }

    addGroupMarker(group) {
        if (!group || typeof group !== 'object') {
            return null;
        }
        if (!group.id || !Number.isFinite(group.x) || !Number.isFinite(group.y)) {
            return null;
        }
        const latlng = [group.y, group.x];
        const existing = this.groupMarkers.get(group.id);
        if (existing) {
            existing.setLatLng(latlng);
            if (existing.getTooltip()) {
                existing.setTooltipContent(this.buildGroupTooltip(group));
            }
            existing.group = group;
            return existing;
        }
        const marker = L.marker(latlng, {
            icon: this.createGroupIcon(group),
            interactive: true
        });
        marker.group = group;
        marker.bindTooltip(this.buildGroupTooltip(group), {
            direction: 'top',
            offset: [0, -12],
            sticky: true,
            className: 'group-tooltip'
        });
        marker.on('click', () => {
            const desiredZoom = Math.max(this.map.getZoom(), this.maxZoom - 1);
            this.map.flyTo(latlng, this.clampZoom(Math.min(this.maxZoom, desiredZoom)), { animate: true, duration: 0.6 });
        });
        this.groupLayer.addLayer(marker);
        this.groupMarkers.set(group.id, marker);
        return marker;
    }

    removeGroup(groupId) {
        if (!groupId) {
            return;
        }
        const marker = this.groupMarkers.get(groupId);
        if (marker) {
            this.groupLayer.removeLayer(marker);
            this.groupMarkers.delete(groupId);
        }
    }

    clearGroups() {
        this.groupMarkers.forEach(marker => {
            this.groupLayer.removeLayer(marker);
        });
        this.groupMarkers.clear();
    }

    buildGroupTooltip(group) {
        const name = group?.name || group?.id || 'Groupe';
        const members = Array.isArray(group?.members) ? group.members : [];
        const escapeHtml = value => (value || '')
            .toString()
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\"/g, '&quot;')
            .replace(/'/g, '&#39;');
        const normalizeAvatarUrl = value => {
            if (!value || typeof value !== 'string') {
                return '';
            }
            const trimmed = value.trim();
            if (!trimmed) {
                return '';
            }
            if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('/') || trimmed.startsWith('assets/')) {
                return trimmed;
            }
            return '';
        };
        const title = `<div class="group-tooltip-title">${escapeHtml(name)}</div>`;
        if (!members.length) {
            return title;
        }
        const items = members.map(member => {
            const entry = typeof member === 'string' ? { name: member } : (member || {});
            const displayName = entry.name || 'Sans nom';
            const avatarUrl = normalizeAvatarUrl(entry.avatar);
            const type = entry.type === 'character' ? 'Personnage' : (entry.type === 'user' ? 'Utilisateur' : '');
            const avatarMarkup = avatarUrl
                ? `<span class="group-tooltip-avatar" style="background-image: url('${escapeHtml(avatarUrl)}')"></span>`
                : `<span class="group-tooltip-avatar is-placeholder">${escapeHtml(displayName.charAt(0).toUpperCase())}</span>`;
            const badgeMarkup = type
                ? `<span class="group-tooltip-badge">${escapeHtml(type)}</span>`
                : '';
            return `<div class="group-tooltip-member">${avatarMarkup}<span class="group-tooltip-name">${escapeHtml(displayName)}</span>${badgeMarkup}</div>`;
        }).join('');
        return `${title}<div class="group-tooltip-members">${items}</div>`;
    }

    createGroupIcon(group) {
        const name = group?.name || group?.id || 'Groupe';
        const members = Array.isArray(group?.members) ? group.members : [];
        const count = Number.isFinite(group?.memberCount) ? group.memberCount : members.length;
        const wrapper = document.createElement('div');
        wrapper.className = 'group-marker';
        if (group?.color) {
            wrapper.style.setProperty('--group-color', group.color);
        }
        const title = document.createElement('span');
        title.className = 'group-marker-name';
        title.textContent = name;
        const badge = document.createElement('span');
        badge.className = 'group-marker-count';
        badge.textContent = `${count}`;
        wrapper.appendChild(title);
        wrapper.appendChild(badge);
        return L.divIcon({
            html: wrapper.outerHTML,
            className: 'group-marker-icon',
            iconSize: [96, 40],
            iconAnchor: [48, 20]
        });
    }

    createClusterIcon(cluster) {
        const markers = cluster.getAllChildMarkers();
        const total = markers.length;
        const typeCounts = new Map();
        let dominantType = 'default';
        let dominantCount = 0;

        markers.forEach(marker => {
            const type = marker.options?.locationType || 'default';
            const nextValue = (typeCounts.get(type) || 0) + 1;
            typeCounts.set(type, nextValue);
            if (nextValue > dominantCount) {
                dominantCount = nextValue;
                dominantType = type;
            }
        });

        const iconPath = (this.typeData[dominantType] && this.typeData[dominantType].icon) || 'assets/icons/default.png';
        const sizeClass = total >= 50 ? 'cluster-large' : total >= 15 ? 'cluster-medium' : 'cluster-small';

        const html = `
            <div class="cluster-shell">
                <span class="cluster-count">${total}</span>
                <img src="${iconPath}" alt="Icône ${dominantType}" class="cluster-type" />
            </div>
        `;

        return L.divIcon({
            html,
            className: `marker-cluster custom-cluster ${sizeClass}`,
            iconSize: L.point(52, 52)
        });
    }

    createCustomIcon(type) {
        const iconBase = 'assets/icons/';
        const pinSize = [40, 50];
        const pinAnchor = [20, 50];
        const popupAnchor = [0, -40];
        const iconPath = (this.typeData[type] && this.typeData[type].icon) || `${iconBase}default.png`;

        return L.divIcon({
            className: 'custom-marker',
            iconSize: pinSize,
            iconAnchor: pinAnchor,
            popupAnchor,
            html: `
                <div class="marker-container">
                    <svg class="pin-shape" width="40" height="50" viewBox="0 0 40 50" xmlns="http://www.w3.org/2000/svg">
                        <path d="M 20 5 C 32 10, 38 22, 30 36 L 20 48 L 10 36 C 2 22, 8 10, 20 5 Z" fill="white" stroke="black" stroke-width="3" />
                    </svg>
                    <img src="${iconPath}" class="marker-icon" alt="Icône de ${type || 'lieu'}" />
                </div>
            `
        });
    }

    setMarkerHighlight(marker, isActive) {
        const icon = marker?.getElement();
        if (!icon) {
            return;
        }
        icon.classList.toggle('marker-highlight', Boolean(isActive));
    }
}
