#!/usr/bin/env node
// Derived browser snapshot for source tooling; package.json remains authoritative.
const fs = require('node:fs');
const path = require('node:path');
const { versionModule } = require('../server/publication/files');
const { version } = require('../package.json');
fs.writeFileSync(path.join(__dirname, '../js/shared/appVersion.mjs'), versionModule(version));
console.log('Browser version snapshot synchronized from package.json.');
