// Deployment provenance only. Never accepts PRs, API-only runs or another revision.
const fs = require('node:fs');
const REPO = 'Daneisra/Carte-Hesta';
function trigger(name, event, revision, id, confirmation) {
    if (name === 'workflow_dispatch') {
        if (confirmation !== 'DEPLOY CARTE HESTA') throw Error('E_DEPLOY_CONFIRMATION');
        return { revision, id };
    }
    const run = event?.workflow_run;
    if (name !== 'workflow_run' || event.action !== 'completed' || event.repository?.full_name !== REPO ||
        run?.name !== 'CI isolated security' || run.conclusion !== 'success' || run.event !== 'push' ||
        run.head_branch !== 'main' || run.head_repository?.full_name !== REPO ||
        run.head_sha !== revision || String(run.id) !== id) throw Error('E_DEPLOY_TRIGGER');
    return { revision, id };
}
function validate({ run, workflow, jobs, artifacts }, revision, current) {
    if (!/^[a-f0-9]{40}$/.test(revision || '') || revision !== current) throw Error('E_DEPLOY_REVISION');
    if (workflow.path !== '.github/workflows/ci.yml' || workflow.state !== 'active' ||
        run.workflow_id !== workflow.id || run.repository?.full_name !== REPO || run.head_repository?.full_name !== REPO ||
        run.event !== 'push' || run.head_branch !== 'main' || run.head_sha !== revision ||
        run.status !== 'completed' || run.conclusion !== 'success') throw Error('E_DEPLOY_CI_PROVENANCE');
    if (jobs.total_count !== jobs.jobs.length || jobs.jobs.length !== 1) throw Error('E_DEPLOY_INCOMPLETE_JOBS');
    const job = jobs.jobs[0];
    if (job.name !== 'Full Linux validation' || job.conclusion !== 'success') throw Error('E_DEPLOY_NOT_FULL_CI');
    for (const name of ['Strict index gate (legacy debt must be removed before CI can pass)',
        'Encoding and isolated unit/storage/publication suites', 'Isolation, permissions, offline migration and rollback',
        'API with isolation boundary enforcement', 'Both browsers (Firefox is mandatory)',
        'Build and verify a code-only candidate outside the checkout', 'Preserve verified code-only candidate for reviewed migration']) {
        if (job.steps.filter(step => step.name === name && step.conclusion === 'success').length !== 1) throw Error('E_DEPLOY_MISSING_CI_STEP');
    }
    if (artifacts.total_count !== artifacts.artifacts.length) throw Error('E_DEPLOY_INCOMPLETE_ARTIFACTS');
    const matches = artifacts.artifacts.filter(a => a.name === 'cartehesta-code-' + revision);
    if (matches.length !== 1 || matches[0].expired || !Number.isSafeInteger(matches[0].id) ||
        matches[0].size_in_bytes <= 0 || !/^sha256:[a-f0-9]{64}$/.test(matches[0].digest || '')) throw Error('E_DEPLOY_ARTIFACT');
    return matches[0];
}
async function main() {
    const { CI_RUN_ID: id, REVISION: revision, GH_TOKEN: token, GITHUB_OUTPUT: output,
        GITHUB_EVENT_NAME: eventName, GITHUB_EVENT_PATH: eventPath, CONFIRMATION: confirmation } = process.env;
    if (!/^[1-9][0-9]{0,14}$/.test(id || '') || !token || !output) throw Error('E_DEPLOY_INPUTS');
    trigger(eventName, JSON.parse(fs.readFileSync(eventPath)), revision, id, confirmation);
    async function api(suffix) {
        const response = await fetch('https://api.github.com/repos/' + REPO + suffix, {
            headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
            redirect: 'error', signal: AbortSignal.timeout(30000)
        });
        if (!response.ok) throw Error('E_DEPLOY_CI_HTTP_' + response.status);
        return response.json();
    }
    const [run, workflow, jobs, artifacts, main] = await Promise.all([
        api('/actions/runs/' + id), api('/actions/workflows/ci.yml'),
        api('/actions/runs/' + id + '/jobs?filter=latest&per_page=100'), api('/actions/runs/' + id + '/artifacts?per_page=100'),
        api('/git/ref/heads/main')
    ]);
    const artifact = validate({ run, workflow, jobs, artifacts }, revision, main.object.sha);
    if (run.id !== Number(id)) throw Error('E_DEPLOY_RUN_ID');
    fs.appendFileSync(output, 'revision=' + revision + '\nci_run_id=' + id + '\nartifact_id=' + artifact.id + '\nartifact_sha256=' + artifact.digest.slice(7) + '\n');
    console.log('Exact full Linux CI revision and artifact provenance verified');
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { validate, trigger };
