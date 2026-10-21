import { createElement, clearElement } from './dom.js';

const ROLE_LABELS = {
    admin: 'Administrateur',
    user: 'Utilisateur'
};

export class UserAdminPanel {
    constructor({
        container,
        mode = 'users',
        onClose = null,
        fetchUsers = null,
        onAddUser = null,
        onUpdateUser = null,
        onDeleteUser = null,
        onAddGroup = null,
        onUpdateGroup = null,
        onUpdateGroups = null,
        onDeleteGroup = null,
        onPlaceGroup = null,
        onClearGroup = null
    } = {}) {
        this.container = container;
        this.mode = mode;
        this.onClose = onClose;
        this.fetchUsers = fetchUsers;
        this.onAddUser = onAddUser;
        this.onUpdateUser = onUpdateUser;
        this.onDeleteUser = onDeleteUser;
        this.onAddGroup = onAddGroup;
        this.onUpdateGroup = onUpdateGroup;
        this.onUpdateGroups = onUpdateGroups;
        this.onDeleteGroup = onDeleteGroup;
        this.onPlaceGroup = onPlaceGroup;
        this.onClearGroup = onClearGroup;

        this.tableBody = null;
        this.addForm = null;
        this.closeButton = null;
        this.emptyState = null;
        this.groupList = null;
        this.groupEmpty = null;
        this.groupForm = null;
        this.updateAllGroupsButton = null;
        this.groups = [];
        this.latestData = { users: [], groups: [] };

        if (this.container) {
            this.buildUI();
        }
    }

    setMode(mode = 'users') {
        if (mode !== 'users' && mode !== 'groups') {
            return;
        }
        if (this.mode === mode) {
            return;
        }
        this.mode = mode;
        this.buildUI();
        this.refresh(this.latestData);
    }

    isUsersMode() {
        return this.mode === 'users';
    }

    isGroupsMode() {
        return this.mode === 'groups';
    }

