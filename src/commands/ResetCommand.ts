import { serializeCommand, asString, splitExact } from './serialize.js';
import { MIN_IP_CHARACTERS } from '../constants.js';

const REQUEST_CMD = 'req_reset';
const RESPONSE_CMD = 'resp_reset';

export const ResetCommand = {
  request(localAddress: string): { toBuffer(): Buffer } {
    return {
      toBuffer() {
        return serializeCommand(REQUEST_CMD, ':', localAddress);
      },
    };
  },

  requestMatches(buf: Buffer): boolean {
    if (buf.length < REQUEST_CMD.length + 1 + MIN_IP_CHARACTERS) return false;
    if (buf[REQUEST_CMD.length] !== 0x3A) return false;
    return asString(buf, 0, REQUEST_CMD.length) === REQUEST_CMD;
  },

  requestFromBuffer(buf: Buffer): { ipAddress: string } | null {
    if (!ResetCommand.requestMatches(buf)) return null;
    const parts = splitExact(asString(buf), ':', 2);
    if (!parts) return null;
    return { ipAddress: parts[1] };
  },

  response(ipAddress: string): { toBuffer(): Buffer } {
    return {
      toBuffer() {
        return serializeCommand(RESPONSE_CMD, ':', ipAddress);
      },
    };
  },

  responseMatches(buf: Buffer): boolean {
    if (buf.length < RESPONSE_CMD.length + 1 + MIN_IP_CHARACTERS) return false;
    if (buf[RESPONSE_CMD.length] !== 0x3A) return false;
    return asString(buf, 0, RESPONSE_CMD.length) === RESPONSE_CMD;
  },

  responseFromBuffer(buf: Buffer): { ipAddress: string } | null {
    if (!ResetCommand.responseMatches(buf)) return null;
    const parts = splitExact(asString(buf), ':', 2);
    if (!parts) return null;
    return { ipAddress: parts[1] };
  },
};
