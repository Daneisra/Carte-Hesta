export const AVAILABILITY_DAYS = [
    { id: 'mon', label: 'Lun' },
    { id: 'tue', label: 'Mar' },
    { id: 'wed', label: 'Mer' },
    { id: 'thu', label: 'Jeu' },
    { id: 'fri', label: 'Ven' },
    { id: 'sat', label: 'Sam' },
    { id: 'sun', label: 'Dim' }
];

export const AVAILABILITY_SLOTS = [
    { id: 'morning', label: 'Matin', range: '08-12' },
    { id: 'afternoon', label: 'Apres-midi', range: '12-18' },
    { id: 'evening', label: 'Soir', range: '18-22' },
    { id: 'night', label: 'Nuit', range: '22-02' }
];

export const AVAILABILITY_STATUS = {
    AVAILABLE: 'available',
    MAYBE: 'maybe',
    BUSY: 'busy'
};

export const AVAILABILITY_STATUS_OPTIONS = [
    { id: AVAILABILITY_STATUS.AVAILABLE, label: 'Disponible' },
    { id: AVAILABILITY_STATUS.MAYBE, label: 'Incertain' },
    { id: AVAILABILITY_STATUS.BUSY, label: 'Indisponible' }
];

export const resolveLocalTimezone = () => {
    try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        return tz || 'UTC';
    } catch (_error) {
        return 'UTC';
    }
};

export const createAvailabilityMatrix = () => (
    AVAILABILITY_DAYS.map(() => AVAILABILITY_SLOTS.map(() => false))
);

export const createAvailabilityStatusMatrix = () => (
    AVAILABILITY_DAYS.map(() => AVAILABILITY_SLOTS.map(() => null))
);

export const normalizeAvailabilityStatus = value => {
    if (value === true) {
        return AVAILABILITY_STATUS.AVAILABLE;
    }
    if (value === false || value === null || value === undefined || value === '') {
        return null;
    }
    const normalized = String(value).trim().toLowerCase();
    if (['available', 'disponible', 'yes', 'true', '1'].includes(normalized)) {
        return AVAILABILITY_STATUS.AVAILABLE;
    }
    if (['maybe', 'uncertain', 'incertain'].includes(normalized)) {
        return AVAILABILITY_STATUS.MAYBE;
    }
    if (['busy', 'unavailable', 'indisponible', 'no', 'false', '0'].includes(normalized)) {
        return AVAILABILITY_STATUS.BUSY;
    }
    return Boolean(value) ? AVAILABILITY_STATUS.AVAILABLE : null;
};

export const normalizeAvailabilityStatusPayload = (payload, fallbackTimezone = '') => {
    if (!payload || typeof payload !== 'object') {
        return null;
    }
    const timezone = typeof payload.timezone === 'string' && payload.timezone.trim()
        ? payload.timezone.trim()
        : (fallbackTimezone || '');
    const source = Array.isArray(payload.slots)
        ? payload.slots
        : (Array.isArray(payload.days) ? payload.days : null);
    if (!Array.isArray(source)) {
        return null;
    }
    const matrix = createAvailabilityStatusMatrix();
    for (let dayIndex = 0; dayIndex < AVAILABILITY_DAYS.length; dayIndex += 1) {
        const daySlots = Array.isArray(source[dayIndex]) ? source[dayIndex] : [];
        for (let slotIndex = 0; slotIndex < AVAILABILITY_SLOTS.length; slotIndex += 1) {
            matrix[dayIndex][slotIndex] = normalizeAvailabilityStatus(daySlots[slotIndex]);
        }
    }
    return { timezone: timezone || null, slots: matrix };
};

export const normalizeAvailabilityPayload = (payload, fallbackTimezone = '') => {
    if (!payload || typeof payload !== 'object') {
        return null;
    }
    const timezone = typeof payload.timezone === 'string' && payload.timezone.trim()
        ? payload.timezone.trim()
        : (fallbackTimezone || '');
    const source = Array.isArray(payload.slots)
        ? payload.slots
        : (Array.isArray(payload.days) ? payload.days : null);
    if (!Array.isArray(source)) {
        return null;
    }
    const matrix = createAvailabilityMatrix();
    for (let dayIndex = 0; dayIndex < AVAILABILITY_DAYS.length; dayIndex += 1) {
        const daySlots = Array.isArray(source[dayIndex]) ? source[dayIndex] : [];
        for (let slotIndex = 0; slotIndex < AVAILABILITY_SLOTS.length; slotIndex += 1) {
            matrix[dayIndex][slotIndex] = normalizeAvailabilityStatus(daySlots[slotIndex]) === AVAILABILITY_STATUS.AVAILABLE;
        }
    }
    return { timezone: timezone || null, slots: matrix };
};
