/* eslint-disable no-console */

const hasPerformanceNow = typeof performance !== 'undefined' && typeof performance.now === 'function';

const now = () => (hasPerformanceNow ? performance.now() : Date.now());

const round = value => Number(value.toFixed(2));

export function startTimer(label, context = {}) {
    return {
        label,
        context: { ...context },
        start: now()
    };
}

export function endTimer(timer, extra = {}) {
    if (!timer) {
        return 0;
    }
    const duration = now() - timer.start;
    const payload = {
        ...timer.context,
        ...extra,
        durationMs: round(duration)
    };
    console.info(`Perf · ${timer.label}`, payload);
    return duration;
}

export async function timeAsync(label, work, context = {}) {
    const timer = startTimer(label, context);
    try {
        const result = await work();
        endTimer(timer, { status: 'ok' });
        return result;
    } catch (error) {
        endTimer(timer, { status: 'error', error: error?.message || String(error) });
        throw error;
    }
}

export function logMetric(label, values = {}) {
    console.info(`Perf · ${label}`, values);
}
