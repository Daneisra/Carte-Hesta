#!/usr/bin/env node
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL, pathToFileURL } = require('url');
const logger = require('./server/utils/logger');
const { withFileLock } = require('./server/utils/fileLock');

const createRouter = require('./server/routes');

const { configuration, loadExplicitSecrets, plainPath, within } = require('./server/storage/paths');
const { JsonStore, privatePath, validate } = require('./server/storage/jsonStore');
const { createSessions } = require('./server/storage/sessions');
const { authConfiguration } = require('./server/storage/authConfig');
const storagePaths = configuration();
loadExplicitSecrets(storagePaths);
const storage = new JsonStore(storagePaths.data);
const PORT = process.env.PORT || 4173;
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = storagePaths.public;
const ASSETS_PATH = storagePaths.media;
const LOCATIONS_FILE = storage.file('locations');
const TYPES_FILE = storage.file('types');
const IMAGES_DIR = path.join(ASSETS_PATH, 'images');
const AUDIO_DIR = path.join(ASSETS_PATH, 'audio');
const AUDIT_DIR = storagePaths.logs;
const AUDIT_FILE = path.join(AUDIT_DIR, 'locations-audit.jsonl');
const USERS_FILE = storage.file('users');
const GROUPS_FILE = storage.file('groups');
const ANNOTATIONS_FILE = storage.file('annotations');
const TIMELINE_FILE = storage.file('timeline');
const SITE_CONFIG_FILE = storage.file('site-config');
const PLANNING_FILE = storage.file('planning');

const REMOTE_SYNC_URL = (process.env.REMOTE_SYNC_URL || '').trim();
const REMOTE_SYNC_TOKEN = (process.env.REMOTE_SYNC_TOKEN || '').trim();
const rawRemoteSyncMethod = (process.env.REMOTE_SYNC_METHOD || 'POST').trim().toUpperCase();
const REMOTE_SYNC_METHOD = ['POST', 'PUT', 'PATCH'].includes(rawRemoteSyncMethod) ? rawRemoteSyncMethod : 'POST';
const REMOTE_SYNC_TIMEOUT = Math.max(0, Number(process.env.REMOTE_SYNC_TIMEOUT) || 7000);
const MAX_BODY_SIZE = 40 * 1024 * 1024;
const AVAILABILITY_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const AVAILABILITY_SLOTS = ['morning', 'afternoon', 'evening', 'night'];
const AVAILABILITY_STATUS = {
  AVAILABLE: 'available',
  MAYBE: 'maybe',
  BUSY: 'busy'
};
const DEFAULT_SITE_CONFIG = {
  version: '0.17.49',
  home: {
    kicker: 'Accueil - Hub narratif',
    title: "Entrez dans l'univers avant d'ouvrir la carte",
    lead: "Explorez les lieux, suivez les quetes en direct, retrouvez votre groupe JDR et centralisez vos personnages. Cette page sert de point d'entree rapide pour la carte et la communaute.",
    atmosphere: "Accueil narratif - entree rapide vers l'univers, la carte et la communaute.",
    tags: ['Carte narrative', 'Quetes live', 'Groupes JDR', 'Profils & personnages'],
    metrics: [
      { label: 'Hub', value: 'Carte + Communaute' },
      { label: 'Acces', value: 'Lecture / Discord / Admin' },
      { label: 'Etat', value: 'Version actuelle en production' }
    ],
    visuals: {
      backgroundImage: '/assets/home/backgrounds/hero-main.png',
      mapPreviewImage: '/assets/home/mockups/map-preview-main.png',
      characterImage: '/assets/home/characters/Chevalier.png',
      floatingTitle: "Les terres d'Hesta",
      floatingCopy: "Un apercu clair du monde, des routes, des villes et des quetes qui structurent vos campagnes."
    }
  },
  community: {
    youtubeUrl: 'https://www.youtube.com/',
    discordUrl: 'https://discord.com/',
    redditUrl: 'https://www.reddit.com/',
    discord: {
      badge: 'Discord',
      title: 'Serveur principal',
      copy: "Organisation des sessions, annonces JDR et coordination des groupes."
    },
    proof: {
      mode: 'manual',
      guildId: '',
      manualCount: 200,
      label: 'membres sur Discord',
      note: 'Sessions, annonces et coordination des groupes JDR.'
    },
    youtube: {
      badge: 'YouTube',
      title: 'Lore & recaps',
      copy: "Recaps, videos d univers et ambiances pour prolonger les campagnes."
    },
    reddit: {
      badge: 'Reddit',
      title: 'Discussions',
      copy: "Partage d idees, feedback et archives communautaires."
    }
  },
  support: {
    issuesUrl: 'https://github.com/Daneisra/Carte-Interactive/issues',
    contactEmail: 'contact@cartehesta.local'
  },
  legal: {
    creditsUrl: '/docs/ASSETS-CREDITS.md',
    footerNote: "Projet narratif / JDR - fan project / page d'accueil officielle."
  },
  changelog: [
    {
      date: '2026-09-25',
      title: 'Version 0.17.49 - Acces au systeme PA',
      summary: 'L accueil propose un lien direct vers l outil Systeme PA / Armures d100 dans la navigation principale.'
    },
    {
      date: '2026-06-01',
      title: 'Version 0.17.48 - Page Geek Unchained',
      summary: 'Une page publique dediee a la Geek Unchained presente Le Monde d Hesta, ses tables JDR, la carte interactive et les infos pratiques de convention.'
    },
    {
      date: '2026-05-26',
      title: 'Version 0.17.47 - Admin groupes et tests API',
      summary: 'L admin carte permet de mettre a jour tous les groupes JDR en une action et les tests API partageant des fichiers persistants sont serialises.'
    },
    {
      date: '2026-05-26',
      title: 'Version 0.17.46 - Publication version et changelog',
      summary: 'La configuration servie aligne les versions affichees et publie correctement les patch notes du planning multi-date sur l accueil et le changelog.'
    },
    {
      date: '2026-05-26',
      title: 'Version 0.17.45 - Planning multi-date',
      summary: 'Les joueurs et admins peuvent enregistrer plusieurs dates en une fois ; les syntheses hebdomadaires obsoletes ont ete retirees du planning et de l admin carte.'
    },
    {
      date: '2026-05-20',
      title: 'Version 0.17.44 - Planning date et sessions',
      summary: 'Le planning permet de cliquer une date pour ajouter une disponibilite, retire l ancien affichage semaine type, prolonge la session Discord et harmonise les footers.'
    },
    {
      date: '2026-05-18',
      title: 'Version 0.17.43 - Admin planning',
      summary: 'La page planning gagne une interface admin pour creer, modifier et supprimer les sessions candidates directement depuis l agenda.'
    },
    {
      date: '2026-05-18',
      title: 'Version 0.17.42 - Disponibilites datees planning',
      summary: 'Le planning permet aux utilisateurs de declarer des disponibilites a une date et une heure precises, avec affichage direct dans l agenda.'
    },
    {
      date: '2026-05-18',
      title: 'Version 0.17.41 - Conflits agenda planning',
      summary: 'Chaque session du planning affiche les conflits, le signal de disponibilite hebdomadaire et les meilleurs creneaux possibles.'
    },
    {
      date: '2026-05-18',
      title: 'Version 0.17.40 - Reponses agenda planning',
      summary: 'Les sessions du planning peuvent etre creees cote API, modifiees par admin et recevoir les reponses des joueurs par date precise.'
    },
    {
      date: '2026-05-17',
      title: 'Version 0.17.39 - Agenda planning date',
      summary: 'Le planning gagne un agenda mensuel date, une API de lecture des sessions candidates et une persistance JSON dediee.'
    },
    {
      date: '2026-05-14',
      title: 'Version 0.17.38 - Roadmap agenda reel',
      summary: 'La roadmap distingue le socle de disponibilites du futur rework agenda/calendrier date avec sessions candidates.'
    },
    {
      date: '2026-05-14',
      title: 'Version 0.17.37 - Vue mois planning',
      summary: 'Le planning propose une bascule semaine/mois lisible sur desktop et mobile, avec projection des disponibilites sur les prochaines semaines.'
    },
    {
      date: '2026-05-14',
      title: 'Version 0.17.36 - Statuts planning',
      summary: 'Les disponibilites du planning gerent maintenant les statuts disponible, incertain, indisponible et non renseigne.'
    },
    {
      date: '2026-05-14',
      title: 'Version 0.17.35 - Synthese planning',
      summary: 'Le planning affiche les meilleurs creneaux communs avec une synthese globale et des scopes de groupes JDR quand ils existent.'
    },
    {
      date: '2026-05-14',
      title: 'Version 0.17.34 - Disponibilites planning',
      summary: 'La page planning permet aux utilisateurs connectes de cocher leurs disponibilites par jour et creneau puis de les enregistrer dans leur profil.'
    },
    {
      date: '2026-05-14',
      title: 'Version 0.17.33 - Page planning JDR',
      summary: 'Une page dediee /planning/ pose le socle UI pour organiser les sessions et preparer les disponibilites des groupes.'
    },
    {
      date: '2026-05-14',
      title: 'Version 0.17.32 - CI Playwright optimisee',
      summary: 'La CI utilise npm ci, cache les dependances et navigateurs, separe les projets Playwright et conserve les diagnostics en echec.'
    },
    {
      date: '2026-05-13',
      title: 'Version 0.17.31 - Encodage UTF-8 verrouille',
      summary: 'Les conventions d encodage sont explicites via EditorConfig et le lint UTF-8 controle les fichiers texte du projet.'
    },
    {
      date: '2026-05-13',
      title: 'Version 0.17.30 - Nettoyage legacy tests',
      summary: 'L ancien placeholder de test unitaire est retire, les compatibilites serveur utiles restent couvertes.'
    },
    {
      date: '2026-05-13',
      title: 'Version 0.17.29 - Annotations modularisees',
      summary: 'La normalisation des annotations sort de UiController avec tests unitaires dedies.'
    },
    {
      date: '2026-05-13',
      title: 'Version 0.17.28 - Personnages modularises',
      summary: 'La normalisation des personnages utilisateur sort de UiController avec tests unitaires dedies.'
    },
    {
      date: '2026-05-13',
      title: 'Version 0.17.27 - Personnalisation profil modularisee',
      summary: 'La normalisation du profil utilisateur sort de UiController pour isoler le modele de donnees.'
    },
    {
      date: '2026-05-13',
      title: 'Version 0.17.26 - Disponibilites modularisees',
      summary: 'Le modele des disponibilites sort de UiController pour reduire les dependances UI.'
    },
    {
      date: '2026-05-12',
      title: 'Version 0.17.25 - Patch notes accueil automatises',
      summary: "L'accueil affiche les dernieres versions depuis l API changelog avec fallback local."
    },
    {
      date: '2026-05-12',
      title: 'Version 0.17.24 - Changelog produit prioritaire',
      summary: "La page changelog est accessible depuis la navigation accueil et affiche les versions produit avant l historique Git brut."
    },
    {
      date: '2026-05-12',
      title: 'Version 0.17.23 - Page changelog dediee',
      summary: "Une page publique /changelog/ regroupe les versions et changements recents de la carte."
    },
    {
      date: '2026-05-12',
      title: 'Version 0.17.22 - Compteur Discord fiabilise',
      summary: "Le compteur Discord de l'accueil affiche un etat live ou un fallback manuel clair quand l API Discord est indisponible."
    },
    {
      date: '2026-05-11',
      title: 'Version 0.17.21 - Telechargement assets fiabilise',
      summary: 'La generation d archive assets corrige le fallback tar, harmonise les exclusions et expose la taille de l archive au telechargement.'
    },
    {
      date: '2026-05-11',
      title: 'Version 0.17.20 - Session Discord prolongee',
      summary: 'La verification de session renouvelle le cookie Discord actif afin de maintenir la connexion pendant l usage regulier.'
    },
    {
      date: '2026-05-11',
      title: 'Version 0.17.19 - QA responsive mobile',
      summary: 'Une suite Playwright dediee verifie les pages publiques et l editeur de lieu sur telephone, avec corrections du formulaire long mobile.'
    },
    {
      date: '2026-05-09',
      title: 'Version 0.17.18 - Admin mobile consolide',
      summary: 'Les panneaux admin accueil, chronologie et carte sont mieux adaptes au telephone avec plein ecran, scroll vertical et controles tactiles.'
    },
    {
      date: '2026-05-09',
      title: 'Version 0.17.17 - CI chronologie Firefox stabilisee',
      summary: 'La navigation rapide par periode de la chronologie cible le bon groupe de maniere deterministe dans les tests Firefox.'
    },
    {
      date: '2026-05-09',
      title: 'Version 0.17.16 - Chronologie mobile consolidee',
      summary: 'La chronologie mobile gagne un header compact, une navigation tactile, des filtres pleine largeur et une lightbox mieux bornee.'
    },
    {
      date: '2026-05-09',
      title: 'Version 0.17.15 - Accueil mobile consolide',
      summary: 'L accueil mobile gagne une navigation tactile, des CTA homogenes et des blocs de soutien lisibles sans debordement horizontal.'
    },
    {
      date: '2026-05-09',
      title: 'Version 0.17.14 - Premiere tranche mobile carte',
      summary: 'La carte gagne une barre d outils mobile compacte, un flux temps reel mieux place et un panneau lieu prioritaire sur telephone.'
    },
    {
      date: '2026-05-09',
      title: 'Version 0.17.13 - Suppression annotations persistante',
      summary: 'La suppression des annotations cible correctement l id serveur, persiste le JSON et synchronise la carte en temps reel.'
    },
    {
      date: '2026-05-08',
      title: 'Version 0.17.12 - Detail chronologie elargi',
      summary: 'Le detail des evenements de chronologie utilise mieux la largeur du panneau apres l ajout de l agrandissement d image.'
    },
    {
      date: '2026-05-07',
      title: 'Version 0.17.11 - Images chronologie agrandies',
      summary: 'Les images de detail de la frise peuvent etre ouvertes en grand dans une modale plein ecran accessible.'
    },
    {
      date: '2026-05-07',
      title: 'Version 0.17.10 - Fix theme clair carte',
      summary: 'Le bouton theme clair de la barre d outil reapplique correctement le theme, son etat accessible et la preference locale.'
    },
    {
      date: '2026-05-06',
      title: 'Version 0.17.9 - Reordre des blocs narratifs',
      summary: 'L editeur de lieux permet de reordonner lore, historique, quetes et sections longues par glisser-deposer ou boutons accessibles.'
    },
    {
      date: '2026-05-06',
      title: 'Version 0.17.8 - Peinture ephemere carte',
      summary: 'Un outil local permet de tracer puis effacer des schemas temporaires sur la carte sans creer d annotation persistante.'
    },
    {
      date: '2026-05-06',
      title: 'Version 0.17.7 - Navigation libre carte',
      summary: 'La carte n est plus verrouillee aux bords afin de rendre les lieux proches des limites plus faciles a atteindre et selectionner.'
    },
    {
      date: '2026-05-06',
      title: 'Version 0.17.6 - Polish chronologie',
      summary: 'La frise gagne en densite, en lisibilite sur les longues periodes et en transitions de lecture.'
    },
    {
      date: '2026-05-06',
      title: 'Version 0.17.5 - Ordre chronologique public',
      summary: 'La chronologie publique et les tests UI utilisent desormais le meme ordre d evenements trie par annee.'
    },
    {
      date: '2026-05-06',
      title: 'Version 0.17.4 - Upload images chronologie',
      summary: 'L admin chronologie permet d uploader directement une image d evenement et de remplir automatiquement l URL media.'
    },
    {
      date: '2026-05-06',
      title: 'Version 0.17.3 - Documentation projet',
      summary: 'Documentation restructuree, version projet alignee et preparation d un suivi version/changelog a chaque commit.'
    },
    {
      date: '2026-02-28',
      title: 'Nouvel accueil en ligne',
      summary: "Nouvelle page d'accueil avec session, communaute, flux live, lieux mis en avant et patch notes."
    }
  ]
};
const DEFAULT_TIMELINE = {
  title: "Chronologie d'Hesta",
  subtitle: "Une lecture lineaire des bascules politiques, spirituelles et militaires qui structurent les campagnes.",
  entries: []
};
const DEFAULT_PLANNING = {
  sessions: []
};

