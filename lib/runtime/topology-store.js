export class TopologyStore {
    current = null;
    set(value) {
        this.current = value;
    }
    get() {
        return this.current;
    }
}
