// Small administrative surface; no permission decision is made by this UI.
const node = (tag, text, attributes = {}) => Object.assign(document.createElement(tag), { textContent: text, ...attributes });
const option = (value, label = value) => node('option', label, { value });
const selected = select => [...select.selectedOptions].map(item => item.value);
function field(form, label, input) { const wrapper = node('label', label); wrapper.append(input); form.append(wrapper); return input; }
async function api(url, method = 'GET', body) {
    const response = await fetch(url, { method, credentials: 'include', cache: 'no-store', ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`);
    return result;
}
export async function initializePermissionsPanel() {
    let session;
    try { session = await api('/auth/session'); } catch { return; }
    if (session.role !== 'admin') return;
    const trigger = node('button', 'Publication et permissions', { type: 'button', className: 'secondary-button', id: 'permissions-open' });
    const dialog = node('dialog', '', { id: 'permissions-dialog', className: 'permissions-dialog' });
    dialog.style.cssText = 'width:min(58rem,92vw);max-height:85vh;overflow:auto;padding:1.5rem';
    dialog.setAttribute('aria-label', 'Publication et permissions');
    dialog.append(node('h2', 'Publication et permissions'));
    dialog.append(node('p', 'Toute qualification est explicite. Une catégorie non qualifiée reste administrative. Un média partagé exige l’accès à tous ses parents.'));
    const close = node('button', 'Fermer', { type: 'button', className: 'secondary-button' }); close.onclick = () => dialog.close(); dialog.append(close);
    const status = node('p', '', { id: 'permissions-status' }); status.setAttribute('role', 'status'); dialog.append(status);
    const content = node('div', ''); dialog.append(content);
    const actions = document.querySelector('#admin-section-actions .admin-actions');
    if (!actions) return;
    actions.append(trigger); document.body.append(dialog);
    let state;
    const save = async action => {
        if (!window.confirm('Confirmer cette modification des accès ? Une publication PUBLIC peut divulguer le contenu sélectionné. Les médias partagés peuvent rester bloqués par un autre parent privé.')) return;
        try {
            status.textContent = 'Enregistrement…';
            await api('/api/admin/permissions', 'PATCH', { revision: state.permissions.revision, confirm: true, ...action });
            await reload(); status.textContent = 'Permissions enregistrées.';
        } catch (error) { status.textContent = error.message; }
    };
    const makeSelect = (items, multiple = false) => { const input = node('select', '', { multiple }); for (const [value, label] of items) input.append(option(value, label)); return input; };
    const ids = values => values.map(value => [value.id, value.name || value.username || value.title || value.id]);
    function render() {
        content.replaceChildren();
        const assignment = node('form', ''); assignment.append(node('h3', 'Groupes administrables par un MJ'));
        const user = field(assignment, 'Compte MJ', makeSelect(ids(state.catalog.users))); user.id = 'permissions-mj-user';
        const managed = field(assignment, 'Groupes attribués (sélection multiple)', makeSelect(ids(state.catalog.groups), true)); managed.id = 'permissions-mj-groups';
        const syncAssignment = () => { for (const item of managed.options) item.selected = (state.permissions.managedGroups[user.value] || []).includes(item.value); };
        user.onchange = syncAssignment; syncAssignment();
        assignment.append(node('button', 'Enregistrer les groupes MJ', { type: 'submit', className: 'secondary-button' }));
        assignment.onsubmit = event => { event.preventDefault(); save({ assignment: { userId: user.value, groupIds: selected(managed) } }); }; content.append(assignment);
        const form = node('form', ''); form.append(node('h3', 'Qualification et publication des contenus'));
        const kind = field(form, 'Ressource', makeSelect([['locations', 'Lieux'], ['groups', 'Groupes'], ['planning', 'Sessions'], ['annotations', 'Annotations historiques'], ['timeline', 'Chronologie']])); kind.id = 'permissions-kind';
        const resource = field(form, 'Contenu', makeSelect([])); resource.id = 'permissions-resource';
        const scope = field(form, 'Visibilité du contenu', makeSelect(['ADMIN', 'PUBLIC', 'PLAYERS', 'GROUP', 'GM', 'PRIVATE'].map(value => [value, value]))); scope.id = 'permissions-scope';
        const group = field(form, 'Groupe déterminé pour GROUP / GM', makeSelect(ids(state.catalog.groups))); group.id = 'permissions-group';
        const players = field(form, 'Comptes autorisés pour PLAYERS (sélection multiple)', makeSelect(ids(state.catalog.users), true)); players.id = 'permissions-players';
        const owner = field(form, 'Propriétaire vérifié de l’annotation', makeSelect([['', 'Non établi — accès administratif uniquement'], ...ids(state.catalog.users)])); owner.id = 'permissions-owner';
        const withdrawn = field(form, 'Retirer de l’affichage sans supprimer l’annotation', node('input', '', { type: 'checkbox' })); withdrawn.id = 'permissions-withdrawn';
        const categoryBox = node('fieldset', ''); categoryBox.append(node('legend', 'Catégories du lieu — accès au lieu parent également requis'));
        const categorySelects = new Map();
        for (const category of state.categories) {
            const select = field(categoryBox, category, makeSelect(['ADMIN', 'PUBLIC', 'PLAYERS', 'GROUP', 'GM'].map(value => [value, value])));
            select.dataset.category = category;
            const categoryGroup = field(categoryBox, category + ' ? groupe GROUP / GM', makeSelect(ids(state.catalog.groups)));
            categoryGroup.dataset.categoryGroup = category;
            const categoryPlayers = field(categoryBox, category + ' ? comptes PLAYERS', makeSelect(ids(state.catalog.users), true));
            categoryPlayers.dataset.categoryPlayers = category;
            const sync = () => { categoryGroup.parentElement.hidden = !['GROUP', 'GM'].includes(select.value); categoryPlayers.parentElement.hidden = select.value !== 'PLAYERS'; };
            select.onchange = sync;
            categorySelects.set(category, { scope: select, group: categoryGroup, players: categoryPlayers, sync });
        }
        form.append(categoryBox);
        const visibilityFields = () => {
            const annotation = kind.value === 'annotations';
            owner.parentElement.hidden = !annotation; withdrawn.parentElement.hidden = !annotation;
            categoryBox.hidden = kind.value !== 'locations';
            for (const item of scope.options) item.disabled = (['groups', 'planning'].includes(kind.value) && !['ADMIN', 'PUBLIC'].includes(item.value)) || (item.value === 'PRIVATE' && !annotation) || (annotation && item.value === 'PLAYERS');
        };
        const syncResource = () => {
            const policy = state.permissions.resources[kind.value]?.[resource.value];
            scope.value = policy?.rule.scope || 'ADMIN'; group.value = policy?.rule.groupId || policy?.groupId || state.catalog.groups[0]?.id || '';
            owner.value = policy?.ownerId || ''; withdrawn.checked = policy?.withdrawn === true;
            for (const item of players.options) item.selected = policy?.rule.userIds?.includes(item.value) || false;
            for (const [category, input] of categorySelects) {
                const rule = policy?.categories?.[category];
                input.scope.value = rule?.scope || 'ADMIN'; input.group.value = rule?.groupId || state.catalog.groups[0]?.id || '';
                for (const item of input.players.options) item.selected = rule?.userIds?.includes(item.value) || false;
                input.sync();
            }
            visibilityFields();
        };
        const syncKind = () => {
            resource.replaceChildren(...state.catalog[kind.value].map(value => option(value.key || value.id, value.name || value.title || value.label || value.id)));
            syncResource();
        };
        resource.onchange = syncResource; kind.onchange = syncKind; syncKind();
        form.append(node('button', 'Enregistrer la qualification', { type: 'submit', className: 'secondary-button' }));
        form.onsubmit = event => {
            event.preventDefault();
            const rule = value => ({ scope: value, ...(['GROUP', 'GM'].includes(value) ? { groupId: group.value } : {}), ...(value === 'PLAYERS' ? { userIds: selected(players) } : {}), ...(value === 'PRIVATE' ? { ownerId: owner.value } : {}) });
            const reviewed = state.catalog[kind.value].find(value => (value.key || value.id) === resource.value);
            const qualification = { kind: kind.value, key: resource.value, fingerprint: reviewed?.fingerprint, rule: rule(scope.value) };
            if (kind.value === 'locations') qualification.categories = Object.fromEntries([...categorySelects].map(([category, input]) => [category, { scope: input.scope.value, ...(['GROUP', 'GM'].includes(input.scope.value) ? { groupId: input.group.value } : {}), ...(input.scope.value === 'PLAYERS' ? { userIds: selected(input.players) } : {}) }]));
            if (kind.value === 'annotations') { qualification.ownerId = owner.value; qualification.withdrawn = withdrawn.checked; }
            save({ qualification });
        }; content.append(form);
    }
    async function reload() { state = await api('/api/admin/permissions'); render(); }
    trigger.onclick = async () => { dialog.showModal(); try { status.textContent = 'Chargement…'; await reload(); status.textContent = ''; } catch (error) { status.textContent = error.message; } };
    window.addEventListener('carte:permissions-updated', async () => {
        let stillAdmin = false;
        try { stillAdmin = (await api('/auth/session')).role === 'admin'; } catch { /* failure revokes the private catalog */ }
        if (!stillAdmin) { content.replaceChildren(); state = null; dialog.close(); trigger.hidden = true; }
    });
}