const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self' data: blob:",
    "script-src 'self' 'unsafe-eval' https://unpkg.com https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://unpkg.com https://cdn.jsdelivr.net",
    "img-src 'self' data: blob: https://unpkg.com https://cdn.jsdelivr.net https://cdn.discordapp.com https://media.discordapp.net https://images-ext-1.discordapp.net https://images-ext-2.discordapp.net https://img.youtube.com https://i.ytimg.com",
    "font-src 'self' data: https://unpkg.com https://cdn.jsdelivr.net",
    "media-src 'self' data: blob:",
    "connect-src 'self'",
    "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com",
    "frame-ancestors 'self'"
  ].join('; '),
  'X-Content-Type-Options': 'nosniff'
};

const SSE_HEARTBEAT_MS = 30_000;
const sseClients = new Set();
const serverStartedAt = Date.now();
const sseMetrics = {
  broadcastCount: 0,
  lastEventAt: null,
  lastEventName: null
};

const broadcastSse = (eventName, payload) => {
  if (!sseClients.size) {
    return;
  }
  sseMetrics.broadcastCount += 1;
  sseMetrics.lastEventAt = Date.now();
  sseMetrics.lastEventName = eventName || null;
  // Payloads are intentionally not transmitted. Authorized-view invalidations are emitted after persistence.
};

const registerSseClient = (req, res) => {
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive'
  });

  res.write(`event: connected\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);

  const client = { req, res, heartbeat: null, signature: null, initialized: false };

  client.heartbeat = setInterval(() => {
    if (res.writableEnded) {
      clearInterval(client.heartbeat);
      return;
    }
    try {
      res.write(`event: heartbeat\ndata: ${Date.now()}\n\n`);
    } catch (error) {
      clearInterval(client.heartbeat);
    }
  }, SSE_HEARTBEAT_MS);

  const cleanup = () => {
    clearInterval(client.heartbeat);
    sseClients.delete(client);
  };

  req.on('close', cleanup);
  res.on('close', cleanup);

  sseClients.add(client);
};

const storeName = target => {
  const name = path.basename(target, '.json');
  if (storage.file(name) !== target) throw new Error('Unregistered JSON path');
  return name;
};
const readJsonFile = target => storage.read(storeName(target));
const writeJsonFile = (target, data) => storage.write(storeName(target), data);

const readAnnotationsFile = async () => readJsonFile(ANNOTATIONS_FILE, []);
const writeAnnotationsFile = async annotations => writeJsonFile(ANNOTATIONS_FILE, annotations);
const readTimelineFile = async () => sanitizeTimelineConfig(await readJsonFile(TIMELINE_FILE, DEFAULT_TIMELINE));
const writeTimelineFile = async timeline => {
  validate('timeline', timeline);
  const next = sanitizeTimelineConfig(timeline);
  if (next.entries.length !== timeline.entries.length) throw new Error('Timeline normalization would discard records');
  await writeJsonFile(TIMELINE_FILE, next);
};
const readPlanningFile = async () => sanitizePlanningConfig(await readJsonFile(PLANNING_FILE, DEFAULT_PLANNING));
const writePlanningFile = async planning => {
  validate('planning', planning);
  const previous = await storage.read('planning');
  const next = sanitizePlanningConfig(planning);
  await storage.write('planning', Array.isArray(previous) ? next.sessions : { ...previous, ...next });
};

let searchFiltersModulePromise = null;
const loadSearchFiltersModule = () => {
  if (!searchFiltersModulePromise) {
    const modulePath = pathToFileURL(path.join(__dirname, 'js', 'shared', 'searchFilters.mjs')).href;
    searchFiltersModulePromise = import(modulePath);
  }
  return searchFiltersModulePromise;
};

let locationValidationModulePromise = null;
const loadLocationValidationModule = () => {
  if (!locationValidationModulePromise) {
    const modulePath = pathToFileURL(path.join(__dirname, 'js', 'shared', 'locationValidation.mjs')).href;
    locationValidationModulePromise = import(modulePath);
  }
  return locationValidationModulePromise;
};


const send = (res, status, body = '', headers = {}) => {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  if (body === null) {
    res.end();
  } else {
    res.end(body);
  }
};

const json = (res, status, payload = null) => {
  const headers = { 'Content-Type': 'application/json' };
  if (payload === null) {
    send(res, status, null, headers);
    return;
  }
  send(res, status, JSON.stringify(payload), headers);
};

const { PublishedMedia } = require('./server/publication/media');
const { createPublicHandler } = require('./server/publication/http');
const { requestPath } = require('./server/publication/files');
const { publicArchive } = require('./server/publication/archive');
const { publicSiteConfig, publicTypes } = require('./server/publication/projections');
const publishedMedia = new PublishedMedia(storagePaths.media);
let serveStatic;

const UPLOAD_RULES = {
  image: {
    directory: IMAGES_DIR,
    extensions: ['.png', '.jpg', '.jpeg', '.webp', '.gif']
  },
  audio: {
    directory: AUDIO_DIR,
    extensions: ['.mp3', '.ogg', '.wav', '.flac', '.aac', '.m4a']
  }
};

const IMAGE_EXTENSIONS = new Set(UPLOAD_RULES.image.extensions);
const AUDIO_EXTENSIONS = new Set(UPLOAD_RULES.audio.extensions);
const canSyncRemote = REMOTE_SYNC_URL.length > 0 && REMOTE_SYNC_METHOD.length;
const ADMIN_API_TOKEN = (process.env.ADMIN_API_TOKEN || '').trim();
const USER_API_TOKENS = (process.env.USER_API_TOKENS || '')
  .split(',')
  .map(token => token.trim())
  .filter(Boolean);
const DISCORD_CLIENT_ID = (process.env.DISCORD_CLIENT_ID || '').trim();
const DISCORD_CLIENT_SECRET = (process.env.DISCORD_CLIENT_SECRET || '').trim();
const DISCORD_REDIRECT_URI = (process.env.DISCORD_REDIRECT_URI || '').trim();
const authConfig = authConfiguration();
const DISCORD_OAUTH_ENABLED = authConfig.discordEnabled;


const DISCORD_API_VERSION = 'v10';
const DEFAULT_DISCORD_API_ORIGIN = 'https://discord.com';
const rawDiscordApiOrigin = (process.env.DISCORD_API_ORIGIN || DEFAULT_DISCORD_API_ORIGIN).trim();
const DISCORD_API_ORIGIN = rawDiscordApiOrigin ? rawDiscordApiOrigin.replace(/\/+$/, '') : DEFAULT_DISCORD_API_ORIGIN;
const DISCORD_AUTHORIZE_URL = `${DISCORD_API_ORIGIN}/oauth2/authorize`;
const DISCORD_TOKEN_URL = `${DISCORD_API_ORIGIN}/api/oauth2/token`;
const DISCORD_USER_URL = `${DISCORD_API_ORIGIN}/api/${DISCORD_API_VERSION}/users/@me`;
const authRequired = true;
logger.info('Discord OAuth configuration', {
  enabled: DISCORD_OAUTH_ENABLED,
  origin: DISCORD_API_ORIGIN
});

const SESSION_COOKIE_NAME = 'map_session';
const oauthStateStore = new Map();
const OAUTH_STATE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_TTL_MS = Math.max(5 * 60 * 1000, Number(process.env.SESSION_TTL_MS) || DEFAULT_SESSION_TTL_MS);
const SESSION_SECRET = authConfig.secret;
const sessions = createSessions(storage, { secret: SESSION_SECRET, ttl: SESSION_TTL_MS, cookie: SESSION_COOKIE_NAME });
const createSession = payload => sessions.create(payload);
const getSession = (req, options) => sessions.get(req, options);
const destroySession = req => sessions.destroy(req);
const signSessionId = id => sessions.sign(id);

const sendSessionCookie = (res, signedId) => {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  const secure = process.env.COOKIE_SECURE === 'true' ? '; Secure' : '';
  const cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(signedId)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
  res.setHeader('Set-Cookie', cookie);
};

const refreshSessionCookie = (res, sessionId) => {
  if (!sessionId) {
    return;
  }
  sendSessionCookie(res, signSessionId(sessionId));
};

const clearSessionCookie = res => {
  const secure = process.env.COOKIE_SECURE === 'true' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`);
};

const fetchJson = (url, options = {}) => new Promise((resolve, reject) => {
  const parsed = new URL(url);
  const transport = parsed.protocol === 'https:' ? https : http;
  const requestOptions = {
    method: options.method || 'GET',
    headers: options.headers ? { ...options.headers } : {},
  };
  if (options.body && !requestOptions.headers['Content-Length']) {
    requestOptions.headers['Content-Length'] = Buffer.byteLength(options.body);
  }
  const request = transport.request(url, requestOptions, response => {
    let body = '';
    response.on('data', chunk => { body += chunk; });
    response.on('end', () => {
      if (response.statusCode >= 200 && response.statusCode < 300) {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (error) {
          reject(error);
        }
      } else {
        reject(new Error(`HTTP ${response.statusCode}: ${body}`));
      }
    });
  });
  const deadline = setTimeout(() => request.destroy(new Error('Remote request deadline exceeded')), 15_000);
  deadline.unref();
  request.once('close', () => clearTimeout(deadline));
  request.on('error', reject);
  if (options.body) {
    request.write(options.body);
  }
  request.end();
});

const AUTH_PRIORITY = { user: 1, admin: 2 };

const extractBearerToken = req => {
  const header = req.headers?.authorization || req.headers?.Authorization;
  if (!header || typeof header !== 'string') {
    return null;
  }
  const parts = header.split(/\s+/);
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
    return parts[1].trim();
  }
  return null;
};

const resolveCaller = async (req, options = {}) => {
  const { AccessError } = require('./server/security/access');
  if (authConfig.invalid) throw new AccessError(503, 'Authentication configuration is invalid.');
  const session = await getSession(req, options);
  let role = null, user = null;
  if (session?.data?.userId) {
    user = await findUserById(session.data.userId);
    if (user) role = user.role;
  }
  const token = extractBearerToken(req);
  if (!role && token) { const result = await resolveTokenUser(token); if (result) { role = result.role; user = result.user || null; } }
  const hasCookie = new RegExp('(?:^|;\\s*)' + SESSION_COOKIE_NAME + '=').test(req.headers?.cookie || '');
  if (!role && (hasCookie || req.headers?.authorization)) throw new AccessError(401, 'Invalid or revoked authentication.');
  return { role, user, session: session?.data || null };
};
const ensureAuthorized = async (req, res, minimumRole = 'user') => {
  let actor;
  try { actor = await resolveCaller(req); }
  catch (error) { if (!error.status) throw error; json(res, error.status, { status: 'error', message: error.message }); return null; }
  if (!actor.role) { json(res, 401, { status: 'error', message: 'Authorization required.' }); return null; }
  if ((AUTH_PRIORITY[actor.role] || 0) < (AUTH_PRIORITY[minimumRole] || 0)) { json(res, 403, { status: 'error', message: 'Insufficient privileges.' }); return null; }
  req.auth = actor;
  return actor.role;
};


const loadTypeMap = async () => readJsonFile(TYPES_FILE);

const normalizeString = value => (value ?? '').toString().trim();

const sanitizePlanningDate = value => {
  const normalized = normalizeString(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return null;
  }
  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString().slice(0, 10);
};

const sanitizePlanningTime = value => {
  const normalized = normalizeString(value);
  if (!/^\d{2}:\d{2}$/.test(normalized)) {
    return '';
  }
  const [hours, minutes] = normalized.split(':').map(Number);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return '';
  }
  return normalized;
};

const planningTimeToMinutes = value => {
  const time = sanitizePlanningTime(value);
  if (!time) {
    return null;
  }
  const [hours, minutes] = time.split(':').map(Number);
  return (hours * 60) + minutes;
};

const minutesToPlanningTime = value => {
  const bounded = Math.max(0, Math.min(23 * 60 + 59, Number(value) || 0));
  const hours = Math.floor(bounded / 60);
  const minutes = bounded % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

const sanitizePlanningStatus = value => {
  const normalized = normalizeString(value).toLowerCase();
  return ['candidate', 'confirmed', 'cancelled'].includes(normalized) ? normalized : 'candidate';
};

const sanitizePlanningId = value => normalizeString(value)
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9_-]+/g, '-')
  .replace(/-+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 120);

