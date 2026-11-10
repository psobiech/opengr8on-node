import { serializeCommand, asString } from './serialize.js';

const REQUEST_CMD = 'req_refresh_modules';
const RESPONSE_CMD = 'resp_refresh_modules';

/**
 * OM "Clear CLU" (commands/clu/w.java): bare `req_refresh_modules` under the project key; the CLU
 * re-runs TFBUS module discovery and answers `resp_refresh_modules…` (OM waits up to 30 s and
 * only checks that prefix), then OM downloads a:\CONFIG.JSON / a:\config.txt.
 */
export const RefreshModulesCommand = {
  request(): { toBuffer(): Buffer } {
    return { toBuffer: () => serializeCommand(REQUEST_CMD) };
  },

  requestMatches(buf: Buffer): boolean {
    return buf.length >= REQUEST_CMD.length && asString(buf, 0, REQUEST_CMD.length) === REQUEST_CMD;
  },

  responseMatches(buf: Buffer): boolean {
    return buf.length >= RESPONSE_CMD.length && asString(buf, 0, RESPONSE_CMD.length) === RESPONSE_CMD;
  },
};
