// Playwright may launch Node workers and browsers, not arbitrary network clients or shells.
module.exports = function install({ childProcess, path, root, token, source, within, deny }) {
    const original = Object.fromEntries(['spawn', 'spawnSync', 'fork', 'exec', 'execSync', 'execFile', 'execFileSync'].map(name => [name, childProcess[name]]));
    const ownedBrowsers = new Set();
    function approved(command, options = {}) {
        if (options.shell) deny('worker shell', command);
        const executable = path.resolve(command);
        if (executable === process.execPath) {
            const env = options.env || process.env;
            if (env.CARTE_TEST_ROOT !== root || env.CARTE_TEST_TOKEN !== token || env.CARTE_TEST_SOURCE_ROOT !== source || env.NODE_OPTIONS !== process.env.NODE_OPTIONS || env.CARTE_TEST_PROCESS !== 'runner') {
                deny('unguarded Node child', executable);
            }
            return false;
        }
        const cache = process.env.CARTE_TEST_BROWSER_CACHE;
        if (!cache || !within(cache, executable) || !/^(?:chrome|headless_shell|firefox|ffmpeg(?:-(?:win64|linux|mac))?|PrintDeps|winldd)(?:\.exe)?$/i.test(path.basename(executable))) {
            deny('worker subprocess', command);
        }
        return true;
    }
    childProcess.spawn = function (command, args, options) {
        const browser = approved(command, options);
        const child = original.spawn(command, args, options);
        if (browser && child.pid) ownedBrowsers.add(child.pid);
        child.once('exit', () => ownedBrowsers.delete(child.pid));
        return child;
    };
    childProcess.spawnSync = function (command, ...args) {
        // Playwright's Windows fallback uses a shell string. Replace only its exact owned-PID form.
        const taskkill = /^taskkill \/pid (\d+) \/T \/F$/.exec(command);
        if (taskkill && process.platform === 'win32' && ownedBrowsers.has(Number(taskkill[1]))) {
            return original.spawnSync(path.join(process.env.SystemRoot, 'System32/taskkill.exe'), ['/pid', taskkill[1], '/T', '/F'], { windowsHide: true, shell: false });
        }
        approved(command, Array.isArray(args[0]) ? args[1] : args[0]);
        return original.spawnSync(command, ...args);
    };
    childProcess.fork = function (modulePath, args, options) {
        approved(process.execPath, Array.isArray(args) ? options : args);
        return original.fork(modulePath, args, options);
    };
    for (const name of ['exec', 'execSync', 'execFile', 'execFileSync']) childProcess[name] = () => deny('worker shell/exec', name);
};
