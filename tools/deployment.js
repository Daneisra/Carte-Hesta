#!/usr/bin/env node
// OFFLINE ONLY: no SSH, rsync, PM2, Nginx reload, deployment or secret loading.
const { build, verify } = require('./deployment/release');
const { capture, verifySnapshot, restore } = require('./deployment/snapshot');
const { stageHistorical, stageMedia, checkData, prepareAndVerify } = require('./deployment/migration');
const { syncStage } = require('./deployment/stage');
const { readPlain } = require('../server/publication/files');
async function main(args = process.argv.slice(2)) {
    const [command, ...a] = args;
    const document = file => JSON.parse(readPlain(file));
    if (command === 'package' && a.length === 3) return build(...a);
    if (command === 'verify' && a.length === 3) return verify(...a);
    if (command === 'stage-code' && a.length === 4) return syncStage(...a);
    if (command === 'snapshot' && a.length === 3 && a[2] === '--writers-stopped') return capture(document(a[0]), a[1], { writersStopped: true });
    if (command === 'verify-snapshot' && a.length === 2) return verifySnapshot(...a);
    if (command === 'restore' && a.length === 3) return restore(...a);
    if (command === 'stage-data' && a.length === 4) return stageHistorical(document(a[0]), a[1], a[2], a[3]);
    if (command === 'stage-media' && a.length === 4) return stageMedia(document(a[0]), a[1], a[2], a[3]);
    if (command === 'check-data' && a.length === 1) { const result = await checkData(a[0]); return { stores: result.stores, valid: true }; }
    if (command === 'prepare-data' && a.length === 0) return prepareAndVerify(process.env);
    throw Error('Offline commands: package SOURCE NEW_DEST REVISION | verify RELEASE REVISION SHA256 | stage-code RELEASE NEW_STAGE REVISION SHA256 | snapshot ROOTS_JSON NEW_DEST --writers-stopped | verify-snapshot SNAPSHOT SHA256 | restore SNAPSHOT NEW_QUARANTINE SHA256 | stage-data PLAN_JSON NEW_DATA SNAPSHOT SHA256 | stage-media PLAN_JSON NEW_MEDIA SNAPSHOT SHA256 | check-data DATA | prepare-data');
}
if (require.main === module) main().then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.code || 'E_OFFLINE_PREPARATION', error instanceof SyntaxError ? 'Invalid JSON; content withheld' : error.message); process.exitCode = 1; });
module.exports = { main };
