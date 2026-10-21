const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { allowed, verify, verifyLocalDependencies } = require('../../tools/verifyLinuxContext');
const { prepare } = require('../../tools/prepareFirefoxLinuxContext');
const { removeSandbox } = require('../support/sandbox.cjs');
const { digest } = require('../../server/publication/files');

test('Linux context allowlist refuses secrets, real datasets/media, Git state and malformed paths', () => {
    for (const name of ['.env', 'tests/fixtures/.env.cjs', 'assets/users.json', 'assets/map.png', '.git/index', 'test-results/results.json', 'tests/fixtures/users.json', 'tests/../server.js', '/absolute', 'C:/absolute', 'tools/unknown.js', 'tests\\escape.cjs']) assert.equal(allowed(name), false, name);
    for (const name of ['server.js', 'assets/hesta-identity.css', 'tests/fixtures/application.cjs', '.github/workflows/ci.yml', 'tools/auditTrackedPaths.js']) assert.equal(allowed(name), true, name);
});

test('independent context verifies exact files/checksum and rejects tampering, hidden additions and unapproved entries', () => {
    const result = prepare({ e1: true }); const { sandbox, context, manifestSha256 } = result;
    try {
        const original = verify(context, manifestSha256); assert.equal(original.linuxExecuted, false); assert.equal(original.files, result.manifest.length);
        assert(result.dependencies.edges.some(e => e.from === 'tests/deployment/git-preflight.test.cjs' && e.to === 'tools/gitCleanupPreflight.js'));
        assert(!require('../../tools/deployment/release').BACKEND.includes('tools/gitCleanupPreflight.js'));
        // A structurally valid export still fails if a test imports an omitted module.
        const dependencyTest = path.join(context, 'tests/deployment/git-preflight.test.cjs');
        const dependencyBytes = fs.readFileSync(dependencyTest);
        fs.appendFileSync(dependencyTest, '\nrequire("../../tools/not-exported.js");\n');
        assert.throws(() => verifyLocalDependencies(context, result.manifest), /Missing local context dependency/);
        fs.writeFileSync(dependencyTest, dependencyBytes);
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(context, 'tools/deployment/legacyTrackedPaths.json'))), []);
        assert.equal(result.manifest.find(e => e.path === 'tools/deployment/legacyTrackedPaths.json').synthetic, true);
        assert.throws(() => verify(context, '0'.repeat(64)), /checksum/);
        const file = path.join(context, 'server.js'), bytes = fs.readFileSync(file); fs.appendFileSync(file, '\n// synthetic tamper'); assert.throws(() => verify(context, manifestSha256), /integrity/); fs.writeFileSync(file, bytes);
        const extra = path.join(context, '.env'); fs.writeFileSync(extra, 'SYNTHETIC-CANARY-NO-SECRET'); assert.throws(() => verify(context, manifestSha256), /Unlisted/); fs.unlinkSync(extra);
        const mf = path.join(context, 'context-manifest.json'), previous = fs.readFileSync(mf), entries = JSON.parse(previous);
        entries.push({ path: 'assets/users.json', synthetic: true, sha256: 'a'.repeat(64) }); const altered = Buffer.from(JSON.stringify(entries)); fs.writeFileSync(mf, altered);
        assert.throws(() => verify(context, digest(altered)), /Unapproved/); fs.writeFileSync(mf, previous);
        const link = path.join(context, 'unlisted-link'); fs.symlinkSync(sandbox.data, link, process.platform === 'win32' ? 'junction' : 'dir');
        assert.throws(() => verify(context, manifestSha256), /links/); fs.unlinkSync(link);
        assert.equal(verify(context, manifestSha256).codeOnlyAllowlistVerified, true);
    } finally { removeSandbox(sandbox.root, sandbox.token); }
});

test('dependency closure parses syntax without executing it and follows transitive require/import/export', () => {
    const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'cartehesta-context-dependencies-synthetic-'));
    const put = (name, text) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
    put('package-lock.json', '{"packages":{}}');
    put('tests/fixtures/closure.cjs', 'throw Error("Must never run"); require("./closure-child"); // require("./missing-comment")\nconst text = "require(\\\"./missing-string\\\")";');
    put('tests/fixtures/closure-child.js', 'export { value } from "./closure-leaf.mjs"; import("./closure-leaf.mjs");');
    put('tests/fixtures/closure-leaf.mjs', 'export const value = 1;');
    const names = ['package-lock.json', 'tests/fixtures/closure.cjs', 'tests/fixtures/closure-child.js', 'tests/fixtures/closure-leaf.mjs'];
    assert.equal(verifyLocalDependencies(root, names).localEdges, 3);
    assert.throws(() => verifyLocalDependencies(root, names.slice(0, -1)), /Missing local context dependency/);
    put('tests/fixtures/closure.cjs', 'require.resolve("./missing");');
    assert.throws(() => verifyLocalDependencies(root, names), /Missing local context dependency/);
    put('tests/fixtures/closure.cjs', 'require(path.join(__dirname, "missing"));');
    assert.throws(() => verifyLocalDependencies(root, names), /Unresolved computed context dependency/);
    put('tests/fixtures/closure.cjs', 'require("uninstalled-package");');
    assert.throws(() => verifyLocalDependencies(root, names), /Undeclared context package/);
    put('tests/fixtures/closure.cjs', 'import("../../../../outside.mjs");');
    assert.throws(() => verifyLocalDependencies(root, names), /escapes validation context/);
    // Fictional files are retained. No application, private data or host module was loaded.
});
