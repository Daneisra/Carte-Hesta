const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createSandbox, removeSandbox } = require('../support/sandbox.cjs');
const { beginRun, recordRun, collect, scrub, makeZip, zipEntries, sanitizeTrace, requireZeroFirefoxRetries } = require('../../tools/testDiagnostics');
const { yaml } = require(path.join(path.dirname(require.resolve('playwright-core/package.json')), 'lib/utilsBundle.js'));
const workflow = yaml.parse(fs.readFileSync(path.join(__dirname, '../../.github/workflows/ci.yml'), 'utf8'));
const steps = workflow.jobs['isolated-validation'].steps;
const step = id => steps.find(s => s.id === id);
const condition = (text, context) => vm.runInNewContext(text.replace(/^\$\{\{\s*|\s*\}\}$/g, ''), context, { timeout: 1000 });

test('browser steps remain distinct, Firefox receives zero retries and no failure is masked', () => {
    assert.equal(step('chromium').name, 'Chromium isolated tests');
    assert.equal(step('firefox').name, 'Firefox isolated tests without retries');
    assert.equal(step('firefox').run, 'node tools/runIsolatedTests.js --project=firefox --retries=0 --ci-diagnostics');
    assert(steps.every(s => !s['continue-on-error']));
    for (const chromium of ['success', 'failure']) {
        const context = { cancelled: () => false, steps: { browsers: { outcome: 'success' }, isolation: { outcome: 'success' }, chromium: { outcome: chromium } }, github: { event_name: 'pull_request' }, inputs: {} };
        assert.equal(condition(step('firefox').if, context), true);
        context.steps.isolation.outcome = 'failure'; assert.equal(condition(step('firefox').if, context), false);
        context.steps.isolation.outcome = 'success'; context.cancelled = () => true;
        assert.equal(condition(step('firefox').if, context), false);
    }
});

test('diagnostics survive browser failure and draft refusal; uploads only use the prepared directory', () => {
    const context = { cancelled: () => false, steps: { api: { outcome: 'success' }, chromium: { outcome: 'failure' }, firefox: { outcome: 'failure' }, ready: { outcome: 'failure' } } };
    assert.equal(condition(step('diagnostics').if, context), true);
    const upload = steps.find(s => s.name === 'Preserve synthetic test diagnostics');
    context.steps.diagnostics = { outcome: 'success' }; assert.equal(condition(upload.if, context), true);
    context.steps.diagnostics.outcome = 'failure'; assert.equal(condition(upload.if, context), false);
    assert.equal(upload.with.path, '${{ runner.temp }}/cartehesta-test-diagnostics/');
    assert.equal(upload.with['retention-days'], 2);
    assert.equal(upload.with['include-hidden-files'], false);
    assert(!JSON.stringify(upload).includes('test-results/'));
    const build = steps.find(s => s.name === 'Build and verify a code-only candidate outside the checkout');
    assert(!build.if.includes('cancelled') && !build.if.includes('always') && !build['continue-on-error']);
    assert.equal(Object.keys(workflow.jobs).length, 1);
});

test('structured sanitation preserves changelog evidence while removing cookie/token values and paths', () => {
    const value = scrub({ headers: [{ name: 'Cookie', value: 'cookie-canary' }, { name: 'Authorization', value: 'Bearer secret-canary' }], cookies: [{ value: 'cookie-canary' }],
        url: 'http://127.0.0.1/auth?code=oauth-canary&state=state-canary', storageState: { secret: 'storage-canary' },
        body: JSON.stringify({ config: { changelog: [{ title: 'X'.repeat(201), summary: 'Texte' }] }, access_token: 'token-canary' }),
        error: 'at C:/Users/SyntheticUser/private/file.js:42', code: 'E_CHANGELOG_TITLE_TOO_LONG' });
    const text = JSON.stringify(value);
    for (const canary of ['cookie-canary', 'secret-canary', 'oauth-canary', 'state-canary', 'storage-canary', 'token-canary', 'SyntheticUser']) assert(!text.includes(canary));
    assert.deepEqual(value.cookies, []);
    assert.equal(JSON.parse(value.body).config.changelog[0].title.length, 201);
    assert.equal(value.code, 'E_CHANGELOG_TITLE_TOO_LONG');
});

