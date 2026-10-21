#!/usr/bin/env node
// READ-ONLY Git inspection + local metadata simulation. No rm/add/commit/push/apply mode.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { plainPath, within } = require('../server/storage/paths');
const { readIndex, auditIndex } = require('./auditTrackedPaths');
const { BACKEND, OPS } = require('./deployment/release');
const STATIC_FILES = require('../server/publication/staticFiles');
const LEGACY = require('./deployment/legacyTrackedPaths.json');
const digest = b => crypto.createHash('sha256').update(b).digest('hex');
function category(name) {
    if (['assets/users.json', 'assets/groups.json', 'assets/planning.json', 'assets/annotations.json'].includes(name)) return 'private-persistent';
    if (['assets/locations.json', 'assets/types.json', 'assets/timeline.json', 'assets/site-config.json'].includes(name)) return 'editable-content-unqualified';
    if (name === 'assets/logs/locations-audit.jsonl') return 'private-journal';
    if (/^assets\/audio\/[^/]+\.mp3$/.test(name)) return 'unapproved-audio';
    if (/^assets\/(?:home|icons|images)\/.+\.(?:png|jpe?g)$/i.test(name) || ['assets/map.png', 'assets/logo.png'].includes(name)) return 'unapproved-image';
    throw Error('Legacy entry requires review; code/unknown paths are never proposed for removal');
}
function localMetadata(root, relative) {
    const target = path.resolve(root, relative);
    if (!within(root, target) || target === root) throw Error('Metadata path escapes checkout');
    plainPath(target);
    try {
        const st = fs.lstatSync(target, { bigint: true });
        return { present: true, plainFile: st.isFile(), size: String(st.size), mtimeNs: String(st.mtimeNs), birthtimeNs: String(st.birthtimeNs), dev: String(st.dev), ino: String(st.ino), nlink: String(st.nlink) };
    } catch (error) { if (error.code === 'ENOENT') return { present: false }; throw error; }
}
function prepare(root, output, { legacy = LEGACY, env = process.env } = {}) {
    root = path.resolve(root);
    if (!output || !path.isAbsolute(output) || !within(path.join(root, 'test-results'), output) || output === path.join(root, 'test-results')) throw Error('New explicit metadata directory under test-results required');
    plainPath(root); plainPath(output);
    const gitEnv = { ...env, GIT_OPTIONAL_LOCKS: '0' };
    const git = args => execFileSync('git', ['-c', 'core.fsmonitor=false', ...args], { cwd: root, env: gitEnv, windowsHide: true });
    const indexPath = path.resolve(root, git(['rev-parse', '--git-path', 'index']).toString('utf8').trim());
    plainPath(indexPath);
    if (fs.existsSync(indexPath + '.lock')) throw Error('Concurrent/stale Git index lock requires review');
    const indexBytes = fs.readFileSync(indexPath); // Index metadata only; never reads a working dataset/blob.
    const entries = readIndex(root, gitEnv);
    const audit = auditIndex(entries);
    if (audit.unsafeEntries.length) throw Error('Conflicted, linked or submodule index entries require review');
    if (!Array.isArray(legacy) || new Set(legacy).size !== legacy.length) throw Error('Invalid legacy inventory');
    const intended = legacy.map(name => ({ path: name, category: category(name) }));
    const tracked = new Set(entries.map(e => e.path));
    const planned = intended.filter(e => tracked.has(e.path));
    const notTracked = intended.filter(e => !tracked.has(e.path));
    const plannedNames = new Set(planned.map(e => e.path));
    const preserved = entries.filter(e => !plannedNames.has(e.path));
    const required = [...new Set([...STATIC_FILES, ...BACKEND, ...OPS.map(n => `ops/${n}`), '.gitignore', '.github/workflows/ci.yml', '.github/workflows/deploy.yml'])].sort();
    if (required.some(name => plannedNames.has(name))) throw Error('Application code included in removal plan');
    const metadata = Object.fromEntries(planned.map(e => [e.path, localMetadata(root, e.path)]));
    const simulation = {
        metadataOnly: true, indexChanged: false, filesDeleted: false, backupVerified: false,
        backupRequirement: 'Separate private local backup of the actual files must be confirmed before using the proposed command. index.before is NOT a dataset backup.',
        initiallyTracked: entries.length, proposedRemovals: planned.length, preservedTracked: preserved.length,
        missingLocalFiles: Object.keys(metadata).filter(n => !metadata[n].present || !metadata[n].plainFile),
        requiredButUntracked: required.filter(n => !tracked.has(n)),
        notTrackedInLegacy: notTracked, categories: Object.fromEntries([...new Set(planned.map(e => e.category))].map(c => [c, planned.filter(e => e.category === c).length])),
        auditBefore: audit,
        // Pure set simulation; no Git rm, including --dry-run, runs on the real index here.
        predictedAfterWithCurrentLegacyExemptions: auditIndex(preserved),
        commandNotExecuted: { executable: 'git', cwd: root, args: ['--literal-pathspecs', '-c', 'core.fsmonitor=false', 'rm', '--cached', `--pathspec-from-file=${path.join(output, 'removal-paths.nul')}`, '--pathspec-file-nul'] }
    };
    if (digest(fs.readFileSync(indexPath)) !== digest(indexBytes)) throw Error('Git index changed while auditing');
    fs.mkdirSync(output, { mode: 0o700 });
    const json = (name, data) => fs.writeFileSync(path.join(output, name), JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    json('initial-index.json', { root, indexSha256: digest(indexBytes), entries, stagedNameStatus: git(['diff', '--cached', '--no-renames', '--name-status', '-z']).toString('utf8') });
    json('initial-status.json', { porcelainV1Z: git(['status', '--porcelain=v1', '-z', '--untracked-files=no', '--ignore-submodules=all']).toString('utf8') });
    json('planned-removals.json', planned);
    json('local-metadata.before.json', metadata);
    json('simulation.json', simulation);
    fs.writeFileSync(path.join(output, 'index.before'), indexBytes, { flag: 'wx', mode: 0o600 });
    fs.writeFileSync(path.join(output, 'removal-paths.nul'), planned.length ? planned.map(e => e.path).join('\0') + '\0' : '', { flag: 'wx', mode: 0o600 });
    return { output, proposedRemovals: planned.length, initiallyTracked: entries.length, indexChanged: false, backupVerified: false, categories: simulation.categories, requiredButUntracked: simulation.requiredButUntracked.length };
}
if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.length !== 1) { console.error('Usage: node tools/prepareGitCleanup.js ABSOLUTE_NEW_METADATA_DIR_UNDER_TEST_RESULTS'); process.exitCode = 1; }
    else { try { console.log(JSON.stringify(prepare(path.resolve(__dirname, '..'), args[0]), null, 2)); } catch (error) { console.error(error.message); process.exitCode = 1; } }
}
module.exports = { prepare, category, localMetadata };
