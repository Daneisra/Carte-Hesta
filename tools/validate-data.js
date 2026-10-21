#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const assetsDir = path.join(ROOT, 'assets');

function readJson(relativePath) {
    const filePath = path.join(ROOT, relativePath);
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resolveAsset(relativePath) {
    return path.resolve(ROOT, relativePath);
}

function existsAsset(relativePath) {
    if (!relativePath) {
        return true;
    }
    return fs.existsSync(resolveAsset(relativePath));
}

const types = readJson('assets/types.json');
const locations = readJson('assets/locations.json');

const issues = [];
const seenNames = new Set();

Object.entries(locations).forEach(([continent, places]) => {
    if (!Array.isArray(places)) {
        issues.push({ level: 'error', message: `${continent} : la liste des lieux n'est pas un tableau.` });
        return;
    }

    places.forEach((place, index) => {
        const label = place && place.name ? `${continent} → ${place.name}` : `${continent} → index ${index}`;

        if (!place || typeof place !== 'object') {
            issues.push({ level: 'error', message: `${label} : entrée invalide.` });
            return;
        }

        if (!place.name || !place.name.trim()) {
            issues.push({ level: 'error', message: `${label} : nom manquant.` });
        } else if (seenNames.has(place.name.trim())) {
            issues.push({ level: 'warning', message: `${label} : nom en doublon.` });
        }
        seenNames.add((place.name || '').trim());

        if (!Number.isFinite(Number(place.x)) || !Number.isFinite(Number(place.y))) {
            issues.push({ level: 'error', message: `${label} : coordonnées invalides.` });
        }

        if (place.type && !types[place.type]) {
            issues.push({ level: 'warning', message: `${label} : type inconnu "${place.type}".` });
        }

        if (place.lore && !Array.isArray(place.lore)) {
            issues.push({ level: 'warning', message: `${label} : le champ "lore" devrait être un tableau.` });
        }

        if (place.history && !Array.isArray(place.history) && typeof place.history !== 'string') {
            issues.push({ level: 'warning', message: `${label} : le champ "history" devrait être une chaîne ou un tableau.` });
        }

        if (place.quests && !Array.isArray(place.quests)) {
            issues.push({ level: 'warning', message: `${label} : le champ "quests" devrait être un tableau.` });
        }

        if (place.pnjs && !Array.isArray(place.pnjs)) {
            issues.push({ level: 'warning', message: `${label} : le champ "pnjs" devrait être un tableau.` });
        }

        if (typeof place.audio === 'string' && place.audio.trim()) {
            const audioPath = place.audio.trim();
            if (!existsAsset(audioPath)) {
                issues.push({ level: 'warning', message: `${label} : fichier audio introuvable (${audioPath}).` });
            }
        }

        if (Array.isArray(place.images)) {
            place.images.forEach(imagePath => {
                if (typeof imagePath !== 'string' || !imagePath.trim()) {
                    issues.push({ level: 'warning', message: `${label} : entrée d'image invalide.` });
                    return;
                }
                if (!existsAsset(imagePath.trim())) {
                    issues.push({ level: 'warning', message: `${label} : image introuvable (${imagePath}).` });
                }
            });
        }
    });
});

if (issues.length === 0) {
    console.log('Validation des données : OK');
    process.exit(0);
}

const summary = issues.reduce((acc, issue) => {
    acc[issue.level] = (acc[issue.level] || 0) + 1;
    return acc;
}, {});

console.error(`Validation des données : ${issues.length} problème(s) détecté(s).`);
issues.forEach(issue => {
    const prefix = issue.level === 'error' ? '[ERREUR]' : '[AVERTISSEMENT]';
    console.error(`${prefix} ${issue.message}`);
});

if (summary.error) {
    process.exit(1);
} else {
    process.exit(0);
}
