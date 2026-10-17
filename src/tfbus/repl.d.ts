import type { TFBusTransport } from './transport/SerialTransport.js';
export interface ReplOptions {
    dir?: string;
    lang?: string;
    ompPath?: string;
    cluSerial?: string;
    /** Timeout ms when waiting for module response. Default 300. */
    rxTimeoutMs?: number;
    /** Our RS485 sender address. Not used for response filtering (modules always respond to 0x00). Default 0xFE. */
    myAddr?: number;
    /** Bus baud rate — used only for utilization calculations. Default 115200. */
    baud?: number;
}
export declare function runRepl(transport: TFBusTransport, options?: ReplOptions): Promise<void>;
//# sourceMappingURL=repl.d.ts.map