const crypto = require('node:crypto');

function cookies(header = '') {
    const result = Object.create(null);
    try {
        for (const entry of header.split(';')) {
            const index = entry.indexOf('=');
            if (index >= 0) result[entry.slice(0, index).trim()] = decodeURIComponent(entry.slice(index + 1));
        }
    } catch { return Object.create(null); }
    return result;
}
function createSessions(storage, { secret, ttl, cookie = 'map_session' }) {
    const enabled = typeof secret === 'string' && Buffer.byteLength(secret) >= 32;
    const sign = id => {
        if (!enabled) throw new Error('Session signing is not configured');
        return `${id}.${crypto.createHmac('sha256', secret).update(id).digest('hex')}`;
    };
    const verify = signed => {
        if (!enabled || typeof signed !== 'string') return null;
        const match = /^([a-zA-Z0-9-]{1,128})\.([a-f0-9]{64})$/.exec(signed);
        if (!match) return null;
        return crypto.timingSafeEqual(Buffer.from(match[2], 'hex'), Buffer.from(sign(match[1]).split('.')[1], 'hex')) ? match[1] : null;
    };
    const idFrom = req => verify(cookies(req.headers?.cookie)[cookie]);
    return {
        sign,
        async create(payload) {
            if (!enabled || typeof payload.userId !== 'string' || !payload.userId) throw new Error('A persisted user and signing key are required');
            return storage.transaction(async () => {
                const users = await storage.read('users');
                if (!(Array.isArray(users) ? users : users.users).some(user => user.id === payload.userId)) throw new Error('Session user does not exist');
                const entries = await storage.read('sessions');
                const id = crypto.randomUUID();
                entries.push({ ...payload, id, expiresAt: Date.now() + ttl });
                await storage.write('sessions', entries);
                return sign(id);
            });
        },
        async get(req, { renew = true } = {}) {
            const id = idFrom(req);
            if (!id) return null;
            return storage.transaction(async () => {
                const entries = await storage.read('sessions');
                const record = entries.find(entry => entry.id === id);
                // Legacy role-only sessions stay on disk but can never authorize a request.
                if (!record || !record.userId || record.expiresAt <= Date.now()) return null;
                if (renew) { record.expiresAt = Date.now() + ttl; await storage.write('sessions', entries); }
                const { id: _id, ...data } = record;
                return { sessionId: id, data };
            });
        },
        async destroy(req) {
            const id = idFrom(req);
            if (!id) return;
            await storage.transaction(async () => {
                const entries = await storage.read('sessions');
                const remaining = entries.filter(entry => entry.id !== id);
                if (remaining.length !== entries.length) await storage.write('sessions', remaining);
            });
        },
        async updateUser(userId, updates) {
            await storage.transaction(async () => {
                const entries = await storage.read('sessions');
                if (!entries.some(entry => entry.userId === userId)) return;
                await storage.write('sessions', entries.flatMap(entry => entry.userId !== userId ? [entry] : updates === null ? [] : [{ ...entry, ...updates, id: entry.id, userId: entry.userId }]));
            });
        }
    };
}
module.exports = { createSessions };
