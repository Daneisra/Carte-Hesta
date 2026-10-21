const hasDOMPurify = () =>
    typeof window !== 'undefined' &&
    window.DOMPurify &&
    typeof window.DOMPurify.sanitize === 'function';

const escapeHtml = value =>
    value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const escapeAttribute = value =>
    value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

const sanitizeUrl = raw => {
    const value = (raw || '').trim();
    if (!value) {
        return '#';
    }
    if (/^(javascript|data|vbscript):/i.test(value)) {
        return '#';
    }
    if (/^https?:\/\//i.test(value) || /^mailto:/i.test(value) || value.startsWith('/') || value.startsWith('#')) {
        return escapeAttribute(value);
    }
    return escapeAttribute(value);
};

const applyInlineFormatting = input => {
    if (!input) {
        return '';
    }
    const codes = [];
    const locationLinks = [];
    let result = input;

    result = result.replace(/`([^`]+)`/g, (_, code) => {
        const token = `@@CODE${codes.length}@@`;
        codes.push(`<code>${escapeHtml(code)}</code>`);
        return token;
    });

    result = result.replace(/\[\[([^\]]+)\]\]/g, (match, raw) => {
        const parts = raw.split('|').map(part => part.trim()).filter(Boolean);
        if (!parts.length) {
            return match;
        }
        const label = parts[0];
        const target = parts.length > 1 ? parts[1] : parts[0];
        if (!target) {
            return match;
        }
        const token = `@@LOC${locationLinks.length}@@`;
        locationLinks.push({ label, target });
        return token;
    });

    result = escapeHtml(result);

    result = result.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (match, text, href, title) => {
        const url = sanitizeUrl(href);
        const safeTitle = title ? ` title="${escapeAttribute(title)}"` : '';
        return `<a href="${url}" target="_blank" rel="noopener noreferrer"${safeTitle}>${text}</a>`;
    });

    result = result.replace(/(\*\*|__)(.+?)\1/g, '<strong>$2</strong>');
    result = result.replace(/(\*|_)([^*_]+?)\1/g, '<em>$2</em>');
    result = result.replace(/~~(.+?)~~/g, '<del>$1</del>');

    result = result.replace(/@@CODE(\d+)@@/g, (_, index) => codes[Number(index)] || '');
    result = result.replace(/@@LOC(\d+)@@/g, (_, index) => {
        const entry = locationLinks[Number(index)];
        if (!entry) {
            return '';
        }
        const label = escapeHtml(entry.label);
        const target = entry.target.trim();
        const encoded = encodeURIComponent(target);
        return `<a href="#location:${encoded}" class="location-link" data-location="${escapeAttribute(target)}">${label}</a>`;
    });

    return result.replace(/\n/g, '<br>');
};

const createParagraph = lines => {
    if (!lines.length) {
        return '';
    }
    const text = lines.join('\n');
    return `<p>${applyInlineFormatting(text)}</p>`;
};

export const renderMarkdown = (input = '') => {
    const source = (input ?? '').toString();
    if (!source.trim()) {
        return '';
    }

    const lines = source.replace(/\r\n?/g, '\n').split('\n');
    const htmlParts = [];

    let paragraphLines = [];
    let listItems = [];
    let codeLines = [];

    let inList = false;
    let inCodeBlock = false;

    const flushParagraph = () => {
        if (!paragraphLines.length) {
            return;
        }
        htmlParts.push(createParagraph(paragraphLines));
        paragraphLines = [];
    };

    const flushList = () => {
        if (!inList) {
            return;
        }
        if (listItems.length) {
            htmlParts.push(`<ul>${listItems.join('')}</ul>`);
        }
        listItems = [];
        inList = false;
    };

    const flushCode = () => {
        if (!inCodeBlock) {
            return;
        }
        const code = codeLines.join('\n');
        htmlParts.push(`<pre><code>${escapeHtml(code)}</code></pre>`);
        codeLines = [];
        inCodeBlock = false;
    };

    for (const rawLine of lines) {
        const line = rawLine;
        const trimmed = line.trim();

        if (trimmed.startsWith('```')) {
            if (inCodeBlock) {
                flushCode();
            } else {
                flushParagraph();
                flushList();
                inCodeBlock = true;
                codeLines = [];
            }
            continue;
        }

        if (inCodeBlock) {
            codeLines.push(line);
            continue;
        }

        const listMatch = line.match(/^\s*[-*+]\s+(.*)$/);
        if (listMatch) {
            flushParagraph();
            if (!inList) {
                inList = true;
                listItems = [];
            }
            listItems.push(`<li>${applyInlineFormatting(listMatch[1])}</li>`);
            continue;
        }

        if (!trimmed) {
            flushParagraph();
            flushList();
            continue;
        }

        const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
        if (headingMatch) {
            flushParagraph();
            flushList();
            const level = headingMatch[1].length;
            htmlParts.push(`<h${level}>${applyInlineFormatting(headingMatch[2].trim())}</h${level}>`);
            continue;
        }

        paragraphLines.push(line);
    }

    flushParagraph();
    flushList();
    flushCode();

    const html = htmlParts.join('');
    if (!html) {
        const fallback = escapeHtml(source).replace(/\n/g, '<br>');
        return hasDOMPurify() ? window.DOMPurify.sanitize(fallback) : fallback;
    }

    if (hasDOMPurify()) {
        return window.DOMPurify.sanitize(html);
    }
    return html;
};
