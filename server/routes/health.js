module.exports = (register, { json }) => {
    register('GET', '/health', async (_req, res) => {
        json(res, 200, {
            status: 'ok',
            timestamp: new Date().toISOString(),
            uptime: process.uptime()
        });
    });
};
