import { VirtualObject } from './VirtualObject.js';
import { ProjectRegistry } from './ProjectRegistry.js';
import { InterfaceRegistry } from '../parsers/interfaces/InterfaceRegistry.js';
import type { IVirtualSystem, IVirtualCLU, Subscription, LuaLike } from './types.js';
export interface VirtualSystemOptions {
    rootDirectory: string;
    localAddress?: string;
    port?: number;
    /** Override CLU name. Defaults to "VIRTUAL_CLU". */
    cluName?: string;
    /** Override HTTP listener port. Defaults to 80. */
    httpListenerPort?: number;
    /** Returns CipherKey instance for a given remote address. Used by RemoteCLU. */
    cipherKeyProvider?: (address: string) => unknown;
    /** Path to device-interfaces directory or .zip — loaded by loadRegistries(). */
    interfaceRegistryPath?: string;
    /** Path to project.omp or system.xml — loaded by loadRegistries(). */
    projectOmpPath?: string;
}
export declare class VirtualSystem implements IVirtualSystem {
    private readonly _objectsByName;
    private readonly _virtualClu;
    private readonly _options;
    private _luaCallFn;
    private _loopTimer;
    private _clientReportFns;
    private _lastClientReportMs;
    private _interfaceRegistry;
    private _projectRegistry;
    constructor(options: VirtualSystemOptions);
    /** Load InterfaceRegistry and ProjectRegistry from the paths in options. Call once before setup(). */
    loadRegistries(): Promise<void>;
    getInterfaceRegistry(): InterfaceRegistry;
    getProjectRegistry(): ProjectRegistry;
    get localAddress(): string | undefined;
    getCipherKeyFor(address: string): unknown;
    getObject(name: string): VirtualObject | null;
    getVirtualClu(): IVirtualCLU;
    setLuaCallFn(fn: (script: string) => LuaLike): void;
    luaCall(script: string): LuaLike;
    newObject(index: number, name: string, ipAddress: string | null): void;
    newGate(index: number, name: string): void;
    setup(): void;
    loop(): void;
    /** Start the periodic loop. Call once after setup(). */
    startLoop(): void;
    stopLoop(): void;
    fetchValues(subscriptions: Subscription[]): string;
    clientRegister(remoteAddr: string, addr: string, port: number, sessionId: number, subs: Subscription[]): string;
    private _sendClientReportImpl;
    private _sendClientReport;
    setSendClientReportFn(fn: (addr: string, port: number, sessionId: number, response: string) => void): void;
    clientDestroy(addr: string, port: number, sessionId: number): number;
    close(): void;
}
//# sourceMappingURL=VirtualSystem.d.ts.map