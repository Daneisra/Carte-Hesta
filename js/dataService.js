import { validateDataset } from './shared/locationValidation.mjs';

const DEFAULT_TYPES_URL = 'assets/types.json';
const DEFAULT_LOCATIONS_URL = 'assets/locations.json';

export class DataService {
    constructor({ typesUrl = DEFAULT_TYPES_URL, locationsUrl = DEFAULT_LOCATIONS_URL } = {}) {
        this.typesUrl = typesUrl;
        this.locationsUrl = locationsUrl;
    }

    async load() {
        const [typeData, rawLocations] = await Promise.all([
            this.fetchJson(this.typesUrl),
            this.fetchJson(this.locationsUrl)
        ]);

        const { normalized: locationsData, issues } = validateDataset(rawLocations, { typeMap: typeData });
        this.reportDatasetIssues(issues);

        return { typeData, locationsData, issues };
    }

    async fetchJson(url) {
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`Impossible de charger la ressource : ${url} (${response.status})`);
        }
        return response.json();
    }

    reportDatasetIssues(issues = []) {
        if (!issues.length) {
            console.info('Validation des données de carte : OK');
            return;
        }
        const errors = issues.filter(issue => issue.level === 'error');
        const warnings = issues.filter(issue => issue.level === 'warning');
        console.group('Validation des données de carte');
        errors.forEach(issue => console.error(issue.message));
        warnings.forEach(issue => console.warn(issue.message));
        console.groupEnd();
    }
}
