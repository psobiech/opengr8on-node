import { VirtualObject } from './VirtualObject.js';
import type { IVirtualSystem, LuaLike } from './types.js';
export declare const REMOTE_CLU_METHODS: {
    readonly EXECUTE: 0;
};
/**
 * Proxy for a remote CLU. Forwards get/set/execute calls as LuaScript commands
 * over UDP to the remote CLU at the configured address.
 *
 * Created when Lua calls OBJECT:new(1, ipAddress, name).
 */
export declare class RemoteCLU extends VirtualObject {
    static readonly INDEX = 1;
    static readonly METHODS: {
        readonly EXECUTE: 0;
    };
    private readonly _remoteAddress;
    private _client;
    constructor(virtualSystem: IVirtualSystem | null, name: string, remoteAddress: string);
    private _getClient;
    remoteExecute(script: string): Promise<string | null>;
    remoteSet(objectName: string, featureIndex: number, value: LuaLike): void;
    remoteGet(objectName: string, featureIndex: number): Promise<LuaLike>;
    remoteMethod(objectName: string, methodIndex: number, ...args: LuaLike[]): void;
    /** Proxy set: forwards to remote object with same name as this RemoteCLU. */
    set(index: number, value: LuaLike): void;
    /** Proxy execute: forwards method call to remote object. */
    execute(index: number, ...args: LuaLike[]): LuaLike;
    close(): void;
}
//# sourceMappingURL=RemoteCLU.d.ts.map