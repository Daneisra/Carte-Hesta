// Shared parsing for gallery and editor: no substring host matches or URL fallbacks.
export function extractYoutubeId(value) {
    if (typeof value !== 'string') return null;
    try {
        const url = new URL(value.trim());
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null;
        const host = url.hostname.replace(/^www\./, ''), parts = url.pathname.split('/').filter(Boolean);
        let id;
        if (host === 'youtu.be' && parts.length === 1) id = parts[0];
        else if (['youtube.com', 'm.youtube.com', 'youtube-nocookie.com'].includes(host)) {
            if (url.pathname === '/watch' && host !== 'youtube-nocookie.com') id = url.searchParams.get('v');
            else if (parts.length === 2 && ['embed', 'shorts', 'live'].includes(parts[0])) id = parts[1];
        }
        return typeof id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    } catch { return null; }
}

export function youtubePreview(value, title = 'Vidéo YouTube') {
    const id = extractYoutubeId(value);
    if (!id) return null;
    const container = document.createElement('div');
    const iframe = document.createElement('iframe');
    iframe.src = 'https://www.youtube.com/embed/' + id;
    iframe.title = title;
    // YouTube requires the embedding origin, never the page path or query string.
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.loading = 'lazy';
    iframe.allow = 'encrypted-media; picture-in-picture; fullscreen';
    iframe.allowFullscreen = true;
    const fallback = document.createElement('a');
    fallback.href = 'https://www.youtube.com/watch?v=' + id;
    fallback.target = '_blank'; fallback.rel = 'noopener noreferrer';
    fallback.textContent = 'Ouvrir sur YouTube si la lecture intégrée est indisponible';
    container.append(iframe, fallback);
    return container;
}