    buildUI() {
        clearElement(this.container);
        this.container.classList.add('user-admin-panel');

        const header = createElement('div', { className: 'user-admin-header' });
        const titleText = this.isGroupsMode()
            ? 'Administration des groupes JDR'
            : 'Administration des utilisateurs';
        const title = createElement('h3', { text: titleText, attributes: { id: 'user-admin-title' } });
        header.appendChild(title);
        this.closeButton = createElement('button', {
            className: 'secondary-button',
            text: 'Fermer',
            attributes: { type: 'button' }
        });
        this.closeButton.addEventListener('click', () => this.onClose?.());
        header.appendChild(this.closeButton);
        this.container.appendChild(header);

        const info = createElement('p', {
            className: 'user-admin-info',
            text: this.isGroupsMode()
                ? 'Gerez les groupes JDR (couleur, placement sur la carte, attribution).'
                : 'Gerez les comptes admin/utilisateur utilises par la carte (roles, tokens API, connexion Discord).'
        });
        this.container.appendChild(info);

        if (this.isUsersMode()) {
            const table = createElement('table', { className: 'user-admin-table' });
            const thead = createElement('thead');
            const headerRow = createElement('tr');
            ['Nom', 'Provider', 'Role', 'Groupes', 'Tokens API', 'Actions'].forEach(label => {
                headerRow.appendChild(createElement('th', { text: label }));
            });
            thead.appendChild(headerRow);
            table.appendChild(thead);
            this.tableBody = createElement('tbody');
            table.appendChild(this.tableBody);
            this.container.appendChild(table);

            this.emptyState = createElement('p', { className: 'user-admin-empty', text: 'Aucun utilisateur enregistre.' });
            this.emptyState.hidden = true;
            this.container.appendChild(this.emptyState);
        } else {
            this.tableBody = null;
            this.emptyState = null;
        }

        if (this.isGroupsMode()) {
            const groupSection = createElement('div', { className: 'user-admin-group-section' });
            const groupHeading = createElement('div', { className: 'user-admin-group-heading' });
            groupHeading.appendChild(createElement('h4', { text: 'Groupes JDR' }));
            this.updateAllGroupsButton = createElement('button', {
                className: 'secondary-button',
                text: 'Mettre a jour tous les groupes',
                attributes: { type: 'button' }
            });
            this.updateAllGroupsButton.addEventListener('click', () => {
                const groups = this.collectGroupDrafts();
                if (groups) {
                    this.onUpdateGroups?.(groups);
                }
            });
            groupHeading.appendChild(this.updateAllGroupsButton);
            groupSection.appendChild(groupHeading);
            this.groupList = createElement('div', { className: 'user-admin-group-list' });
            groupSection.appendChild(this.groupList);
            this.groupEmpty = createElement('p', { className: 'user-admin-empty', text: 'Aucun groupe enregistre.' });
            this.groupEmpty.hidden = true;
            groupSection.appendChild(this.groupEmpty);

            this.groupForm = createElement('form', {
                className: 'user-admin-group-form',
                attributes: { autocomplete: 'off' }
            });

            const groupNameId = 'user-admin-group-name';
            const groupColorId = 'user-admin-group-color';

            const groupNameField = createElement('div', { className: 'user-admin-field' });
            groupNameField.appendChild(createElement('label', {
                text: 'Nom du groupe',
                attributes: { for: groupNameId }
            }));
            const groupNameInput = createElement('input', {
                attributes: {
                    type: 'text',
                    id: groupNameId,
                    name: 'name',
                    placeholder: 'Nom du groupe'
                }
            });
            groupNameField.appendChild(groupNameInput);
            this.groupForm.appendChild(groupNameField);

            const groupColorField = createElement('div', { className: 'user-admin-field' });
            groupColorField.appendChild(createElement('label', {
                text: 'Couleur',
                attributes: { for: groupColorId }
            }));
            const groupColorInput = createElement('input', {
                attributes: {
                    type: 'text',
                    id: groupColorId,
                    name: 'color',
                    placeholder: '#2563eb'
                }
            });
            groupColorField.appendChild(groupColorInput);
            this.groupForm.appendChild(groupColorField);

            this.groupForm.appendChild(createElement('button', {
                className: 'primary-button',
                attributes: { type: 'submit' },
                text: 'Creer'
            }));
            this.groupForm.appendChild(createElement('p', {
                className: 'user-admin-add-hint',
                text: 'Un identifiant est derive du nom.'
            }));
            this.groupForm.addEventListener('submit', event => {
                event.preventDefault();
                const formData = new FormData(this.groupForm);
                const name = (formData.get('name') || '').toString().trim();
                const color = (formData.get('color') || '').toString().trim();
                if (!name) {
                    groupNameInput.focus();
                    return;
                }
                this.onAddGroup?.({ name, color });
            });

            groupSection.appendChild(this.groupForm);
            this.container.appendChild(groupSection);
        } else {
            this.groupList = null;
            this.groupEmpty = null;
            this.groupForm = null;
            this.updateAllGroupsButton = null;
        }

        if (this.isUsersMode()) {
            const addSection = createElement('div', { className: 'user-admin-add' });
            addSection.appendChild(createElement('h4', { text: 'Ajouter un utilisateur (manuel)' }));
            const usernameFieldId = 'user-admin-add-username';
            const roleFieldId = 'user-admin-add-role';

            this.addForm = createElement('form', {
                className: 'user-admin-add-form',
                attributes: { autocomplete: 'off' }
            });

            const usernameGroup = createElement('div', { className: 'user-admin-field' });
            usernameGroup.appendChild(createElement('label', {
                text: 'Nom affiche',
                attributes: { for: usernameFieldId }
            }));
            const usernameInput = createElement('input', {
                attributes: {
                    type: 'text',
                    id: usernameFieldId,
                    name: 'username',
                    placeholder: 'Nom affiche',
                    autocomplete: 'username'
                }
            });
            usernameGroup.appendChild(usernameInput);
            this.addForm.appendChild(usernameGroup);

            const roleGroup = createElement('div', { className: 'user-admin-field' });
            roleGroup.appendChild(createElement('label', {
                text: 'Role',
                attributes: { for: roleFieldId }
            }));
            const roleSelect = createElement('select', {
                attributes: { id: roleFieldId, name: 'role', autocomplete: 'off' }
            });
            ['admin', 'user'].forEach(role => {
                roleSelect.appendChild(createElement('option', { text: ROLE_LABELS[role], attributes: { value: role } }));
            });
            roleGroup.appendChild(roleSelect);
            this.addForm.appendChild(roleGroup);

            this.addForm.appendChild(createElement('button', {
                className: 'primary-button',
                attributes: { type: 'submit' },
                text: 'Creer'
            }));
            this.addForm.appendChild(createElement('p', {
                className: 'user-admin-add-hint',
                text: 'Un token API sera genere automatiquement.'
            }));
            this.addForm.addEventListener('submit', event => {
                event.preventDefault();
                const formData = new FormData(this.addForm);
                const payload = {
                    username: (formData.get('username') || '').trim(),
                    role: formData.get('role') || 'user'
                };
                this.onAddUser?.(payload);
            });
            addSection.appendChild(this.addForm);
            this.container.appendChild(addSection);
        } else {
            this.addForm = null;
        }
    }

