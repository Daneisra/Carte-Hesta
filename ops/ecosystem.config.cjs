// Proposal only. Install PM2 and Node 22 through the host's reviewed provisioning.
// Start from a clean environment as cartehesta; never reload/cluster the single writer.
module.exports = {
    apps: [{
        name: 'cartehesta', cwd: '/srv/cartehesta/app', script: '/srv/cartehesta/app/server.js',
        interpreter: '/opt/node-v22.23.2-linux-x64/bin/node', exec_mode: 'fork', instances: 1,
        autorestart: false, watch: false, kill_timeout: 60000,
        out_file: '/var/log/cartehesta/node-out.log', error_file: '/var/log/cartehesta/node-error.log',
        merge_logs: true,
        env: {
            NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '4173', COOKIE_SECURE: 'true',
            CARTE_PUBLIC_DIR: '/srv/cartehesta/public', CARTE_DATA_DIR: '/srv/cartehesta/data',
            CARTE_MEDIA_DIR: '/srv/cartehesta/media-private', CARTE_LOG_DIR: '/var/log/cartehesta',
            CARTE_ENV_FILE: '/etc/cartehesta/cartehesta.env',
            REMOTE_SYNC_URL: '', REMOTE_SYNC_TOKEN: ''
        }
    }]
};
