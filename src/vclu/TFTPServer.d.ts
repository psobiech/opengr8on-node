export declare const TFTP_DEFAULT_PORT = 69;
export type TFTPServerMode = 'GET_ONLY' | 'PUT_ONLY' | 'GET_AND_PUT' | 'GET_AND_REPLACE';
export declare class TFTPServer {
    private readonly _rootDirectory;
    private readonly _mode;
    private _socket;
    private _port;
    constructor(rootDirectory: string, port?: number, mode?: TFTPServerMode);
    get port(): number;
    start(): Promise<void>;
    stop(): void;
    close(): void;
    private _onRequest;
    /** Resolve a TFTP path within server root. Returns null if outside root. */
    private _resolvePath;
    private _errorTo;
    /** RRQ: send file to client via ephemeral socket */
    private _sendFile;
    /** WRQ: receive file from client via ephemeral socket */
    private _receiveFile;
}
//# sourceMappingURL=TFTPServer.d.ts.map