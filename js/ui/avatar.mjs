const pending = new WeakMap();
// Keep the initial visible when the provider removes an attachment. A late image
// must never restore a previous account's portrait after logout or profile change.
export function setAvatarImage(element, source, fallback = '?', className = 'has-avatar') {
    if (!element) return;
    const token = {}; pending.set(element, token);
    element.style.backgroundImage = ''; element.style.backgroundSize = ''; element.style.backgroundPosition = '';
    element.classList.remove(className); element.textContent = (fallback || '?').charAt(0).toUpperCase();
    if (typeof source !== 'string' || !source.trim()) return;
    let url;
    try {
        url = new URL(source.trim(), window.location.origin + '/');
        if (url.username || url.password || !['https:', 'http:'].includes(url.protocol)) return;
    } catch { return; }
    const image = new Image(); image.referrerPolicy = 'no-referrer';
    image.onload = () => {
        if (pending.get(element) !== token) return;
        element.style.backgroundImage = 'url(' + JSON.stringify(url.href) + ')';
        element.style.backgroundSize = 'cover'; element.style.backgroundPosition = 'center';
        element.classList.add(className); element.textContent = '';
    };
    image.src = url.href;
}
