#!/usr/bin/env node
// Verify a code-only validation context BEFORE any transfer/build. No test/data/secrets are executed.
const fs = require('node:fs');
const path = require('node:path');
const { readPlain, digest } = require('../server/publication/files');
const { plainPath } = require('../server/storage/paths');
const { BACKEND, OPS, scan, directories } = require('./deployment/release');
const STATIC_FILES = require('../server/publication/staticFiles');
const EXTRA = ['Dockerfile', 'playwright.config.js', '.editorconfig', '.gitattributes', '.gitignore', 'README.md', 'ROADMAP.md',
    '.github/workflows/ci.yml', '.github/workflows/deploy.yml', '.github/scripts/verify-ci-run.cjs', '.github/scripts/transport-deploy.py', 'ops/deploy-code.py', 'ops/receive-deploy.py', 'tools/deployment/legacyTrackedPaths.json',
    ...['auditTrackedPaths', 'gitCleanupPreflight', 'prepareGitCleanup', 'localBackupManifest', 'verifyLinuxContext', 'runLinuxValidation', 'benchmarkSynthetic', 'lintEncoding', 'runIsolatedTests', 'devServerWithStub', 'diagnoseFirefox', 'prepareFirefoxLinuxContext'].map(n => `tools/${n}.js`)];
