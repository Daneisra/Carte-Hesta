import {
    AVAILABILITY_DAYS,
    AVAILABILITY_SLOTS,
    AVAILABILITY_STATUS,
    AVAILABILITY_STATUS_OPTIONS,
    createAvailabilityStatusMatrix,
    normalizeAvailabilityStatusPayload,
    resolveLocalTimezone
} from './ui/availability.mjs';

const SITE_CONFIG_URL = '/assets/site-config.json';
const SESSION_URL = '/auth/session';
const PROFILE_URL = '/api/profile';
const SESSIONS_URL = '/api/planning/sessions';
const ADMIN_SESSIONS_URL = '/api/admin/planning/sessions';
const DATED_AVAILABILITY_URL = '/api/planning/my-availability';

const dom = {
    year: document.getElementById('planning-year'),
    version: document.getElementById('planning-version'),
    versionFooter: document.getElementById('planning-version-footer'),
    status: document.getElementById('planning-status'),
    profileName: document.getElementById('planning-profile-name'),
    timezone: document.getElementById('planning-timezone'),
    login: document.getElementById('planning-login'),
    calendar: document.getElementById('planning-calendar'),
    save: document.getElementById('planning-save'),
    clear: document.getElementById('planning-clear'),
    viewWeek: document.getElementById('planning-view-week'),
    viewMonth: document.getElementById('planning-view-month'),
    weekView: document.getElementById('planning-week-view'),
    monthView: document.getElementById('planning-month-view'),
    monthTitle: document.getElementById('planning-month-title'),
    monthGrid: document.getElementById('planning-month-grid'),
    agendaStatus: document.getElementById('planning-agenda-status'),
    agendaMonth: document.getElementById('planning-agenda-month'),
    agendaGrid: document.getElementById('planning-agenda-grid'),
    agendaList: document.getElementById('planning-agenda-list'),
    agendaPrev: document.getElementById('planning-month-prev'),
    agendaNext: document.getElementById('planning-month-next'),
    agendaToday: document.getElementById('planning-month-today'),
    datedStatus: document.getElementById('planning-dated-status'),
    datedForm: document.getElementById('planning-dated-form'),
    datedDate: document.getElementById('planning-dated-date'),
    datedStart: document.getElementById('planning-dated-start'),
    datedEnd: document.getElementById('planning-dated-end'),
    datedResponse: document.getElementById('planning-dated-response'),
    datedComment: document.getElementById('planning-dated-comment'),
    datedSelectedDates: document.getElementById('planning-dated-selected-dates'),
    datedList: document.getElementById('planning-dated-list'),
    adminLink: document.getElementById('planning-admin-link'),
    adminPanel: document.getElementById('planning-admin'),
    adminStatus: document.getElementById('planning-admin-status'),
    adminForm: document.getElementById('planning-admin-form'),
    adminId: document.getElementById('planning-admin-session-id'),
    adminTitle: document.getElementById('planning-admin-title-input'),
    adminDate: document.getElementById('planning-admin-date'),
    adminStart: document.getElementById('planning-admin-start'),
    adminDuration: document.getElementById('planning-admin-duration'),
    adminGroup: document.getElementById('planning-admin-group'),
    adminGroupId: document.getElementById('planning-admin-group-id'),
    adminSessionStatus: document.getElementById('planning-admin-session-status'),
    adminDescription: document.getElementById('planning-admin-description'),
    adminSelectedDates: document.getElementById('planning-admin-selected-dates'),
    adminSave: document.getElementById('planning-admin-save'),
    adminReset: document.getElementById('planning-admin-reset'),
    adminList: document.getElementById('planning-admin-list')
};

const state = {
    authenticated: false,
    username: 'Invite',
    timezone: resolveLocalTimezone(),
    slots: createAvailabilityStatusMatrix(),
    sessions: [],
    datedAvailability: [],
    datedSelectedDates: [],
    agendaMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    view: 'week',
    dirty: false,
    saving: false,
    datedSaving: false,
    role: 'guest',
    adminSaving: false,
    adminEditingId: '',
    adminSelectedDates: []
};

const setText = (node, value) => {
    if (node) {
        node.textContent = value;
    }
};

const setStatus = (message, isError = false) => {
    if (!dom.status) {
        return;
    }
    dom.status.textContent = message;
    dom.status.classList.toggle('is-error', isError);
};

