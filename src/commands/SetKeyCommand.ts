import { serializeCommand, asString } from './serialize.js';
import { RANDOM_ENCRYPTED_BYTES, IV_BYTES, KEY_BYTES, CRLF } from '../constants.js';

const REQUEST_CMD = 'req_set_key';
const RESPONSE_CMD = 'resp:OK';

export const SetKeyCommand = {
  request(encrypted: Buffer, key: Buffer, iv: Buffer): { toBuffer(): Buffer } {
    return {
      toBuffer() {
        return serializeCommand(encrypted, ':', iv, ':', REQUEST_CMD, ':', key);
      },
    };
  },

  requestMatches(buf: Buffer): boolean {
    const expectedLen = RANDOM_ENCRYPTED_BYTES + 1 + IV_BYTES + 1 + REQUEST_CMD.length + 1 + KEY_BYTES;
    if (buf.length !== expectedLen && buf.length !== expectedLen + CRLF.length) return false;
    if (buf[RANDOM_ENCRYPTED_BYTES] !== 0x3A) return false;
    if (buf[RANDOM_ENCRYPTED_BYTES + 1 + IV_BYTES] !== 0x3A) return false;
    if (buf[RANDOM_ENCRYPTED_BYTES + 1 + IV_BYTES + 1 + REQUEST_CMD.length] !== 0x3A) return false;
    return asString(buf, RANDOM_ENCRYPTED_BYTES + 1 + IV_BYTES + 1, REQUEST_CMD.length) === REQUEST_CMD;
  },

  requestFromBuffer(buf: Buffer): { encrypted: Buffer; iv: Buffer; key: Buffer } | null {
    if (!SetKeyCommand.requestMatches(buf)) return null;
    const encrypted = buf.subarray(0, RANDOM_ENCRYPTED_BYTES);
    const iv = buf.subarray(RANDOM_ENCRYPTED_BYTES + 1, RANDOM_ENCRYPTED_BYTES + 1 + IV_BYTES);
    const keyStart = RANDOM_ENCRYPTED_BYTES + 1 + IV_BYTES + 1 + REQUEST_CMD.length + 1;
    const key = buf.subarray(keyStart, keyStart + KEY_BYTES);
    return { encrypted, iv, key };
  },

  response(): { toBuffer(): Buffer } {
    return {
      toBuffer() { return Buffer.from(RESPONSE_CMD, 'utf8'); },
    };
  },

  responseMatches(buf: Buffer): boolean {
    if (buf.length !== RESPONSE_CMD.length && buf.length !== RESPONSE_CMD.length + CRLF.length) return false;
    return asString(buf, 0, RESPONSE_CMD.length) === RESPONSE_CMD;
  },

  responseFromBuffer(buf: Buffer): Record<never, never> | null {
    if (!SetKeyCommand.responseMatches(buf)) return null;
    return {};
  },
};
