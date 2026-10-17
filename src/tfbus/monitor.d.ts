import type { TFBusTransport } from './transport/SerialTransport.js';
export interface MonitorOptions {
    /** Device-interfaces directory for registry. */
    dir?: string;
    /** Translation language. Default 'pl'. */
    lang?: string;
    /** RS485 address range to scan. Default [1, 30]. Active mode only. */
    scanRange?: [number, number];
    /** Send RESET broadcast before seek. Active mode only. */
    reset?: boolean;
    /** Send SEEK broadcast before scanning. Active mode only. */
    seek?: boolean;
    /** Minimum ms between full poll cycles. Default 500. Active mode only. */
    pollIntervalMs?: number;
    /** Called for each log line instead of writing to stdout. */
    logger?: (line: string) => void;
    /**
     * Listen-only: decode CLU bus traffic without sending any frames. Default: true.
     */
    passive?: boolean;
    /**
     * Our RS485 address for active mode response filtering (exact match).
     * Unset (default): accept all frames. Set to 0x00 when acting as CLU master.
     */
    myAddr?: number;
    /** Path to an .omp project file. Pre-populates module names and RS485 addresses. */
    ompPath?: string;
    /** CLU serial (decimal string) to use when multiple CLUs exist in the OMP file. */
    cluSerial?: string;
}
export declare function runMonitor(transport: TFBusTransport, options?: MonitorOptions): Promise<void>;
//# sourceMappingURL=monitor.d.ts.map