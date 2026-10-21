module.exports = (register, context) => {
    const { json, readTimelineFile, writeTimelineFile, ensureAuthorized, collectBody } = context;
    const adminTimelinePaths = ['/api/admin/timeline-config', '/api/admin/timeline'];
    register('GET', '/api/timeline', (req, res, url) => context.security.handle(req, res, url));

    adminTimelinePaths.forEach(path => {
        register('GET', path, async (req, res) => {
            if (!(await ensureAuthorized(req, res, 'admin'))) {
                return;
            }
            const timeline = await readTimelineFile();
            json(res, 200, { status: 'ok', timeline });
        });

        register('PATCH', path, async (req, res) => {
            if (!(await ensureAuthorized(req, res, 'admin'))) {
                return;
            }
            let payload;
            try {
                payload = JSON.parse(await collectBody(req) || '{}');
            } catch (error) {
                json(res, 400, { status: 'error', message: 'Invalid JSON' });
                return;
            }
            const nextTimeline = payload?.timeline && typeof payload.timeline === 'object' ? payload.timeline : payload;
            await writeTimelineFile(nextTimeline);
            const timeline = await readTimelineFile();
            json(res, 200, { status: 'ok', timeline });
        });

        register('PUT', path, async (req, res) => {
            if (!(await ensureAuthorized(req, res, 'admin'))) {
                return;
            }
            let payload;
            try {
                payload = JSON.parse(await collectBody(req) || '{}');
            } catch (error) {
                json(res, 400, { status: 'error', message: 'Invalid JSON' });
                return;
            }
            const nextTimeline = payload?.timeline && typeof payload.timeline === 'object' ? payload.timeline : payload;
            await writeTimelineFile(nextTimeline);
            const timeline = await readTimelineFile();
            json(res, 200, { status: 'ok', timeline });
        });
    });
};
