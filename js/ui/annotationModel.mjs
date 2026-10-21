export const DEFAULT_ANNOTATION_COLOR = '#ff8a00';

export const normalizeAnnotationId = annotationId => {
    if (annotationId === null || annotationId === undefined) {
        return '';
    }
    return String(annotationId).trim();
};

export const normalizeAnnotationColor = value => {
    const normalized = (value || '').toString().trim();
    if (!normalized) {
        return DEFAULT_ANNOTATION_COLOR;
    }
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(normalized)) {
        return normalized;
    }
    if (/^[0-9a-f]{3}$/i.test(normalized)) {
        return `#${normalized}`;
    }
    if (/^[0-9a-f]{6}$/i.test(normalized)) {
        return `#${normalized}`;
    }
    return DEFAULT_ANNOTATION_COLOR;
};
