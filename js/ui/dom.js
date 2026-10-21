export function qs(selector, root = document) {
    if (!selector || !root) {
        return null;
    }
    return root.querySelector(selector);
}

export function qsa(selector, root = document) {
    if (!selector || !root) {
        return [];
    }
    return Array.from(root.querySelectorAll(selector));
}

export function createElement(tag, {
    className = '',
    text = '',
    html = '',
    dataset = null,
    attributes = null,
    title = ''
} = {}) {
    const element = document.createElement(tag);
    if (className) {
        element.className = className;
    }
    if (text) {
        element.textContent = text;
    }
    if (html) {
        element.innerHTML = html;
    }
    if (title) {
        element.title = title;
    }
    if (dataset) {
        Object.entries(dataset).forEach(([key, value]) => {
            if (value !== undefined) {
                element.dataset[key] = value;
            }
        });
    }
    if (attributes) {
        Object.entries(attributes).forEach(([key, value]) => {
            if (value !== undefined) {
                element.setAttribute(key, value);
            }
        });
    }
    return element;
}

export function clearElement(element) {
    if (!element) {
        return;
    }
    while (element.firstChild) {
        element.removeChild(element.firstChild);
    }
}
