import { VirtualObject } from './VirtualObject.js';
import type { IVirtualSystem, LuaLike } from './types.js';
export declare const STORAGE_FEATURES: {
    readonly STORAGE_UTILIZATION: 1;
};
export declare const STORAGE_METHODS: {
    readonly ERASE_ALL: 3;
    readonly STORE: 4;
};
export declare class Storage extends VirtualObject {
    static readonly INDEX = 44;
    static readonly FEATURES: {
        readonly STORAGE_UTILIZATION: 1;
    };
    static readonly METHODS: {
        readonly ERASE_ALL: 3;
        readonly STORE: 4;
    };
    private readonly _storagePath;
    private _variables;
    private _syncTimer;
    constructor(virtualSystem: IVirtualSystem | null, name: string, storageRootPath: string);
    setup(): void;
    /** Get a stored variable by name. */
    getVar(varName: string): LuaLike;
    /** Set a stored variable by name (does not auto-persist; call store() or wait for sync). */
    setVar(varName: string, value: LuaLike): void;
    /** All stored variable names. */
    getVarNames(): string[];
    private _restore;
    private _sync;
    private _persist;
    close(): void;
}
//# sourceMappingURL=Storage.d.ts.map