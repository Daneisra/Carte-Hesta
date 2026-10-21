// Diagnostic only: observe Playwright's original methods without changing their results or timing policy.
const fs = require('node:fs');
const path = require('node:path');
let installed;

function instrument() {
    if (installed) return installed;
    const events = [];
    const observed = new WeakSet();
    const record = (type, data = {}) => events.push({ ms: Number(process.hrtime.bigint() / 1000000n), type, ...data });
    const core = path.dirname(require.resolve('playwright-core/package.json'));
    const { FFBrowser } = require(path.join(core, 'lib/server/firefox/ffBrowser.js'));
    const { FFSession } = require(path.join(core, 'lib/server/firefox/ffConnection.js'));
    record("node-channel", { fd: process.channel?.fd, channelEnvironment: process.env.NODE_CHANNEL_FD, serializationEnvironment: process.env.NODE_CHANNEL_SERIALIZATION_MODE, execArgv: process.execArgv });
    const send = FFSession.prototype.send;
    FFSession.prototype.send = function (method, params) {
        if (['Browser.newPage', 'Browser.removeBrowserContext', 'Page.navigate', 'Page.close'].includes(method)) record('protocol-send', { method, ...params });
        return send.call(this, method, params);
    };
    const dispatch = FFSession.prototype.dispatchMessage;
    FFSession.prototype.dispatchMessage = function (message) {
        if (message.result?.targetId) record('protocol-result-target', { id: message.id, targetId: message.result.targetId });
        if (['Browser.attachedToTarget', 'Browser.detachedFromTarget'].includes(message.method)) record(message.method, message.params);
        return dispatch.call(this, message);
    };
    for (const method of ['_onAttachedToTarget', '_onDetachedFromTarget']) {
        const original = FFBrowser.prototype[method];
        FFBrowser.prototype[method] = function (payload) {
            record(method, { payload, sizeBefore: this._ffPages.size });
            return original.call(this, payload);
        };
    }
    const create = FFBrowser.prototype.doCreateNewContext;
    FFBrowser.prototype.doCreateNewContext = async function (...args) {
        const context = await create.apply(this, args);
        const newPage = context.doCreateNewPage;
        context.doCreateNewPage = async function (...pageArgs) {
            try { return await newPage.apply(this, pageArgs); }
            catch (error) {
                record('internal-newPage-error', { stack: error.stack, targets: [...this._browser._ffPages.keys()], connected: this._browser.isConnected() });
                throw error;
            }
        };
        return context;
    };
    const cp = require('node:child_process');
    const spawn = cp.spawn;
    cp.spawn = function (command, args, options) {
        const child = spawn.call(this, command, args, options);
        if (/firefox(?:\.exe)?$/i.test(command)) {
            record('browser-spawn', { pid: child.pid, args });
            child.stdout?.on('data', data => record('browser-stdout', { text: data.toString().slice(0, 8000) }));
            child.stderr?.on('data', data => record('browser-stderr', { text: data.toString().slice(0, 8000) }));
            child.on('exit', (code, signal) => record('browser-exit', { pid: child.pid, code, signal }));
        }
        return child;
    };
    installed = {
        record,
        save: () => fs.writeFileSync(path.join(process.env.CARTE_TEST_ROOT, 'results', `firefox-events-${process.pid}.json`), JSON.stringify(events, null, 2)),
        observe(browser) {
            if (observed.has(browser)) return;
            observed.add(browser);
            browser.on('disconnected', () => record('browser-disconnected'));
        }
    };
    process.on('exit', installed.save);
    return installed;
}
module.exports = { instrument };
