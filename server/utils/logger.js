const formatTimestamp = () => new Date().toISOString();

const formatMessage = (level, message) => `[${formatTimestamp()}] ${level} ${message}`;

const serializeMeta = meta => {
    if (!meta || typeof meta !== 'object') {
        return '';
    }
    try {
        return ` ${JSON.stringify(meta)}`;
    } catch (error) {
        return ` ${String(meta)}`;
    }
};

const emit = (level, message, meta) => {
    const formatted = formatMessage(level, message);
    const suffix = meta === undefined ? '' : serializeMeta(meta);
    if (level === 'ERROR') {
        console.error(formatted + suffix);
    } else if (level === 'WARN') {
        console.warn(formatted + suffix);
    } else if (level === 'INFO') {
        console.info(formatted + suffix);
    } else {
        console.debug(formatted + suffix);
    }
};

const makeLogger = prefix => ({
    debug: (message, meta) => emit('DEBUG', prefix ? `${prefix} ${message}` : message, meta),
    info: (message, meta) => emit('INFO', prefix ? `${prefix} ${message}` : message, meta),
    warn: (message, meta) => emit('WARN', prefix ? `${prefix} ${message}` : message, meta),
    error: (message, meta) => emit('ERROR', prefix ? `${prefix} ${message}` : message, meta),
    child: childPrefix => makeLogger(prefix ? `${prefix} ${childPrefix}` : childPrefix)
});

module.exports = makeLogger('[server]');
