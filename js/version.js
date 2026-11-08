import { APP_VERSION } from './shared/appVersion.mjs';

// Valeur générée depuis package.json au build, disponible même sans API/config.
document.querySelectorAll('[data-app-version]').forEach(node => { node.textContent = APP_VERSION; });
document.querySelectorAll('meta[name="application-version"]').forEach(node => { node.content = APP_VERSION; });
