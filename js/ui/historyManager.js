import { getString } from '../i18n.js';

export class HistoryManager {
    constructor({ container, listElement, backButton, maxVisibleItems = 4 }) {
        this.container = container;
        this.listElement = listElement;
        this.backButton = backButton;
        this.stack = [];
        this.maxVisibleItems = Number.isInteger(maxVisibleItems) && maxVisibleItems > 0
            ? maxVisibleItems
            : 4;
        this.onSelect = () => {};
    }

    initialize({ onSelect }) {
        this.onSelect = typeof onSelect === 'function' ? onSelect : () => {};
        if (this.backButton) {
            this.backButton.addEventListener('click', () => this.goBack());
        }
        this.render();
    }

    push(entry) {
        if (!entry) {
            return;
        }
        if (this.stack.length && this.stack[this.stack.length - 1].locationName === entry.locationName) {
            this.stack[this.stack.length - 1] = entry;
        } else {
            this.stack.push(entry);
        }
        this.render();
    }

    goBack() {
        if (this.stack.length <= 1) {
            return;
        }
        this.stack.pop();
        const previous = this.stack[this.stack.length - 1];
        if (previous) {
            this.onSelect(previous);
        }
        this.render();
    }

    render() {
        if (this.listElement) {
            this.listElement.innerHTML = '';
            const total = this.stack.length;
            const startIndex = Math.max(0, total - this.maxVisibleItems);
            const hiddenCount = startIndex;

            if (hiddenCount > 0) {
                const indicator = document.createElement('div');
                indicator.className = 'history-overflow';
                indicator.textContent = '+' + hiddenCount;
                indicator.dataset.count = String(hiddenCount);
                const title = hiddenCount === 1
                    ? getString('history.overflowSingle', { count: hiddenCount })
                    : getString('history.overflowPlural', { count: hiddenCount });
                indicator.title = title;
                indicator.setAttribute('aria-label', title);
                this.listElement.appendChild(indicator);
            }

            this.stack.slice(startIndex).forEach((item, index) => {
                const absoluteIndex = startIndex + index;
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'history-item';
                button.textContent = item.locationName;
                button.disabled = absoluteIndex === total - 1;
                button.addEventListener('click', () => this.onSelect(item));
                this.listElement.appendChild(button);
            });
        }
        if (this.container) {
            this.container.hidden = this.stack.length === 0;
        }
        if (this.backButton) {
            this.backButton.disabled = this.stack.length <= 1;
        }
    }
}