#!/usr/bin/env node
// Explicit offline schema preparation only; never called at startup or during deployment.
const fs = require('node:fs');
const path = require('node:path');
const { configuration, plainPath } = require('../server/storage/paths');
const { JsonStore, names } = require('../server/storage/jsonStore');
const { emptyPermissions } = require('../server/security/schema');

async function main(args = process.argv.slice(2), env = process.env) {
    if (args.length !== 1 || args[0] !== 'prepare-v1') throw new Error('Usage: node tools/migratePermissions.js prepare-v1');
    const config = configuration(env);
    const store = new JsonStore(config.data);
    await store.acquire();
    try {
        plainPath(store.journalPath);
        try { await fs.promises.lstat(store.journalPath); throw new Error('Pending transaction requires explicit recovery'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        // Validate existing stores before introducing the new schema; never normalize or rewrite them.
        for (const name of names.filter(name => name !== 'permissions')) await store.raw(name);
        try {
            await store.raw('permissions');
            return { version: 1, created: false };
        } catch (error) { if (error.code !== 'E_STORAGE_MISSING') throw error; }
        const target = store.file('permissions');
        plainPath(target);
        const handle = await fs.promises.open(target, 'wx', 0o600);
        try { await handle.writeFile(JSON.stringify(emptyPermissions(), null, 2) + '\n', 'utf8'); await handle.sync(); }
        finally { await handle.close(); }
        if (process.platform !== 'win32') {
            const directory = await fs.promises.open(path.dirname(target), 'r');
            try { await directory.sync(); } finally { await directory.close(); }
        }
        return { version: 1, created: true };
    } finally { await store.close(); }
}
if (require.main === module) main().then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
module.exports = { main };