const getDayLabel = dayId => AVAILABILITY_DAYS.find(day => day.id === dayId)?.label || dayId;
const getSlotLabel = slotId => AVAILABILITY_SLOTS.find(slot => slot.id === slotId)?.label || slotId;
const getStatusLabel = status => AVAILABILITY_STATUS_OPTIONS.find(option => option.id === status)?.label || 'Non renseigne';
const getAvailabilityChipClass = status => {
    if (status === AVAILABILITY_STATUS.BUSY) {
        return 'is-availability-busy';
    }
    if (status === AVAILABILITY_STATUS.MAYBE) {
        return 'is-availability-maybe';
    }
    return 'is-availability';
};
const setDatedStatus = (message, isError = false) => {
    if (!dom.datedStatus) {
        return;
    }
    dom.datedStatus.textContent = message;
    dom.datedStatus.classList.toggle('is-error', isError);
};
const setAdminStatus = (message, isError = false) => {
    if (!dom.adminStatus) {
        return;
    }
    dom.adminStatus.textContent = message;
    dom.adminStatus.classList.toggle('is-error', isError);
};
const setAgendaStatus = (message, isError = false) => {
    if (!dom.agendaStatus) {
        return;
    }
    dom.agendaStatus.textContent = message;
    dom.agendaStatus.classList.toggle('is-error', isError);
};
const formatDateKey = date => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};
const formatMonthDate = date => {
    try {
        return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(date);
    } catch (_error) {
        return `${date.getDate()}/${date.getMonth() + 1}`;
    }
};
const formatMonthTitle = date => {
    try {
        return new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(date);
    } catch (_error) {
        return `${date.getMonth() + 1}/${date.getFullYear()}`;
    }
};
const formatFullDate = value => {
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    try {
        return new Intl.DateTimeFormat('fr-FR', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        }).format(date);
    } catch (_error) {
        return value;
    }
};
const getUniqueDates = dates => [...new Set(
    dates.filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date || ''))
)].sort();
const renderSelectedDates = (container, dates, action, disabled = false) => {
    if (!container) {
        return;
    }
    if (!dates.length) {
        container.replaceChildren(Object.assign(document.createElement('span'), {
            className: 'planning-selected-dates-empty',
            textContent: 'Aucune date selectionnee.'
        }));
        return;
    }
    container.replaceChildren(...dates.map(date => {
        const chip = document.createElement('span');
        chip.className = 'planning-selected-date';
        const text = document.createElement('span');
        text.textContent = formatFullDate(date);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.dataset.dateAction = action;
        remove.dataset.date = date;
        remove.disabled = disabled;
        remove.setAttribute('aria-label', `Retirer ${formatFullDate(date)}`);
        remove.textContent = 'Retirer';
        chip.append(text, remove);
        return chip;
    }));
};
const addDatedSelectedDate = date => {
    state.datedSelectedDates = getUniqueDates([...state.datedSelectedDates, date]);
    renderSelectedDates(dom.datedSelectedDates, state.datedSelectedDates, 'dated-remove', state.datedSaving);
};
const addAdminSelectedDate = date => {
    state.adminSelectedDates = getUniqueDates([...state.adminSelectedDates, date]);
    renderSelectedDates(dom.adminSelectedDates, state.adminSelectedDates, 'admin-remove', state.adminSaving);
    syncAdminPanel();
};
const getSessionStatusLabel = status => {
    if (status === 'confirmed') {
        return 'Confirmee';
    }
    if (status === 'cancelled') {
        return 'Annulee';
    }
    return 'Candidate';
};
const getSessionStatusClass = status => {
    if (status === 'confirmed') {
        return 'is-confirmed';
    }
    if (status === 'cancelled') {
        return 'is-cancelled';
    }
    return 'is-candidate';
};
const isAdmin = () => state.role === 'admin' || (state.managedGroupIds || []).length > 0;
const getResponseSummaryText = summary => {
    const available = Number(summary?.available) || 0;
    const maybe = Number(summary?.maybe) || 0;
    const busy = Number(summary?.busy) || 0;
    return `${available} dispo / ${maybe} incertain / ${busy} indispo`;
};
const getPlanningInsightText = insight => {
    const dated = insight?.dated || {};
    const weekly = insight?.weekly || {};
    const signal = Number(dated.respondents) > 0 ? dated : weekly;
    const available = Number(signal.available) || 0;
    const maybe = Number(signal.maybe) || 0;
    const busy = Number(signal.busy) || 0;
    if (!insight || insight.quality === 'unknown') {
        return 'Pas assez de disponibilites pour evaluer ce creneau.';
    }
    return `${Number(dated.respondents) > 0 ? 'Disponibilites datees' : 'Creneau prevu'}: ${available} dispo / ${maybe} incertain / ${busy} conflit`;
};
const getNextStatus = status => {
    if (!status) {
        return AVAILABILITY_STATUS.AVAILABLE;
    }
    if (status === AVAILABILITY_STATUS.AVAILABLE) {
        return AVAILABILITY_STATUS.MAYBE;
    }
    if (status === AVAILABILITY_STATUS.MAYBE) {
        return AVAILABILITY_STATUS.BUSY;
    }
    return null;
};

const getMonthDays = monthDate => {
    const firstOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const startOffset = (firstOfMonth.getDay() + 6) % 7;
    const start = new Date(firstOfMonth);
    start.setDate(firstOfMonth.getDate() - startOffset);
    return Array.from({ length: 42 }, (_entry, index) => {
        const date = new Date(start);
        date.setDate(start.getDate() + index);
        return date;
    });
};

const getSessionsForMonth = () => {
    const year = state.agendaMonth.getFullYear();
    const month = state.agendaMonth.getMonth();
    return state.sessions.filter(session => {
        const date = new Date(`${session.date}T00:00:00`);
        return !Number.isNaN(date.getTime()) && date.getFullYear() === year && date.getMonth() === month;
    });
};

const getDatedAvailabilityForMonth = () => {
    const year = state.agendaMonth.getFullYear();
    const month = state.agendaMonth.getMonth();
    return state.datedAvailability.filter(entry => {
        const date = new Date(`${entry.date}T00:00:00`);
        return !Number.isNaN(date.getTime()) && date.getFullYear() === year && date.getMonth() === month;
    });
};

const syncDatedForm = () => {
    const disabled = !state.authenticated || state.datedSaving;
    [
        dom.datedDate,
        dom.datedStart,
        dom.datedEnd,
        dom.datedResponse,
        dom.datedComment
    ].forEach(field => {
        if (field) {
            field.disabled = disabled;
        }
    });
    const button = dom.datedForm?.querySelector?.('button[type="submit"]');
    if (button) {
        button.disabled = disabled;
        button.textContent = state.datedSaving
            ? 'Sauvegarde...'
            : (state.datedSelectedDates.length > 1 ? 'Ajouter ces creneaux' : 'Ajouter ce creneau');
    }
    renderSelectedDates(dom.datedSelectedDates, state.datedSelectedDates, 'dated-remove', disabled);
};

const renderDatedAvailability = () => {
    syncDatedForm();
    if (!dom.datedList) {
        return;
    }
    if (!state.authenticated) {
        dom.datedList.replaceChildren(Object.assign(document.createElement('article'), {
            className: 'planning-dated-empty',
            textContent: 'Connectez-vous via Discord pour renseigner vos disponibilites datees.'
        }));
        return;
    }
    const entries = [...state.datedAvailability].sort((a, b) => (
        a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime)
    ));
    if (!entries.length) {
        dom.datedList.replaceChildren(Object.assign(document.createElement('article'), {
            className: 'planning-dated-empty',
            textContent: 'Aucune disponibilite datee enregistree.'
        }));
        return;
    }
    dom.datedList.replaceChildren(...entries.map(entry => {
        const item = document.createElement('article');
        item.className = `planning-dated-entry is-${entry.status || 'available'}`;
        const content = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = `${formatFullDate(entry.date)} - ${entry.startTime} a ${entry.endTime}`;
        const status = document.createElement('span');
        status.textContent = getStatusLabel(entry.status);
        const comment = document.createElement('small');
        comment.textContent = entry.comment || 'Sans note.';
        content.append(title, status, comment);
        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'planning-dated-delete';
        deleteButton.dataset.availabilityId = entry.id;
        deleteButton.textContent = 'Supprimer';
        item.append(content, deleteButton);
        return item;
    }));
};

