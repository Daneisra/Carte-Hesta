#!/usr/bin/env node
const { buildPublic } = require('../server/publication/files');
if (require.main === module) {
    const [source, destination, ...rest] = process.argv.slice(2);
    if (!source || !destination || rest.length) { console.error('Usage: node tools/buildPublic.js ABSOLUTE_SOURCE ABSOLUTE_NEW_DESTINATION'); process.exitCode = 1; }
    else {
        try { const result = buildPublic(source, destination); console.log(`Public code artifact: ${Object.keys(result.entries).length} approved resources; media published separately.`); }
        catch (error) { console.error(error.message); process.exitCode = 1; }
    }
}
