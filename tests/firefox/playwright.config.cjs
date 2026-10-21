const config = require('../../playwright.config.js');
module.exports = {
    ...config, retries: 0, maxFailures: 0,
    projects: config.projects.filter(project => project.name === 'firefox').map(project => ({
        ...project, testDir: __dirname, testMatch: 'probe.spec.js'
    }))
};
