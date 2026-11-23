import { toHexString, hexToNumber } from '../util/hex.js';
import { serializeCommand, asString } from './serialize.js';
import { CRLF, MIN_IP_CHARACTERS, MIN_SESSION_CHARACTERS, MAX_SESSION_CHARACTERS } from '../constants.js';

const REQUEST_CMD = 'req';
const RESPONSE_CMD = 'resp';

export const LuaScriptCommand = {
  CHECK_ALIVE: 'checkAlive()',
  GET_VAR: 'getVar',
  SET_VAR: 'setVar',

  request(localAddress: string, sessionId: number, script: string): { toBuffer(): Buffer } {
    return {
      toBuffer() {
        return serializeCommand(
          REQUEST_CMD, ':',
          localAddress, ':',
          toHexString(sessionId, MAX_SESSION_CHARACTERS), ':',
          script,
          CRLF,
        );
      },
    };
  },

  requestFromBuffer(buffer: Buffer): { ipAddress: string; sessionId: number; script: string } | null {
    if (!LuaScriptCommand.requestMatches(buffer)) return null;
    const parts = splitHeader(asString(buffer));
    if (parts.length < 4) return null;
    return { ipAddress: parts[1], sessionId: hexToNumber(parts[2]), script: parts[3] };
  },

  requestMatches(buffer: Buffer): boolean {
    const minLength = REQUEST_CMD.length + 1 + MIN_IP_CHARACTERS + 1 + MIN_SESSION_CHARACTERS + 1 + 1;
    if (buffer.length < minLength) return false;
    if (buffer[REQUEST_CMD.length] !== 0x3A) return false;
    return asString(buffer, 0, REQUEST_CMD.length) === REQUEST_CMD;
  },

  response(ipAddress: string, sessionId: number, returnValue: string): { toBuffer(): Buffer } {
    return {
      toBuffer() {
        return serializeCommand(
          RESPONSE_CMD, ':',
          ipAddress, ':',
          toHexString(sessionId, MAX_SESSION_CHARACTERS), ':',
          returnValue,
        );
      },
    };
  },

  parse(sessionId: number, decryptedBuf: Buffer): string | null {
    const response = LuaScriptCommand.responseFromBuffer(decryptedBuf);
    if (!response) return null;
    if (response.sessionId !== sessionId) return null;
    return response.returnValue;
  },

  responseFromBuffer(buffer: Buffer): { ipAddress: string; sessionId: number; returnValue: string } | null {
    if (!LuaScriptCommand.responseMatches(buffer)) return null;
    const parts = splitHeader(asString(buffer));
    if (parts.length < 4) return null;
    return { ipAddress: parts[1], sessionId: hexToNumber(parts[2]), returnValue: parts[3] };
  },

  responseMatches(buffer: Buffer): boolean {
    const minLength = RESPONSE_CMD.length + 1 + MIN_IP_CHARACTERS + 1 + MIN_SESSION_CHARACTERS + 1 + 1;
    if (buffer.length < minLength) return false;
    if (buffer[RESPONSE_CMD.length] !== 0x3A) return false;
    return asString(buffer, 0, RESPONSE_CMD.length) === RESPONSE_CMD;
  },
};

/**
 * `cmd:ip:session:payload` → 4 parts; the payload keeps its own colons (times "22:44:51", URLs, a
 * script with `CLU->OBJ`...). JavaScript's split(':', 4) would drop everything after the 4th part.
 */
function splitHeader(text: string): string[] {
  const parts: string[] = [];
  let from = 0;
  for (let k = 0; k < 3; k++) {
    const separatorIdx = text.indexOf(':', from);
    if (separatorIdx < 0) return parts;
    parts.push(text.slice(from, separatorIdx));
    from = separatorIdx + 1;
  }
  parts.push(text.slice(from));
  return parts;
}