const ensureUniquePlanningId = (sessions, baseId) => {
  const used = new Set(sessions.map(session => session?.id).filter(Boolean));
  const base = sanitizePlanningId(baseId) || `session-${crypto.randomUUID()}`;
  let candidate = base;
  let index = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  return candidate;
};

const sanitizePlanningResponses = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return Object.entries(value).reduce((responses, [key, entry]) => {
    const userId = normalizeString(key).slice(0, 120);
    if (!userId || !entry || typeof entry !== 'object') {
      return responses;
    }
    const status = normalizeAvailabilityStatus(entry.status || entry.response);
    responses[userId] = {
      status: status || AVAILABILITY_STATUS.MAYBE,
      comment: normalizeString(entry.comment).slice(0, 280) || ''
    };
    return responses;
  }, {});
};

const sanitizePlanningAvailabilityEntry = (value, { existing = null, touch = false } = {}) => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const date = sanitizePlanningDate(value.date || existing?.date);
  const startTime = sanitizePlanningTime(value.startTime || value.start || existing?.startTime);
  if (!date || !startTime) {
    return null;
  }
  const startMinutes = planningTimeToMinutes(startTime);
  const rawEndTime = sanitizePlanningTime(value.endTime || value.end || existing?.endTime);
  let endMinutes = planningTimeToMinutes(rawEndTime);
  if (endMinutes === null || endMinutes <= startMinutes) {
    endMinutes = Math.min(startMinutes + 180, 23 * 60 + 59);
  }
  const id = sanitizePlanningId(value.id || existing?.id) || `availability-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  return {
    id,
    date,
    startTime,
    endTime: minutesToPlanningTime(endMinutes),
    status: normalizeAvailabilityStatus(value.status || value.response || existing?.status) || AVAILABILITY_STATUS.AVAILABLE,
    comment: normalizeString(value.comment || existing?.comment).slice(0, 280),
    createdAt: sanitizeIsoDateString(existing?.createdAt || value.createdAt) || now,
    updatedAt: touch ? now : (sanitizeIsoDateString(value.updatedAt || existing?.updatedAt) || now)
  };
};

const sanitizePlanningAvailabilityList = value => {
  if (!Array.isArray(value)) {
    return [];
  }
  const used = new Set();
  return value
    .map(entry => sanitizePlanningAvailabilityEntry(entry))
    .filter(Boolean)
    .map(entry => {
      let id = entry.id;
      let index = 2;
      while (used.has(id)) {
        id = `${entry.id}-${index}`;
        index += 1;
      }
      used.add(id);
      return { ...entry, id };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
};

const sanitizePlanningSession = value => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const id = normalizeString(value.id).slice(0, 120);
  const title = normalizeString(value.title).slice(0, 140);
  const date = sanitizePlanningDate(value.date);
  if (!id || !title || !date) {
    return null;
  }
  const duration = Math.max(0, Math.min(720, Number(value.durationMinutes) || 0));
  return {
    id,
    title,
    date,
    startTime: sanitizePlanningTime(value.startTime || value.time),
    durationMinutes: duration || 180,
    groupId: normalizeString(value.groupId).slice(0, 120),
    groupName: normalizeString(value.groupName || value.group).slice(0, 140),
    status: sanitizePlanningStatus(value.status),
    description: normalizeString(value.description).slice(0, 600),
    responses: sanitizePlanningResponses(value.responses),
    createdAt: sanitizeIsoDateString(value.createdAt),
    updatedAt: sanitizeIsoDateString(value.updatedAt)
  };
};

const buildPlanningSessionFromPayload = (payload, { existing = null, sessions = [] } = {}) => {
  const now = new Date().toISOString();
  const source = payload && typeof payload === 'object' ? payload : {};
  const merged = {
    ...(existing || {}),
    ...source,
    id: existing?.id || source.id || ensureUniquePlanningId(sessions, source.id || source.title || source.date),
    createdAt: existing?.createdAt || source.createdAt || now,
    updatedAt: now
  };
  return sanitizePlanningSession(merged);
};

const getPlanningPayloadDates = payload => {
  const source = Array.isArray(payload?.dates) ? payload.dates : [payload?.date];
  if (!source.length) {
    return [];
  }
  const dates = source.map(sanitizePlanningDate);
  if (dates.some(date => !date)) {
    return [];
  }
  return [...new Set(dates)];
};

const sanitizePlanningConfig = value => {
  const sessionsSource = Array.isArray(value)
    ? value
    : (Array.isArray(value?.sessions) ? value.sessions : []);
  const sessions = sessionsSource
    .map(sanitizePlanningSession)
    .filter(Boolean)
    .sort((a, b) => {
      const dateCompare = a.date.localeCompare(b.date);
      return dateCompare || a.startTime.localeCompare(b.startTime) || a.title.localeCompare(b.title);
    });
  return { sessions };
};

const summarizePlanningSessionResponses = responses => {
  const counts = {
    available: 0,
    maybe: 0,
    busy: 0
  };
  Object.values(responses || {}).forEach(entry => {
    const status = entry?.status;
    if (Object.prototype.hasOwnProperty.call(counts, status)) {
      counts[status] += 1;
    }
  });
  return counts;
};

const withPlanningResponseSummary = (session, { users = [] } = {}) => ({
  ...session,
  responseSummary: summarizePlanningSessionResponses(session.responses),
  planningInsight: buildPlanningSessionInsight(session, users)
});

const parseListParam = (searchParams, key) => {
  const rawValues = searchParams.getAll(key) || [];
  const collected = [];
  rawValues.forEach(entry => {
    if (typeof entry !== 'string') {
      return;
    }
    entry.split(/[,;]+/).forEach(chunk => {
      const normalized = normalizeString(chunk);
      if (normalized) {
        collected.push(normalized);
      }
    });
  });
  return collected;
};


const isHttpUrl = value => {
  if (!value || typeof value !== 'string') {
    return false;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (error) {
    return false;
  }
};

const cloneSiteConfigDefaults = () => JSON.parse(JSON.stringify(DEFAULT_SITE_CONFIG));

const sanitizeSiteConfigText = (value, maxLength = 1200) => {
  const normalized = normalizeString(value);
  if (!normalized) {
    return '';
  }
  return normalized.slice(0, maxLength);
};

const sanitizeSiteConfigDate = value => {
  const normalized = normalizeString(value);
  if (!normalized) {
    return '';
  }
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : normalized.slice(0, 32);
};

const sanitizeSiteConfigUrl = (value, { allowRelative = false } = {}) => {
  const normalized = normalizeString(value);
  if (!normalized) {
    return '';
  }
  if (allowRelative && normalized.startsWith('/')) {
    return normalized;
  }
  return isHttpUrl(normalized) ? normalized : '';
};

const sanitizeSiteConfigContact = value => {
  const normalized = normalizeString(value);
  if (!normalized) {
    return '';
  }
  if (/^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(normalized)) {
    return normalized;
  }
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(normalized) ? normalized : '';
};

const sanitizeSiteConfigMode = value => {
  const normalized = normalizeString(value).toLowerCase();
  return normalized === 'discord' ? 'discord' : 'manual';
};

const sanitizeProjectVersion = value => {
  const normalized = normalizeString(value);
  return /^\d+\.\d+\.\d+$/u.test(normalized) ? normalized : '';
};

const sanitizeSiteConfigMetric = value => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const label = sanitizeSiteConfigText(value.label, 60);
  const metricValue = sanitizeSiteConfigText(value.value, 120);
  if (!label || !metricValue) {
    return null;
  }
  return { label, value: metricValue };
};

const sanitizeSiteConfigChangelogEntry = value => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const date = sanitizeSiteConfigDate(value.date);
  const title = sanitizeSiteConfigText(value.title, 120);
  const summary = sanitizeSiteConfigText(value.summary, 400);
  if (!date && !title && !summary) {
    return null;
  }
  return {
    date: date || '',
    title: title || 'Mise a jour',
    summary: summary || ''
  };
};

const sanitizeTimelineText = (value, maxLength = 1200) => sanitizeSiteConfigText(value, maxLength);
const sanitizeTimelineColor = value => {
  const normalized = normalizeString(value);
  if (!normalized) {
    return '#7dd3fc';
  }
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(normalized) ? normalized : '#7dd3fc';
};
const sanitizeTimelineEventKind = value => {
  const normalized = normalizeString(value).toLowerCase();
  return normalized === 'player' ? 'player' : 'lore';
};
const sanitizeTimelineId = value => {
  const normalized = normalizeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized.slice(0, 80);
};
const sanitizeTimelineList = (list, maxItems = 8, itemMaxLength = 60) => (
  Array.isArray(list)
    ? list.map(entry => sanitizeTimelineText(entry, itemMaxLength)).filter(Boolean).slice(0, maxItems)
    : []
);
const sanitizeTimelineEntry = (value, index = 0) => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const yearValue = Number(value.year);
  const year = Number.isFinite(yearValue) ? Math.round(yearValue) : index;
  const title = sanitizeTimelineText(value.title, 140);
  const summary = sanitizeTimelineText(value.summary, 280);
  const content = sanitizeTimelineText(value.content, 2400);
  const era = sanitizeTimelineText(value.era, 80);
  const period = sanitizeTimelineText(value.period, 80);
  const id = sanitizeTimelineId(value.id) || sanitizeTimelineId(`${year}-${title || `event-${index + 1}`}`) || `timeline-${index + 1}`;
  return {
    id,
    year,
    yearLabel: sanitizeTimelineText(value.yearLabel, 40) || String(year),
    title: title || `Evenement ${index + 1}`,
    summary: summary || content || '',
    content: content || summary || '',
    eventKind: sanitizeTimelineEventKind(value.eventKind),
    era: era || period || 'Periode inconnue',
    eraSummary: sanitizeTimelineText(value.eraSummary, 240),
    sceneLabel: sanitizeTimelineText(value.sceneLabel, 60),
    period: period || 'Periode inconnue',
    tags: sanitizeTimelineList(value.tags, 10, 40),
    locationNames: sanitizeTimelineList(value.locationNames, 10, 80),
    imageUrl: sanitizeSiteConfigUrl(value.imageUrl, { allowRelative: true }),
    mediaAlt: sanitizeTimelineText(value.mediaAlt, 180),
    accentColor: sanitizeTimelineColor(value.accentColor),
    visible: value.visible !== false
  };
};
const sanitizeTimelineConfig = value => {
  const source = value && typeof value === 'object' ? value : {};
  const entries = Array.isArray(source.entries)
    ? source.entries.map((entry, index) => sanitizeTimelineEntry(entry, index)).filter(Boolean).slice(0, 120)
    : [];
  return {
    title: sanitizeTimelineText(source.title, 120) || DEFAULT_TIMELINE.title,
    subtitle: sanitizeTimelineText(source.subtitle, 320) || DEFAULT_TIMELINE.subtitle,
    entries
  };
};


const extractDiscordInviteCode = value => {
  const normalized = normalizeString(value);
  if (!normalized) {
    return '';
  }
  try {
    const parsed = new URL(normalized);
    const parts = parsed.pathname.split('/').map(part => part.trim()).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
  } catch (_error) {
    return normalized.replace(/^https?:\/\/[^/]+\//i, '').trim();
  }
};

const fetchDiscordInviteStats = async inviteUrl => {
  const inviteCode = extractDiscordInviteCode(inviteUrl);
  if (!inviteCode) {
    return null;
  }
  const url = `${DISCORD_API_ORIGIN}/api/${DISCORD_API_VERSION}/invites/${encodeURIComponent(inviteCode)}?with_counts=true`;
  const payload = await fetchJson(url);
  return {
    inviteCode,
    memberCount: Math.max(0, Number(payload?.approximate_member_count) || 0),
    presenceCount: Math.max(0, Number(payload?.approximate_presence_count) || 0),
    guildId: normalizeString(payload?.guild?.id || ''),
    guildName: normalizeString(payload?.guild?.name || ''),
    source: 'discord'
  };
};

const fetchDiscordWidgetStats = async guildId => {
  const normalizedGuildId = normalizeString(guildId);
  if (!normalizedGuildId) {
    return null;
  }
  const widgetUrl = `${DISCORD_API_ORIGIN}/api/guilds/${encodeURIComponent(normalizedGuildId)}/widget.json`;
  const payload = await fetchJson(widgetUrl);
  const presenceCount = Math.max(0, Number(payload?.presence_count) || 0);
  const memberCount = Array.isArray(payload?.members) ? payload.members.length : 0;
  return {
    guildId: normalizedGuildId,
    presenceCount,
    memberCount,
    instantInvite: typeof payload?.instant_invite === 'string' ? payload.instant_invite : null,
    source: 'discord'
  };
};
const sanitizeSiteConfig = value => {
  const defaults = cloneSiteConfigDefaults();
  const source = value && typeof value === 'object' ? value : {};
  const homeSource = source.home && typeof source.home === 'object' ? source.home : {};
  const communitySource = source.community && typeof source.community === 'object' ? source.community : {};
  const supportSource = source.support && typeof source.support === 'object' ? source.support : {};
  const legalSource = source.legal && typeof source.legal === 'object' ? source.legal : {};

  const tags = Array.isArray(homeSource.tags)
    ? homeSource.tags.map(entry => sanitizeSiteConfigText(entry, 60)).filter(Boolean).slice(0, 8)
    : defaults.home.tags;
  const metrics = Array.isArray(homeSource.metrics)
    ? homeSource.metrics.map(sanitizeSiteConfigMetric).filter(Boolean).slice(0, 6)
    : defaults.home.metrics;
  const visualsSource = homeSource.visuals && typeof homeSource.visuals === 'object' ? homeSource.visuals : {};
  const proofSource = communitySource.proof && typeof communitySource.proof === 'object' ? communitySource.proof : {};

  const sanitizeCommunityCard = (key, fallback) => {
    const cardSource = communitySource[key] && typeof communitySource[key] === 'object' ? communitySource[key] : {};
    return {
      badge: sanitizeSiteConfigText(cardSource.badge, 30) || fallback.badge,
      title: sanitizeSiteConfigText(cardSource.title, 80) || fallback.title,
      copy: sanitizeSiteConfigText(cardSource.copy, 240) || fallback.copy
    };
  };

  const proof = {
    mode: normalizeString(proofSource.mode) === 'discord' ? 'discord' : 'manual',
    guildId: normalizeString(proofSource.guildId || ''),
    manualCount: Math.max(0, Number(proofSource.manualCount) || 0),
    label: sanitizeSiteConfigText(proofSource.label, 60) || defaults.community.proof.label,
    note: sanitizeSiteConfigText(proofSource.note, 200) || defaults.community.proof.note
  };

  const changelog = Array.isArray(source.changelog)
    ? source.changelog.map(sanitizeSiteConfigChangelogEntry).filter(Boolean).slice(0, 12)
    : defaults.changelog;

  return {
    version: sanitizeProjectVersion(source.version) || defaults.version,
    home: {
      kicker: sanitizeSiteConfigText(homeSource.kicker, 80) || defaults.home.kicker,
      title: sanitizeSiteConfigText(homeSource.title, 180) || defaults.home.title,
      lead: sanitizeSiteConfigText(homeSource.lead, 600) || defaults.home.lead,
      atmosphere: sanitizeSiteConfigText(homeSource.atmosphere, 180) || defaults.home.atmosphere,
      tags: tags.length ? tags : defaults.home.tags,
      metrics: metrics.length ? metrics : defaults.home.metrics,
      visuals: {
        backgroundImage: sanitizeSiteConfigUrl(visualsSource.backgroundImage, { allowRelative: true }) || defaults.home.visuals.backgroundImage,
        mapPreviewImage: sanitizeSiteConfigUrl(visualsSource.mapPreviewImage, { allowRelative: true }) || defaults.home.visuals.mapPreviewImage,
        characterImage: sanitizeSiteConfigUrl(visualsSource.characterImage, { allowRelative: true }) || defaults.home.visuals.characterImage,
        floatingTitle: sanitizeSiteConfigText(visualsSource.floatingTitle, 120) || defaults.home.visuals.floatingTitle,
        floatingCopy: sanitizeSiteConfigText(visualsSource.floatingCopy, 260) || defaults.home.visuals.floatingCopy
      }
    },
    community: {
      youtubeUrl: sanitizeSiteConfigUrl(communitySource.youtubeUrl) || defaults.community.youtubeUrl,
      discordUrl: sanitizeSiteConfigUrl(communitySource.discordUrl) || defaults.community.discordUrl,
      redditUrl: sanitizeSiteConfigUrl(communitySource.redditUrl) || defaults.community.redditUrl,
      discord: sanitizeCommunityCard('discord', defaults.community.discord),
      proof,
      youtube: sanitizeCommunityCard('youtube', defaults.community.youtube),
      reddit: sanitizeCommunityCard('reddit', defaults.community.reddit)
    },
    support: {
      issuesUrl: sanitizeSiteConfigUrl(supportSource.issuesUrl) || defaults.support.issuesUrl,
      contactEmail: sanitizeSiteConfigContact(supportSource.contactEmail) || defaults.support.contactEmail
    },
    legal: {
      creditsUrl: sanitizeSiteConfigUrl(legalSource.creditsUrl, { allowRelative: true }) || defaults.legal.creditsUrl,
      footerNote: sanitizeSiteConfigText(legalSource.footerNote, 240) || defaults.legal.footerNote
    },
    changelog: changelog.length ? changelog : defaults.changelog
  };
};

const readSiteConfigFile = async () => sanitizeSiteConfig(await readJsonFile(SITE_CONFIG_FILE, DEFAULT_SITE_CONFIG));
const writeSiteConfigFile = async config => {
  validate('site-config', config);
  await writeJsonFile(SITE_CONFIG_FILE, sanitizeSiteConfig(config));
};

const resolveAssetPath = relative => {
  if (typeof relative !== 'string') return null;
  const normalized = relative.replace(/^\//, '');
  if (!normalized.startsWith('assets/images/') && !normalized.startsWith('assets/audio/')) return null;
  const target = path.resolve(ASSETS_PATH, normalized.slice('assets/'.length));
  plainPath(target);
  return within(ASSETS_PATH, target) ? target : null;
};

const persistUploadedFile = payload => publishedMedia.upload(payload);

const readLocationsFile = () => readJsonFile(LOCATIONS_FILE);

const formatAssetLabel = (continent, index, name) => {
  const safeContinent = normalizeString(continent) || continent || 'Continent inconnu';
  const position = Number.isInteger(index) ? `${safeContinent}[${index + 1}]` : safeContinent;
  return name ? `${position} - ${name}` : position;
};

const validateLocationsDataset = async dataset => {
  const { validateDataset } = await loadLocationValidationModule();
  const typeMap = await loadTypeMap();
  const { normalized, issues } = validateDataset(dataset, { typeMap, sanitizeKeys: false });

  const errors = [];
  const warnings = [];
  issues.forEach(issue => {
    if (issue.level === 'error') {
      errors.push(issue.message);
    } else if (issue.level === 'warning') {
      warnings.push(issue.message);
    }
  });

  const assetChecks = [];
  Object.entries(normalized).forEach(([continent, locations]) => {
    if (!Array.isArray(locations)) {
      return;
    }
    locations.forEach((location, index) => {
      const label = formatAssetLabel(continent, index, location?.name);
      const audio = normalizeString(location?.audio);
      if (audio && audio.startsWith('assets/')) {
        const ext = path.extname(audio).toLowerCase();
        if (!AUDIO_EXTENSIONS.has(ext)) {
          errors.push(`Extension audio non supportee (${audio}) pour ${label}.`);
        } else {
          const resolved = resolveAssetPath(audio);
          if (!resolved) {
            errors.push(`Chemin audio hors assets (${audio}) pour ${label}.`);
          } else {
            assetChecks.push({ path: resolved, original: audio, context: label });
          }
        }
      }

      const images = Array.isArray(location?.images) ? location.images : [];
      images.forEach((entry, imageIndex) => {
        const value = normalizeString(entry);
        if (!value) {
          return;
        }
        if (value.startsWith('assets/')) {
          const ext = path.extname(value).toLowerCase();
          if (!IMAGE_EXTENSIONS.has(ext)) {
            errors.push(`Extension d'image non supportee (${value}) pour ${label}.`);
          } else {
            const resolved = resolveAssetPath(value);
            if (!resolved) {
              errors.push(`Chemin image hors assets (${value}) pour ${label}.`);
            } else {
              assetChecks.push({ path: resolved, original: value, context: label });
            }
          }
        } else if (!isHttpUrl(value)) {
          errors.push(`Image invalide (${value}) pour ${label} [index ${imageIndex + 1}].`);
        }
      });
    });
  });

  const seenAssetPaths = new Set();
  for (const asset of assetChecks) {
    if (seenAssetPaths.has(asset.path)) {
      continue;
    }
    seenAssetPaths.add(asset.path);
    try {
      await fs.promises.access(asset.path);
    } catch (error) {
      errors.push(`Fichier manquant ${asset.original} reference dans ${asset.context}.`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    normalized
  };
};

const flattenLocations = dataset => {
  const map = new Map();
  Object.entries(dataset || {}).forEach(([continent, list]) => {
    if (!Array.isArray(list)) {
      return;
    }
    list.forEach(location => {
      if (!location || typeof location !== 'object') {
        return;
      }
      const name = normalizeString(location.name);
      if (!name) {
        return;
      }
      const key = `${normalizeString(continent).toLowerCase()}::${name.toLowerCase()}`;
      map.set(key, {
        continent: continent,
        name: location.name,
        location
      });
    });
  });
  return map;
};

const cloneDataset = dataset => JSON.parse(JSON.stringify(dataset || {}));

const readList = async name => {
  const value = await storage.read(name);
  return Array.isArray(value) ? value : value[name];
};
const writeList = async (name, list) => {
  const previous = await storage.read(name);
  await storage.write(name, Array.isArray(previous) ? list : { ...previous, [name]: list });
};
const readUsersFile = () => readList('users');
const writeUsersFile = users => writeList('users', users);
const readGroupsFile = () => readList('groups');
const writeGroupsFile = groups => writeList('groups', groups);

const normalizeGroupColor = value => {
  if (!value || typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const normalized = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized.toLowerCase() : null;
};

const slugifyGroupId = name => {
  if (!name) {
    return '';
  }
  return name
    .toString()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

const ensureUniqueGroupId = (existing, base) => {
  if (!base) {
    return '';
  }
  const used = new Set(existing.map(group => group?.id).filter(Boolean));
  if (!used.has(base)) {
    return base;
  }
  let index = 2;
  let candidate = `${base}-${index}`;
  while (used.has(candidate)) {
    index += 1;
    candidate = `${base}-${index}`;
  }
  return candidate;
};

const sanitizeGroupRecord = group => ({
  id: group?.id || '',
  name: group?.name || '',
  color: normalizeGroupColor(group?.color),
  x: Number.isFinite(group?.x) ? group.x : null,
  y: Number.isFinite(group?.y) ? group.y : null
});

const sanitizeCharacterRecord = (character, { allowEmptyId = true } = {}) => {
  if (!character || typeof character !== 'object') {
    return null;
  }
  const id = normalizeString(character.id);
  const name = normalizeString(character.name);
  const bio = normalizeString(character.bio);
  const avatar = normalizeString(character.avatar);
  const groupId = normalizeString(character.groupId || character.group);
  const active = Boolean(character.active);
  const record = {
    id: id || (allowEmptyId ? null : ''),
    name: name || null,
    bio: bio || null,
    avatar: avatar || null,
    groupId: groupId || null,
    active
  };
  const hasValue = record.name || record.bio || record.avatar || record.groupId || record.active;
  return hasValue ? record : null;
};

const sanitizeCharacterList = (characters, { assignIds = false, allowedGroups = null } = {}) => {
  if (!Array.isArray(characters)) {
    return [];
  }
  const list = [];
  const seen = new Set();
  let hasActiveCharacter = false;
  characters.forEach(entry => {
    const record = sanitizeCharacterRecord(entry);
    if (!record) {
      return;
    }
    let id = normalizeString(record.id);
    if (!id && assignIds) {
      id = `char_${crypto.randomUUID()}`;
    }
    if (!id && !assignIds) {
      id = `legacy_${list.length + 1}`;
    }
    if (!id) {
      return;
    }
    if (seen.has(id)) {
      if (!assignIds) {
        return;
      }
      id = `char_${crypto.randomUUID()}`;
    }
    seen.add(id);
    let groupId = record.groupId || null;
    if (allowedGroups && groupId && !allowedGroups.has(groupId)) {
      groupId = null;
    }
    const isActive = Boolean(record.active) && !hasActiveCharacter;
    if (isActive) {
      hasActiveCharacter = true;
    }
    list.push({
      id,
      name: record.name || null,
      bio: record.bio || null,
      avatar: record.avatar || null,
      groupId,
      active: isActive
    });
  });
  return list;
};

const sanitizeProfileUrl = value => {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith('/')) {
    return normalized;
  }
  return isHttpUrl(normalized) ? normalized : null;
};

const sanitizeAccentColor = value => {
  const normalized = normalizeString(value).toLowerCase();
  return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : null;
};

const PROFILE_SOCIAL_KEYS = ['website', 'discord', 'twitch', 'youtube', 'x'];

const sanitizeProfileRecord = value => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const banner = sanitizeProfileUrl(value.banner || value.bannerUrl);
  const accentColor = sanitizeAccentColor(value.accentColor || value.accent || value.color);
  const bioRaw = normalizeString(value.bio);
  const bio = bioRaw ? bioRaw.slice(0, 6000) : null;
  const socialsSource = value.socials && typeof value.socials === 'object'
    ? value.socials
    : value;
  const socials = {};
  PROFILE_SOCIAL_KEYS.forEach(key => {
    const normalized = sanitizeProfileUrl(socialsSource[key]);
    if (normalized) {
      socials[key] = normalized;
    }
  });
  const hasSocials = Object.keys(socials).length > 0;
  if (!banner && !accentColor && !bio && !hasSocials) {
    return null;
  }
  return {
    banner: banner || null,
    accentColor: accentColor || null,
    bio: bio || null,
    socials
  };
};

const normalizeAvailabilityMatrix = slots => {
  if (!Array.isArray(slots)) {
    return null;
  }
  const matrix = [];
  for (let dayIndex = 0; dayIndex < AVAILABILITY_DAYS.length; dayIndex += 1) {
    const daySlots = Array.isArray(slots[dayIndex]) ? slots[dayIndex] : [];
    const row = [];
    for (let slotIndex = 0; slotIndex < AVAILABILITY_SLOTS.length; slotIndex += 1) {
      row.push(normalizeAvailabilityStatus(daySlots[slotIndex]));
    }
    matrix.push(row);
  }
  return matrix;
};

const normalizeAvailabilityStatus = value => {
  if (value === true) {
    return AVAILABILITY_STATUS.AVAILABLE;
  }
  if (value === false || value === null || value === undefined || value === '') {
    return null;
  }
  const normalized = normalizeString(value).toLowerCase();
  if (['available', 'disponible', 'yes', 'true', '1'].includes(normalized)) {
    return AVAILABILITY_STATUS.AVAILABLE;
  }
  if (['maybe', 'uncertain', 'incertain'].includes(normalized)) {
    return AVAILABILITY_STATUS.MAYBE;
  }
  if (['busy', 'unavailable', 'indisponible', 'no', 'false', '0'].includes(normalized)) {
    return AVAILABILITY_STATUS.BUSY;
  }
  return value ? AVAILABILITY_STATUS.AVAILABLE : null;
};

const sanitizeAvailabilityRecord = value => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const timezone = normalizeString(value.timezone || value.tz) || null;
  const sourceSlots = Array.isArray(value.slots)
    ? value.slots
    : (Array.isArray(value.days) ? value.days : null);
  const slots = normalizeAvailabilityMatrix(sourceSlots);
  if (!slots) {
    return null;
  }
  return { timezone, slots };
};

