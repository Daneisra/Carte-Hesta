import { initializePermissionsPanel } from './ui/permissionsPanel.js';
import { DataService } from './dataService.js';
import { MapController } from './mapController.js';
import { UiController } from './uiController.js';
import { PreferencesService } from './preferencesService.js';
import { startTimer, endTimer, logMetric } from './utils/metrics.js';

const dataService = new DataService();
const preferencesService = new PreferencesService();
let mapController = null;
let uiController = null;

const summarizeDatasets = ({ typeData, locationsData }) => {
    const continents = Object.keys(locationsData || {}).length;
    const locations = Object.values(locationsData || {}).reduce(
        (accumulator, list) => accumulator + (Array.isArray(list) ? list.length : 0),
        0
    );
    const types = Object.keys(typeData || {}).length;
    return { continents, locations, types };
};

async function initialize() {
    const bootstrapTimer = startTimer('app.bootstrap');
    let summary = null;

    try {
        const mapTimer = startTimer('map.setup');
        try {
            mapController = new MapController({ imageUrl: 'assets/map.png' });
            uiController = new UiController({ mapController, preferences: preferencesService });
            endTimer(mapTimer, { status: 'ok' });
        } catch (setupError) {
            endTimer(mapTimer, { status: 'error', error: setupError?.message || String(setupError) });
            throw setupError;
        }

        const dataTimer = startTimer('data.load');
        let datasets = null;
        try {
            datasets = await dataService.load();
            summary = summarizeDatasets(datasets);
            endTimer(dataTimer, { status: 'ok', ...summary });
        } catch (dataError) {
            endTimer(dataTimer, { status: 'error', error: dataError?.message || String(dataError) });
            throw dataError;
        }

        const uiTimer = startTimer('ui.initialize');
        try {
            uiController.initialize(datasets);
            endTimer(uiTimer, { status: 'ok', ...summary });
        } catch (uiError) {
            endTimer(uiTimer, { status: 'error', error: uiError?.message || String(uiError) });
            throw uiError;
        }

        if (summary) {
            logMetric('app.ready', summary);
        }
        endTimer(bootstrapTimer, { status: 'ok', ...summary });
    } catch (error) {
        endTimer(bootstrapTimer, { status: 'error', error: error?.message || String(error) });
        console.error("Erreur lors de l'initialisation de la carte :", error);
        const sidebar = document.getElementById('sidebar');
        if (sidebar) {
            sidebar.innerHTML = '';
            const message = document.createElement('p');
            message.className = 'error-message';
            message.textContent = 'Impossible de charger les données de la carte. Réessayez plus tard.';
            sidebar.appendChild(message);
        }
    }
}

document.addEventListener('DOMContentLoaded', initialize);
document.addEventListener('DOMContentLoaded', initializePermissionsPanel);
