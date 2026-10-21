export class AriaAnnouncer {
    constructor({ politeNode = null, assertiveNode = null } = {}) {
        this.politeNode = politeNode;
        this.assertiveNode = assertiveNode;
    }

    polite(message) {
        this.announce(message, this.politeNode);
    }

    assertive(message) {
        this.announce(message, this.assertiveNode);
    }

    announce(message, node) {
        if (!node || typeof message !== 'string' || !message.trim()) {
            return;
        }

        const text = message.trim();
        node.textContent = '';
        requestAnimationFrame(() => {
            node.textContent = text;
        });
    }
}
