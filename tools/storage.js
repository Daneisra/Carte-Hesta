#!/usr/bin/env node
// Deliberate offline operations only. Never invoked by startup, tests or deployment implicitly.
const fs = require('node:fs');
const path = require('node:path');
const { configuration, plainPath } = require('../server/storage/paths');
const { JsonStore, initialize, privatePath } = require('../server/storage/jsonStore');
const { initializeMedia } = require('../server/publication/media');

async function main(args = process.argv.slice(2), env = process.env) {
    const config = configuration(env);
    const [command, argument] = args;
    if (args.length > 2) throw new Error('Unexpected storage arguments');
    if (command === 'init' && !argument) {
        // Preflight all new roots. Existing directories, even empty ones, require operator review.
        for (const target of [config.data, config.logs, config.media]) {
            plainPath(target);
            try { await fs.promises.lstat(target); throw new Error('Initialization refuses existing storage'); }
            catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
        await initialize(config.data);
        await fs.promises.mkdir(config.logs, { mode: 0o700 });
        await fs.promises.mkdir(config.media, { mode: 0o700 });
        initializeMedia(config.media);
        console.log('Virgin storage initialized; no administrator created.');
        return;
    }
    if (command === 'unlock' && /^[a-f0-9]{48}$/.test(argument || '')) {
        const target = new JsonStore(config.data).lockPath;
        await privatePath(config.data, true);
        await privatePath(target);
        const lock = JSON.parse(await fs.promises.readFile(target, 'utf8'));
        if (lock.nonce !== argument || !Number.isSafeInteger(lock.pid) || lock.pid <= 0) throw new Error('Lock identity mismatch');
        try { process.kill(lock.pid, 0); throw new Error('Lock owner is still alive'); }
        catch (error) { if (error.code !== 'ESRCH') throw error; }
        await fs.promises.unlink(target);
        console.log('Confirmed stale local lock released; recovery may still be required.');
        return;
    }
    const store = new JsonStore(config.data);
    try {
        if (command === 'recover' && !argument) {
            await store.acquire();
            await store.recover();
            console.log('Pending transaction rolled forward.');
        } else if (command === 'bootstrap-admin' && /^\d{17,20}$/.test(argument || '')) {
            await store.open();
            await store.transaction(async () => {
                const original = await store.read('users');
                const users = Array.isArray(original) ? original : original.users;
                if (users.length) throw new Error('Bootstrap requires an empty user store; existing accounts are never changed');
                const user = { id: `discord:${argument}`, provider: 'discord', discordId: argument, username: '', avatar: null, role: 'admin', groups: [], characters: [], character: null, profile: null, availability: null, apiTokens: [], lastLoginAt: null, lastSeenAt: null };
                await store.write('users', Array.isArray(original) ? [user] : { ...original, users: [user] });
            });
            console.log('Explicit administrator registered; OAuth credentials remain separately configured.');
        } else throw new Error('Usage: node tools/storage.js init | bootstrap-admin DISCORD_ID | unlock LOCK_NONCE | recover');
    } finally { await store.close(); }
}
if (require.main === module) main().catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
module.exports = { main };
