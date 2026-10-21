// The security service owns reads, creation and non-destructive withdrawal together.
// Retained registration keeps the router contract; the main HTTP boundary also invokes it.
module.exports = (register, context) => {
    for (const method of ['GET', 'POST']) register(method, '/api/annotations', (req, res, url) => context.security.handle(req, res, url));
    register('DELETE', /^\/api\/annotations\/(?<id>[^/]+)$/, (req, res, url) => context.security.handle(req, res, url));
};
