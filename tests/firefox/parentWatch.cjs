// Diagnostic owner watchdog, including the variant without a Node IPC channel.
const { verifySandbox } = require('../support/sandbox.cjs');
const marker = verifySandbox(process.env.CARTE_TEST_ROOT, process.env.CARTE_TEST_TOKEN);
if (process.ppid === marker.ownerPid && !process.channel) {
    const ownerWatch = setInterval(() => {
        try { process.kill(marker.ownerPid, 0); }
        catch { process.exit(1); }
    }, 250);
    ownerWatch.unref();
}
