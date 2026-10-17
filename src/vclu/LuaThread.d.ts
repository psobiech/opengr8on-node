import type { VirtualSystemOptions } from './VirtualSystem.js';
import type { LuaLike } from './types.js';
export declare class LuaThread {
    private _worker;
    private readonly _sab;
    private readonly _i32;
    private readonly _u8;
    private _startedResolve;
    private _startedReject;
    private _onClientReport;
    private _emergency;
    private _callQueue;
    constructor();
    get isEmergency(): boolean;
    start(scriptPath: string, emergency: boolean, vsOptions: VirtualSystemOptions, aDriveDirectory: string): Promise<void>;
    onClientReport(fn: (addr: string, port: number, response: string) => void): void;
    awaitStarted(timeoutMs?: number): Promise<void>;
    /** Execute a Lua expression and return its result. Thread-safe via internal queue. */
    luaCall(script: string): Promise<LuaLike>;
    private _doLuaCall;
    close(): void;
}
//# sourceMappingURL=LuaThread.d.ts.map