    async refresh(data = []) {
        const users = Array.isArray(data) ? data : (Array.isArray(data?.users) ? data.users : []);
        this.groups = Array.isArray(data?.groups) ? data.groups : this.groups;
        this.latestData = { users, groups: this.groups };
        if (this.tableBody) {
            clearElement(this.tableBody);
            if (this.emptyState) {
                this.emptyState.hidden = users.length > 0;
            }
            users.forEach(user => {
                const row = this.createRow(user);
                this.tableBody.appendChild(row);
            });
        }
        if (this.groupList) {
            this.renderGroupList();
        }
    }

    createRow(user) {
        const row = createElement('tr');
        row.appendChild(createElement('td', { text: user.username || '(sans nom)' }));
        row.appendChild(createElement('td', { text: user.provider || 'manual' }));
        row.appendChild(createElement('td', { text: ROLE_LABELS[user.role] || user.role }));
        row.appendChild(this.createGroupCell(user));

        const tokenCell = createElement('td');
        if (Array.isArray(user.apiTokens) && user.apiTokens.length) {
            const list = createElement('ul', { className: 'token-list' });
            user.apiTokens.forEach(token => {
                const item = createElement('li', { text: token });
                const removeBtn = createElement('button', {
                    className: 'token-remove',
                    text: 'X',
                    attributes: { type: 'button' }
                });
                removeBtn.addEventListener('click', () => this.onRemoveToken(user, token));
                item.appendChild(removeBtn);
                list.appendChild(item);
            });
            tokenCell.appendChild(list);
        } else {
            tokenCell.appendChild(createElement('span', { className: 'token-empty', text: '--' }));
        }
        row.appendChild(tokenCell);

        const actions = createElement('td', { className: 'user-admin-actions' });
        const promoteBtn = createElement('button', {
            className: 'secondary-button',
            text: user.role === 'admin' ? 'Passer en utilisateur' : 'Promouvoir admin',
            attributes: { type: 'button' }
        });
        promoteBtn.addEventListener('click', () => this.onPromote(user));
        actions.appendChild(promoteBtn);

        if (user.provider !== 'discord') {
            const tokenBtn = createElement('button', {
                className: 'secondary-button',
                text: 'Nouveau token',
                attributes: { type: 'button' }
            });
            tokenBtn.addEventListener('click', () => this.onGenerateToken(user));
            actions.appendChild(tokenBtn);
        }

        const deleteBtn = createElement('button', {
            className: 'danger-button',
            text: 'Supprimer',
            attributes: { type: 'button' }
        });
        deleteBtn.addEventListener('click', () => this.onDeleteUser?.(user));
        actions.appendChild(deleteBtn);

        row.appendChild(actions);
        return row;
    }

    createGroupCell(user) {
        const cell = createElement('td', { className: 'user-admin-groups-cell' });
        const groups = Array.isArray(this.groups) ? this.groups : [];
        if (!groups.length) {
            cell.appendChild(createElement('span', { className: 'token-empty', text: 'Aucun groupe' }));
            return cell;
        }
        const selected = new Set(Array.isArray(user.groups) ? user.groups : []);
        const list = createElement('div', { className: 'user-admin-group-picker' });
        groups.forEach(group => {
            const option = createElement('label', { className: 'user-admin-group-option' });
            const checkbox = createElement('input', {
                attributes: {
                    type: 'checkbox',
                    value: group.id
                }
            });
            checkbox.checked = selected.has(group.id);
            const label = createElement('span', { text: group.name || group.id });
            if (group.color) {
                label.style.borderColor = group.color;
                label.style.color = group.color;
            }
            option.appendChild(checkbox);
            option.appendChild(label);
            list.appendChild(option);
        });
        const applyButton = createElement('button', {
            className: 'secondary-button user-admin-group-apply',
            text: 'Appliquer',
            attributes: { type: 'button' }
        });
        applyButton.addEventListener('click', () => {
            const checked = Array.from(list.querySelectorAll('input[type="checkbox"]:checked'))
                .map(input => input.value);
            this.onUpdateUser?.({ id: user.id, groups: checked });
        });
        cell.appendChild(list);
        cell.appendChild(applyButton);
        return cell;
    }