const syncAdminPanel = () => {
    const canAdmin = isAdmin();
    if (dom.adminLink) {
        dom.adminLink.hidden = !canAdmin;
    }
    if (dom.adminPanel) {
        dom.adminPanel.hidden = !canAdmin;
    }
    const disabled = !canAdmin || state.adminSaving;
    [
        dom.adminTitle,
        dom.adminDate,
        dom.adminStart,
        dom.adminDuration,
        dom.adminGroup,
        dom.adminGroupId,
        dom.adminSessionStatus,
        dom.adminDescription
    ].forEach(field => {
        if (field) {
            field.disabled = disabled;
        }
    });
    if (dom.adminSave) {
        dom.adminSave.disabled = disabled;
        dom.adminSave.textContent = state.adminSaving
            ? 'Sauvegarde...'
            : (state.adminEditingId
                ? 'Modifier la session'
                : (state.adminSelectedDates.length > 1 ? 'Creer les sessions' : 'Creer la session'));
    }
    if (dom.adminReset) {
        dom.adminReset.disabled = disabled;
    }
    renderSelectedDates(dom.adminSelectedDates, state.adminSelectedDates, 'admin-remove', disabled || Boolean(state.adminEditingId));
};

const resetAdminForm = () => {
    state.adminEditingId = '';
    state.adminSelectedDates = [];
    if (dom.adminId) {
        dom.adminId.value = '';
    }
    if (dom.adminTitle) {
        dom.adminTitle.value = '';
    }
    if (dom.adminDate) {
        dom.adminDate.value = '';
    }
    if (dom.adminStart) {
        dom.adminStart.value = '20:30';
    }
    if (dom.adminDuration) {
        dom.adminDuration.value = '180';
    }
    if (dom.adminGroupId) dom.adminGroupId.value = '';
    if (dom.adminGroup) {
        dom.adminGroup.value = '';
    }
    if (dom.adminSessionStatus) {
        dom.adminSessionStatus.value = 'candidate';
    }
    if (dom.adminDescription) {
        dom.adminDescription.value = '';
    }
    syncAdminPanel();
};

const fillAdminForm = session => {
    if (!session) {
        resetAdminForm();
        return;
    }
    state.adminEditingId = session.id || '';
    state.adminSelectedDates = [];
    if (dom.adminId) {
        dom.adminId.value = state.adminEditingId;
    }
    if (dom.adminTitle) {
        dom.adminTitle.value = session.title || '';
    }
    if (dom.adminDate) {
        dom.adminDate.value = session.date || formatDateKey(new Date());
        addAdminSelectedDate(dom.adminDate.value);
    }
    if (dom.adminStart) {
        dom.adminStart.value = session.startTime || '20:30';
    }
    if (dom.adminDuration) {
        dom.adminDuration.value = String(session.durationMinutes || 180);
    }
    if (dom.adminGroupId) dom.adminGroupId.value = session.groupId || '';
    if (dom.adminGroup) {
        dom.adminGroup.value = session.groupName || session.groupId || '';
    }
    if (dom.adminSessionStatus) {
        dom.adminSessionStatus.value = session.status || 'candidate';
    }
    if (dom.adminDescription) {
        dom.adminDescription.value = session.description || '';
    }
    syncAdminPanel();
    setAdminStatus(`Edition de "${session.title}".`);
};

const renderAdminSessions = () => {
    syncAdminPanel();
    if (!dom.adminList) {
        return;
    }
    if (!isAdmin()) {
        dom.adminList.replaceChildren(Object.assign(document.createElement('article'), {
            className: 'planning-admin-empty',
            textContent: 'Connectez-vous avec un compte admin pour gerer les sessions.'
        }));
        return;
    }
    if (!state.sessions.length) {
        dom.adminList.replaceChildren(Object.assign(document.createElement('article'), {
            className: 'planning-admin-empty',
            textContent: 'Aucune session candidate chargee.'
        }));
        return;
    }
    dom.adminList.replaceChildren(...state.sessions.filter(session => session.canManage !== false).map(session => {
        const item = document.createElement('article');
        item.className = `planning-admin-entry ${getSessionStatusClass(session.status)}`;
        const content = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = session.title;
        const meta = document.createElement('span');
        meta.textContent = `${formatFullDate(session.date)} - ${session.startTime || '--:--'} - ${getSessionStatusLabel(session.status)}`;
        const detail = document.createElement('small');
        detail.textContent = session.groupName || session.groupId || 'Aucun groupe lie';
        content.append(title, meta, detail);
        const actions = document.createElement('div');
        actions.className = 'planning-admin-entry-actions';
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.dataset.adminAction = 'edit';
        edit.dataset.sessionId = session.id;
        edit.textContent = 'Modifier';
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.dataset.adminAction = 'delete';
        remove.dataset.sessionId = session.id;
        remove.textContent = 'Supprimer';
        actions.append(edit, remove);
        item.append(content, actions);
        return item;
    }));
};

