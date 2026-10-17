import type { ModuleTranscript } from './ModuleTranscript.js';
export interface TranscribeOptions {
    /** Translation language code. Default: `'pl'`. Falls back to `'en'` if key missing. */
    lang?: string;
}
export interface TranscribeResult {
    output: ModuleTranscript;
    errors: string[];
}
export declare function loadProperties(filePath: string): Map<string, string>;
/**
 * Reads all `module_*.xml` files from `dir`, parses them, resolves translations,
 * and returns a nested lookup keyed by `[hwType][fwType][fwApiVer]`.
 */
export declare function transcribeModules(dir: string, options?: TranscribeOptions): TranscribeResult;
//# sourceMappingURL=transcribeModules.d.ts.map