// Development-only AST parser already locked with Playwright. Not used by the pre-install
// structural verifier, and never included in the application release or executed test code.
function verifyLocalDependencies(root, entries) {
    const { isBuiltin } = require('node:module');
    if (require('playwright/package.json').version !== '1.56.0') throw Error('Dependency parser requires locked Playwright 1.56.0');
    const { babelParse, traverse } = require(path.join(path.dirname(require.resolve('playwright/package.json')), 'lib/transform/babelBundle.js'));
    const packageRoots = { playwright: path.dirname(require.resolve('playwright/package.json')), 'playwright-core': path.dirname(require.resolve('playwright-core/package.json')) };
    const names = new Set(entries.map(e => typeof e === 'string' ? e : e.path));
    const lock = JSON.parse(readPlain(path.join(root, 'package-lock.json')));
    const edges = [], packageInternals = [];
    const packagePresent = name => isBuiltin(name) || Object.hasOwn(lock.packages, `node_modules/${name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0]}`);
    function local(from, specifier, esm) {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
        if (target.startsWith('../') || path.posix.isAbsolute(target) || /[\\:\x00-\x1f]/.test(target)) throw Error('Local module escapes validation context');
        const candidates = esm ? [target] : [target, `${target}.js`, `${target}.json`, `${target}/index.js`, `${target}/index.json`];
        const resolved = candidates.find(p => names.has(p));
        if (!resolved) throw Error(`Missing local context dependency: ${from}`);
        edges.push({ from, to: resolved });
    }
    for (const from of [...names].filter(n => /\.(?:js|cjs|mjs)$/.test(n)).sort()) {
        if (!allowed(from)) throw Error('Unapproved dependency source');
        const text = readPlain(path.join(root, from)).toString('utf8');
        let ast;
        try { ast = babelParse(text, from, false); } catch { throw Error(`Cannot parse context module: ${from}`); }
        const fileUrlImports = new WeakMap();
        traverse(ast, { CallExpression(p) {
            if (p.node.callee.type !== 'Import' || p.node.arguments[0]?.type !== 'Identifier') return;
            const binding = p.scope.getBinding(p.node.arguments[0].name);
            const init = binding?.constant && binding.kind === 'const' && binding.path.node.init;
            const url = init?.type === 'MemberExpression' && init.property.name === 'href' && init.object;
            const join = url?.type === 'CallExpression' && url.callee.name === 'pathToFileURL' && url.arguments[0];
            if (join?.type === 'CallExpression' && join.callee.object?.name === 'path' && join.callee.property?.name === 'join' &&
                join.arguments[0]?.name === '__dirname' && join.arguments.length > 1 && join.arguments.slice(1).every(a => a.type === 'StringLiteral')) {
                fileUrlImports.set(p.node, './' + join.arguments.slice(1).map(a => a.value).join('/'));
            }
        } });
        const visit = node => {
            if (!node || typeof node !== 'object') return;
            const declared = ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.source;
            const called = node.type === 'CallExpression' && (node.callee?.name === 'require' || node.callee?.type === 'Import' ||
                (node.callee?.type === 'MemberExpression' && node.callee.object?.name === 'require' && node.callee.property?.name === 'resolve'));
            const argument = declared || (called && node.arguments[0]);
            if (argument) {
                if (argument.type === 'StringLiteral') {
                    const specifier = argument.value;
                    if (specifier.startsWith('.')) local(from, specifier, !!declared || node.callee?.type === 'Import');
                    else if (!packagePresent(specifier)) throw Error(`Undeclared context package: ${from}`);
                } else if (fileUrlImports.has(node)) {
                    local(from, fileUrlImports.get(node), true);
                } else {
                    // Existing nonliteral loads are fixed internals of the pinned Playwright
                    // package. Arbitrary variables, local path.join and computed imports fail.
                    const expression = text.slice(argument.start, argument.end).replace(/\s+/g, '').replace(/"/g, "'");
                    const direct = /^path\.join\(path\.dirname\(require\.resolve\('(playwright(?:-core)?)\/package\.json'\)\),'(lib\/[A-Za-z0-9_/]+\.js)'\)$/.exec(expression);
                    const viaCore = /^path\.join\(core,'(lib\/[A-Za-z0-9_/]+\.js)'\)$/.exec(expression);
                    const coreDefined = /\bconst\s+core\s*=\s*path\.dirname\(require\.resolve\(['"]playwright-core\/package\.json['"]\)\)/.test(text);
                    if (!direct && !(viaCore && coreDefined)) throw Error(`Unresolved computed context dependency: ${from}`);
                    packageInternals.push({ from, package: direct ? direct[1] : 'playwright-core', module: direct ? direct[2] : viaCore[1] });
                }
            }
            for (const [key, value] of Object.entries(node)) {
                if (['loc', 'extra', 'tokens', 'comments'].includes(key)) continue;
                if (Array.isArray(value)) value.forEach(visit);
                else if (value && typeof value === 'object') visit(value);
            }
        };
        visit(ast.program);
    }
    for (const entry of packageInternals) {
        const target = path.join(packageRoots[entry.package], entry.module);
        plainPath(target);
        if (!fs.lstatSync(target).isFile()) throw Error('Missing pinned package internal');
    }
    return { modules: [...names].filter(n => /\.(?:js|cjs|mjs)$/.test(n)).length, localEdges: edges.length, edges, packageInternals, testCodeExecuted: false };
}
function allowed(name) {
    if (typeof name !== 'string' || !name || /[\\:%\x00-\x1f\x7f]/.test(name) || path.posix.isAbsolute(name) || name.split('/').some(p => !p || p === '.' || p === '..')) return false;
    if ([...BACKEND, ...STATIC_FILES, ...EXTRA, ...OPS.map(n => `ops/${n}`)].includes(name)) return true;
    return /^tests\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.(?:js|mjs|cjs|md)$/.test(name) && !name.split('/').some(p => p.startsWith('.'));
}
function verify(root, expectedDigest) {
    if (!path.isAbsolute(root) || !/^[a-f0-9]{64}$/.test(expectedDigest || '')) throw Error('Explicit context path and independent expected manifest SHA-256 required');
    plainPath(root);
    const bytes = readPlain(path.join(root, 'context-manifest.json'), 1024 * 1024);
    if (digest(bytes) !== expectedDigest) throw Error('Context manifest checksum mismatch');
    const entries = JSON.parse(bytes);
    if (!Array.isArray(entries) || !entries.length || entries.length > 2048) throw Error('Invalid context manifest');
    const names = new Set(); let size = 0;
    for (const entry of entries) {
        if (!entry || !allowed(entry.path) || names.has(entry.path) || !/^[a-f0-9]{64}$/.test(entry.sha256 || '') || typeof entry.synthetic !== 'boolean') throw Error('Unapproved context entry');
        names.add(entry.path);
        const b = readPlain(path.join(root, entry.path)); size += b.length;
        if (size > 32 * 1024 * 1024 || digest(b) !== entry.sha256) throw Error('Context integrity/size failure');
    }
    for (const name of [...BACKEND, ...STATIC_FILES, ...EXTRA, ...OPS.map(n => `ops/${n}`)]) if (!names.has(name)) throw Error('Incomplete independent validation context');
    if (JSON.stringify(scan(root)) !== JSON.stringify([...names, 'context-manifest.json'].sort())) throw Error('Unlisted context file');
    const dirs = new Set(); for (const name of names) { let p = path.posix.dirname(name); while (p !== '.') { dirs.add(p); p = path.posix.dirname(p); } }
    if (JSON.stringify(directories(root)) !== JSON.stringify([...dirs].sort())) throw Error('Unlisted context directory');
    return { files: names.size, bytes: size, manifestSha256: digest(bytes), codeOnlyAllowlistVerified: true, linuxExecuted: false };
}
if (require.main === module) {
    try {
        const args = process.argv.slice(2);
        if (args.length !== 2 && !(args.length === 3 && args[2] === '--dependencies')) throw Error('Usage: node tools/verifyLinuxContext.js ABSOLUTE_CONTEXT EXPECTED_MANIFEST_SHA256 [--dependencies]');
        const result = verify(args[0], args[1]);
        if (args[2]) result.dependencies = verifyLocalDependencies(args[0], JSON.parse(readPlain(path.join(args[0], 'context-manifest.json'))));
        console.log(JSON.stringify(result, null, 2));
    }
    catch (error) { console.error(error instanceof SyntaxError ? 'Invalid context manifest' : error.message); process.exitCode = 1; }
}
module.exports = { verify, verifyLocalDependencies, allowed, EXTRA };