const renderAgenda = () => {
    if (!dom.agendaGrid || !dom.agendaList) {
        return;
    }
    setText(dom.agendaMonth, formatMonthTitle(state.agendaMonth));
    const month = state.agendaMonth.getMonth();
    const sessionsByDate = state.sessions.reduce((lookup, session) => {
        if (!lookup.has(session.date)) {
            lookup.set(session.date, []);
        }
        lookup.get(session.date).push(session);
        return lookup;
    }, new Map());
    const availabilityByDate = state.datedAvailability.reduce((lookup, entry) => {
        if (!lookup.has(entry.date)) {
            lookup.set(entry.date, []);
        }
        lookup.get(entry.date).push(entry);
        return lookup;
    }, new Map());
    const days = getMonthDays(state.agendaMonth);
    dom.agendaGrid.replaceChildren(...days.map(date => {
        const dateKey = formatDateKey(date);
        const daySessions = sessionsByDate.get(dateKey) || [];
        const dayAvailability = availabilityByDate.get(dateKey) || [];
        const item = document.createElement('article');
        item.className = 'planning-agenda-day';
        item.tabIndex = 0;
        item.dataset.date = dateKey;
        item.classList.toggle('is-outside-month', date.getMonth() !== month);
        item.classList.toggle('has-session', daySessions.length > 0);
        item.classList.toggle('has-availability', dayAvailability.length > 0);
        item.setAttribute('aria-label', `${formatFullDate(dateKey)} - ${daySessions.length} session${daySessions.length > 1 ? 's' : ''}, ${dayAvailability.length} disponibilite${dayAvailability.length > 1 ? 's' : ''}`);

        const label = document.createElement('strong');
        label.textContent = String(date.getDate());
        item.appendChild(label);

        daySessions.slice(0, 3).forEach(session => {
            const chip = document.createElement('span');
            chip.className = `planning-agenda-chip ${getSessionStatusClass(session.status)}`;
            chip.textContent = `${session.startTime || '--:--'} ${session.title}`;
            item.appendChild(chip);
        });
        dayAvailability.slice(0, Math.max(0, 3 - daySessions.length)).forEach(entry => {
            const chip = document.createElement('span');
            chip.className = `planning-agenda-chip ${getAvailabilityChipClass(entry.status)}`;
            chip.textContent = `${entry.startTime} Moi: ${getStatusLabel(entry.status)}`;
            item.appendChild(chip);
        });
        const hiddenCount = Math.max(0, (daySessions.length + dayAvailability.length) - 3);
        if (hiddenCount > 0) {
            const more = document.createElement('span');
            more.className = 'planning-agenda-more';
            more.textContent = `+${hiddenCount}`;
            item.appendChild(more);
        }
        return item;
    }));

    const monthSessions = getSessionsForMonth();
    if (!monthSessions.length) {
        dom.agendaList.replaceChildren(Object.assign(document.createElement('article'), {
            className: 'planning-agenda-empty',
            textContent: 'Aucune session candidate ou confirmee pour ce mois.'
        }));
        return;
    }
    dom.agendaList.replaceChildren(...monthSessions.map(session => {
        const item = document.createElement('article');
        item.className = `planning-agenda-session ${getSessionStatusClass(session.status)}`;
        const meta = document.createElement('span');
        meta.className = 'planning-agenda-session-meta';
        const duration = session.durationMinutes ? ` - ${session.durationMinutes} min` : '';
        meta.textContent = `${formatFullDate(session.date)} - ${session.startTime || '--:--'}${duration}`;
        const title = document.createElement('strong');
        title.textContent = session.title;
        const badge = document.createElement('span');
        badge.className = 'planning-agenda-session-badge';
        badge.textContent = getSessionStatusLabel(session.status);
        const description = document.createElement('p');
        description.textContent = session.description || 'Aucune description renseignee.';
        const group = document.createElement('small');
        group.textContent = session.groupName || session.groupId || 'Aucun groupe lie';
        const summary = document.createElement('span');
        summary.className = 'planning-agenda-response-summary';
        summary.textContent = getResponseSummaryText(session.responseSummary);
        const insight = document.createElement('div');
        insight.className = `planning-agenda-insight is-${session.planningInsight?.quality || 'unknown'}`;
        const insightText = document.createElement('span');
        insightText.textContent = getPlanningInsightText(session.planningInsight);
        insight.append(insightText);
        const actions = document.createElement('div');
        actions.className = 'planning-agenda-response-actions';
        actions.hidden = !state.authenticated || session.canRespond === false;
        [
            { status: AVAILABILITY_STATUS.AVAILABLE, label: 'Disponible' },
            { status: AVAILABILITY_STATUS.MAYBE, label: 'Incertain' },
            { status: AVAILABILITY_STATUS.BUSY, label: 'Indisponible' }
        ].forEach(option => {
            const button = document.createElement('button');
            button.type = 'button';
            button.dataset.sessionId = session.id;
            button.dataset.responseStatus = option.status;
            button.textContent = option.label;
            actions.appendChild(button);
        });
        item.append(meta, title, badge, description, group, summary, insight, actions);
        if (session.canManage) {
            const inspect = document.createElement('button'); inspect.type = 'button'; inspect.textContent = 'Disponibilités de cette session';
            const details = document.createElement('div');
            inspect.addEventListener('click', async () => {
                details.replaceChildren();
                try {
                    const response = await fetch(`/api/planning/sessions/${encodeURIComponent(session.id)}/availability`, { credentials: 'include', cache: 'no-store' });
                    if (!response.ok) throw new Error('Accès refusé');
                    const payload = await response.json();
                    for (const member of payload.members || []) {
                        const text = document.createElement('p');
                        text.textContent = `${member.username} : ${member.response?.status || 'Sans réponse'} ${member.response?.comment || ''} — ${(member.availability || []).map(entry => `${entry.startTime}–${entry.endTime} ${entry.status} ${entry.comment || ''}`).join(' ; ')}`;
                        details.append(text);
                    }
                } catch { details.textContent = 'Disponibilités indisponibles.'; }
            });
            item.append(inspect, details);
        }
        return item;
    }));
};

