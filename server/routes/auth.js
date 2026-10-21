const crypto = require('crypto');

const DEFAULT_REDIRECT_PATH = '/';
const SCOPE = 'identify';

const sanitizeRedirectTarget = value => {
    if (typeof value !== 'string') {
        return DEFAULT_REDIRECT_PATH;
    }
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 512) {
        return DEFAULT_REDIRECT_PATH;
    }
    if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
        return DEFAULT_REDIRECT_PATH;
    }
    return trimmed;
};

const buildDiscordAvatarUrl = profile => {
    if (!profile || !profile.id) {
        return null;
    }
    const avatarHash = profile.avatar;
    if (avatarHash) {
        return `https://cdn.discordapp.com/avatars/${profile.id}/${avatarHash}.png?size=128`;
    }
    const discriminator = Number(profile.discriminator) || 0;
    const index = Number.isFinite(discriminator) ? discriminator % 5 : 0;
    return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
};

module.exports = (register, context) => {
    const {
        logger,
        json,
        send,
        authRequired,
        authenticationUnavailable = false,
        discordOauth,
        oauthStateStore,
        oauthStateTtlMs,
        createSession,
        getSession,
        sendSessionCookie,
        refreshSessionCookie,
        clearSessionCookie,
        destroySession,
        findUserById,
        sanitizeRole,
        sanitizeUserRecord,
        upsertDiscordUser,
        normalizeString,
        fetchJson,
        readGroupsFile,
        storageTransaction = callback => callback(),
        discordEndpoints = {}
    } = context;

    const authorizeUrl = (discordEndpoints?.authorizeUrl || 'https://discord.com/oauth2/authorize');
    const tokenUrl = (discordEndpoints?.tokenUrl || 'https://discord.com/api/oauth2/token');
    const userUrl = (discordEndpoints?.userUrl || 'https://discord.com/api/v10/users/@me');

    const log = logger.child('[auth]');
    const discordEnabled = Boolean(
        discordOauth &&
        discordOauth.enabled &&
        discordOauth.clientId &&
        discordOauth.clientSecret &&
        discordOauth.redirectUri
    );

    const rememberState = (state, payload) => {
        const ttl = Math.max(0, Number(oauthStateTtlMs) || 0);
        const entry = {
            ...payload
        };
        if (ttl > 0) {
            entry.expiresAt = Date.now() + ttl;
        }
        if (ttl > 0) {
            entry.timeout = setTimeout(() => {
                oauthStateStore.delete(state);
            }, ttl);
            if (entry.timeout && typeof entry.timeout.unref === 'function') {
                entry.timeout.unref();
            }
        }
        oauthStateStore.set(state, entry);
        return entry;
    };

    const consumeState = state => {
        if (!state) {
            return null;
        }
        const entry = oauthStateStore.get(state);
        if (!entry) {
            return null;
        }
        oauthStateStore.delete(state);
        if (entry.timeout) {
            clearTimeout(entry.timeout);
        }
        if (entry.expiresAt && entry.expiresAt < Date.now()) {
            return null;
        }
        return entry;
    };

    const resolveSessionUser = async (req, res) => {
        const session = await getSession(req);
        if (!session) {
            return { user: null };
        }
        const data = session.data || {};
        if (data.userId) {
            const persisted = await findUserById(data.userId);
            if (!persisted) {
                await destroySession(req);
                clearSessionCookie(res);
                return { user: null };
            }
            const sanitized = sanitizeUserRecord(persisted);
            if (session.data) {
                session.data.role = sanitized.role;
                session.data.username = sanitized.username;
                session.data.provider = sanitized.provider;
                session.data.discordId = sanitized.discordId || null;
                session.data.avatar = sanitized.avatar || null;
                session.data.groups = Array.isArray(sanitized.groups) ? sanitized.groups : [];
                session.data.characters = Array.isArray(sanitized.characters) ? sanitized.characters : [];
                session.data.profile = sanitized.profile || null;
                session.data.availability = sanitized.availability || null;
                session.data.account = sanitized.account || null;
            }
            return { user: sanitized, sessionId: session.sessionId };
        }
        return { user: null };
    };

    const createAuthResponse = (user, groupDetails = []) => {
        if (!user) {
            return {
                status: 'ok',
                authenticated: false,
                role: 'guest',
                username: '',
                avatar: null,
                groups: [],
                groupDetails: [],
                characters: [],
                profile: null,
                availability: null,
                provider: null,
                discordId: null,
                account: { lastLoginAt: null, lastSeenAt: null },
                authRequired: true,
                oauth: { discord: discordEnabled }
            };
        }
        return {
            status: 'ok',
            authenticated: true,
            role: sanitizeRole(user.role),
            username: user.username || '',
            avatar: user.avatar || null,
            groups: Array.isArray(user.groups) ? user.groups : [],
            groupDetails: Array.isArray(groupDetails) ? groupDetails : [],
            characters: Array.isArray(user.characters) ? user.characters : [],
            profile: user.profile || null,
            availability: user.availability || null,
            provider: user.provider || 'manual',
            discordId: user.discordId || null,
            account: user.account || { lastLoginAt: null, lastSeenAt: null },
            authRequired: true,
            oauth: { discord: discordEnabled }
        };
    };

    const buildAuthorizeUrl = (state, prompt = null) => {
        const redirectUrl = new URL(authorizeUrl);
        redirectUrl.searchParams.set('client_id', discordOauth.clientId);
        redirectUrl.searchParams.set('response_type', 'code');
        redirectUrl.searchParams.set('scope', SCOPE);
        redirectUrl.searchParams.set('state', state);
        redirectUrl.searchParams.set('redirect_uri', discordOauth.redirectUri);
        if (prompt) {
            redirectUrl.searchParams.set('prompt', prompt);
        }
        return redirectUrl.toString();
    };

    const requestDiscordTokens = async code => {
        const body = new URLSearchParams({
            client_id: discordOauth.clientId,
            client_secret: discordOauth.clientSecret,
            grant_type: 'authorization_code',
            code,
            redirect_uri: discordOauth.redirectUri
        }).toString();
        return await fetchJson(tokenUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body
        });
    };

    const fetchDiscordProfile = async accessToken => {
        return await fetchJson(userUrl, {
            headers: {
                Authorization: `Bearer ${accessToken}`
            }
        });
    };

    register('GET', '/auth/session', async (req, res) => {
        if (authenticationUnavailable) {
            json(res, 503, { status: 'error', message: 'Authentication configuration is invalid.' });
            return;
        }
        try {
            const { user, sessionId } = await resolveSessionUser(req, res);
            let groupDetails = [];
            if (user && Array.isArray(user.groups) && user.groups.length && typeof readGroupsFile === 'function') {
                const groups = await readGroupsFile();
                const lookup = new Map(groups.map(group => [group.id, group]));
                groupDetails = user.groups
                    .map(id => lookup.get(id))
                    .filter(Boolean)
                    .map(group => ({
                        id: group.id,
                        name: group.name || group.id,
                        color: group.color || null
                    }));
            }
            if (user && sessionId && typeof refreshSessionCookie === 'function') {
                refreshSessionCookie(res, sessionId);
            }
            const response = createAuthResponse(user, groupDetails);
            if (user && context.security) {
                const access = await context.security.load(req);
                response.userId = user.id;
                response.managedGroupIds = [...access.managed];
                response.managedGroupDetails = access.groups.filter(group => access.managed.has(group.id)).map(group => ({ id: group.id, name: group.name }));
            }
            json(res, 200, response);
        } catch (error) {
            log.error('Failed to resolve session', { error: error.message });
            json(res, 500, { status: 'error', message: 'Session lookup failed.' });
        }
    });

    register('POST', '/auth/logout', async (req, res) => {
        try {
            await destroySession(req);
            clearSessionCookie(res);
            json(res, 204, null);
        } catch (error) {
            log.error('Logout failed', { error: error.message });
            json(res, 500, { status: 'error', message: 'Logout failed.' });
        }
    });

    register('DELETE', '/auth/session', async (req, res) => {
        try {
            await destroySession(req);
            clearSessionCookie(res);
            json(res, 200, { status: 'ok', message: 'Session revoquee.' });
        } catch (error) {
            log.error('Session revoke failed', { error: error.message });
            json(res, 500, { status: 'error', message: 'Impossible de revoquer la session.' });
        }
    });

    register('GET', '/auth/discord/login', async (req, res, urlObj) => {
        if (!discordEnabled) {
            log.warn('Discord login attempted but OAuth is disabled');
            json(res, 503, { status: 'error', message: 'Discord OAuth is not configured.' });
            return;
        }
        const redirectTarget = sanitizeRedirectTarget(urlObj.searchParams.get('redirect') || '');
        const prompt = normalizeString(urlObj.searchParams.get('prompt')) || null;
        const state = crypto.randomBytes(24).toString('hex');
        rememberState(state, { redirect: redirectTarget });
        const location = buildAuthorizeUrl(state, prompt);
        log.info('Redirecting to Discord authorization', { redirect: redirectTarget });
        send(res, 302, '', {
            Location: location,
            'Cache-Control': 'no-store'
        });
    });

    register('GET', '/auth/discord/callback', async (req, res, urlObj) => {
        if (!discordEnabled) {
            json(res, 503, { status: 'error', message: 'Discord OAuth is not configured.' });
            return;
        }

        const params = urlObj.searchParams;
        const error = params.get('error');
        const code = params.get('code');
        const state = params.get('state');

        if (error) {
            log.warn('Discord returned error', { error });
            const message = error === 'access_denied' ? 'Acces refuse par Discord.' : 'Erreur lors de la connexion Discord.';
            send(res, 400, `<!DOCTYPE html><html><body><p>${message}</p><p><a href="${DEFAULT_REDIRECT_PATH}">Retour</a></p></body></html>`, {
                'Content-Type': 'text/html; charset=utf-8'
            });
            return;
        }

        const entry = consumeState(state);
        if (!entry) {
            log.warn('OAuth state mismatch or expired');
            send(res, 400, '<!DOCTYPE html><html><body><p>Session OAuth invalide ou expiree. Veuillez relancer la connexion.</p></body></html>', {
                'Content-Type': 'text/html; charset=utf-8'
            });
            return;
        }

        if (!code) {
            log.warn('Missing authorization code from Discord');
            send(res, 400, '<!DOCTYPE html><html><body><p>Code d\'autorisation manquant. Veuillez reessayer.</p></body></html>', {
                'Content-Type': 'text/html; charset=utf-8'
            });
            return;
        }

        try {
            const tokenResponse = await requestDiscordTokens(code);
            const accessToken = tokenResponse?.access_token;
            if (!accessToken) {
                throw new Error('Missing access token in response');
            }

            const profile = await fetchDiscordProfile(accessToken);
            if (!profile?.id) {
                throw new Error('Invalid Discord profile payload');
            }

            const displayName = profile.global_name || profile.username || '';
            const avatarUrl = buildDiscordAvatarUrl(profile);
            const sessionId = await storageTransaction(async () => {
            const user = await upsertDiscordUser({
                discordId: normalizeString(profile.id),
                username: displayName,
                roleHint: null,
                avatar: avatarUrl,
                markLogin: true
            });

            return createSession({
                userId: user.id,
                provider: 'discord',
                role: user.role,
                username: user.username || displayName,
                discordId: user.discordId,
                avatar: avatarUrl,
                groups: Array.isArray(user.groups) ? user.groups : [],
                characters: Array.isArray(user.characters) ? user.characters : [],
                profile: user.profile || null,
                availability: user.availability || null,
                account: user.account || null
            });
            });
            sendSessionCookie(res, sessionId);

            const redirectTarget = entry.redirect || DEFAULT_REDIRECT_PATH;
            send(res, 302, '', {
                Location: redirectTarget,
                'Cache-Control': 'no-store'
            });
        } catch (error) {
            log.error('Discord OAuth callback failed', { code: error.code || 'E_OAUTH' });
            clearSessionCookie(res);
            send(res, 500, '<!DOCTYPE html><html><body><p>Impossible de terminer la connexion Discord. Veuillez reessayer.</p></body></html>', {
                'Content-Type': 'text/html; charset=utf-8'
            });
        }
    });
};
