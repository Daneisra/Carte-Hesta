import { HomeAdminPanel } from './ui/homeAdminPanel.js';

const fetchSession = async () => {
    try {
        const response = await fetch('/auth/session', { credentials: 'include' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
    } catch (_error) {
        return { authenticated: false, role: 'guest' };
    }
};

document.addEventListener('DOMContentLoaded', async () => {
    const panel = new HomeAdminPanel({
        onSave: () => window.location.reload()
    });

    panel.bindTriggers([
        document.getElementById('home-admin-entry'),
        document.getElementById('home-admin-link')
    ]);

    const session = await fetchSession();
    panel.setSession(session);
});
