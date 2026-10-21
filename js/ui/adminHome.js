import { sanitizeString } from '../shared/locationSchema.mjs';
import {
    setPanelStatus,
    renderPanelErrors,
    setElementsDisabled,
    syncReloadButton,
    syncSaveButton
} from './adminShared.js';

const HOME_ADMIN_FIELDS = [
    'homeKicker',
    'homeTitle',
    'homeLead',
    'homeAtmosphere',
    'homeTags',
    'homeMetrics',
    'homeBackgroundImage',
    'homeMapImage',
    'homeCharacterImage',
    'homeFloatingTitle',
    'homeFloatingCopy',
    'homeDiscordUrl',
    'homeDiscordTitle',
    'homeDiscordCopy',
    'homeDiscordProofMode',
    'homeDiscordGuildId',
    'homeDiscordManualCount',
    'homeDiscordProofLabel',
    'homeDiscordProofNote',
    'homeYoutubeUrl',
    'homeYoutubeTitle',
    'homeYoutubeCopy',
    'homeRedditUrl',
    'homeRedditTitle',
    'homeRedditCopy',
    'homeSupportUrl',
    'homeContactEmail',
    'homeCreditsUrl',
    'homeFooterNote',
    'homeChangelog'
];
const HOME_ADMIN_API_ROUTE = '/api/admin/home-config';

export const normalizeAdminSiteConfig = (config = {}) => {
    const home = config?.home && typeof config.home === 'object' ? config.home : {};
    const community = config?.community && typeof config.community === 'object' ? config.community : {};
    const support = config?.support && typeof config.support === 'object' ? config.support : {};
    const legal = config?.legal && typeof config.legal === 'object' ? config.legal : {};
    const changelog = Array.isArray(config?.changelog) ? config.changelog : [];
    const normalizeCard = (card, fallback) => ({
        badge: sanitizeString(card?.badge || fallback.badge),
        title: sanitizeString(card?.title || fallback.title),
        copy: sanitizeString(card?.copy || fallback.copy)
    });
    const normalizeMetrics = Array.isArray(home.metrics) && home.metrics.length
        ? home.metrics
            .map(metric => ({
                label: sanitizeString(metric?.label),
                value: sanitizeString(metric?.value)
            }))
            .filter(metric => metric.label && metric.value)
        : [
            { label: 'Hub', value: 'Carte + Communaute' },
            { label: 'Acces', value: 'Lecture / Discord / Admin' },
            { label: 'Etat', value: 'Version actuelle en production' }
        ];
    const normalizeTags = Array.isArray(home.tags) && home.tags.length
        ? home.tags.map(tag => sanitizeString(tag)).filter(Boolean)
        : ['Carte narrative', 'Quetes live', 'Groupes JDR', 'Profils & personnages'];
    return {
        version: sanitizeString(config?.version || '0.17.49'),
        home: {
            kicker: sanitizeString(home.kicker || 'Accueil - Hub narratif'),
            title: sanitizeString(home.title || "Entrez dans l'univers avant d'ouvrir la carte"),
            lead: sanitizeString(home.lead || "Explorez les lieux, suivez les quetes en direct, retrouvez votre groupe JDR et centralisez vos personnages. Cette page sert de point d'entree rapide pour la carte et la communaute."),
            atmosphere: sanitizeString(home.atmosphere || "Accueil narratif - entree rapide vers l'univers, la carte et la communaute."),
            tags: normalizeTags,
            metrics: normalizeMetrics,
            visuals: {
                backgroundImage: sanitizeString(home?.visuals?.backgroundImage || '/assets/home/backgrounds/hero-main.png'),
                mapPreviewImage: sanitizeString(home?.visuals?.mapPreviewImage || '/assets/home/mockups/map-preview-main.png'),
                characterImage: sanitizeString(home?.visuals?.characterImage || '/assets/home/characters/Chevalier.png'),
                floatingTitle: sanitizeString(home?.visuals?.floatingTitle || "Les terres d'Hesta"),
                floatingCopy: sanitizeString(home?.visuals?.floatingCopy || "Un apercu clair du monde, des routes, des villes et des quetes qui structurent vos campagnes.")
            }
        },
        community: {
            discordUrl: sanitizeString(community.discordUrl || 'https://discord.com/'),
            youtubeUrl: sanitizeString(community.youtubeUrl || 'https://www.youtube.com/'),
            redditUrl: sanitizeString(community.redditUrl || 'https://www.reddit.com/'),
            discord: normalizeCard(community.discord, {
                badge: 'Discord',
                title: 'Serveur principal',
                copy: 'Organisation des sessions, annonces JDR et coordination des groupes.'
            }),
            proof: {
                mode: sanitizeString(community?.proof?.mode) === 'discord' ? 'discord' : 'manual',
                guildId: sanitizeString(community?.proof?.guildId || ''),
                manualCount: Math.max(0, Number(community?.proof?.manualCount) || 0),
                label: sanitizeString(community?.proof?.label || 'membres sur Discord'),
                note: sanitizeString(community?.proof?.note || 'Sessions, annonces et coordination des groupes JDR.')
            },
            youtube: normalizeCard(community.youtube, {
                badge: 'YouTube',
                title: 'Lore & recaps',
                copy: "Recaps, videos d univers et ambiances pour prolonger les campagnes."
            }),
            reddit: normalizeCard(community.reddit, {
                badge: 'Reddit',
                title: 'Discussions',
                copy: "Partage d idees, feedback et archives communautaires."
            })
        },
        support: {
            issuesUrl: sanitizeString(support.issuesUrl || 'https://github.com/Daneisra/Carte-Interactive/issues'),
            contactEmail: sanitizeString(support.contactEmail || 'contact@cartehesta.local')
        },
        legal: {
            creditsUrl: sanitizeString(legal.creditsUrl || '/docs/ASSETS-CREDITS.md'),
            footerNote: sanitizeString(legal.footerNote || "Projet narratif / JDR - fan project / page d'accueil officielle.")
        },
        changelog: changelog
            .map(entry => ({
                date: sanitizeString(entry?.date),
                title: sanitizeString(entry?.title),
                summary: sanitizeString(entry?.summary)
            }))
            .filter(entry => entry.date || entry.title || entry.summary)
    };
};

