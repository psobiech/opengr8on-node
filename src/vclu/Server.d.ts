import { VirtualSystem } from './VirtualSystem.js';
import { ProjectRegistry } from './ProjectRegistry.js';
export interface ServerOptions {
    rootDirectory: string;
    localAddress: string;
    port?: number;
    serialNumber: number;
    macAddress: string;
    projectKey: Buffer;
    projectIV: Buffer;
    deviceIV?: Buffer;
    pin?: Buffer;
    privateKey?: Buffer;
    /** Path to MAIN.LUA. If provided, Lua execution is enabled via wasmoon. */
    mainLuaPath?: string;
    /** Override CLU name in VirtualSystem. */
    cluName?: string;
    httpListenerPort?: number;
    /** Path to project.omp or system.xml for ProjectRegistry. */
    projectOmpPath?: string;
}
export declare class Server {
    private readonly _opts;
    private readonly _vs;
    private _projectCipherKey;
    private _temporaryIV;
    private _unicastKeys;
    private _broadcastKeys;
    private _broadcastSocket;
    private _commandSocket;
    private _responseSocket;
    private _tftpServer;
    private _registry;
    private _luaThread;
    private _closed;
    constructor(opts: ServerOptions);
    get virtualSystem(): VirtualSystem;
    start(): Promise<void>;
    get registry(): ProjectRegistry;
    private _startClu;
    private _bindSockets;
    private _handleIncoming;
    private _dispatch;
    private _onDiscover;
    private _generateTemporaryKey;
    private _onSetIp;
    private _onSetKey;
    private _onReset;
    private _onLuaScript;
    private _luaCall;
    private _validateCheckAlive;
    private _sendLuaResponse;
    private _sendEncrypted;
    private _persistKeys;
    /** Load persisted keys from disk (optional, call before start()). */
    static loadKeys(keysPath: string): Partial<Pick<ServerOptions, 'projectKey' | 'projectIV'>>;
    private _startTftp;
    private _stopTftp;
    close(): void;
}
//# sourceMappingURL=Server.d.ts.map