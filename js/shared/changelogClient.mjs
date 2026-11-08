import { mergeChangelog, normalizeEntries } from './changelogData.mjs';

export async function loadChangelog({ limit = 50, complete = false, config, fetcher = fetch } = {}) {
    try {
        const entries = [];
        let offset = 0;
        let source = 'code';
        do {
            const response = await fetcher(`/api/changelog?limit=${limit}&offset=${offset}`, { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const payload = await response.json();
            const page = normalizeEntries(payload?.entries);
            if (!page.length && (offset === 0 || payload?.hasMore)) throw new Error('Changelog incomplet');
            entries.push(...page);
            source = payload?.source === 'config' || payload?.source === 'code+config' ? 'code+config' : 'code';
            if (!complete || !payload?.hasMore) break;
            if (!Number.isSafeInteger(payload.nextOffset) || payload.nextOffset !== offset + page.length) throw new Error('Pagination invalide');
            offset = payload.nextOffset;
        } while (true);
        return { entries, source };
    } catch (_error) {
        try {
            if (!config) {
                const response = await fetcher('/assets/site-config.json', { cache: 'no-store' });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                config = await response.json();
            }
            return { entries: mergeChangelog(config?.changelog), source: 'code+config', fallback: true };
        } catch (_fallbackError) {
            return { entries: mergeChangelog(), source: 'code', fallback: true };
        }
    }
}
