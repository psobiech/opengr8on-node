import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { VirtualObject } from './VirtualObject.js';
export const STORAGE_FEATURES = {
    STORAGE_UTILIZATION: 1,
};
export const STORAGE_METHODS = {
    ERASE_ALL: 3,
    STORE: 4,
};
export class Storage extends VirtualObject {
    static INDEX = 44;
    static FEATURES = STORAGE_FEATURES;
    static METHODS = STORAGE_METHODS;
    _storagePath;
    _variables = new Map();
    _syncTimer = null;
    constructor(virtualSystem, name, storageRootPath) {
        super(virtualSystem, name);
        mkdirSync(storageRootPath, { recursive: true });
        this._storagePath = `${storageRootPath}/storage.json`;
        this.setValue(STORAGE_FEATURES.STORAGE_UTILIZATION, 0);
        this.registerMethod(STORAGE_METHODS.STORE, () => {
            this._persist();
            return null;
        });
        this.registerMethod(STORAGE_METHODS.ERASE_ALL, () => {
            this._variables.clear();
            try {
                writeFileSync(this._storagePath, '{}', 'utf8');
            }
            catch (e) {
                console.error(`[${this.name}] erase storage error:`, e);
            }
            this.setValue(STORAGE_FEATURES.STORAGE_UTILIZATION, 0);
            return null;
        });
    }
    setup() {
        this._restore();
        this._syncTimer = setInterval(() => this._sync(), 1000);
    }
    /** Get a stored variable by name. */
    getVar(varName) {
        return this._variables.get(varName) ?? null;
    }
    /** Set a stored variable by name (does not auto-persist; call store() or wait for sync). */
    setVar(varName, value) {
        this._variables.set(varName, value);
    }
    /** All stored variable names. */
    getVarNames() {
        return [...this._variables.keys()];
    }
    _restore() {
        if (!existsSync(this._storagePath))
            return;
        try {
            const raw = readFileSync(this._storagePath, 'utf8').trim();
            if (!raw)
                return;
            const parsed = JSON.parse(raw);
            for (const [k, v] of Object.entries(parsed)) {
                this._variables.set(k, v);
            }
        }
        catch (e) {
            console.error(`[${this.name}] restore error:`, e);
        }
    }
    _sync() {
        // Pull current values from Lua globals if a luaCall function is available
        if (this.virtualSystem != null) {
            let changed = false;
            for (const [varName] of this._variables) {
                try {
                    const current = this.virtualSystem.luaCall(`getVar("${varName}")`);
                    if (current !== this._variables.get(varName)) {
                        this._variables.set(varName, current);
                        changed = true;
                    }
                }
                catch {
                    // luaCall not available or variable doesn't exist — skip
                }
            }
            if (changed)
                this._persist();
        }
    }
    _persist() {
        try {
            const dir = dirname(this._storagePath);
            mkdirSync(dir, { recursive: true });
            const obj = {};
            for (const [k, v] of this._variables)
                obj[k] = v;
            writeFileSync(this._storagePath, JSON.stringify(obj, null, 2), 'utf8');
            this.setValue(STORAGE_FEATURES.STORAGE_UTILIZATION, this._variables.size);
        }
        catch (e) {
            console.error(`[${this.name}] persist error:`, e);
        }
    }
    close() {
        if (this._syncTimer != null) {
            clearInterval(this._syncTimer);
            this._syncTimer = null;
        }
        this._persist();
    }
}
