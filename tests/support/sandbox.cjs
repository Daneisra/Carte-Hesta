const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const fixtures = require('../fixtures/application.cjs');
const { storeFile } = require('../../server/storage/jsonStore');
const { buildPublic, metadata } = require('../../server/publication/files');
const { validateMedia } = require('../../server/publication/mediaTypes');

const SOURCE_ROOT = path.resolve(__dirname, '../..');
const MARKER = '.carte-test-sandbox.json';
const PREFIX = 'cartehesta-test-';
const CODE_DIRECTORIES = ['server', 'js'];
const PAGES = ['index.html', 'map/index.html', 'timeline/index.html', 'planning/index.html', 'changelog/index.html', 'geek-unchained/index.html'];
const STYLES = ['style.css', 'editor.css', 'home.css', 'timeline.css', 'planning.css', 'changelog.css', 'admin-panels.css', 'geek-unchained.css', 'assets/hesta-identity.css'];

function isWithin(root, target) {
    const relative = path.relative(root, target);
    return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function assertPlainPath(target) {
    let cursor = path.resolve(target);
    while (true) {
        try {
            if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`Test sandbox refuses links: ${cursor}`);
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        const parent = path.dirname(cursor);
        if (parent === cursor) break;
        cursor = parent;
    }
}

function verifySandbox(root, token) {
    const parent = process.env.CARTE_TEST_PARENT_DIR || fs.realpathSync(os.tmpdir());
    if (!path.isAbsolute(root) || path.dirname(root) !== parent || !path.basename(root).startsWith(PREFIX)) {
        throw new Error('Not an owned test temporary directory');
    }
    assertPlainPath(root);
    const marker = JSON.parse(fs.readFileSync(path.join(root, MARKER), 'utf8'));
    if (!token || marker.token !== token || marker.root !== root || marker.sourceRoot !== SOURCE_ROOT) {
        throw new Error('Invalid test sandbox identity');
    }
    return marker;
}

function createSandbox() {
    // Outside the checkout: neither git nor the existing repo-wide rsync can include test data.
    const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), PREFIX));
    const token = crypto.randomBytes(24).toString('hex');
    const app = path.join(root, 'app');
    const publicDir = path.join(root, 'public');
    const data = path.join(root, 'data');
    const logs = path.join(root, 'logs');
    const mediaDir = path.join(root, 'media');
    const marker = { root, token, sourceRoot: SOURCE_ROOT, ownerPid: process.pid };
    fs.writeFileSync(path.join(root, MARKER), JSON.stringify(marker), { flag: 'wx', mode: 0o600 });
    fs.mkdirSync(app);
    for (const directory of [data, logs, mediaDir, ...['private', 'content', 'locks', 'transactions'].map(name => path.join(data, name))]) fs.mkdirSync(directory, { mode: 0o700 });
    const sourceFiles = [];
    function copyCode(relative) {
        const source = path.join(SOURCE_ROOT, relative);
        assertPlainPath(source);
        const destination = path.join(app, relative);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
        sourceFiles.push(relative);
    }
    function visitCode(relative) {
        const source = path.join(SOURCE_ROOT, relative);
        assertPlainPath(source);
        for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
            const nested = path.join(relative, entry.name);
            if (entry.isDirectory()) visitCode(nested);
            else if (entry.isFile() && /\.(?:js|mjs)$/.test(entry.name)) copyCode(nested);
            else if (!entry.isFile()) throw new Error(`Unexpected entry in code directory: ${nested}`);
        }
    }
    try {
        for (const file of ['server.js', 'package.json', ...PAGES, ...STYLES, 'docs/ASSETS-CREDITS.md']) copyCode(file);
        for (const directory of CODE_DIRECTORIES) visitCode(directory);
        for (const [name, payload] of Object.entries(fixtures.stores)) {
            const target = storeFile(data, name === 'logs/sessions.json' ? 'sessions' : name.replace(/\.json$/, ''));
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, JSON.stringify(payload, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
        }
        buildPublic(app, publicDir);
        const publishedMedia = { version: 1, entries: {} };
        // Generate every media placeholder from bytes defined in fixtures, never from assets/.
        const media = new Set(['assets/map.png', 'assets/icons/test-icon.png', 'assets/images/test-port.png', 'assets/images/Frise/test-founding.png', 'assets/images/Frise/test-expedition.png']);
        for (const relative of sourceFiles) {
            const text = fs.readFileSync(path.join(app, relative), 'utf8');
            for (const match of text.matchAll(/['"]\/?(assets\/[^'"\r\n]+\.(?:png|jpe?g|webp|gif))['"]/gi)) media.add(match[1]);
        }
        for (const relative of media) {
            const target = path.resolve(mediaDir, relative.slice('assets/'.length));
            if (!isWithin(mediaDir, target)) throw new Error('Invalid fixture media path');
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, fixtures.PNG, { flag: 'wx' });
            publishedMedia.entries[relative] = metadata(fixtures.PNG, validateMedia(relative, fixtures.PNG));
        }
        fs.writeFileSync(path.join(mediaDir, '.published-media.json'), JSON.stringify(publishedMedia), { flag: 'wx', mode: 0o600 });
        fs.mkdirSync(path.join(root, 'results'));
        fs.mkdirSync(path.join(root, 'tmp'));
        fs.mkdirSync(path.join(root, 'home', 'AppData', 'Roaming'), { recursive: true });
        fs.mkdirSync(path.join(root, 'home', 'AppData', 'Local'), { recursive: true });
        fs.writeFileSync(path.join(root, 'copied-code.json'), JSON.stringify(sourceFiles, null, 2));
        return { ...marker, app, publicDir, data, logs, media: mediaDir };
    } catch (error) {
        removeSandbox(root, token);
        throw error;
    }
}

