import { serializeCommand, asString } from './serialize.js';
import { RANDOM_ENCRYPTED_BYTES, IV_BYTES, KEY_BYTES, CRLF } from '../constants.js';

const REQUEST_CMD = 'req_set_key';
const RESPONSE_CMD = 'resp:OK';

export const SetKeyCommand = {
  // encrypted = newCipherKey.encrypt(randomBytes)
  // key = newCipherKey.getSecretKey()
  // iv = newCipherKey.getIV()
  request(encrypted, key, iv) {
    return {
      toBuffer() {
        return serializeCommand(encrypted, ':', iv, ':', REQUEST_CMD, ':', key);
      },
    };
  },

  requestMatches(buf) {
    const expectedLen = RANDOM_ENCRYPTED_BYTES + 1 + IV_BYTES + 1 + REQUEST_CMD.length + 1 + KEY_BYTES;
    if (buf.length !== expectedLen && buf.length !== expectedLen + CRLF.length) return false;
    if (buf[RANDOM_ENCRYPTED_BYTES] !== 0x3A) return false;
    if (buf[RANDOM_ENCRYPTED_BYTES + 1 + IV_BYTES] !== 0x3A) return false;
    if (buf[RANDOM_ENCRYPTED_BYTES + 1 + IV_BYTES + 1 + REQUEST_CMD.length] !== 0x3A) return false;
    return asString(buf, RANDOM_ENCRYPTED_BYTES + 1 + IV_BYTES + 1, REQUEST_CMD.length) === REQUEST_CMD;
  },

  requestFromBuffer(buf) {
    if (!SetKeyCommand.requestMatches(buf)) return null;
    const encrypted = buf.slice(0, RANDOM_ENCRYPTED_BYTES);
    const iv = buf.slice(RANDOM_ENCRYPTED_BYTES + 1, RANDOM_ENCRYPTED_BYTES + 1 + IV_BYTES);
    const keyStart = RANDOM_ENCRYPTED_BYTES + 1 + IV_BYTES + 1 + REQUEST_CMD.length + 1;
    const key = buf.slice(keyStart, keyStart + KEY_BYTES);
    return { encrypted, iv, key };
  },

  response() {
    return {
      toBuffer() { return Buffer.from(RESPONSE_CMD, 'utf8'); },
    };
  },

  responseMatches(buf) {
    if (buf.length !== RESPONSE_CMD.length && buf.length !== RESPONSE_CMD.length + CRLF.length) return false;
    return asString(buf, 0, RESPONSE_CMD.length) === RESPONSE_CMD;
  },

  responseFromBuffer(buf) {
    if (!SetKeyCommand.responseMatches(buf)) return null;
    return {};
  },
};