export const formatAdminSiteConfigTags = (tags = []) => (
    Array.isArray(tags) ? tags.filter(Boolean).join('\n') : ''
);

export const formatAdminSiteConfigMetrics = (metrics = []) => (
    Array.isArray(metrics)
        ? metrics
            .filter(metric => metric?.label && metric?.value)
            .map(metric => `${metric.label} | ${metric.value}`)
            .join('\n')
        : ''
);

export const formatAdminSiteConfigChangelog = (entries = []) => (
    Array.isArray(entries)
        ? entries
            .filter(entry => entry?.date || entry?.title || entry?.summary)
            .map(entry => `${entry.date || ''} | ${entry.title || ''} | ${entry.summary || ''}`.trim())
            .join('\n')
        : ''
);

export const parseAdminDelimitedLines = (value = '') => (
    String(value || '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
);

export const parseAdminMetrics = value => (
    parseAdminDelimitedLines(value)
        .map(line => {
            const [label, ...rest] = line.split('|');
            const metricLabel = sanitizeString(label);
            const metricValue = sanitizeString(rest.join('|'));
            if (!metricLabel || !metricValue) {
                return null;
            }
            return { label: metricLabel, value: metricValue };
        })
        .filter(Boolean)
);

export const parseAdminChangelog = value => (
    parseAdminDelimitedLines(value)
        .map(line => {
            const [date, title, ...summaryParts] = line.split('|');
            const parsed = {
                date: sanitizeString(date),
                title: sanitizeString(title),
                summary: sanitizeString(summaryParts.join('|'))
            };
            if (!parsed.date && !parsed.title && !parsed.summary) {
                return null;
            }
            return parsed;
        })
        .filter(Boolean)
);

export const setAdminHomeStatus = (ctx, message, isError = false) => {
    setPanelStatus(ctx.adminDom.homeStatus, message, isError);
};

export const renderAdminHomeErrors = (ctx, errors = []) => {
    renderPanelErrors(ctx.adminDom.homeErrors, errors);
};

export const syncAdminHomeEditor = ctx => {
    const isAdmin = ctx.isAdmin();
    const hasConfig = !!ctx.adminSiteConfig;
    const readOnlyFallback = ctx.adminSiteConfigSource === 'fallback';
    const disabled = !isAdmin || ctx.adminSiteConfigPending || !hasConfig;
    setElementsDisabled(HOME_ADMIN_FIELDS.map(key => ctx.adminDom[key]), disabled);
    syncReloadButton(ctx.adminDom.homeReloadButton, {
        isAdmin,
        pending: ctx.adminSiteConfigPending
    });
    syncSaveButton(ctx.adminDom.homeSaveButton, {
        isAdmin,
        pending: ctx.adminSiteConfigPending,
        hasData: hasConfig,
        dirty: ctx.adminSiteConfigDirty,
        idleLabel: "Enregistrer l'accueil",
        dirtyLabel: "Enregistrer l'accueil *",
        pendingLabel: 'Enregistrement...',
        readOnly: readOnlyFallback,
        readOnlyLabel: 'API admin indisponible'
    });
};

export const renderAdminSiteConfig = ctx => {
    const config = normalizeAdminSiteConfig(ctx.adminSiteConfig || {});
    if (ctx.adminDom.homeKicker) {
        ctx.adminDom.homeKicker.value = config.home.kicker || '';
    }
    if (ctx.adminDom.homeTitle) {
        ctx.adminDom.homeTitle.value = config.home.title || '';
    }
    if (ctx.adminDom.homeLead) {
        ctx.adminDom.homeLead.value = config.home.lead || '';
    }
    if (ctx.adminDom.homeAtmosphere) {
        ctx.adminDom.homeAtmosphere.value = config.home.atmosphere || '';
    }
    if (ctx.adminDom.homeTags) {
        ctx.adminDom.homeTags.value = formatAdminSiteConfigTags(config.home.tags);
    }
    if (ctx.adminDom.homeMetrics) {
        ctx.adminDom.homeMetrics.value = formatAdminSiteConfigMetrics(config.home.metrics);
    }
    if (ctx.adminDom.homeBackgroundImage) {
        ctx.adminDom.homeBackgroundImage.value = config.home.visuals?.backgroundImage || '';
    }
    if (ctx.adminDom.homeMapImage) {
        ctx.adminDom.homeMapImage.value = config.home.visuals?.mapPreviewImage || '';
    }
    if (ctx.adminDom.homeCharacterImage) {
        ctx.adminDom.homeCharacterImage.value = config.home.visuals?.characterImage || '';
    }
    if (ctx.adminDom.homeFloatingTitle) {
        ctx.adminDom.homeFloatingTitle.value = config.home.visuals?.floatingTitle || '';
    }
    if (ctx.adminDom.homeFloatingCopy) {
        ctx.adminDom.homeFloatingCopy.value = config.home.visuals?.floatingCopy || '';
    }
    if (ctx.adminDom.homeDiscordUrl) {
        ctx.adminDom.homeDiscordUrl.value = config.community.discordUrl || '';
    }
    if (ctx.adminDom.homeDiscordTitle) {
        ctx.adminDom.homeDiscordTitle.value = config.community.discord?.title || '';
    }
    if (ctx.adminDom.homeDiscordCopy) {
        ctx.adminDom.homeDiscordCopy.value = config.community.discord?.copy || '';
    }
    if (ctx.adminDom.homeDiscordProofMode) {
        ctx.adminDom.homeDiscordProofMode.value = config.community.proof?.mode || 'manual';
    }
    if (ctx.adminDom.homeDiscordGuildId) {
        ctx.adminDom.homeDiscordGuildId.value = config.community.proof?.guildId || '';
    }
    if (ctx.adminDom.homeDiscordManualCount) {
        ctx.adminDom.homeDiscordManualCount.value = String(config.community.proof?.manualCount ?? 0);
    }
    if (ctx.adminDom.homeDiscordProofLabel) {
        ctx.adminDom.homeDiscordProofLabel.value = config.community.proof?.label || '';
    }
    if (ctx.adminDom.homeDiscordProofNote) {
        ctx.adminDom.homeDiscordProofNote.value = config.community.proof?.note || '';
    }
    if (ctx.adminDom.homeYoutubeUrl) {
        ctx.adminDom.homeYoutubeUrl.value = config.community.youtubeUrl || '';
    }
    if (ctx.adminDom.homeYoutubeTitle) {
        ctx.adminDom.homeYoutubeTitle.value = config.community.youtube?.title || '';
    }
    if (ctx.adminDom.homeYoutubeCopy) {
        ctx.adminDom.homeYoutubeCopy.value = config.community.youtube?.copy || '';
    }
    if (ctx.adminDom.homeRedditUrl) {
        ctx.adminDom.homeRedditUrl.value = config.community.redditUrl || '';
    }
    if (ctx.adminDom.homeRedditTitle) {
        ctx.adminDom.homeRedditTitle.value = config.community.reddit?.title || '';
    }
    if (ctx.adminDom.homeRedditCopy) {
        ctx.adminDom.homeRedditCopy.value = config.community.reddit?.copy || '';
    }
    if (ctx.adminDom.homeSupportUrl) {
        ctx.adminDom.homeSupportUrl.value = config.support.issuesUrl || '';
    }
    if (ctx.adminDom.homeContactEmail) {
        ctx.adminDom.homeContactEmail.value = config.support.contactEmail || '';
    }
    if (ctx.adminDom.homeCreditsUrl) {
        ctx.adminDom.homeCreditsUrl.value = config.legal.creditsUrl || '';
    }
    if (ctx.adminDom.homeFooterNote) {
        ctx.adminDom.homeFooterNote.value = config.legal.footerNote || '';
    }
    if (ctx.adminDom.homeChangelog) {
        ctx.adminDom.homeChangelog.value = formatAdminSiteConfigChangelog(config.changelog);
    }
    renderAdminHomeErrors(ctx, []);
    syncAdminHomeEditor(ctx);
};

export const collectAdminSiteConfigDraft = ctx => normalizeAdminSiteConfig({
    version: ctx.adminSiteConfig?.version || '0.17.49',
    home: {
        kicker: ctx.adminDom.homeKicker?.value || '',
        title: ctx.adminDom.homeTitle?.value || '',
        lead: ctx.adminDom.homeLead?.value || '',
        atmosphere: ctx.adminDom.homeAtmosphere?.value || '',
        tags: parseAdminDelimitedLines(ctx.adminDom.homeTags?.value || ''),
        metrics: parseAdminMetrics(ctx.adminDom.homeMetrics?.value || ''),
        visuals: {
            backgroundImage: ctx.adminDom.homeBackgroundImage?.value || '',
            mapPreviewImage: ctx.adminDom.homeMapImage?.value || '',
            characterImage: ctx.adminDom.homeCharacterImage?.value || '',
            floatingTitle: ctx.adminDom.homeFloatingTitle?.value || '',
            floatingCopy: ctx.adminDom.homeFloatingCopy?.value || ''
        }
    },
    community: {
        discordUrl: ctx.adminDom.homeDiscordUrl?.value || '',
        youtubeUrl: ctx.adminDom.homeYoutubeUrl?.value || '',
        redditUrl: ctx.adminDom.homeRedditUrl?.value || '',
        discord: {
            badge: 'Discord',
            title: ctx.adminDom.homeDiscordTitle?.value || '',
            copy: ctx.adminDom.homeDiscordCopy?.value || ''
        },
        proof: {
            mode: ctx.adminDom.homeDiscordProofMode?.value || 'manual',
            guildId: ctx.adminDom.homeDiscordGuildId?.value || '',
            manualCount: ctx.adminDom.homeDiscordManualCount?.value || 0,
            label: ctx.adminDom.homeDiscordProofLabel?.value || '',
            note: ctx.adminDom.homeDiscordProofNote?.value || ''
        },
        youtube: {
            badge: 'YouTube',
            title: ctx.adminDom.homeYoutubeTitle?.value || '',
            copy: ctx.adminDom.homeYoutubeCopy?.value || ''
        },
        reddit: {
            badge: 'Reddit',
            title: ctx.adminDom.homeRedditTitle?.value || '',
            copy: ctx.adminDom.homeRedditCopy?.value || ''
        }
    },
    support: {
        issuesUrl: ctx.adminDom.homeSupportUrl?.value || '',
        contactEmail: ctx.adminDom.homeContactEmail?.value || ''
    },
    legal: {
        creditsUrl: ctx.adminDom.homeCreditsUrl?.value || '',
        footerNote: ctx.adminDom.homeFooterNote?.value || ''
    },
    changelog: parseAdminChangelog(ctx.adminDom.homeChangelog?.value || '')
});

export const validateAdminSiteConfigDraft = config => {
    const errors = [];
    const isHttp = value => /^https?:\/\//i.test((value || '').trim());
    const isRelative = value => (value || '').trim().startsWith('/');
    const isMail = value => /^(mailto:)?[^@\s]+@[^@\s]+\.[^@\s]+$/i.test((value || '').trim());
    if (!sanitizeString(config?.home?.title)) {
        errors.push("Le titre de l'accueil est requis.");
    }
    if (!sanitizeString(config?.home?.lead)) {
        errors.push("Le texte d'introduction de l'accueil est requis.");
    }
    if (!Array.isArray(config?.home?.metrics) || !config.home.metrics.length) {
        errors.push('Ajoutez au moins une metrique hero (Label | Valeur).');
    }
    [
        ['Fond hero', config?.home?.visuals?.backgroundImage],
        ['Mockup carte', config?.home?.visuals?.mapPreviewImage],
        ['Render personnage', config?.home?.visuals?.characterImage]
    ].forEach(([label, value]) => {
        const raw = sanitizeString(value);
        if (raw && !(isHttp(raw) || isRelative(raw))) {
            errors.push(`${label} invalide (http(s) ou chemin relatif attendu).`);
        }
    });
    if (config?.community?.discordUrl && !isHttp(config.community.discordUrl)) {
        errors.push('URL Discord invalide.');
    }
    if (config?.community?.proof?.mode === 'discord'
        && !sanitizeString(config?.community?.proof?.guildId)
        && !sanitizeString(config?.community?.discordUrl)) {
        errors.push('Renseignez une URL Discord ou un Guild ID pour le compteur auto.');
    }
    if (Number(config?.community?.proof?.manualCount) < 0) {
        errors.push('Le compteur manuel Discord doit etre positif.');
    }
    if (config?.community?.youtubeUrl && !isHttp(config.community.youtubeUrl)) {
        errors.push('URL YouTube invalide.');
    }
    if (config?.community?.redditUrl && !isHttp(config.community.redditUrl)) {
        errors.push('URL Reddit invalide.');
    }
    if (config?.support?.issuesUrl && !isHttp(config.support.issuesUrl)) {
        errors.push('URL support / bugs invalide.');
    }
    if (config?.support?.contactEmail && !isMail(config.support.contactEmail)) {
        errors.push('Contact invalide (email ou mailto: attendu).');
    }
    if (config?.legal?.creditsUrl && !(isHttp(config.legal.creditsUrl) || isRelative(config.legal.creditsUrl))) {
        errors.push('URL credits invalide (http(s) ou chemin relatif attendu).');
    }
    if (!Array.isArray(config?.changelog) || !config.changelog.length) {
        errors.push('Ajoutez au moins une patch note.');
    }
    return errors;
};

export const markAdminSiteConfigDirty = ctx => {
    if (!ctx.isAdmin()) {
        return;
    }
    ctx.adminSiteConfigDirty = true;
    setAdminHomeStatus(ctx, '');
    renderAdminHomeErrors(ctx, []);
    syncAdminHomeEditor(ctx);
};

export const fetchAdminSiteConfig = async ctx => {
    if (!ctx.adminDom.homeSaveButton) {
        return;
    }
    if (!ctx.isAdmin()) {
        ctx.adminSiteConfig = null;
        ctx.adminSiteConfigSource = 'unloaded';
        ctx.adminSiteConfigDirty = false;
        syncAdminHomeEditor(ctx);
        return;
    }
    setAdminHomeStatus(ctx, "Chargement de la configuration de l'accueil...");
    try {
        const response = await fetch(HOME_ADMIN_API_ROUTE, {
            credentials: 'include',
            cache: 'no-store'
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const payload = await response.json();
        ctx.adminSiteConfig = normalizeAdminSiteConfig(payload?.config || {});
        ctx.adminSiteConfigSource = 'api';
        ctx.adminSiteConfigDirty = false;
        renderAdminSiteConfig(ctx);
        setAdminHomeStatus(ctx, "Configuration de l'accueil chargee depuis l'API admin.");
    } catch (error) {
        console.error('[admin] site config fetch failed', error);
        ctx.logTelemetryEvent({
            title: 'Admin accueil - chargement',
            description: error?.message || "Echec chargement configuration d'accueil",
            route: HOME_ADMIN_API_ROUTE,
            method: 'GET',
            status: error?.status || null
        });
        try {
            const fallbackResponse = await fetch('/assets/site-config.json', {
                cache: 'no-store'
            });
            if (!fallbackResponse.ok) {
                throw new Error(`HTTP ${fallbackResponse.status}`);
            }
            const fallbackPayload = await fallbackResponse.json();
            ctx.adminSiteConfig = normalizeAdminSiteConfig(fallbackPayload || {});
            ctx.adminSiteConfigSource = 'fallback';
            ctx.adminSiteConfigDirty = false;
            renderAdminSiteConfig(ctx);
            setAdminHomeStatus(ctx, "API admin indisponible. Formulaire charge depuis assets/site-config.json en lecture seule.", true);
        } catch (fallbackError) {
            console.error('[admin] site config fallback fetch failed', fallbackError);
            ctx.adminSiteConfig = null;
            ctx.adminSiteConfigSource = 'unloaded';
            setAdminHomeStatus(ctx, "Impossible de charger la configuration de l'accueil depuis l'API admin ou assets/site-config.json.", true);
        }
    } finally {
        syncAdminHomeEditor(ctx);
    }
};

export const saveAdminSiteConfig = async ctx => {
    if (!ctx.isAdmin()) {
        ctx.announcer?.assertive?.('Connexion administrateur requise.');
        return;
    }
    const draft = collectAdminSiteConfigDraft(ctx);
    const errors = validateAdminSiteConfigDraft(draft);
    ctx.adminSiteConfigErrors = errors;
    renderAdminHomeErrors(ctx, errors);
    if (errors.length) {
        setAdminHomeStatus(ctx, 'Corrigez les erreurs avant enregistrement.', true);
        return;
    }
    ctx.adminSiteConfigPending = true;
    syncAdminHomeEditor(ctx);
    setAdminHomeStatus(ctx, "Enregistrement de l'accueil...");
    try {
        const response = await fetch(HOME_ADMIN_API_ROUTE, {
            method: 'PATCH',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ config: draft })
        });
        if (!response.ok) {
            const error = new Error(`HTTP ${response.status}`);
            error.status = response.status;
            throw error;
        }
        const payload = await response.json();
        ctx.adminSiteConfig = normalizeAdminSiteConfig(payload?.config || draft);
        ctx.adminSiteConfigSource = 'api';
        ctx.adminSiteConfigDirty = false;
        renderAdminSiteConfig(ctx);
        setAdminHomeStatus(ctx, "Accueil mis a jour. Rechargez '/' pour verifier le rendu.");
        ctx.announcer?.polite?.("Configuration de l'accueil enregistree.");
    } catch (error) {
        console.error('[admin] site config save failed', error);
        setAdminHomeStatus(ctx, "Impossible d'enregistrer l'accueil.", true);
        ctx.logTelemetryEvent({
            title: 'Admin accueil - sauvegarde',
            description: error?.message || "Echec sauvegarde configuration d'accueil",
            route: HOME_ADMIN_API_ROUTE,
            method: 'PATCH',
            status: error?.status || null
        });
    } finally {
        ctx.adminSiteConfigPending = false;
        syncAdminHomeEditor(ctx);
    }
};