test('HTTP URLs and public JavaScript stack locations survive while absolute local paths are masked', () => {
    for (const text of ['http://127.0.0.1:41234/api/admin/home-config?x=1', 'https://example.test/path',
        'renderAdminSiteConfig@http://127.0.0.1:41234/js/ui/adminHome.js:450:12',
        'at render (https://example.test/js/public.js:42:7)', 'https://example.test/home/public.js:12:3']) assert.equal(scrub(text), text);
    for (const file of ['C:/Users/SyntheticUser/private/file.js:42:3', 'D:\\private\\data.json', '\\\\host\\private\\data.json',
        '/home/synthetic/private.json', '/Users/synthetic/private.json', '/tmp/synthetic/private.json']) {
        assert.equal(scrub(`at ${file}`), 'at <absolute-path>');
    }
    assert.equal(scrub('http://127.0.0.1:41234/auth?x=1&code=oauth-code-canary&state=oauth-state-canary'),
        'http://127.0.0.1:41234/auth?x=1&code=[redacted]&state=[redacted]');
});

test('functional session/state/code remain readable; OAuth contexts and nested authentication remain private', () => {
    const value = scrub({ response: { session: { id: 'session-synthétique', title: 'Préparation', state: 'scheduled', code: 'SESSION_OK',
        nested: { access_token: 'nested-token-canary', password: 'nested-password-canary' } } },
        params: { state: 'visible', session: 'functional-session', code: 'FUNCTIONAL_CODE' },
        oauth: { nested: { state: 'oauth-state-canary', code: 'oauth-code-canary', session: 'oauth-session-canary' } },
        auth: { response: JSON.stringify({ state: 'json-state-canary', code: 'json-code-canary', access_token: 'json-token-canary' }) },
        request: { queryString: [{ name: 'state', value: 'query-state-canary' }, { name: 'code', value: 'query-code-canary' }, { name: 'x', value: 'retained' }] } });
    assert.equal(value.response.session.id, 'session-synthétique'); assert.equal(value.response.session.state, 'scheduled');
    assert.equal(value.response.session.code, 'SESSION_OK'); assert.equal(value.response.session.title, 'Préparation');
    assert.deepEqual(value.params, { state: 'visible', session: 'functional-session', code: 'FUNCTIONAL_CODE' });
    assert.equal(value.request.queryString[2].value, 'retained');
    assert(!JSON.stringify(value).includes('canary'));
});

test('actual Firefox results must confirm zero retries even if the child exited successfully', () => {
    const payload = { stats: { flaky: 0 }, config: { projects: [{ name: 'firefox', retries: 0 }] }, suites: [{ specs: [{ tests: [{ projectName: 'firefox', results: [{ status: 'passed', retry: 0 }] }] }] }] };
    requireZeroFirefoxRetries(payload);
    for (const mutate of [p => p.config.projects[0].retries = 1, p => p.stats.flaky = 1, p => p.suites[0].specs[0].tests[0].results.push({ status: 'passed', retry: 1 }), p => p.suites = []]) {
        const copy = structuredClone(payload); mutate(copy);
        assert.throws(() => requireZeroFirefoxRetries(copy), /E_FIREFOX_RETRIES_OR_MISSING_RESULTS/);
    }
});

test('trace ZIPs retain sanitized protocol/network evidence and exclude sources and arbitrary binary', async () => {
    const archive = await makeZip([
        { name: 'test.trace', bytes: Buffer.from(JSON.stringify({ type: 'before', callId: 'private', method: 'cookies' }) + '\n' + JSON.stringify({ type: 'after', callId: 'private', result: ['cookie-canary'] }) + '\n' + JSON.stringify({ type: 'log', message: 'Cookie: cookie-canary' }) + '\n' + JSON.stringify({ type: 'before', params: { expected: 'identity-canary' } })) },
        { name: '0-trace.network', bytes: Buffer.from(JSON.stringify({ request: { headers: [{ name: 'Authorization', value: 'Bearer token-canary' }], cookies: [{ value: 'cookie-canary' }] } })) },
        { name: 'resources/' + 'a'.repeat(40) + '.json', bytes: Buffer.from(JSON.stringify({ title: 'X'.repeat(201), refresh_token: 'token-canary', token: 'identity-canary' })) },
        { name: 'resources/src@source.txt', bytes: Buffer.from('source-canary') },
        { name: 'resources/' + 'b'.repeat(40), bytes: Buffer.from('binary-canary') }
    ]);
    const result = await zipEntries(await sanitizeTrace(archive));
    assert.equal(result.length, 3);
    const text = result.map(e => e.bytes.toString()).join('\n');
    for (const canary of ['cookie-canary', 'token-canary', 'identity-canary', 'source-canary', 'binary-canary']) assert(!text.includes(canary));
    assert(text.includes('X'.repeat(201)));
});