const loadDatedAvailability = async () => {
    const generation = state.accessGeneration || 0;
    if (!state.authenticated) {
        state.datedAvailability = [];
        setDatedStatus('Connectez-vous pour renseigner vos disponibilites.', true);
        renderDatedAvailability();
        renderAgenda();
        return;
    }
    setDatedStatus('Chargement de vos disponibilites datees...');
    try {
        const response = await fetch(DATED_AVAILABILITY_URL, { credentials: 'include', cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const payload = await response.json();
        if (generation !== (state.accessGeneration || 0)) return;
        state.datedAvailability = Array.isArray(payload?.availability) ? payload.availability : [];
        setDatedStatus(state.datedAvailability.length
            ? `${state.datedAvailability.length} disponibilite${state.datedAvailability.length > 1 ? 's' : ''} chargee${state.datedAvailability.length > 1 ? 's' : ''}.`
            : 'Aucune disponibilite datee pour le moment.');
    } catch (error) {
        if (generation !== (state.accessGeneration || 0)) return;
        console.warn('[planning] dated availability unavailable', error);
        state.datedAvailability = [];
        setDatedStatus('Disponibilites datees indisponibles.', true);
    }
    renderDatedAvailability();
    renderAgenda();
};

const saveDatedAvailability = async event => {
    event?.preventDefault?.();
    if (!state.authenticated || state.datedSaving) {
        setDatedStatus('Connectez-vous via Discord pour renseigner vos disponibilites.', true);
        return;
    }
    const dates = getUniqueDates([...state.datedSelectedDates, dom.datedDate?.value || '']);
    const payload = {
        date: dates[0] || '',
        dates,
        startTime: dom.datedStart?.value || '',
        endTime: dom.datedEnd?.value || '',
        status: dom.datedResponse?.value || AVAILABILITY_STATUS.AVAILABLE,
        comment: dom.datedComment?.value || ''
    };
    state.datedSaving = true;
    syncDatedForm();
    setDatedStatus('Sauvegarde du creneau...');
    try {
        const response = await fetch(DATED_AVAILABILITY_URL, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const result = await response.json();
        state.datedAvailability = Array.isArray(result?.availability) ? result.availability : state.datedAvailability;
        if (dom.datedComment) {
            dom.datedComment.value = '';
        }
        state.datedSelectedDates = [];
        if (dom.datedDate) {
            dom.datedDate.value = '';
        }
        setDatedStatus(dates.length > 1
            ? `${dates.length} disponibilites datees enregistrees.`
            : 'Disponibilite datee enregistree.');
        renderDatedAvailability();
        renderAgenda();
        loadSessions();
    } catch (error) {
        console.error('[planning] dated availability save failed', error);
        setDatedStatus('Impossible d enregistrer ce creneau.', true);
    } finally {
        state.datedSaving = false;
        syncDatedForm();
    }
};

const deleteDatedAvailability = async id => {
    if (!state.authenticated || state.datedSaving || !id) {
        return;
    }
    state.datedSaving = true;
    syncDatedForm();
    setDatedStatus('Suppression du creneau...');
    try {
        const response = await fetch(DATED_AVAILABILITY_URL, {
            method: 'DELETE',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const result = await response.json();
        state.datedAvailability = Array.isArray(result?.availability) ? result.availability : [];
        setDatedStatus('Disponibilite supprimee.');
        renderDatedAvailability();
        renderAgenda();
        loadSessions();
    } catch (error) {
        console.error('[planning] dated availability delete failed', error);
        setDatedStatus('Impossible de supprimer ce creneau.', true);
    } finally {
        state.datedSaving = false;
        syncDatedForm();
    }
};

const saveSessionResponse = async (sessionId, status) => {
    if (!state.authenticated || !sessionId || !status) {
        setAgendaStatus('Connectez-vous via Discord pour repondre a une session.', true);
        return;
    }
    setAgendaStatus('Sauvegarde de votre reponse...');
    try {
        const response = await fetch(`/api/planning/sessions/${encodeURIComponent(sessionId)}/response`, {
            method: 'PATCH',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const payload = await response.json();
        const nextSession = payload?.session;
        if (nextSession?.id) {
            state.sessions = state.sessions.map(session => (
                session.id === nextSession.id ? nextSession : session
            ));
        }
        setAgendaStatus('Reponse enregistree.');
        renderAgenda();
        renderAdminSessions();
    } catch (error) {
        console.warn('[planning] session response save failed', error);
        setAgendaStatus('Impossible d enregistrer votre reponse.', true);
    }
};

const collectAdminSessionPayload = () => ({
    id: dom.adminId?.value || undefined,
    title: dom.adminTitle?.value || '',
    date: dom.adminDate?.value || '',
    startTime: dom.adminStart?.value || '',
    durationMinutes: Number(dom.adminDuration?.value) || 180,
    groupName: dom.adminGroup?.value || '',
    groupId: dom.adminGroupId?.value || '',
    status: dom.adminSessionStatus?.value || 'candidate',
    description: dom.adminDescription?.value || ''
});

const saveAdminSession = async event => {
    event?.preventDefault?.();
    if (!isAdmin() || state.adminSaving) {
        setAdminStatus('Action reservee aux admins.', true);
        return;
    }
    const payload = collectAdminSessionPayload();
    if (!payload.title.trim() || !payload.date) {
        setAdminStatus('Titre et date sont requis.', true);
        return;
    }
    const editing = Boolean(state.adminEditingId);
    if (editing) {
        payload.id = state.adminEditingId;
    } else {
        delete payload.id;
        payload.dates = getUniqueDates([...state.adminSelectedDates, payload.date]);
    }
    const createdCount = editing ? 1 : payload.dates.length;
    state.adminSaving = true;
    syncAdminPanel();
    setAdminStatus(editing ? 'Modification de la session...' : 'Creation de la session...');
    try {
        const response = await fetch(ADMIN_SESSIONS_URL, {
            method: editing ? 'PATCH' : 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const result = await response.json();
        state.sessions = Array.isArray(result?.sessions) ? result.sessions : state.sessions;
        if (!state.sessions.length && result?.session) {
            state.sessions = [result.session];
        }
        setAdminStatus(editing
            ? 'Session modifiee.'
            : (createdCount > 1 ? `${createdCount} sessions creees.` : 'Session creee.'));
        resetAdminForm();
        renderAgenda();
        renderAdminSessions();
    } catch (error) {
        console.error('[planning] admin session save failed', error);
        setAdminStatus('Impossible d enregistrer la session.', true);
    } finally {
        state.adminSaving = false;
        syncAdminPanel();
    }
};

const deleteAdminSession = async sessionId => {
    if (!isAdmin() || state.adminSaving || !sessionId) {
        return;
    }
    state.adminSaving = true;
    syncAdminPanel();
    setAdminStatus('Suppression de la session...');
    try {
        const response = await fetch(ADMIN_SESSIONS_URL, {
            method: 'DELETE',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: sessionId })
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const result = await response.json();
        state.sessions = Array.isArray(result?.sessions)
            ? result.sessions
            : state.sessions.filter(session => session.id !== sessionId);
        if (state.adminEditingId === sessionId) {
            resetAdminForm();
        }
        setAdminStatus('Session supprimee.');
        renderAgenda();
        renderAdminSessions();
    } catch (error) {
        console.error('[planning] admin session delete failed', error);
        setAdminStatus('Impossible de supprimer la session.', true);
    } finally {
        state.adminSaving = false;
        syncAdminPanel();
    }
};

const loadSessions = async () => {
    const generation = state.accessGeneration || 0;
    setAgendaStatus('Chargement de l agenda...');
    try {
        const response = await fetch(SESSIONS_URL, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const payload = await response.json();
        if (generation !== (state.accessGeneration || 0)) return;
        state.sessions = Array.isArray(payload?.sessions) ? payload.sessions : [];
        setAgendaStatus(state.sessions.length
            ? `${state.sessions.length} session${state.sessions.length > 1 ? 's' : ''} chargee${state.sessions.length > 1 ? 's' : ''}.`
            : 'Aucune session candidate pour le moment.');
    } catch (error) {
        console.warn('[planning] sessions unavailable', error);
        state.sessions = [];
        setAgendaStatus('Agenda indisponible pour le moment.', true);
    }
    renderAgenda();
    renderAdminSessions();
};

const shiftAgendaMonth = offset => {
    state.agendaMonth = new Date(state.agendaMonth.getFullYear(), state.agendaMonth.getMonth() + offset, 1);
    renderAgenda();
    renderDatedAvailability();
};

const getAvailabilityFromState = () => ({
    timezone: state.timezone || resolveLocalTimezone(),
    slots: state.slots
});

const syncActions = () => {
    if (dom.save) {
        dom.save.disabled = !state.authenticated || state.saving || !state.dirty;
    }
    if (dom.clear) {
        dom.clear.disabled = !state.authenticated || state.saving;
    }
    if (dom.login) {
        dom.login.hidden = state.authenticated;
    }
};

const syncSessionCard = () => {
    setText(dom.profileName, state.authenticated ? state.username : 'Invite');
    setText(dom.timezone, state.timezone || '--');
    syncActions();
};

const buildCalendar = () => {
    if (!dom.calendar || dom.calendar.dataset.ready === 'true') {
        return;
    }
    const header = document.createElement('div');
    header.className = 'planning-calendar-row planning-calendar-head';
    header.setAttribute('role', 'row');
    header.appendChild(Object.assign(document.createElement('span'), { textContent: 'Jour' }));
    header.lastElementChild.setAttribute('role', 'columnheader');
    AVAILABILITY_SLOTS.forEach(slot => {
        const cell = document.createElement('span');
        cell.setAttribute('role', 'columnheader');
        cell.textContent = slot.label;
        cell.title = slot.range ? `${slot.label} (${slot.range})` : slot.label;
        header.appendChild(cell);
    });
    dom.calendar.appendChild(header);

    AVAILABILITY_DAYS.forEach((day, dayIndex) => {
        const row = document.createElement('div');
        row.className = 'planning-calendar-row';
        row.setAttribute('role', 'row');

        const label = document.createElement('strong');
        label.setAttribute('role', 'rowheader');
        label.textContent = day.label;
        row.appendChild(label);

        AVAILABILITY_SLOTS.forEach((slot, slotIndex) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'planning-slot planning-slot-empty';
            button.setAttribute('role', 'cell');
            button.setAttribute('aria-pressed', 'false');
            button.setAttribute('aria-label', `${day.label} ${slot.label}`);
            button.dataset.dayIndex = String(dayIndex);
            button.dataset.slotIndex = String(slotIndex);
            button.title = slot.range ? `${slot.label} (${slot.range})` : slot.label;
            button.textContent = '--';
            row.appendChild(button);
        });

        dom.calendar.appendChild(row);
    });

    dom.calendar.addEventListener('click', event => {
        const button = event.target?.closest?.('.planning-slot');
        if (!button || !dom.calendar.contains(button)) {
            return;
        }
        if (!state.authenticated) {
            setStatus('Connectez-vous via Discord pour renseigner vos disponibilites.', true);
            return;
        }
        const dayIndex = Number(button.dataset.dayIndex);
        const slotIndex = Number(button.dataset.slotIndex);
        if (!Number.isFinite(dayIndex) || !Number.isFinite(slotIndex) || !state.slots[dayIndex]) {
            return;
        }
        state.slots[dayIndex][slotIndex] = getNextStatus(state.slots[dayIndex][slotIndex]);
        state.dirty = true;
        setStatus('Modifications en attente.');
        renderCalendar();
        syncActions();
    });

    dom.calendar.dataset.ready = 'true';
};

const renderCalendar = () => {
    buildCalendar();
    if (!dom.calendar) {
        return;
    }
    dom.calendar.classList.toggle('is-disabled', !state.authenticated);
    dom.calendar.querySelectorAll('.planning-slot').forEach(button => {
        const dayIndex = Number(button.dataset.dayIndex);
        const slotIndex = Number(button.dataset.slotIndex);
        const status = state.slots?.[dayIndex]?.[slotIndex] || null;
        button.classList.toggle('planning-slot-available', status === AVAILABILITY_STATUS.AVAILABLE);
        button.classList.toggle('planning-slot-maybe', status === AVAILABILITY_STATUS.MAYBE);
        button.classList.toggle('planning-slot-busy', status === AVAILABILITY_STATUS.BUSY);
        button.classList.toggle('planning-slot-empty', !status);
        button.setAttribute('aria-pressed', String(Boolean(status)));
        button.setAttribute('aria-label', `${button.getAttribute('aria-label')?.split(':')[0] || ''}: ${getStatusLabel(status)}`);
        button.disabled = state.saving;
        button.textContent = status ? getStatusLabel(status) : '--';
    });
    renderMonthView();
};

const renderMonthView = () => {
    if (!dom.monthGrid) {
        return;
    }
    const today = new Date();
    const days = [];
    for (let offset = 0; offset < 35; offset += 1) {
        const date = new Date(today);
        date.setDate(today.getDate() + offset);
        days.push(date);
    }
    setText(dom.monthTitle, `Projection ${formatMonthTitle(today)}`);
    dom.monthGrid.replaceChildren(...days.map(date => {
        const dayIndex = (date.getDay() + 6) % 7;
        const daySlots = state.slots?.[dayIndex] || [];
        const item = document.createElement('article');
        item.className = 'planning-month-day';
        const title = document.createElement('strong');
        title.textContent = formatMonthDate(date);
        const weekday = document.createElement('small');
        weekday.textContent = getDayLabel(AVAILABILITY_DAYS[dayIndex]?.id || '');
        const tags = document.createElement('div');
        tags.className = 'planning-month-tags';
        daySlots.forEach((status, slotIndex) => {
            if (!status) {
                return;
            }
            const tag = document.createElement('span');
            tag.className = `planning-month-tag planning-month-tag-${status}`;
            tag.textContent = `${getSlotLabel(AVAILABILITY_SLOTS[slotIndex]?.id || '')}: ${getStatusLabel(status)}`;
            tags.appendChild(tag);
        });
        if (!tags.childElementCount) {
            const empty = document.createElement('span');
            empty.className = 'planning-month-tag';
            empty.textContent = 'Non renseigne';
            tags.appendChild(empty);
        }
        item.append(title, weekday, tags);
        return item;
    }));
};

const setPlanningView = view => {
    state.view = view === 'month' ? 'month' : 'week';
    const isMonth = state.view === 'month';
    if (dom.weekView) {
        dom.weekView.hidden = isMonth;
    }
    if (dom.monthView) {
        dom.monthView.hidden = !isMonth;
    }
    if (dom.viewWeek) {
        dom.viewWeek.classList.toggle('is-active', !isMonth);
        dom.viewWeek.setAttribute('aria-selected', String(!isMonth));
    }
    if (dom.viewMonth) {
        dom.viewMonth.classList.toggle('is-active', isMonth);
        dom.viewMonth.setAttribute('aria-selected', String(isMonth));
    }
    renderMonthView();
};

const loadVersion = async () => {
    try {
        const response = await fetch(SITE_CONFIG_URL, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const config = await response.json();
        if (config?.version) {
            setText(dom.version, config.version);
            setText(dom.versionFooter, config.version);
        }
    } catch (error) {
        console.warn('[planning] site config unavailable, keeping static version', error);
    }
};

const selectAgendaDateForAvailability = dateKey => {
    if (!dateKey || !dom.datedDate) {
        return;
    }
    dom.datedDate.value = dateKey;
    addDatedSelectedDate(dateKey);
    if (!state.authenticated) {
        setDatedStatus('Date selectionnee. Connectez-vous via Discord pour enregistrer une disponibilite.', true);
    } else {
        setDatedStatus(`Date selectionnee: ${formatFullDate(dateKey)}.`);
    }
    dom.datedForm?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    dom.datedStart?.focus?.({ preventScroll: true });
};

const loadSession = async () => {
    const generation = state.accessGeneration || 0;
    try {
        const response = await fetch(SESSION_URL, { credentials: 'include', cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const session = await response.json();
        if (generation !== (state.accessGeneration || 0)) return;
        state.authenticated = Boolean(session?.authenticated);
        state.role = session?.role || 'guest';
        state.managedGroupIds = session?.managedGroupIds || [];
        const groupsResponse = await fetch('/api/groups', { credentials: 'include', cache: 'no-store' });
        if (groupsResponse.ok) {
            const groups = (await groupsResponse.json()).groups || [];
            const selectedGroup = dom.adminGroupId.value;
            dom.adminGroupId.replaceChildren(new Option('Aucun groupe (administrateur)', ''), ...groups.filter(group => state.role === 'admin' || state.managedGroupIds.includes(group.id)).map(group => new Option(group.name, group.id)));
            if ([...dom.adminGroupId.options].some(option => option.value === selectedGroup)) dom.adminGroupId.value = selectedGroup;
        }
        state.username = session?.username || 'Invite';
        const normalized = normalizeAvailabilityStatusPayload(session?.availability, state.timezone);
        state.timezone = normalized?.timezone || state.timezone || resolveLocalTimezone();
        state.slots = normalized?.slots || createAvailabilityStatusMatrix();
        state.dirty = false;
        setStatus(state.authenticated
            ? 'Cochez les creneaux ou vous etes disponible, puis enregistrez.'
            : 'Connectez-vous via Discord pour renseigner vos disponibilites.',
        !state.authenticated);
    } catch (error) {
        console.warn('[planning] session unavailable', error);
        state.authenticated = false;
        state.role = 'guest';
        state.managedGroupIds = [];
        state.slots = createAvailabilityStatusMatrix();
        setStatus('Session indisponible. Reessayez plus tard.', true);
    }
    syncSessionCard();
    syncAdminPanel();
    renderAdminSessions();
    renderCalendar();
    renderAgenda();
};

const saveAvailability = async () => {
    if (!state.authenticated || state.saving) {
        return;
    }
    state.saving = true;
    syncActions();
    setStatus('Sauvegarde des disponibilites...');
    try {
        const response = await fetch(PROFILE_URL, {
            method: 'PATCH',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ availability: getAvailabilityFromState() })
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const payload = await response.json();
        const normalized = normalizeAvailabilityStatusPayload(payload?.profile?.availability, state.timezone);
        if (normalized) {
            state.timezone = normalized.timezone || state.timezone;
            state.slots = normalized.slots;
        }
        state.dirty = false;
        setStatus('Disponibilites enregistrees.');
        renderCalendar();
    } catch (error) {
        console.error('[planning] availability save failed', error);
        setStatus('Impossible d enregistrer les disponibilites.', true);
    } finally {
        state.saving = false;
        syncSessionCard();
        renderCalendar();
    }
};

const clearAvailability = () => {
    if (!state.authenticated || state.saving) {
        return;
    }
    state.slots = createAvailabilityStatusMatrix();
    state.dirty = true;
    setStatus('Semaine vide. Enregistrez pour confirmer.');
    renderCalendar();
    syncActions();
};

if (dom.save) {
    dom.save.addEventListener('click', saveAvailability);
}
if (dom.clear) {
    dom.clear.addEventListener('click', clearAvailability);
}
if (dom.viewWeek) {
    dom.viewWeek.addEventListener('click', () => setPlanningView('week'));
}
if (dom.viewMonth) {
    dom.viewMonth.addEventListener('click', () => setPlanningView('month'));
}
if (dom.agendaPrev) {
    dom.agendaPrev.addEventListener('click', () => shiftAgendaMonth(-1));
}
if (dom.agendaNext) {
    dom.agendaNext.addEventListener('click', () => shiftAgendaMonth(1));
}
if (dom.agendaToday) {
    dom.agendaToday.addEventListener('click', () => {
        const today = new Date();
        state.agendaMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        renderAgenda();
        renderDatedAvailability();
    });
}
if (dom.agendaList) {
    dom.agendaList.addEventListener('click', event => {
        const button = event.target?.closest?.('[data-session-id][data-response-status]');
        if (!button || !dom.agendaList.contains(button)) {
            return;
        }
        saveSessionResponse(button.dataset.sessionId, button.dataset.responseStatus);
    });
}
if (dom.agendaGrid) {
    dom.agendaGrid.addEventListener('click', event => {
        const day = event.target?.closest?.('.planning-agenda-day[data-date]');
        if (!day || !dom.agendaGrid.contains(day)) {
            return;
        }
        selectAgendaDateForAvailability(day.dataset.date);
    });
    dom.agendaGrid.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') {
            return;
        }
        const day = event.target?.closest?.('.planning-agenda-day[data-date]');
        if (!day || !dom.agendaGrid.contains(day)) {
            return;
        }
        event.preventDefault();
        selectAgendaDateForAvailability(day.dataset.date);
    });
}
if (dom.datedForm) {
    dom.datedForm.addEventListener('submit', saveDatedAvailability);
}
if (dom.datedDate) {
    dom.datedDate.addEventListener('change', () => addDatedSelectedDate(dom.datedDate.value));
}
if (dom.datedSelectedDates) {
    dom.datedSelectedDates.addEventListener('click', event => {
        const button = event.target?.closest?.('[data-date-action="dated-remove"][data-date]');
        if (!button) {
            return;
        }
        state.datedSelectedDates = state.datedSelectedDates.filter(date => date !== button.dataset.date);
        dom.datedDate.value = state.datedSelectedDates.at(-1) || '';
        syncDatedForm();
    });
}
if (dom.datedList) {
    dom.datedList.addEventListener('click', event => {
        const button = event.target?.closest?.('[data-availability-id]');
        if (!button || !dom.datedList.contains(button)) {
            return;
        }
        deleteDatedAvailability(button.dataset.availabilityId);
    });
}
if (dom.adminForm) {
    dom.adminForm.addEventListener('submit', saveAdminSession);
}
if (dom.adminReset) {
    dom.adminReset.addEventListener('click', () => {
        resetAdminForm();
        setAdminStatus('Creation d une nouvelle session.');
    });
}
if (dom.adminDate) {
    dom.adminDate.addEventListener('change', () => {
        if (state.adminEditingId) {
            state.adminSelectedDates = [];
        }
        addAdminSelectedDate(dom.adminDate.value);
    });
}
if (dom.adminSelectedDates) {
    dom.adminSelectedDates.addEventListener('click', event => {
        const button = event.target?.closest?.('[data-date-action="admin-remove"][data-date]');
        if (!button || state.adminEditingId) {
            return;
        }
        state.adminSelectedDates = state.adminSelectedDates.filter(date => date !== button.dataset.date);
        dom.adminDate.value = state.adminSelectedDates.at(-1) || '';
        syncAdminPanel();
    });
}
if (dom.adminList) {
    dom.adminList.addEventListener('click', event => {
        const button = event.target?.closest?.('[data-admin-action][data-session-id]');
        if (!button || !dom.adminList.contains(button)) {
            return;
        }
        const sessionId = button.dataset.sessionId;
        if (button.dataset.adminAction === 'edit') {
            fillAdminForm(state.sessions.find(session => session.id === sessionId));
            dom.adminForm?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
            return;
        }
        if (button.dataset.adminAction === 'delete') {
            deleteAdminSession(sessionId);
        }
    });
}

if (dom.datedStart && !dom.datedStart.value) {
    dom.datedStart.value = '20:00';
}
if (dom.datedEnd && !dom.datedEnd.value) {
    dom.datedEnd.value = '23:00';
}
resetAdminForm();

setText(dom.year, String(new Date().getFullYear()));
buildCalendar();
renderAgenda();
renderDatedAvailability();
renderAdminSessions();
setPlanningView('week');
syncSessionCard();
loadVersion();
loadSessions();
loadSession().then(() => {
    loadDatedAvailability();
});

if (typeof EventSource === 'function') {
    const permissionsStream = new EventSource('/api/events/stream');
    const refreshPermissions = () => {
        state.accessGeneration = (state.accessGeneration || 0) + 1;
        state.sessions = [];
        state.datedAvailability = [];
        renderAgenda();
        renderDatedAvailability();
        loadSession().then(() => Promise.all([loadSessions(), loadDatedAvailability()]));
    };
    permissionsStream.addEventListener('permissions.changed', refreshPermissions);
    permissionsStream.addEventListener('permissions.ready', refreshPermissions);
    window.addEventListener('beforeunload', () => permissionsStream.close(), { once: true });
}
