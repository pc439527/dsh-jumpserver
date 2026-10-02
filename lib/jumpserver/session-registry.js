import { SessionState } from './state-machine.js';
export class SessionRegistry {
    options;
    bundles = new Map();
    detachGraceMs;
    constructor(options) {
        this.options = options;
        this.detachGraceMs = options.detachGraceMs ?? 5 * 60 * 1000;
    }
    get(sessionId) {
        return this.bundles.get(sessionId);
    }
    has(sessionId) {
        return this.bundles.has(sessionId);
    }
    getOrCreate(sessionId) {
        if (sessionId.length === 0)
            throw new Error('JUMPSERVER_SESSION_REQUIRED: empty conversation session id');
        let bundle = this.bundles.get(sessionId);
        if (bundle === undefined) {
            bundle = this.options.create(sessionId);
            this.bundles.set(sessionId, bundle);
        }
        bundle.lastUsedAt = (this.options.now ?? Date.now).call(undefined);
        return bundle;
    }
    snapshot() {
        return this.bundles;
    }
    get size() {
        return this.bundles.size;
    }
    applyScrollback(rows) {
        for (const bundle of this.bundles.values()) {
            bundle.observer.setScrollbackRows(rows);
        }
    }
    tickIdle() {
        const now = (this.options.now ?? Date.now).call(undefined);
        for (const [sessionId, bundle] of [...this.bundles]) {
            bundle.manager.tickIdle();
            const state = bundle.manager.status().state;
            const unusedFor = now - bundle.lastUsedAt;
            if (state === SessionState.DISCONNECTED && unusedFor >= this.detachGraceMs) {
                this.bundles.delete(sessionId);
                bundle.manager.dispose();
                this.options.onDetach?.(sessionId);
            }
        }
    }
    dispose() {
        for (const [sessionId, bundle] of [...this.bundles]) {
            this.bundles.delete(sessionId);
            bundle.manager.dispose();
            this.options.onDetach?.(sessionId);
        }
    }
}