test('trace ZIPs reject duplicate members and traversal before exporting', async () => {
    const entry = { name: 'test.trace', bytes: Buffer.from('{}\n') };
    await assert.rejects(zipEntries(await makeZip([entry, entry])), /E_DIAGNOSTIC_ZIP/);
    const archive = await makeZip([{ ...entry, name: 'aa/bb.trace' }]);
    // Equal-length member-name substitution affects both ZIP directory and local header.
    const malformed = Buffer.from(archive);
    const before = Buffer.from('aa/bb.trace'), after = Buffer.from('../bb.trace');
    for (let offset = malformed.indexOf(before); offset !== -1; offset = malformed.indexOf(before, offset + after.length)) after.copy(malformed, offset);
    await assert.rejects(zipEntries(malformed), /E_DIAGNOSTIC_ZIP|invalid relative path/);
});

async function fixture(fn) {
    const sandbox = createSandbox();
    try {
        const source = path.join(sandbox.root, 'synthetic-checkout');
        const destination = path.join(source, 'test-results', path.basename(sandbox.root));
        fs.mkdirSync(destination, { recursive: true });
        fs.writeFileSync(path.join(destination, 'isolation-summary.json'), JSON.stringify({ exitCode: 1, sandbox: sandbox.root, testArgs: ['--project=firefox', '--retries=0'], violations: [], serverStopped: true, stubStopped: true, runtimeRetained: true }));
        fs.writeFileSync(path.join(destination, 'results.json'), JSON.stringify({ stats: { unexpected: 1 }, config: { projects: [{ name: 'firefox', retries: 0 }] }, suites: [{ specs: [{ title: 'Synthetic failure', tests: [{ projectName: 'firefox', status: 'unexpected', results: [{ status: 'failed', retry: 0, errors: [{ message: 'Cookie: cookie-canary' }] }] }] }] }] }));
        fs.writeFileSync(path.join(destination, 'private-store.json'), 'private-canary');
        fs.mkdirSync(path.join(destination, 'html')); fs.writeFileSync(path.join(destination, 'html/index.html'), 'html-canary');
        await fn({ sandbox, source, destination, output: path.join(sandbox.root, 'export') });
    } finally { removeSandbox(sandbox.root, sandbox.token); }
}

test('parent receipts and explicit hashed manifests export only selected synthetic files', () => fixture(async ({ sandbox, source, destination, output }) => {
    assert.throws(() => recordRun({ root: sandbox.root }, destination, 'firefox', source), /RECEIPT/);
    recordRun(beginRun(sandbox), destination, 'firefox', source);
    const files = await collect(output, source);
    assert.deepEqual(files.map(f => f.name).sort(), ['isolation-summary.json', 'results.json']);
    const json = JSON.parse(fs.readFileSync(path.join(output, 'firefox/results.json')));
    assert.equal(json.retries, 0); assert.equal(json.retryAttempts, 0); assert.equal(json.tests[0].results[0].status, 'failed');
    assert(!JSON.stringify(json).includes('cookie-canary'));
    assert(!fs.existsSync(path.join(output, 'firefox/private-store.json')));
    assert(!fs.existsSync(path.join(output, 'firefox/html')));
}));

test('representative export preserves network, stacks and planning data while removing distinct secrets across fields', () => fixture(async ({ sandbox, source, destination, output }) => {
    const secrets = ['cookie-distinct-canary', 'header-distinct-canary', 'oauth-code-distinct-canary', 'oauth-state-distinct-canary', 'body-token-distinct-canary', 'assertion-secret-distinct-canary'];
    const session = { id: 'synthetic-session-42', title: 'Session de test', state: 'scheduled', code: 'PLANNING_OK', nested: { access_token: secrets[4] } };
    const resource = 'resources/' + 'c'.repeat(40) + '.json';
    const artifact = path.join(destination, 'artifacts/synthetic'); fs.mkdirSync(artifact, { recursive: true });
    fs.writeFileSync(path.join(artifact, 'trace.zip'), await makeZip([
        { name: 'test.trace', bytes: Buffer.from(JSON.stringify({ type: 'before', method: 'waitForSelector', params: { state: 'visible' },
            stack: 'renderAdminSiteConfig@http://127.0.0.1:41234/js/ui/adminHome.js:450:12' })) },
        { name: '0-trace.network', bytes: Buffer.from(JSON.stringify({ request: { method: 'PATCH', url: `http://127.0.0.1:41234/api/admin/home-config?x=1&code=${secrets[2]}&state=${secrets[3]}`,
            queryString: [{ name: 'code', value: secrets[2] }, { name: 'state', value: secrets[3] }], cookies: [{ name: 'sid', value: secrets[0], domain: '127.0.0.1', path: '/' }],
            headers: [{ name: 'Cookie', value: `sid=${secrets[0]}` }, { name: 'Authorization', value: `Bearer ${secrets[1]}` }] },
            response: { status: 400, content: { _sha1: resource.slice('resources/'.length) } } })) },
        { name: resource, bytes: Buffer.from(JSON.stringify({ session, oauth: { state: secrets[3], code: secrets[2] } })) }
    ]));
    const results = JSON.parse(fs.readFileSync(path.join(destination, 'results.json')));
    results.suites[0].specs[0].tests[0].results[0].errors = [{ message: 'Assertion: ' + secrets.slice(0, 5).join(' ') }, { message: 'Authorization: ' + secrets[5] }];
    fs.writeFileSync(path.join(destination, 'results.json'), JSON.stringify(results));
    recordRun(beginRun(sandbox), destination, 'firefox', source);
    await collect(output, source);
    const entries = await zipEntries(fs.readFileSync(path.join(output, 'firefox/artifacts/synthetic/trace.zip')));
    const body = JSON.parse(entries.find(e => e.name === resource).bytes);
    assert.deepEqual(body.session, { ...session, nested: { access_token: '[redacted]' } });
    const network = JSON.parse(entries.find(e => e.name === '0-trace.network').bytes);
    assert.equal(network.request.method, 'PATCH'); assert.equal(network.response.status, 400);
    assert.equal(network.request.url, 'http://127.0.0.1:41234/api/admin/home-config?x=1&code=[redacted]&state=[redacted]');
    const trace = JSON.parse(entries.find(e => e.name === 'test.trace').bytes);
    assert.equal(trace.params.state, 'visible'); assert.equal(trace.stack, 'renderAdminSiteConfig@http://127.0.0.1:41234/js/ui/adminHome.js:450:12');
    const text = entries.map(e => e.bytes.toString()).join('\n') + fs.readFileSync(path.join(output, 'firefox/results.json'), 'utf8');
    for (const secret of secrets) assert(!text.includes(secret));
}));

