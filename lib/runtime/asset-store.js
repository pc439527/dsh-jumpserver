export class AssetStore {
    current = null;
    set(value) {
        this.current = value;
    }
    get() {
        return this.current;
    }
    clear() {
        this.current = null;
    }
}
