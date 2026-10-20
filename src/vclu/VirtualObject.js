import { EventEmitter } from 'node:events';
export class VirtualObject extends EventEmitter {
    _name;
    virtualSystem;
    _featureValues = new Map();
    _featureFns = new Map();
    _methods = new Map();
    _eventHandlers = new Map();
    _pendingEvents = new Map();
    constructor(virtualSystem, name) {
        super({ captureRejections: true });
        this.virtualSystem = virtualSystem;
        this._name = name;
    }
    get name() {
        return this._name;
    }
    set name(v) {
        this._name = v;
    }
    /**
     * Register a bidirectional feature.
     * fn(undefined) → getter: return current/computed value.
     * fn(value) → setter: return the value to store.
     */
    registerFeature(index, fn) {
        this._featureFns.set(index, fn);
        const initial = fn(undefined);
        if (initial !== undefined)
            this._featureValues.set(index, initial);
    }
    get(index) {
        const fn = this._featureFns.get(index);
        if (fn !== undefined) {
            const val = fn(undefined);
            if (val !== undefined)
                this._featureValues.set(index, val);
            return this._featureValues.get(index) ?? null;
        }
        return this._featureValues.get(index) ?? null;
    }
    set(index, value) {
        const fn = this._featureFns.get(index);
        if (fn !== undefined) {
            const result = fn(value);
            this._featureValues.set(index, result !== undefined ? result : value);
        }
        else {
            this._featureValues.set(index, value);
        }
    }
    getValue(index) {
        return this._featureValues.get(index) ?? null;
    }
    setValue(index, value) {
        this._featureValues.set(index, value);
    }
    clearValue(index) {
        this._featureValues.delete(index);
    }
    registerMethod(index, fn) {
        this._methods.set(index, fn);
    }
    execute(index, ...args) {
        const fn = this._methods.get(index);
        if (fn === undefined)
            return null;
        try {
            return fn(...args);
        }
        catch (e) {
            console.error(`[${this._name}] execute(${index}) error:`, e);
            return null;
        }
    }
    addEventHandler(address, fn) {
        const existing = this._eventHandlers.get(address);
        if (existing !== undefined) {
            existing.push(fn);
        }
        else {
            this._eventHandlers.set(address, [fn]);
        }
    }
    isEventRegistered(address) {
        const handlers = this._eventHandlers.get(address);
        return handlers !== undefined && handlers.length > 0;
    }
    async awaitEventTrigger(address) {
        const p = this._pendingEvents.get(address);
        if (p !== undefined)
            await p;
    }
    /** Run event handlers for address, serialising against any previous trigger. Returns Promise that resolves when all handlers complete. */
    runEvent(address) {
        const handlers = [...(this._eventHandlers.get(address) ?? [])];
        if (handlers.length === 0)
            return Promise.resolve();
        const prev = this._pendingEvents.get(address) ?? Promise.resolve();
        const p = prev
            .then(async () => {
            for (const h of handlers) {
                try {
                    await h();
                }
                catch (e) {
                    console.error(`[${this._name}] event address=${address} handler error:`, e);
                }
            }
        })
            .finally(() => {
            if (this._pendingEvents.get(address) === p) {
                this._pendingEvents.delete(address);
            }
        });
        this._pendingEvents.set(address, p);
        return p;
    }
    /** Fire event handlers asynchronously. Returns true if any handlers are registered. */
    triggerEvent(address, onCompleted) {
        if (!this.isEventRegistered(address)) {
            onCompleted?.();
            return false;
        }
        void this.runEvent(address).finally(() => onCompleted?.());
        return true;
    }
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    setup() { }
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    loop() { }
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    close() { }
}
