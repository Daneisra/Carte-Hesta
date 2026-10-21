#!/usr/bin/env node
const { configuration } = require('../server/storage/paths');
const { JsonStore } = require('../server/storage/jsonStore');
const { PublishedMedia, initializeMedia } = require('../server/publication/media');
async function main(args = process.argv.slice(2)) {
    const paths = configuration();
    const store = new JsonStore(paths.data);
    try {
        await store.open(); // Offline operation: refused while the application owns the writer lease.
        if (args.length === 1 && args[0] === 'init') initializeMedia(paths.media);
        else if (args[0] === 'approve' && args.length > 1) await new PublishedMedia(paths.media).approve(args.slice(1));
        else throw new Error('Usage: node tools/publishMedia.js init | approve assets/EXPLICIT_PATH ...');
        console.log('Media publication index updated; existing media bytes preserved.');
    } finally { await store.close(); }
}
if (require.main === module) main().catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
module.exports = { main };
