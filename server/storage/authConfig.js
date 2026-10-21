function authConfiguration(env = process.env) {
    const fields = ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DISCORD_REDIRECT_URI'].map(key => (env[key] || '').trim());
    const any = fields.some(Boolean);
    const secret = env.SESSION_SECRET || '';
    let invalid = Boolean(secret && Buffer.byteLength(secret) < 32);
    if (any && (!fields.every(Boolean) || Buffer.byteLength(secret) < 32)) invalid = true;
    const test = env.NODE_ENV === 'test' && Boolean(env.CARTE_TEST_ROOT);
    const origin = (env.DISCORD_API_ORIGIN || 'https://discord.com').replace(/\/+$/, '');
    try {
        const parsed = new URL(origin);
        if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash || (origin !== 'https://discord.com' && !(test && parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1'))) invalid = true;
        if (any) {
            const redirect = new URL(fields[2]);
            if (redirect.username || redirect.password || redirect.hash || (redirect.protocol !== 'https:' && !(test && redirect.protocol === 'http:' && redirect.hostname === '127.0.0.1'))) invalid = true;
        }
    } catch { invalid = true; }
    return { invalid, discordEnabled: any && !invalid, origin, secret };
}
module.exports = { authConfiguration };
