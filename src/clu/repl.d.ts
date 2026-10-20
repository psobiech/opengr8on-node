export interface CluReplOptions {
    ompFile: string;
    localAddress: string;
    cluPort?: number;
    /** Path to device-interfaces directory. Default: 'docs/device-interfaces' */
    interfacesDir?: string;
}
export declare function runCluRepl(options: CluReplOptions): Promise<void>;
//# sourceMappingURL=repl.d.ts.map