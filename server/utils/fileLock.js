const locks = new Map();

async function withFileLock(targetPath, task) {
    const key = String(targetPath);
    const previous = locks.get(key) || Promise.resolve();

    let result;
    const next = previous.catch(() => {}).then(async () => {
        result = await task();
        return result;
    });

    locks.set(key, next.catch(() => {}));

    try {
        return await next;
    } finally {
        const current = locks.get(key);
        if (current === next || current === undefined) {
            locks.delete(key);
        }
    }
}

module.exports = {
    withFileLock
};
