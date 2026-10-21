const fs = require('node:fs');
const path = require('node:path');

const within = (root, target) => {
    const relative = path.relative(root, target);
    return !relative || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
};
function plainPath(target) {
    for (let cursor = path.resolve(target); ; cursor = path.dirname(cursor)) {
        try {
            if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error('Storage paths must not contain links');
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (path.dirname(cursor) === cursor) break;
    }
}
function configuration(env = process.env, code = path.resolve(__dirname, '../..')) {
    const result = { code };
    for (const [key, variable] of Object.entries({ public: 'CARTE_PUBLIC_DIR', data: 'CARTE_DATA_DIR', logs: 'CARTE_LOG_DIR', media: 'CARTE_MEDIA_DIR' })) {
        if (!env[variable] || !path.isAbsolute(env[variable])) throw new Error(`${variable} must be an explicit absolute path`);
        result[key] = path.resolve(env[variable]);
    }
    const values = Object.values(result);
    for (let i = 0; i < values.length; i++) {
        plainPath(values[i]);
        for (let j = i + 1; j < values.length; j++) {
            if (within(values[i], values[j]) || within(values[j], values[i])) throw new Error('Code, public, data, media and logs must be separate directories');
        }
    }
    if (env.CARTE_ENV_FILE) {
        if (env.NODE_ENV === 'test' || env.CARTE_TEST_ROOT) throw new Error('Secret files are forbidden in tests');
        if (!path.isAbsolute(env.CARTE_ENV_FILE)) throw new Error('CARTE_ENV_FILE must be absolute');
        const secret = path.resolve(env.CARTE_ENV_FILE);
        plainPath(secret);
        if (values.some(root => within(root, secret))) throw new Error('Secret file must be outside application/storage/public roots');
        result.secretFile = secret;
    }
    return result;
}
function loadExplicitSecrets(config, env = process.env) {
    if (!config.secretFile) return;
    const stat = fs.statSync(config.secretFile);
    if (!stat.isFile() || (process.platform !== 'win32' && (stat.mode & 0o077))) throw new Error('Secret file requires private permissions');
    // No interpolation, executable directives or implicit file discovery.
    const entries = fs.readFileSync(config.secretFile, 'utf8').split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith('#'));
    for (const line of entries) {
        const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
        if (!match || match[1].startsWith('CARTE_') || ['NODE_OPTIONS', 'NODE_PATH'].includes(match[1])) throw new Error('Invalid explicit secret configuration');
    }
    for (const line of entries) {
        const index = line.indexOf('=');
        const key = line.slice(0, index);
        if (!(key in env)) env[key] = line.slice(index + 1);
    }
}
module.exports = { configuration, loadExplicitSecrets, plainPath, within };