test('summary distinguishes missing expected reports from deliberately unexecuted projects', () => fixture(async ({ sandbox, source, destination, output }) => {
    fs.unlinkSync(path.join(destination, 'results.json'));
    recordRun(beginRun(sandbox), destination, 'firefox', source);
    await collect(output, source);
    const summary = fs.readFileSync(path.join(output, 'summary.md'), 'utf8');
    for (const project of ['api', 'chromium', 'firefox']) assert(summary.includes(`| ${project} | rapport absent (attendu) |`));
    const apiOnly = output + '-api'; await collect(apiOnly, source, ['api']);
    const apiSummary = fs.readFileSync(path.join(apiOnly, 'summary.md'), 'utf8');
    assert(apiSummary.includes('| api | rapport absent (attendu) |'));
    for (const project of ['chromium', 'firefox']) assert(apiSummary.includes(`| ${project} | non exécuté (non attendu) |`));
    assert.equal(condition(step('diagnostics').env.DIAGNOSTIC_API_ONLY, { github: { event_name: 'workflow_dispatch' }, inputs: { api_only: true } }), true);
    assert.equal(condition(step('diagnostics').env.DIAGNOSTIC_API_ONLY, { github: { event_name: 'pull_request' }, inputs: {} }), false);
}));

test('altered selected files fail closed before any upload', () => fixture(async ({ sandbox, source, destination, output }) => {
    recordRun(beginRun(sandbox), destination, 'firefox', source);
    fs.appendFileSync(path.join(destination, 'results.json'), ' ');
    await assert.rejects(collect(output, source), /INTEGRITY/);
}));

test('foreign pointer paths and linked inputs cannot become diagnostics', () => fixture(async ({ sandbox, source, destination, output }) => {
    recordRun(beginRun(sandbox), destination, 'firefox', source);
    fs.writeFileSync(path.join(source, 'test-results/ci-firefox.json'), JSON.stringify({ run: '../private', sha256: 'a'.repeat(64) }));
    await assert.rejects(collect(output, source), /POINTER/);
}));

test('selected hard links and linked artifact directories are rejected', () => fixture(async ({ sandbox, source, destination, output }) => {
    const result = path.join(destination, 'results.json');
    fs.linkSync(result, path.join(sandbox.root, 'synthetic-linked-report.json'));
    assert.throws(() => recordRun(beginRun(sandbox), destination, 'firefox', source), /E_DIAGNOSTIC_FILE/);
    fs.unlinkSync(path.join(sandbox.root, 'synthetic-linked-report.json'));
    fs.mkdirSync(path.join(destination, 'artifacts'));
    const link = path.join(destination, 'artifacts/escape');
    try {
        fs.symlinkSync(sandbox.data, link, process.platform === 'win32' ? 'junction' : 'dir');
        assert.throws(() => recordRun(beginRun(sandbox), destination, 'firefox', source), /links/);
    } finally { if (fs.existsSync(link)) fs.unlinkSync(link); }
}));
