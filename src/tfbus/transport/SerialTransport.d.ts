export interface TFBusTransport {
    enqueue(buf: Buffer): void;
    dequeue(): Promise<Buffer | null>;
    open(): Promise<void>;
    close(): Promise<void>;
}
export interface SerialTransportOptions {
    baudRate?: number;
    /** RX frame timeout in ms before dequeue() returns null. Default 200. */
    rxTimeoutMs?: number;
}
export declare class SerialTransport implements TFBusTransport {
    #private;
    constructor(path: string, { baudRate, rxTimeoutMs }?: SerialTransportOptions);
    open(): Promise<void>;
    close(): Promise<void>;
    enqueue(buf: Buffer): void;
    dequeue(): Promise<Buffer | null>;
}
//# sourceMappingURL=SerialTransport.d.ts.map