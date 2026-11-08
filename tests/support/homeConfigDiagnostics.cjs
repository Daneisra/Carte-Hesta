const { verifySandbox } = require('./sandbox.cjs');
const fs = require('node:fs');

// Only the owned synthetic home editor is observed; no headers, cookies or tokens are recorded.
async function observeHomeConfig(page, testInfo, { watchWrites = false } = {}) {
    verifySandbox(process.env.CARTE_TEST_ROOT, process.env.CARTE_TEST_TOKEN);
    const events = [];
    const requests = new Map();
    const responses = [];
    const record = (phase, value) => events.push({ phase, value });
    await page.addInitScript(({ watchWrites }) => {
        window.__homeEditorDiagnostics = [];
        const record = (kind, extra = {}) => {
            const editor = document.getElementById('admin-home-changelog');
            window.__homeEditorDiagnostics.push({ kind, at: performance.now(), value: editor?.value,
                active: document.activeElement?.id, ...extra });
        };
        // Optional write-stack observation for the controlled loading experiment only.
        if (watchWrites) {
            const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
            Object.defineProperty(HTMLTextAreaElement.prototype, 'value', {
                ...descriptor,
                set(value) {
                    descriptor.set.call(this, value);
                    if (this.id === 'admin-home-changelog') record('value-set', { stack: new Error().stack });
                }
            });
        }
        for (const kind of ['beforeinput', 'input', 'change', 'click']) {
            document.addEventListener(kind, event => {
                if (['admin-home-changelog', 'admin-home-save'].includes(event.target.id)) record(kind, { target: event.target.id });
            }, true);
        }
    }, { watchWrites });
    const onRequest = request => {
        if (new URL(request.url()).pathname !== '/api/admin/home-config') return;
        const id = requests.size + 1;
        requests.set(request, id);
        const body = request.postDataJSON();
        record('request', { id, method: request.method(), path: new URL(request.url()).pathname, body,
            titleLengths: body?.config?.changelog?.map(entry => [...String(entry.title || '')].length) });
    };
    const onResponse = response => {
        const id = requests.get(response.request());
        if (!id) return;
        responses.push((async () => {
            try { record('response', { id, status: response.status(), body: await response.json() }); }
            catch (error) { record('response-error', { id, error: error.message }); }
        })());
    };
    page.on('request', onRequest);
    page.on('response', onResponse);
    const snapshot = async phase => {
        const value = await page.evaluate(() => ({
            value: document.getElementById('admin-home-changelog')?.value,
            active: document.activeElement?.id,
            status: document.getElementById('admin-home-status')?.textContent,
            events: window.__homeEditorDiagnostics
        }));
        record(phase, value);
        return value;
    };
    return {
        record, snapshot,
        async finish() {
            try { await snapshot('final-form'); } catch (error) { record('snapshot-error', error.message); }
            try { record('final-config', await (await page.request.get('/api/admin/home-config')).json()); }
            catch (error) { record('config-error', error.message); }
            await Promise.all(responses);
            page.off('request', onRequest); page.off('response', onResponse);
            const file = testInfo.outputPath('synthetic-home-config.json');
            fs.writeFileSync(file, JSON.stringify(events, null, 2), { flag: 'wx' });
            await testInfo.attach('synthetic-home-config', { path: file, contentType: 'application/json' });
        }
    };
}
module.exports = { observeHomeConfig };
