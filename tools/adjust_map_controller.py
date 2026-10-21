from pathlib import Path

path = Path('js/mapController.js')
text = path.read_text(encoding='utf-8')

def replace_block(source, new):
    global text
    idx = text.find(source)
    if idx == -1:
        raise SystemExit(f'block starting with {source!r} not found')
    end_idx = text.find('\n    ', idx + len(source))
    depth = 0
    for pos in range(idx, len(text)):
        if text[pos] == '{':
            depth += 1
        elif text[pos] == '}':
            depth -= 1
            if depth == 0:
                end_block = pos + 1
                break
    else:
        raise SystemExit('matching brace not found')
    text = text[:idx] + new + text[end_block:]

replace_block('    setEntryVisibility', "    setEntryVisibility(entry, isVisible) {\n        if (!entry || !entry.marker) {\n            return;\n        }\n\n        if (isVisible) {\n            if (!entry.visible) {\n                this.addMarkerToLayer(entry.marker);\n            }\n        } else {\n            if (entry.visible) {\n                this.removeMarkerFromLayers(entry.marker);\n            }\n            if (this.selectedEntry === entry) {\n                this.selectedEntry = null;\n            }\n        }\n\n        entry.visible = Boolean(isVisible);\n    }\n\n")

replace_block('    clearEntries', "    clearEntries() {\n        this.entries.forEach(entry => {\n            if (entry.marker) {\n                this.removeMarkerFromLayers(entry.marker);\n            }\n        });\n\n        this.markerLayer.clearLayers();\n        if (this.clusterGroup) {\n            this.clusterGroup.clearLayers();\n        }\n\n        this.entries = [];\n        this.selectedEntry = null;\n    }\n\n")

insertion = "    addMarkerToLayer(marker) {\n        if (!marker) {\n            return;\n        }\n\n        if (this.clusteringEnabled) {\n            if (!this.clusterGroup) {\n                this.clusterGroup = L.markerClusterGroup({\n                    showCoverageOnHover: false,\n                    spiderfyOnMaxZoom: true,\n                    maxClusterRadius: 80\n                });\n            }\n            if (!this.map.hasLayer(this.clusterGroup)) {\n                this.map.addLayer(this.clusterGroup);\n            }\n            this.clusterGroup.addLayer(marker);\n        } else {\n            this.markerLayer.addLayer(marker);\n        }\n    }\n\n    removeMarkerFromLayers(marker) {\n        if (!marker) {\n            return;\n        }\n\n        if (this.markerLayer.hasLayer(marker)) {\n            this.markerLayer.removeLayer(marker);\n        }\n        if (this.clusterGroup && this.clusterGroup.hasLayer(marker)) {\n            this.clusterGroup.removeLayer(marker);\n        }\n    }\n\n    setClusteringEnabled(isEnabled) {\n        const nextState = Boolean(isEnabled);\n        if (nextState === this.clusteringEnabled) {\n            return;\n        }\n\n        this.clusteringEnabled = nextState;\n\n        if (this.clusteringEnabled) {\n            if (!this.clusterGroup) {\n                this.clusterGroup = L.markerClusterGroup({\n                    showCoverageOnHover: false,\n                    spiderfyOnMaxZoom: true,\n                    maxClusterRadius: 80\n                });\n            }\n            if (!this.map.hasLayer(this.clusterGroup)) {\n                this.map.addLayer(this.clusterGroup);\n            }\n            this.entries.forEach(entry => {\n                if (!entry.marker || !entry.visible) {\n                    return;\n                }\n                this.markerLayer.removeLayer(entry.marker);\n                this.clusterGroup.addLayer(entry.marker);\n            });\n        } else if (this.clusterGroup) {\n            this.entries.forEach(entry => {\n                if (!entry.marker || !entry.visible) {\n                    return;\n                }\n                this.clusterGroup.removeLayer(entry.marker);\n                this.markerLayer.addLayer(entry.marker);\n            });\n            if (this.map.hasLayer(this.clusterGroup)) {\n                this.map.removeLayer(this.clusterGroup);\n            }\n        }\n    }\n\n    isClusteringEnabled() {\n        return this.clusteringEnabled;\n    }\n\n    getMapState() {\n        const center = this.map.getCenter();\n        return {\n            center: [center.lat, center.lng],\n            zoom: this.map.getZoom()\n        };\n    }\n\n    setMapState(state = {}) {\n        if (!state) {\n            return;\n        }\n        const { center, zoom } = state;\n        const hasCenterArray = Array.isArray(center) && center.length === 2 && center.every(val => typeof val === 'number');\n        const hasCenterObject = center && typeof center.lat === 'number' && typeof center.lng === 'number';\n        const targetCenter = hasCenterArray ? center : hasCenterObject ? [center.lat, center.lng] : null;\n        const targetZoom = typeof zoom === 'number' ? zoom : null;\n\n        if (targetCenter) {\n            this.map.setView([targetCenter[0], targetCenter[1]], targetZoom ?? this.map.getZoom(), { animate: false });\n        } else if (targetZoom !== null) {\n            this.map.setZoom(targetZoom, { animate: false });\n        }\n    }\n\n    notifyMapStateChange() {\n        if (!this.mapStateListeners || this.mapStateListeners.size === 0) {\n            return;\n        }\n        const snapshot = this.getMapState();\n        this.mapStateListeners.forEach(callback => {\n            try {\n                callback(snapshot);\n            } catch (error) {\n                console.error('Erreur lors de la notification de l\'état de la carte :', error);\n            }\n        });\n    }\n\n    onMapStateChange(callback) {\n        if (typeof callback === 'function') {\n            this.mapStateListeners.add(callback);\n        }\n    }\n\n"\n
marker = '    setMarkerHighlight'
idx = text.find(marker)
if idx == -1:
    raise SystemExit('setMarkerHighlight not found')
text = text[:idx] + insertion + text[idx:]

path.write_text(text, encoding='utf-8')