function removeSandbox(root, token) {
    verifySandbox(root, token);
    // Check every entry before recursive deletion, including Windows junctions.
    function inspect(target) {
        assertPlainPath(target);
        if (fs.lstatSync(target).isDirectory()) {
            for (const name of fs.readdirSync(target)) inspect(path.join(target, name));
        }
    }
    inspect(root);
    fs.rmSync(root, { recursive: true });
}

// Only synthetic policy bytes are created, inside each owned test sandbox.
function installFirefoxUpdatePolicy(browserDirectory, origin) {
    const endpoint = new URL(origin);
    if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !endpoint.port || endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash) throw new Error('Explicit owned loopback origin required');
    assertPlainPath(browserDirectory);
    if (!fs.statSync(browserDirectory).isDirectory()) throw new Error('Expected Firefox directory');
    const distribution = path.join(browserDirectory, 'distribution');
    assertPlainPath(distribution);
    if (!fs.existsSync(distribution)) fs.mkdirSync(distribution);
    const policy = path.join(distribution, 'policies.json');
    assertPlainPath(policy);
    const expected = { policies: { DisableAppUpdate: true, AppUpdateURL: origin + '/_firefox/updates.xml' } };
    fs.writeFileSync(policy, JSON.stringify(expected) + '\n', { flag: 'wx', mode: 0o600 });
    if (JSON.stringify(JSON.parse(fs.readFileSync(policy, 'utf8'))) !== JSON.stringify(expected)) throw new Error('Firefox update policy verification failed');
    return { updateDisabled: true, existingPolicyOverwritten: false };
}

function cleanEnvironment(sandbox, extra = {}, inherited = process.env) {
    const firefoxPolicy = sandbox.firefoxPolicy || path.join(sandbox.root, 'tmp', 'distribution', 'policies.json');
    if (!isWithin(path.join(sandbox.root, 'tmp'), firefoxPolicy)) throw new Error('Firefox policy must stay in the owned sandbox');
    assertPlainPath(firefoxPolicy);
    const env = {};
    // OS essentials only. No inherited NODE_OPTIONS, proxies, OAuth, tokens or application config.
    for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'LANG']) {
        if (inherited[key] !== undefined) env[key] = inherited[key];
    }
    Object.assign(env, {
        HOME: path.join(sandbox.root, 'home'), USERPROFILE: path.join(sandbox.root, 'home'),
        APPDATA: path.join(sandbox.root, 'home', 'AppData', 'Roaming'), LOCALAPPDATA: path.join(sandbox.root, 'home', 'AppData', 'Local'),
        MOZ_CRASHREPORTER_DISABLE: '1', MOZ_DISABLE_NONLOCAL_CONNECTIONS: '1',
        PLAYWRIGHT_FIREFOX_POLICIES_JSON: firefoxPolicy,
        TMP: path.join(sandbox.root, 'tmp'), TEMP: path.join(sandbox.root, 'tmp'), TMPDIR: path.join(sandbox.root, 'tmp'),
        CARTE_PUBLIC_DIR: sandbox.publicDir, CARTE_DATA_DIR: sandbox.data, CARTE_LOG_DIR: sandbox.logs, CARTE_MEDIA_DIR: sandbox.media,
        NODE_ENV: 'test', TZ: 'Europe/Warsaw', CI: inherited.CI ? '1' : '',
        CARTE_TEST_ROOT: sandbox.root, CARTE_TEST_TOKEN: sandbox.token, CARTE_TEST_SOURCE_ROOT: SOURCE_ROOT,
        CARTE_TEST_PARENT_DIR: path.dirname(sandbox.root),
        GIT_CEILING_DIRECTORIES: sandbox.root,
        NODE_OPTIONS: `--require="${path.join(__dirname, 'processBoundary.cjs').split(path.sep).join('/')}"`,
        ...extra
    });
    return env;
}

module.exports = { SOURCE_ROOT, MARKER, isWithin, assertPlainPath, createSandbox, verifySandbox, removeSandbox, cleanEnvironment, installFirefoxUpdatePolicy };
