const path = require('node:path');
const { JsonStore } = require('../../server/storage/jsonStore');
const [directory, mode] = process.argv.slice(2);
const store = new JsonStore(directory, {
    beforeRename(target) {
        if (mode === 'crash' && path.basename(target) === 'groups.json') process.exit(77);
    }
});
(async () => {
    await store.open();
    if (mode === 'crash') {
        await store.transaction(async () => {
            await store.write('users', [{ id: 'manual:synthetic', role: 'user' }]);
            await store.write('groups', [{ id: 'synthetic-group' }]);
        });
    }
    await store.close();
})().catch(error => { console.log(error.code); process.exitCode = error.code === 'E_STORAGE_LOCKED' ? 23 : 1; });