const collectUserGroupIds = user => {
  const ids = new Set();
  if (Array.isArray(user?.groups)) {
    user.groups.forEach(groupId => {
      const normalized = normalizeString(groupId);
      if (normalized) {
        ids.add(normalized);
      }
    });
  }
  return ids;
};

const resolvePlanningSessionSlot = session => {
  const date = new Date(`${session?.date || ''}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const dayIndex = (date.getUTCDay() + 6) % 7;
  const [hoursRaw] = normalizeString(session?.startTime).split(':');
  const hours = Number(hoursRaw);
  let slotIndex = null;
  if (Number.isFinite(hours)) {
    if (hours < 12) {
      slotIndex = 0;
    } else if (hours < 18) {
      slotIndex = 1;
    } else if (hours < 22) {
      slotIndex = 2;
    } else {
      slotIndex = 3;
    }
  }
  return {
    day: AVAILABILITY_DAYS[dayIndex],
    dayIndex,
    slot: slotIndex === null ? null : AVAILABILITY_SLOTS[slotIndex],
    slotIndex
  };
};

const collectPlanningTargetUsers = (session, users) => {
  const groupId = normalizeString(session?.groupId);
  if (!groupId) {
    return users;
  }
  return users.filter(user => collectUserGroupIds(user).has(groupId));
};

const getAvailabilityCountsForSlot = (users, dayIndex, slotIndex) => {
  const counts = {
    available: 0,
    maybe: 0,
    busy: 0,
    empty: 0,
    respondents: 0
  };
  users.forEach(user => {
    const availability = sanitizeAvailabilityRecord(user?.availability);
    const status = availability?.slots?.[dayIndex]?.[slotIndex] || null;
    if (status === AVAILABILITY_STATUS.AVAILABLE) {
      counts.available += 1;
      counts.respondents += 1;
    } else if (status === AVAILABILITY_STATUS.MAYBE) {
      counts.maybe += 1;
      counts.respondents += 1;
    } else if (status === AVAILABILITY_STATUS.BUSY) {
      counts.busy += 1;
      counts.respondents += 1;
    } else {
      counts.empty += 1;
    }
  });
  return counts;
};

const rangesOverlap = (startA, endA, startB, endB) => (
  startA !== null
  && endA !== null
  && startB !== null
  && endB !== null
  && startA < endB
  && startB < endA
);

const getPlanningSessionRange = session => {
  const start = planningTimeToMinutes(session?.startTime);
  if (start === null) {
    return null;
  }
  const duration = Math.max(1, Math.min(720, Number(session?.durationMinutes) || 180));
  return {
    start,
    end: Math.min(start + duration, 24 * 60)
  };
};

const getDatedAvailabilityCountsForSession = (users, session) => {
  const counts = {
    available: 0,
    maybe: 0,
    busy: 0,
    empty: 0,
    respondents: 0
  };
  const date = sanitizePlanningDate(session?.date);
  const range = getPlanningSessionRange(session);
  if (!date || !range) {
    counts.empty = users.length;
    return counts;
  }
  users.forEach(user => {
    const entries = sanitizePlanningAvailabilityList(user?.planningAvailability)
      .filter(entry => entry.date === date)
      .filter(entry => rangesOverlap(
        planningTimeToMinutes(entry.startTime),
        planningTimeToMinutes(entry.endTime),
        range.start,
        range.end
      ));
    const statuses = entries.map(entry => entry.status);
    if (statuses.includes(AVAILABILITY_STATUS.BUSY)) {
      counts.busy += 1;
      counts.respondents += 1;
    } else if (statuses.includes(AVAILABILITY_STATUS.AVAILABLE)) {
      counts.available += 1;
      counts.respondents += 1;
    } else if (statuses.includes(AVAILABILITY_STATUS.MAYBE)) {
      counts.maybe += 1;
      counts.respondents += 1;
    } else {
      counts.empty += 1;
    }
  });
  return counts;
};

const buildPlanningSessionInsight = (session, users = []) => {
  const targetUsers = collectPlanningTargetUsers(session, Array.isArray(users) ? users : []);
  const responseSummary = summarizePlanningSessionResponses(session?.responses);
  const slot = resolvePlanningSessionSlot(session);
  const weekly = slot && slot.slotIndex !== null
    ? getAvailabilityCountsForSlot(targetUsers, slot.dayIndex, slot.slotIndex)
    : { available: 0, maybe: 0, busy: 0, empty: targetUsers.length, respondents: 0 };
  const dated = getDatedAvailabilityCountsForSession(targetUsers, session);
  const signal = dated.respondents > 0 ? dated : weekly;
  const conflicts = responseSummary.busy + signal.busy;
  const positives = responseSummary.available + signal.available;
  let quality = 'unknown';
  if (targetUsers.length || Object.keys(session?.responses || {}).length) {
    quality = conflicts > positives ? 'conflict' : (positives > 0 ? 'good' : 'mixed');
  }
  return {
    targetUsers: targetUsers.length,
    slot: slot ? {
      day: slot.day,
      slot: slot.slot
    } : null,
    weekly,
    dated,
    conflicts,
    quality
  };
};

const resolveUserCharacters = user => {
  if (Array.isArray(user?.characters) && user.characters.length) {
    return user.characters;
  }
  const legacy = sanitizeCharacterRecord(user?.character);
  return legacy ? [legacy] : [];
};

const sanitizeRole = value => (value && value.toLowerCase() === 'admin') ? 'admin' : 'user';

const sanitizeIsoDateString = value => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const timestamp = Date.parse(trimmed);
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return new Date(timestamp).toISOString();
};

const sanitizeUserRecord = user => {
  const characters = sanitizeCharacterList(resolveUserCharacters(user));
  return ({
  id: user?.id || '',
  provider: user?.provider || 'manual',
  discordId: user?.provider === 'discord' ? user.discordId || null : null,
  username: user?.username || '',
  role: sanitizeRole(user?.role || 'user'),
  avatar: typeof user?.avatar === 'string' && user.avatar.trim() ? user.avatar.trim() : null,
  groups: Array.isArray(user?.groups) ? user.groups.filter(Boolean) : [],
  character: characters[0] || null,
  characters,
  profile: sanitizeProfileRecord(user?.profile),
  availability: sanitizeAvailabilityRecord(user?.availability),
  planningAvailability: sanitizePlanningAvailabilityList(user?.planningAvailability),
  account: {
    lastLoginAt: sanitizeIsoDateString(user?.lastLoginAt),
    lastSeenAt: sanitizeIsoDateString(user?.lastSeenAt)
  },
  apiTokens: Array.isArray(user?.apiTokens) && user?.provider !== 'discord' ? [...user.apiTokens] : undefined
  });
};

const findUserById = async id => {
  const users = await readUsersFile();
  return users.find(user => user.id === id) || null;
};

const findUserByDiscordId = async discordId => {
  const users = await readUsersFile();
  return users.find(user => user.provider === 'discord' && user.discordId === discordId) || null;
};

const resolveTokenUser = async token => {
  if (!token) {
    return null;
  }
  const users = await readUsersFile();
  for (const user of users) {
    if (Array.isArray(user.apiTokens) && user.apiTokens.includes(token)) {
      return { user, role: sanitizeRole(user.role) };
    }
  }
  if (ADMIN_API_TOKEN && token === ADMIN_API_TOKEN) {
    return { user: null, role: 'admin' };
  }
  if (USER_API_TOKENS.includes(token)) {
    return { user: null, role: 'user' };
  }
  return null;
};

const normalizeCharacterPayload = (payload, allowedGroups = null, assignIds = true) => {
  if (Array.isArray(payload)) {
    return sanitizeCharacterList(payload, { assignIds, allowedGroups });
  }
  if (payload && typeof payload === 'object') {
    return sanitizeCharacterList([payload], { assignIds, allowedGroups });
  }
  return [];
};

const updateSessionsForUser = (userId, updates = {}) => sessions.updateUser(userId, updates);
const destroySessionsForUser = userId => sessions.updateUser(userId, null);

const createManualUser = async ({ username = '', role = 'user', token = null }) => storage.transaction(async () => {
  const users = await readUsersFile();
  const id = `manual:${crypto.randomUUID()}`;
  const apiToken = token && token.trim() ? token.trim() : crypto.randomBytes(24).toString('hex');
  const user = {
    id,
    provider: 'manual',
    username: username || '',
    role: sanitizeRole(role),
    characters: [],
    character: null,
    profile: null,
    availability: null,
    lastLoginAt: null,
    lastSeenAt: null,
    groups: [],
    apiTokens: [apiToken]
  };
  users.push(user);
  await writeUsersFile(users);
  return { user, token: apiToken };
});

const upsertDiscordUser = async ({ discordId, username = '', roleHint = null, avatar = null, markLogin = false }) => storage.transaction(async () => {
  const users = await readUsersFile();
  let user = users.find(entry => entry.provider === 'discord' && entry.discordId === discordId);
  const avatarValue = typeof avatar === 'string' && avatar.trim() ? avatar.trim() : null;
  const loginTimestamp = markLogin ? new Date().toISOString() : null;
  if (!user) {
    const shouldBeAdmin = roleHint ? sanitizeRole(roleHint) === 'admin' : false;
    user = {
      id: `discord:${discordId}`,
      provider: 'discord',
      discordId,
      username: username || '',
      avatar: avatarValue,
      role: shouldBeAdmin ? 'admin' : 'user',
      characters: [],
      character: null,
      profile: null,
      availability: null,
      lastLoginAt: loginTimestamp,
      lastSeenAt: loginTimestamp,
      groups: [],
      apiTokens: []
    };
    users.push(user);
  } else {
    if (username && user.username !== username) {
      user.username = username;
    }
    if (avatarValue && user.avatar !== avatarValue) {
      user.avatar = avatarValue;
    }
    if (roleHint) {
      const sanitized = sanitizeRole(roleHint);
      if (sanitized !== user.role) {
        user.role = sanitized;
      }
    }
    if (markLogin) {
      user.lastLoginAt = loginTimestamp;
      user.lastSeenAt = loginTimestamp;
    }
  }
  await writeUsersFile(users);
  await updateSessionsForUser(user.id, {
    role: user.role,
    username: user.username,
    avatar: user.avatar || null,
    characters: Array.isArray(user.characters) ? user.characters : [],
    profile: sanitizeProfileRecord(user?.profile),
    availability: sanitizeAvailabilityRecord(user?.availability),
    account: {
      lastLoginAt: sanitizeIsoDateString(user?.lastLoginAt),
      lastSeenAt: sanitizeIsoDateString(user?.lastSeenAt)
    }
  });
  return user;
});

const updateUser = async (id, { role, username, addToken, removeToken, groups, character, characters, availability }) => storage.transaction(async () => {
  const users = await readUsersFile();
  const user = users.find(entry => entry.id === id);
  if (!user) {
    return null;
  }
  let updated = false;
  if (role) {
    const sanitized = sanitizeRole(role);
    if (sanitized !== user.role) {
      user.role = sanitized;
      updated = true;
    }
  }
  if (typeof username === 'string' && username !== user.username) {
    user.username = username;
    updated = true;
  }
  if (addToken) {
    if (!Array.isArray(user.apiTokens)) {
      user.apiTokens = [];
    }
    if (!user.apiTokens.includes(addToken)) {
      user.apiTokens.push(addToken);
      updated = true;
    }
  }
  if (removeToken && Array.isArray(user.apiTokens)) {
    const index = user.apiTokens.indexOf(removeToken);
    if (index !== -1) {
      user.apiTokens.splice(index, 1);
      updated = true;
    }
  }
  if (Array.isArray(groups)) {
    const cleaned = groups.filter(Boolean);
    const current = Array.isArray(user.groups) ? user.groups : [];
    const currentKey = JSON.stringify(current);
    const nextKey = JSON.stringify(cleaned);
    if (currentKey !== nextKey) {
      user.groups = cleaned;
      updated = true;
    }
  }
  if (Array.isArray(characters) || character !== undefined) {
    const groups = await readGroupsFile();
    const allowed = new Set(groups.map(group => group?.id).filter(Boolean));
    const normalized = Array.isArray(characters)
      ? normalizeCharacterPayload(characters, allowed, true)
      : normalizeCharacterPayload(character, allowed, true);
    const currentKey = JSON.stringify(Array.isArray(user.characters) ? user.characters : []);
    const nextKey = JSON.stringify(normalized);
    if (currentKey !== nextKey) {
      user.characters = normalized;
      user.character = null;
      updated = true;
    }
  }
  if (availability !== undefined) {
    const normalized = availability === null ? null : sanitizeAvailabilityRecord(availability);
    if (availability === null || normalized) {
      const currentKey = JSON.stringify(sanitizeAvailabilityRecord(user.availability) || null);
      const nextKey = JSON.stringify(normalized || null);
      if (currentKey !== nextKey) {
        user.availability = normalized;
        updated = true;
      }
    }
  }
  if (updated) {
    await writeUsersFile(users);
    await updateSessionsForUser(user.id, {
      role: user.role,
      username: user.username,
      groups: user.groups || [],
      characters: Array.isArray(user.characters) ? user.characters : [],
      profile: sanitizeProfileRecord(user?.profile),
      availability: sanitizeAvailabilityRecord(user?.availability)
    });
  }
  return user;
});

const updateUserCharacters = async (id, characterPayload) => storage.transaction(async () => {
  const users = await readUsersFile();
  const user = users.find(entry => entry.id === id);
  if (!user) {
    return null;
  }
  const groups = await readGroupsFile();
  const allowed = new Set(groups.map(group => group?.id).filter(Boolean));
  const normalized = normalizeCharacterPayload(characterPayload, allowed, true);
  const currentKey = JSON.stringify(Array.isArray(user.characters) ? user.characters : []);
  const nextKey = JSON.stringify(normalized);
  if (currentKey !== nextKey) {
    user.characters = normalized;
    user.character = null;
    await writeUsersFile(users);
    await updateSessionsForUser(user.id, {
      characters: Array.isArray(user.characters) ? user.characters : [],
      groups: user.groups || []
    });
  }
  return user;
});

const updateUserProfile = async (
  id,
  {
    characterPayload,
    availabilityPayload,
    profilePayload,
    updateCharacters,
    updateAvailability,
    updateProfile
  } = {}
) => storage.transaction(async () => {
  const users = await readUsersFile();
  const user = users.find(entry => entry.id === id);
  if (!user) {
    return { user: null };
  }
  const groups = await readGroupsFile();
  const allowed = new Set(groups.map(group => group?.id).filter(Boolean));
  const currentCharacters = sanitizeCharacterList(resolveUserCharacters(user), { assignIds: true, allowedGroups: allowed });
  let characters = currentCharacters;
  let updated = false;
  if (updateCharacters) {
    const entries = Array.isArray(characterPayload) ? characterPayload : [characterPayload];
    const permissions = await storage.read('permissions');
    const scoped = new Set([...(user.groups || []), ...(Object.hasOwn(permissions.managedGroups, user.id) ? permissions.managedGroups[user.id] : [])]);
    if (user.role !== 'admin' && entries.some(character => (character?.groupId || character?.group) && !scoped.has(character.groupId || character.group))) return { user: null, error: 'Character group is outside your authorized memberships.' };
    const normalized = normalizeCharacterPayload(characterPayload, allowed, true);
    const currentKey = JSON.stringify(Array.isArray(user.characters) ? user.characters : []);
    const nextKey = JSON.stringify(normalized);
    if (currentKey !== nextKey) {
      user.characters = normalized;
      user.character = null;
      updated = true;
    }
    characters = normalized;
  }

  let availability = sanitizeAvailabilityRecord(user.availability) || null;
  if (updateAvailability) {
    if (availabilityPayload === null) {
      if (availability !== null) {
        availability = null;
        user.availability = null;
        updated = true;
      }
    } else {
      const normalized = sanitizeAvailabilityRecord(availabilityPayload);
      if (!normalized) {
        return { user: null, error: 'Invalid availability payload.' };
      }
      const currentKey = JSON.stringify(availability || null);
      const nextKey = JSON.stringify(normalized || null);
      if (currentKey !== nextKey) {
        availability = normalized;
        user.availability = normalized;
        updated = true;
      }
    }
  }

  let profile = sanitizeProfileRecord(user.profile) || null;
  if (updateProfile) {
    if (profilePayload === null) {
      if (profile !== null) {
        profile = null;
        user.profile = null;
        updated = true;
      }
    } else {
      const normalized = sanitizeProfileRecord(profilePayload);
      const currentKey = JSON.stringify(profile || null);
      const nextKey = JSON.stringify(normalized || null);
      if (currentKey !== nextKey) {
        profile = normalized;
        user.profile = normalized;
        updated = true;
      }
    }
  }

  if (updated) {
    await writeUsersFile(users);
    await updateSessionsForUser(user.id, {
      characters: Array.isArray(user.characters) ? user.characters : [],
      groups: user.groups || [],
      profile: sanitizeProfileRecord(user?.profile),
      availability: sanitizeAvailabilityRecord(user?.availability)
    });
  }
  return { user, characters, availability, profile };
});

const deleteUser = async id => storage.transaction(async () => {
  const users = await readUsersFile();
  const index = users.findIndex(entry => entry.id === id);
  if (index === -1) {
    return null;
  }
  const [removed] = users.splice(index, 1);
  await writeUsersFile(users);
  await destroySessionsForUser(id);
  await require('./server/security/revoke').revokeReferences(storage, 'users', id);
  return removed;
});

const createGroup = async ({ name, color = null, x, y }) => {
  const groups = await readGroupsFile();
  const baseId = slugifyGroupId(name);
  const permissions = await storage.read('permissions');
  const historicalPlanning = await storage.read('planning');
  const historicalAnnotations = await storage.read('annotations');
  const accounts = await readUsersFile();
  const reserved = new Set(permissions.retiredGroupIds);
  for (const session of Array.isArray(historicalPlanning) ? historicalPlanning : historicalPlanning.sessions) if (typeof session.groupId === 'string') reserved.add(session.groupId);
  for (const annotation of historicalAnnotations) if (typeof annotation.groupId === 'string') reserved.add(annotation.groupId);
  for (const user of accounts) {
    for (const groupId of user.groups || []) reserved.add(groupId);
    for (const character of [...(user.characters || []), ...(user.character ? [user.character] : [])]) if (typeof character.groupId === 'string') reserved.add(character.groupId);
  }
  for (const groupIds of Object.values(permissions.managedGroups)) for (const groupId of groupIds) reserved.add(groupId);
  for (const entries of Object.values(permissions.resources)) for (const entry of Object.values(entries)) for (const rule of [entry.rule, ...Object.values(entry.categories || {})]) if (rule.groupId) reserved.add(rule.groupId);
  const id = ensureUniqueGroupId([...groups, ...[...reserved].map(id => ({ id }))], baseId);
  const nextX = x === null ? null : Number(x);
  const nextY = y === null ? null : Number(y);
  const hasCoords = Number.isFinite(nextX) && Number.isFinite(nextY);
  const group = {
    id,
    name,
    color: normalizeGroupColor(color),
    x: hasCoords ? nextX : null,
    y: hasCoords ? nextY : null
  };
  groups.push(group);
  await writeGroupsFile(groups);
  return group;
};

const updateGroup = async (id, { name, color, x, y }) => {
  const groups = await readGroupsFile();
  const group = groups.find(entry => entry.id === id);
  if (!group) {
    return null;
  }
  let updated = false;
  if (typeof name === 'string' && name.trim() && name.trim() !== group.name) {
    group.name = name.trim();
    updated = true;
  }
  if (color !== undefined) {
    const normalized = normalizeGroupColor(color);
    if (normalized !== group.color) {
      group.color = normalized;
      updated = true;
    }
  }
  if (x !== undefined || y !== undefined) {
    const nextX = x === null ? null : Number(x);
    const nextY = y === null ? null : Number(y);
    if (nextX === null || nextY === null) {
      if (group.x !== null || group.y !== null) {
        group.x = null;
        group.y = null;
        updated = true;
      }
    } else if (Number.isFinite(nextX) && Number.isFinite(nextY)) {
      if (group.x !== nextX || group.y !== nextY) {
        group.x = nextX;
        group.y = nextY;
        updated = true;
      }
    }
  }
  if (updated) {
    await writeGroupsFile(groups);
  }
  return group;
};

const updateGroups = async entries => {
  if (!Array.isArray(entries) || entries.length === 0) {
    return [];
  }
  const groups = await readGroupsFile();
  const byId = new Map(groups.map(group => [group.id, group]));
  const seen = new Set();
  const changes = [];
  for (const entry of entries) {
    const id = normalizeString(entry?.id);
    const name = normalizeString(entry?.name);
    const group = byId.get(id);
    if (!id || !name || !group || seen.has(id)) {
      return null;
    }
    seen.add(id);
    changes.push({
      group,
      name,
      color: normalizeGroupColor(entry?.color)
    });
  }
  let updated = false;
  changes.forEach(({ group, name, color }) => {
    if (group.name !== name) {
      group.name = name;
      updated = true;
    }
    if (group.color !== color) {
      group.color = color;
      updated = true;
    }
  });
  if (updated) {
    await writeGroupsFile(groups);
  }
  return changes.map(({ group }) => group);
};

const removeGroupFromUsers = async groupId => storage.transaction(async () => {
  const users = await readUsersFile();
  let changed = false;
  for (const user of users) {
    if (!Array.isArray(user.groups)) {
      continue;
    }
    const next = user.groups.filter(entry => entry !== groupId);
    if (next.length !== user.groups.length) {
      user.groups = next;
      await updateSessionsForUser(user.id, { groups: next });
      changed = true;
    }
  }
  if (changed) {
    await writeUsersFile(users);
  }
});

const deleteGroup = async id => storage.transaction(async () => {
  const groups = await readGroupsFile();
  const index = groups.findIndex(entry => entry.id === id);
  if (index === -1) {
    return null;
  }
  const [removed] = groups.splice(index, 1);
  await writeGroupsFile(groups);
  await removeGroupFromUsers(id);
  await require('./server/security/revoke').revokeReferences(storage, 'groups', id);
  return removed;
});

const computeLocationsDiff = (previous, next) => {
  const before = flattenLocations(previous);
  const after = flattenLocations(next);
  const created = [];
  const updated = [];
  const deleted = [];

  after.forEach((entry, key) => {
    if (!before.has(key)) {
      created.push({ continent: entry.continent, name: entry.name });
      return;
    }
    const previousEntry = before.get(key);
    const beforeSnapshot = JSON.stringify(previousEntry.location);
    const afterSnapshot = JSON.stringify(entry.location);
    if (beforeSnapshot !== afterSnapshot) {
      updated.push({ continent: entry.continent, name: entry.name });
    }
  });

  before.forEach((entry, key) => {
    if (!after.has(key)) {
      deleted.push({ continent: entry.continent, name: entry.name });
    }
  });

  return { created, updated, deleted };
};

const appendAuditLog = async ({ dataset, diff }) => {
  const totalContinents = Object.keys(dataset || {}).length;
  const totalLocations = Object.values(dataset || {}).reduce(
    (acc, list) => acc + (Array.isArray(list) ? list.length : 0),
    0
  );
  const summarize = entries => ({
    count: entries.length,
    items: entries.slice(0, 10)
  });
  const entry = {
    timestamp: new Date().toISOString(),
    totals: {
      continents: totalContinents,
      locations: totalLocations
    },
    changes: {
      created: summarize(diff.created),
      updated: summarize(diff.updated),
      deleted: summarize(diff.deleted)
    }
  };
  try {
    await withFileLock(AUDIT_FILE, async () => {
      await fs.promises.mkdir(AUDIT_DIR, { recursive: true });
      await fs.promises.appendFile(AUDIT_FILE, JSON.stringify(entry) + '\n', { encoding: 'utf8', mode: 0o600 });
    });
  } catch (error) {
    logger.error('[audit] unable to append log', { error: error.message });
  }
};

const sendRemoteSync = async ({ dataset, diff }) => {
  if (!canSyncRemote) {
    return { status: 'skipped' };
  }
  try {
    const target = new URL(REMOTE_SYNC_URL);
    const transport = target.protocol === 'https:' ? https : http;
    const body = JSON.stringify({
      timestamp: new Date().toISOString(),
      locations: dataset,
      diff
    });
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    };
    if (REMOTE_SYNC_TOKEN) {
      headers.Authorization = `Bearer ${REMOTE_SYNC_TOKEN}`;
    }
    const options = {
      method: REMOTE_SYNC_METHOD,
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: `${target.pathname}${target.search}`,
      headers,
      timeout: REMOTE_SYNC_TIMEOUT
    };

    return await new Promise(resolve => {
      const request = transport.request(options, response => {
        let responseBody = '';
        response.on('data', chunk => {
          responseBody += chunk;
        });
        response.on('end', () => {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve({ status: 'ok', statusCode: response.statusCode });
          } else {
            resolve({
              status: 'error',
              statusCode: response.statusCode,
              body: responseBody
            });
          }
        });
      });
      request.on('timeout', () => {
        request.destroy(new Error('timeout'));
      });
      request.on('error', error => {
        resolve({ status: 'error', error: error.message });
      });
      request.write(body);
      request.end();
    });
  } catch (error) {
    return { status: 'error', error: error.message };
  }
};

const collectBody = req => new Promise((resolve, reject) => {
  let body = '';
  req.on('data', chunk => {
    body += chunk;
    if (body.length > MAX_BODY_SIZE) {
      reject(new Error('Payload too large'));
      req.destroy();
    }
  });
  req.on('end', () => resolve(body));
  req.on('error', reject);
});

const persistLocations = payload => storage.transaction(async () => {
  const previous = await storage.read('locations'), permissions = await storage.read('permissions');
  const { locationKey } = require('./server/security/access');
  const kept = new Set(Object.entries(payload).flatMap(([continent, places]) => places.map(place => locationKey(continent, place.name))));
  let changed = false;
  for (const key of Object.keys(permissions.resources.locations)) if (!kept.has(key)) { delete permissions.resources.locations[key]; changed = true; }
  await storage.write('locations', payload);
  if (changed) { permissions.revision++; await storage.write('permissions', permissions); }
});

const context = {
  logger,
  json,
  send,
  ensureAuthorized,
  security: null,
  persistScopedLocations: null,
  normalizeString,
  parseListParam,
  loadSearchFiltersModule,
  loadLocationValidationModule,
  readLocationsFile,
  loadTypeMap,
  validateLocationsDataset,
  persistLocations,
  computeLocationsDiff,
  appendAuditLog,
  sendRemoteSync,
  broadcastSse,
  collectBody,
  readAnnotationsFile,
  writeAnnotationsFile,
  readTimelineFile,
  writeTimelineFile,
  authRequired,
  authenticationUnavailable: authConfig.invalid,
  storageTransaction: callback => storage.transaction(callback),
  discordOauth: {
    enabled: DISCORD_OAUTH_ENABLED,
    clientId: DISCORD_CLIENT_ID,
    clientSecret: DISCORD_CLIENT_SECRET,
    redirectUri: DISCORD_REDIRECT_URI
  },
  discordEndpoints: {
    origin: DISCORD_API_ORIGIN,
    authorizeUrl: DISCORD_AUTHORIZE_URL,
    tokenUrl: DISCORD_TOKEN_URL,
    userUrl: DISCORD_USER_URL
  },
  oauthStateStore,
  oauthStateTtlMs: OAUTH_STATE_TTL_MS,
  createSession,
  getSession,
  sendSessionCookie,
  refreshSessionCookie,
  clearSessionCookie,
  destroySession,
  findUserById,
  sanitizeRole,
  sanitizeUserRecord,
  upsertDiscordUser,
  fetchJson,
  readGroupsFile
};

const { createSecurity } = require('./server/security/service');
const security = createSecurity({ storage, resolveCaller, json, collectBody, summarize: withPlanningResponseSummary, buildSession: buildPlanningSessionFromPayload, datesFrom: getPlanningPayloadDates, sanitizeSession: sanitizePlanningSession });
context.security = security;
context.persistScopedLocations = async (req, locations) => storage.transaction(async () => {
  const before = await security.load(req);
  await storage.write('locations', locations);
  if (!before.admin) {
    const { fingerprint, locationKey } = require('./server/security/access');
    for (const [continent, entries] of Object.entries(locations)) for (const entry of entries) {
      const original = (before.locations[continent] || []).find(place => place.name === entry.name);
      const policy = original && before.locationPolicy(continent, original);
      if (policy) before.permissions.resources.locations[locationKey(continent, entry.name)].fingerprint = fingerprint('locations', entry);
    }
    before.permissions.revision++; await storage.write('permissions', before.permissions);
  }
});
const router = createRouter(context);

const handleRequest = async (req, res) => {
  try {
    let canonical;
    try { canonical = requestPath(req.url); } catch { send(res, 400, 'Invalid request path'); return; }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      let crossOrigin = req.headers['sec-fetch-site'] === 'cross-site';
      if (req.headers.origin) { try { crossOrigin ||= new URL(req.headers.origin).host !== req.headers.host; } catch { crossOrigin = true; } }
      if (crossOrigin) { json(res, 403, { status: 'error', message: 'Cross-origin mutation refused.' }); return; }
    }
    if (canonical.startsWith('/api/') || canonical.startsWith('/assets/')) { res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Vary', 'Cookie, Authorization'); }
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    if (canonical !== decodeURIComponent(urlObj.pathname)) { send(res, 400, 'Invalid request path'); return; }
    if (req.method === 'GET' && urlObj.pathname === '/api/events/stream') {
      await security.load(req);
      registerSseClient(req, res);
      await security.publish(sseClients);
      return;
    }
    if (await security.handle(req, res, urlObj)) return;
    const contentAliases = { '/assets/types.json': 'types', '/assets/site-config.json': 'site-config' };
    if (Object.hasOwn(contentAliases, urlObj.pathname)) {
      if (!['GET', 'HEAD'].includes(req.method)) { send(res, 405, '', { Allow: 'GET, HEAD' }); return; }
      const name = contentAliases[urlObj.pathname], value = await storage.read(name);
      json(res, 200, name === 'types' ? publicTypes(value) : publicSiteConfig(value));
      return;
    }
    const handled = await router(req, res, urlObj);
    if (handled) {
      return;
    }

    if (req.method === 'POST' && urlObj.pathname === '/api/upload') {
      if (!(await ensureAuthorized(req, res, 'admin'))) {
        return;
      }
      let body;
      try {
        body = await collectBody(req);
      } catch (error) {
        const statusCode = error.message === 'Payload too large' ? 413 : 400;
        logger.warn('[upload] body rejected', { error: error.message });
        send(res, statusCode, JSON.stringify({ status: 'error', message: 'Fichier trop volumineux pour etre traite.' }), {
          'Content-Type': 'application/json'
        });
        return;
      }
      let payload;
      try {
        payload = JSON.parse(body || '{}');
      } catch (error) {
        send(res, 400, 'Invalid JSON');
        return;
      }
      try {
        const relativePath = await persistUploadedFile({
          type: payload?.type,
          filename: payload?.filename,
          data: payload?.data
        });
        send(res, 200, JSON.stringify({ status: 'ok', path: relativePath }), { 'Content-Type': 'application/json' });
      } catch (error) {
        logger.error('[upload] error', { error: error.message, type: payload?.type, filename: payload?.filename });
        send(res, 400, JSON.stringify({ status: 'error', message: error.message }), { 'Content-Type': 'application/json' });
      }
      return;
    }

    if (urlObj.pathname === '/api/admin/assets.zip') {
      if (!['GET', 'HEAD'].includes(req.method)) { send(res, 405, '', { Allow: 'GET, HEAD' }); return; }
      if (!(await ensureAuthorized(req, res, 'admin'))) return;
      const publicAccess = await security.load({ headers: {} });
      const archive = publicArchive(publishedMedia, relative => publicAccess.mediaAllowed(relative));
      send(res, 200, req.method === 'HEAD' ? null : archive.bytes, {
        'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="assets.zip"',
        'Content-Length': archive.bytes.length, 'Cache-Control': 'no-store',
        'X-Archive-Method': 'zip-store', 'X-Archive-Size': archive.bytes.length
      });
      return;
    }

    if (urlObj.pathname === '/api/changelog') {
      if (req.method !== 'GET') {
        send(res, 405, JSON.stringify({ status: 'error', message: 'Method Not Allowed' }), { 'Content-Type': 'application/json', 'Allow': 'GET' });
        return;
      }
      const limit = Math.max(1, Math.min(50, Number(urlObj.searchParams.get('limit')) || 6));
      const config = publicSiteConfig(await storage.read('site-config'));
      json(res, 200, { status: 'ok', source: 'config', entries: (config.changelog || []).slice(0, limit) });
      return;
    }

    if (urlObj.pathname === '/api/community/discord') {
      if (req.method !== 'GET') {
        send(res, 405, JSON.stringify({ status: 'error', message: 'Method Not Allowed' }), { 'Content-Type': 'application/json', 'Allow': 'GET' });
        return;
      }
      try {
        const config = await readSiteConfigFile();
        const proof = config?.community?.proof || {};
        const manualCount = Math.max(0, Number(proof.manualCount) || 0);
        const label = normalizeString(proof.label) || 'membres sur Discord';
        const note = normalizeString(proof.note) || 'Sessions, annonces et coordination des groupes JDR.';
        if (proof.mode === 'discord') {
          try {
            const inviteStats = await fetchDiscordInviteStats(config?.community?.discordUrl || '');
            if (inviteStats) {
              send(res, 200, JSON.stringify({
                status: 'ok',
                mode: 'discord',
                source: 'discord',
                count: Math.max(inviteStats.memberCount, inviteStats.presenceCount),
                label,
                note,
                guildId: inviteStats.guildId || normalizeString(proof.guildId) || null,
                inviteUrl: config?.community?.discordUrl || null,
                live: true,
                fallback: false,
                message: ''
              }), { 'Content-Type': 'application/json' });
              return;
            }
          } catch (error) {
            logger.warn('[community] discord invite unavailable', { error: error.message, url: config?.community?.discordUrl || null });
          }
          if (normalizeString(proof.guildId)) {
            try {
              const live = await fetchDiscordWidgetStats(proof.guildId);
              send(res, 200, JSON.stringify({
                status: 'ok',
                mode: 'discord',
                source: 'discord',
                count: Math.max(live.presenceCount, live.memberCount),
                label,
                note,
                guildId: live.guildId,
                inviteUrl: live.instantInvite || config?.community?.discordUrl || null,
                live: true,
                fallback: false,
                message: ''
              }), { 'Content-Type': 'application/json' });
              return;
            } catch (error) {
              logger.warn('[community] discord widget unavailable', { error: error.message, guildId: proof.guildId });
            }
          }
        }
        send(res, 200, JSON.stringify({
          status: 'ok',
          mode: proof.mode === 'discord' ? 'discord' : 'manual',
          source: 'manual',
          count: manualCount,
          label,
          note,
          guildId: normalizeString(proof.guildId) || null,
          inviteUrl: config?.community?.discordUrl || null,
          live: false,
          fallback: proof.mode === 'discord',
          message: proof.mode === 'discord'
            ? `Compteur live indisponible - estimation: ${manualCount.toLocaleString('fr-FR')} ${label}`
            : `${manualCount.toLocaleString('fr-FR')} ${label} (estimation)`
        }), { 'Content-Type': 'application/json' });
      } catch (error) {
        send(res, 500, JSON.stringify({ status: 'error', message: 'Discord community stats unavailable.' }), { 'Content-Type': 'application/json' });
      }
      return;
    }
    if (urlObj.pathname === '/api/planning/my-availability') {
      if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
        send(res, 405, JSON.stringify({ status: 'error', message: 'Method Not Allowed' }), { 'Content-Type': 'application/json', 'Allow': 'GET,POST,PATCH,PUT,DELETE' });
        return;
      }
      if (!(await ensureAuthorized(req, res, 'user'))) {
        return;
      }
      const currentUserId = normalizeString(req.auth?.user?.id);
      if (!currentUserId) {
        send(res, 403, JSON.stringify({ status: 'error', message: 'User profile unavailable.' }), { 'Content-Type': 'application/json' });
        return;
      }
      const users = await readUsersFile();
      const index = users.findIndex(entry => entry.id === currentUserId);
      const user = index === -1 ? null : users[index];
      if (!user) {
        send(res, 404, JSON.stringify({ status: 'error', message: 'User not found.' }), { 'Content-Type': 'application/json' });
        return;
      }
      if (req.method === 'GET') {
        const availability = sanitizePlanningAvailabilityList(user.planningAvailability);
        send(res, 200, JSON.stringify({ status: 'ok', availability }), { 'Content-Type': 'application/json' });
        return;
      }
      const body = await collectBody(req);
      let payload = {};
      try {
        payload = JSON.parse(body || '{}');
      } catch (error) {
        send(res, 400, 'Invalid JSON');
        return;
      }
      const current = sanitizePlanningAvailabilityList(user.planningAvailability);
      if (req.method === 'DELETE') {
        const id = sanitizePlanningId(payload?.id || urlObj.searchParams.get('id'));
        if (!id) {
          send(res, 400, JSON.stringify({ status: 'error', message: 'id is required.' }), { 'Content-Type': 'application/json' });
          return;
        }
        const next = current.filter(entry => entry.id !== id);
        user.planningAvailability = next;
        await storage.transaction(async () => {
          await writeUsersFile(users);
          await updateSessionsForUser(user.id, { planningAvailability: next });
        });
        send(res, 200, JSON.stringify({ status: 'ok', availability: next }), { 'Content-Type': 'application/json' });
        return;
      }
      const requestedId = sanitizePlanningId(payload?.id);
      const existing = requestedId ? current.find(entry => entry.id === requestedId) : null;
      const dates = existing || req.method !== 'POST'
        ? [payload?.date || existing?.date]
        : getPlanningPayloadDates(payload);
      const entries = dates.map(date => sanitizePlanningAvailabilityEntry({ ...payload, date }, { existing, touch: true }));
      if (!dates.length || entries.some(entry => !entry)) {
        send(res, 400, JSON.stringify({ status: 'error', message: 'Disponibilite invalide: date et heures sont requises.' }), { 'Content-Type': 'application/json' });
        return;
      }
      const next = existing
        ? current.map(item => (item.id === existing.id ? entries[0] : item))
        : [...current, ...entries];
      user.planningAvailability = sanitizePlanningAvailabilityList(next);
      await storage.transaction(async () => {
        await writeUsersFile(users);
        await updateSessionsForUser(user.id, { planningAvailability: user.planningAvailability });
      });
      send(res, existing ? 200 : 201, JSON.stringify({
        status: 'ok',
        entry: entries[0],
        entries,
        availability: user.planningAvailability
      }), { 'Content-Type': 'application/json' });
      return;
    }

    if (urlObj.pathname === '/api/profile') {
      if (!(await ensureAuthorized(req, res, 'user'))) {
        return;
      }
      const currentUser = req.auth?.user;
      if (!currentUser?.id) {
        send(res, 403, JSON.stringify({ status: 'error', message: 'User profile unavailable.' }), { 'Content-Type': 'application/json' });
        return;
      }
      if (req.method === 'GET') {
        const users = await readUsersFile();
        const index = users.findIndex(entry => entry.id === currentUser.id);
        const user = index === -1 ? null : users[index];
        if (!user) {
          send(res, 404, JSON.stringify({ status: 'error', message: 'User not found.' }), { 'Content-Type': 'application/json' });
          return;
        }
        const groups = await readGroupsFile();
        const allowed = new Set(groups.map(group => group?.id).filter(Boolean));
        const characters = sanitizeCharacterList(resolveUserCharacters(user), { assignIds: true, allowedGroups: allowed });
        const availability = sanitizeAvailabilityRecord(user.availability) || null;
        const profile = sanitizeProfileRecord(user.profile) || null;
        send(res, 200, JSON.stringify({
          status: 'ok',
          profile: {
            username: user.username || '',
            avatar: user.avatar || null,
            provider: user.provider || 'manual',
            discordId: user.provider === 'discord' ? user.discordId || null : null,
            groups: Array.isArray(user.groups) ? user.groups : [],
            characters,
            availability,
            account: {
              lastLoginAt: sanitizeIsoDateString(user?.lastLoginAt),
              lastSeenAt: sanitizeIsoDateString(user?.lastSeenAt)
            },
            profile,
            customization: profile
          }
        }), { 'Content-Type': 'application/json' });
        return;
      }
      if (req.method === 'PATCH' || req.method === 'PUT') {
        const body = await collectBody(req);
        let payload;
        try {
          payload = JSON.parse(body || '{}');
        } catch (error) {
          send(res, 400, 'Invalid JSON');
          return;
        }
        if (['role', 'groups', 'managedGroupIds', 'apiTokens', 'provider', 'discordId', 'ownerId', 'userId'].some(key => Object.hasOwn(payload || {}, key))) { json(res, 403, { status: 'error', message: 'Account permissions cannot be changed through a personal profile.' }); return; }
        const hasLegacyFields = payload && typeof payload === 'object' && (
          payload.name || payload.bio || payload.avatar || payload.groupId || payload.group
        );
        const updateCharacters = Boolean(
          Array.isArray(payload?.characters) || payload?.character || hasLegacyFields
        );
        const characterPayload = updateCharacters
          ? (Array.isArray(payload?.characters)
            ? payload.characters
            : (payload?.character ? payload.character : payload))
          : undefined;
        const updateAvailability = Object.prototype.hasOwnProperty.call(payload || {}, 'availability');
        const availabilityPayload = updateAvailability ? payload.availability : undefined;
        const updateProfile = Object.prototype.hasOwnProperty.call(payload || {}, 'profile');
        const profilePayload = updateProfile ? payload.profile : undefined;
        const result = await updateUserProfile(currentUser.id, {
          characterPayload,
          availabilityPayload,
          profilePayload,
          updateCharacters,
          updateAvailability,
          updateProfile
        });
        if (result.error) {
          send(res, 400, JSON.stringify({ status: 'error', message: result.error }), { 'Content-Type': 'application/json' });
          return;
        }
        if (!result.user) {
          send(res, 404, JSON.stringify({ status: 'error', message: 'User not found.' }), { 'Content-Type': 'application/json' });
          return;
        }
        const characters = Array.isArray(result.characters)
          ? result.characters
          : sanitizeCharacterList(resolveUserCharacters(result.user));
        const availability = result.availability ?? (sanitizeAvailabilityRecord(result.user.availability) || null);
        const profile = result.profile ?? (sanitizeProfileRecord(result.user.profile) || null);
        send(res, 200, JSON.stringify({
          status: 'ok',
          profile: {
            username: result.user.username || '',
            avatar: result.user.avatar || null,
            provider: result.user.provider || 'manual',
            discordId: result.user.provider === 'discord' ? result.user.discordId || null : null,
            groups: Array.isArray(result.user.groups) ? result.user.groups : [],
            characters,
            availability,
            account: {
              lastLoginAt: sanitizeIsoDateString(result.user?.lastLoginAt),
              lastSeenAt: sanitizeIsoDateString(result.user?.lastSeenAt)
            },
            profile,
            customization: profile
          }
        }), { 'Content-Type': 'application/json' });
        return;
      }
      send(res, 405, JSON.stringify({ status: 'error', message: 'Method Not Allowed' }), { 'Content-Type': 'application/json', 'Allow': 'GET,PATCH,PUT' });
      return;
    }

    if (urlObj.pathname === '/api/admin/home-config' || urlObj.pathname === '/api/admin/site-config') {
      if (!(await ensureAuthorized(req, res, 'admin'))) {
        return;
      }
      if (req.method === 'GET') {
        const config = await readSiteConfigFile();
        send(res, 200, JSON.stringify({ status: 'ok', config }), { 'Content-Type': 'application/json' });
        return;
      }
      if (req.method === 'PATCH' || req.method === 'PUT') {
        const body = await collectBody(req);
        let payload;
        try {
          payload = JSON.parse(body || '{}');
        } catch (error) {
          send(res, 400, 'Invalid JSON');
          return;
        }
        const nextConfig = sanitizeSiteConfig(payload?.config && typeof payload.config === 'object' ? payload.config : payload);
        await writeSiteConfigFile(nextConfig);
        send(res, 200, JSON.stringify({ status: 'ok', config: nextConfig }), { 'Content-Type': 'application/json' });
        return;
      }
      send(res, 405, JSON.stringify({ status: 'error', message: 'Method Not Allowed' }), { 'Content-Type': 'application/json', 'Allow': 'GET,PATCH,PUT' });
      return;
    }

    if (urlObj.pathname === '/api/admin/metrics') {
      if (req.method !== 'GET') {
        send(res, 405, JSON.stringify({ status: 'error', message: 'Method Not Allowed' }), { 'Content-Type': 'application/json', 'Allow': 'GET' });
        return;
      }
      if (!(await ensureAuthorized(req, res, 'admin'))) {
        return;
      }
      send(res, 200, JSON.stringify({
        status: 'ok',
        serverTime: new Date().toISOString(),
        uptimeMs: Date.now() - serverStartedAt,
        sse: {
          clients: sseClients.size,
          broadcastCount: sseMetrics.broadcastCount,
          lastEventAt: sseMetrics.lastEventAt,
          lastEventName: sseMetrics.lastEventName
        }
      }), { 'Content-Type': 'application/json' });
      return;
    }

    if (urlObj.pathname === '/api/admin/groups') {
      if (req.method === 'GET') {
        if (!(await ensureAuthorized(req, res, 'admin'))) {
          return;
        }
        const groups = await readGroupsFile();
        send(res, 200, JSON.stringify({
          status: 'ok',
          groups: groups.map(group => sanitizeGroupRecord(group))
        }), { 'Content-Type': 'application/json' });
        return;
      }

      if (req.method === 'POST') {
        if (!(await ensureAuthorized(req, res, 'admin'))) {
          return;
        }
        const body = await collectBody(req);
        let payload;
        try {
          payload = JSON.parse(body || '{}');
        } catch (error) {
          send(res, 400, 'Invalid JSON');
          return;
        }
        const name = normalizeString(payload?.name);
        if (!name) {
          send(res, 400, JSON.stringify({ status: 'error', message: 'name is required.' }), { 'Content-Type': 'application/json' });
          return;
        }
        const color = payload?.color || null;
        const group = await createGroup({
          name,
          color,
          x: payload?.x ?? undefined,
          y: payload?.y ?? undefined
        });
        send(res, 201, JSON.stringify({
          status: 'ok',
          group: sanitizeGroupRecord(group)
        }), { 'Content-Type': 'application/json' });
        return;
      }

      if (req.method === 'PATCH' || req.method === 'PUT') {
        if (!(await ensureAuthorized(req, res, 'admin'))) {
          return;
        }
        const body = await collectBody(req);
        let payload;
        try {
          payload = JSON.parse(body || '{}');
        } catch (error) {
          send(res, 400, 'Invalid JSON');
          return;
        }
        if (Array.isArray(payload?.groups)) {
          if (!payload.groups.length) {
            send(res, 400, JSON.stringify({ status: 'error', message: 'groups is required.' }), { 'Content-Type': 'application/json' });
            return;
          }
          const groups = await updateGroups(payload.groups);
          if (!groups) {
            send(res, 400, JSON.stringify({ status: 'error', message: 'Each group must reference an existing id and a name.' }), { 'Content-Type': 'application/json' });
            return;
          }
          send(res, 200, JSON.stringify({
            status: 'ok',
            groups: groups.map(group => sanitizeGroupRecord(group))
          }), { 'Content-Type': 'application/json' });
          return;
        }
        const id = normalizeString(payload?.id);
        if (!id) {
          send(res, 400, JSON.stringify({ status: 'error', message: 'id is required.' }), { 'Content-Type': 'application/json' });
          return;
        }
        const group = await updateGroup(id, {
          name: typeof payload?.name === 'string' ? payload.name : undefined,
          color: payload?.color,
          x: payload?.x ?? undefined,
          y: payload?.y ?? undefined
        });
        if (!group) {
          send(res, 404, JSON.stringify({ status: 'error', message: 'Group not found.' }), { 'Content-Type': 'application/json' });
          return;
        }
        send(res, 200, JSON.stringify({
          status: 'ok',
          group: sanitizeGroupRecord(group)
        }), { 'Content-Type': 'application/json' });
        return;
      }

      if (req.method === 'DELETE') {
        if (!(await ensureAuthorized(req, res, 'admin'))) {
          return;
        }
        const body = await collectBody(req);
        let payload;
        try {
          payload = JSON.parse(body || '{}');
        } catch (error) {
          send(res, 400, 'Invalid JSON');
          return;
        }
        const id = normalizeString(payload?.id);
        if (!id) {
          send(res, 400, JSON.stringify({ status: 'error', message: 'id is required.' }), { 'Content-Type': 'application/json' });
          return;
        }
        const removed = await deleteGroup(id);
        if (!removed) {
          send(res, 404, JSON.stringify({ status: 'error', message: 'Group not found.' }), { 'Content-Type': 'application/json' });
          return;
        }
        send(res, 200, JSON.stringify({
          status: 'ok',
          removed: sanitizeGroupRecord(removed)
        }), { 'Content-Type': 'application/json' });
        return;
      }

      send(res, 405, JSON.stringify({ status: 'error', message: 'Method Not Allowed' }), { 'Content-Type': 'application/json', 'Allow': 'GET,POST,PATCH,PUT,DELETE' });
      return;
    }

    if (urlObj.pathname === '/api/admin/users') {
      if (req.method === 'GET') {
        if (!(await ensureAuthorized(req, res, 'admin'))) {
          return;
        }
        const users = await readUsersFile();
        send(res, 200, JSON.stringify({
          status: 'ok',
          users: users.map(user => sanitizeUserRecord(user))
        }), { 'Content-Type': 'application/json' });
        return;
      }

      if (req.method === 'POST') {
        if (!(await ensureAuthorized(req, res, 'admin'))) {
          return;
        }
        const body = await collectBody(req);
        let payload;
        try {
          payload = JSON.parse(body || '{}');
        } catch (error) {
          send(res, 400, 'Invalid JSON');
          return;
        }
        const provider = normalizeString(payload?.provider) || 'manual';
        if (provider === 'discord') {
          const discordId = normalizeString(payload?.discordId);
          if (!discordId) {
            send(res, 400, JSON.stringify({ status: 'error', message: 'discordId is required.' }), { 'Content-Type': 'application/json' });
            return;
          }
          const existing = await findUserByDiscordId(discordId);
          if (existing) {
            send(res, 409, JSON.stringify({ status: 'error', message: 'Discord user already exists.' }), { 'Content-Type': 'application/json' });
            return;
          }
          const user = await upsertDiscordUser({
            discordId,
            username: normalizeString(payload?.username),
            roleHint: sanitizeRole(payload?.role || 'user')
          });
          send(res, 201, JSON.stringify({
            status: 'ok',
            user: sanitizeUserRecord(user)
          }), { 'Content-Type': 'application/json' });
          return;
        }

        const { user, token } = await createManualUser({
          username: normalizeString(payload?.username),
          role: sanitizeRole(payload?.role || 'user'),
          token: payload?.token
        });
        send(res, 201, JSON.stringify({
          status: 'ok',
          user: sanitizeUserRecord(user),
          token
        }), { 'Content-Type': 'application/json' });
        return;
      }

      if (req.method === 'PATCH' || req.method === 'PUT') {
        if (!(await ensureAuthorized(req, res, 'admin'))) {
          return;
        }
        const body = await collectBody(req);
        let payload;
        try {
          payload = JSON.parse(body || '{}');
        } catch (error) {
          send(res, 400, 'Invalid JSON');
          return;
        }
        const id = normalizeString(payload?.id);
        if (!id) {
          send(res, 400, JSON.stringify({ status: 'error', message: 'id is required.' }), { 'Content-Type': 'application/json' });
          return;
        }
        const updates = {};
        if (payload?.role) {
          updates.role = sanitizeRole(payload.role);
        }
        if (typeof payload?.username === 'string') {
          updates.username = payload.username;
        }
        if (Array.isArray(payload?.groups)) {
          const groups = await readGroupsFile();
          const allowed = new Set(groups.map(group => group?.id).filter(Boolean));
          if (payload.groups.some(entry => typeof entry !== 'string' || !allowed.has(entry))) { json(res, 400, { status: 'error', message: 'Unknown group membership.' }); return; }
          updates.groups = [...new Set(payload.groups)];
        }
        let generatedToken = null;
        if (payload?.generateToken) {
          generatedToken = crypto.randomBytes(24).toString('hex');
          updates.addToken = generatedToken;
        }
        if (payload?.removeToken) {
          updates.removeToken = payload.removeToken;
        }
        const user = await updateUser(id, updates);
        if (!user) {
          send(res, 404, JSON.stringify({ status: 'error', message: 'User not found.' }), { 'Content-Type': 'application/json' });
          return;
        }
        const response = {
          status: 'ok',
          user: sanitizeUserRecord(user)
        };
        if (generatedToken) {
          response.token = generatedToken;
        }
        send(res, 200, JSON.stringify(response), { 'Content-Type': 'application/json' });
        return;
      }

      if (req.method === 'DELETE') {
        if (!(await ensureAuthorized(req, res, 'admin'))) {
          return;
        }
        const body = await collectBody(req);
        let payload;
        try {
          payload = JSON.parse(body || '{}');
        } catch (error) {
          send(res, 400, 'Invalid JSON');
          return;
        }
        const id = normalizeString(payload?.id);
        if (!id) {
          send(res, 400, JSON.stringify({ status: 'error', message: 'id is required.' }), { 'Content-Type': 'application/json' });
          return;
        }
        const removed = await deleteUser(id);
        if (!removed) {
          send(res, 404, JSON.stringify({ status: 'error', message: 'User not found.' }), { 'Content-Type': 'application/json' });
          return;
        }
        send(res, 200, JSON.stringify({
          status: 'ok',
          removed: sanitizeUserRecord(removed)
        }), { 'Content-Type': 'application/json' });
        return;
      }

      send(res, 405, JSON.stringify({ status: 'error', message: 'Method Not Allowed' }), { 'Content-Type': 'application/json', 'Allow': 'GET,POST,PATCH,PUT,DELETE' });
      return;
    }

    if (req.method === 'OPTIONS') {
      send(res, 204, null, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      send(res, 405, 'Method Not Allowed', {'Allow': 'GET,HEAD,POST,OPTIONS'});
      return;
    }

    if (canonical.startsWith('/assets/') && !require('./server/publication/staticFiles').includes(canonical.slice(1))) {
      const access = await security.load(req);
      if (!access.mediaAllowed(canonical.slice(1))) { send(res, 404, 'Not Found'); return; }
    }
    await serveStatic(req, res);
  } catch (error) {
    if (error.status && !res.headersSent) { json(res, error.status, { status: 'error', message: error.message }); return; }
    logger.error('Unhandled server error', { error: error.message });
    if (!res.headersSent) {
      send(res, 500, 'Internal Server Error');
    } else {
      res.destroy();
    }
  }
};

// Serialize complete read/modify/write request sequences, not just the final write.
const server = http.createServer((req, res) => {
  storage.run(async () => {
    await handleRequest(req, res);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) await security.publish(sseClients);
  }).catch(error => {
    logger.error('Storage unavailable', { code: error.code || 'E_STORAGE_IO' });
    if (!res.headersSent) send(res, 503, 'Storage unavailable');
    else res.destroy();
  });
});
server.requestTimeout = 30_000;
server.headersTimeout = 30_000;
const permissionRefresh = setInterval(() => { if (sseClients.size) storage.run(() => security.publish(sseClients)).catch(() => { sseClients.forEach(client => client.res.destroy()); }); }, 30_000);
permissionRefresh.unref();
let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  clearInterval(permissionRefresh);
  sseClients.forEach(client => client.res?.end());
  await new Promise(resolve => server.close(resolve));
  await storage.close();
};
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => shutdown().catch(() => { process.exitCode = 1; }));
if (process.env.CARTE_TEST_ROOT) process.on('message', message => {
  if (message?.type === 'carte-test-stop' && message.token === process.env.CARTE_TEST_TOKEN) shutdown().then(() => { process.exitCode = 0; process.disconnect?.(); }).catch(() => { process.exitCode = 1; process.disconnect?.(); });
});
(async () => {
  plainPath(ROOT);
  if (!(await fs.promises.stat(ROOT)).isDirectory()) throw new Error('Public directory is missing');
  await privatePath(storagePaths.logs, true);
  await privatePath(storagePaths.media, true);
  serveStatic = createPublicHandler({ publicRoot: ROOT, media: publishedMedia, securityHeaders: SECURITY_HEADERS });
  publishedMedia.index();
  await storage.open();
  server.listen(PORT, HOST, () => logger.info('Application listening'));
})().catch(error => {
  logger.error('Startup refused', { code: error.code || 'E_CONFIGURATION' });
  storage.close().catch(() => {}).finally(() => { process.exitCode = 1; process.disconnect?.(); });
});
