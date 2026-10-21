import { createElement } from './dom.js';

export const setPanelStatus = (statusNode, message, isError = false) => {
    if (!statusNode) {
        return;
    }
    if (!message) {
        statusNode.hidden = true;
        statusNode.textContent = '';
        statusNode.classList.remove('is-error');
        return;
    }
    statusNode.hidden = false;
    statusNode.textContent = message;
    statusNode.classList.toggle('is-error', Boolean(isError));
};

export const renderPanelErrors = (errorsNode, errors = []) => {
    if (!errorsNode) {
        return;
    }
    const list = Array.isArray(errors) ? errors.filter(Boolean) : [];
    errorsNode.innerHTML = '';
    if (!list.length) {
        errorsNode.hidden = true;
        return;
    }
    list.forEach(message => {
        errorsNode.appendChild(createElement('li', { text: message }));
    });
    errorsNode.hidden = false;
};

export const setElementsDisabled = (elements = [], disabled = false) => {
    elements.forEach(element => {
        if (element) {
            element.disabled = disabled;
        }
    });
};

export const syncReloadButton = (button, { isAdmin = false, pending = false } = {}) => {
    if (!button) {
        return;
    }
    button.disabled = !isAdmin || pending;
};

export const syncSaveButton = (
    button,
    {
        isAdmin = false,
        pending = false,
        hasData = false,
        dirty = false,
        idleLabel = 'Enregistrer',
        dirtyLabel = 'Enregistrer *',
        pendingLabel = 'Enregistrement...',
        readOnly = false,
        readOnlyLabel = 'Lecture seule'
    } = {}
) => {
    if (!button) {
        return;
    }
    button.disabled = !isAdmin || pending || !hasData || readOnly;
    if (pending) {
        button.textContent = pendingLabel;
        return;
    }
    if (readOnly) {
        button.textContent = readOnlyLabel;
        return;
    }
    button.textContent = dirty ? dirtyLabel : idleLabel;
};