    renderGroupList() {
        if (!this.groupList) {
            return;
        }
        clearElement(this.groupList);
        const groups = Array.isArray(this.groups) ? this.groups : [];
        if (this.groupEmpty) {
            this.groupEmpty.hidden = groups.length > 0;
        }
        if (this.updateAllGroupsButton) {
            this.updateAllGroupsButton.disabled = groups.length === 0;
        }
        groups.forEach(group => {
            const row = createElement('div', { className: 'user-admin-group-row' });
            row.dataset.groupId = group.id;

            const nameWrap = createElement('div', { className: 'user-admin-group-name' });
            const nameInput = createElement('input', {
                className: 'user-admin-group-name-input',
                attributes: {
                    type: 'text',
                    value: group.name || group.id
                }
            });
            const idHint = createElement('span', { className: 'user-admin-group-id', text: group.id });
            nameWrap.appendChild(nameInput);
            nameWrap.appendChild(idHint);
            row.appendChild(nameWrap);

            const colorInput = createElement('input', {
                className: 'user-admin-group-color',
                attributes: {
                    type: 'text',
                    value: group.color || '',
                    placeholder: '#2563eb'
                }
            });
            row.appendChild(colorInput);

            const position = createElement('div', { className: 'user-admin-group-position' });
            const hasCoords = Number.isFinite(group.x) && Number.isFinite(group.y);
            position.textContent = hasCoords
                ? `Position: ${Math.round(group.x)}, ${Math.round(group.y)}`
                : 'Position: non placee';
            row.appendChild(position);

            const actions = createElement('div', { className: 'user-admin-group-actions' });
            const updateBtn = createElement('button', {
                className: 'secondary-button',
                text: 'Mettre a jour',
                attributes: { type: 'button' }
            });
            updateBtn.addEventListener('click', () => {
                const name = nameInput.value.trim();
                const color = colorInput.value.trim();
                if (!name) {
                    nameInput.focus();
                    return;
                }
                this.onUpdateGroup?.({ id: group.id, name, color });
            });
            actions.appendChild(updateBtn);

            const placeBtn = createElement('button', {
                className: 'secondary-button',
                text: hasCoords ? 'Deplacer' : 'Placer',
                attributes: { type: 'button' }
            });
            placeBtn.addEventListener('click', () => this.onPlaceGroup?.(group));
            actions.appendChild(placeBtn);

            if (hasCoords) {
                const clearBtn = createElement('button', {
                    className: 'secondary-button',
                    text: 'Retirer',
                    attributes: { type: 'button' }
                });
                clearBtn.addEventListener('click', () => this.onClearGroup?.(group));
                actions.appendChild(clearBtn);
            }

            const deleteBtn = createElement('button', {
                className: 'danger-button',
                text: 'Supprimer',
                attributes: { type: 'button' }
            });
            deleteBtn.addEventListener('click', () => this.onDeleteGroup?.(group));
            actions.appendChild(deleteBtn);

            row.appendChild(actions);
            this.groupList.appendChild(row);
        });
    }

    collectGroupDrafts() {
        const rows = Array.from(this.groupList?.querySelectorAll('.user-admin-group-row') || []);
        if (!rows.length) {
            return null;
        }
        const groups = [];
        for (const row of rows) {
            const nameInput = row.querySelector('.user-admin-group-name-input');
            const colorInput = row.querySelector('.user-admin-group-color');
            const id = (row.dataset.groupId || '').trim();
            const name = (nameInput?.value || '').trim();
            if (!id || !name) {
                nameInput?.focus();
                return null;
            }
            groups.push({
                id,
                name,
                color: (colorInput?.value || '').trim()
            });
        }
        return groups;
    }

    onPromote(user) {
        const newRole = user.role === 'admin' ? 'user' : 'admin';
        this.onUpdateUser?.({ id: user.id, role: newRole });
    }

    onGenerateToken(user) {
        this.onUpdateUser?.({ id: user.id, generateToken: true });
    }

    onRemoveToken(user, token) {
        this.onUpdateUser?.({ id: user.id, removeToken: token });
    }

    resetAddForm() {
        this.addForm?.reset?.();
    }

    resetGroupForm() {
        this.groupForm?.reset?.();
    }
}
