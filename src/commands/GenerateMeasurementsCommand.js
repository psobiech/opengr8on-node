import { toHexString, hexToNumber } from '../util/hex.js';
import { serializeCommand, asString } from './serialize.js';
import { CRLF, MIN_IP_CHARACTERS, MIN_SESSION_CHARACTERS, MAX_SESSION_CHARACTERS } from '../constants.js';

const REQUEST_CMD = 'req_gen_measurements';
const RESPONSE_CMD = 'meas_file_download';

export const RESPONSE_OK = 'ok';

export const GenerateMeasurementsCommand = {
  request(localAddress, sessionId, unknown) {
    return {
      toBuffer() {
        return serializeCommand(
          REQUEST_CMD, ':',
          localAddress, ':',
          toHexString(sessionId, MAX_SESSION_CHARACTERS), ':',
          unknown,
          CRLF,
        );
      },
    };
  },

  requestMatches(buf) {
    const minLen = REQUEST_CMD.length + 1 + MIN_IP_CHARACTERS + 1 + MIN_SESSION_CHARACTERS + 1 + 1;
    if (buf.length < minLen) return false;
    if (buf[REQUEST_CMD.length] !== 0x3A) return false;
    return asString(buf, 0, REQUEST_CMD.length) === REQUEST_CMD;
  },

  requestFromBuffer(buf) {
    if (!GenerateMeasurementsCommand.requestMatches(buf)) return null;
    const parts = asString(buf).split(':', 4);
    if (parts.length < 4) return null;
    return { ipAddress: parts[1], sessionId: hexToNumber(parts[2]), unknown: parts[3] };
  },

  response(ipAddress, sessionId, returnValue) {
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

  responseMatches(buf) {
    const minLen = RESPONSE_CMD.length + 1 + MIN_IP_CHARACTERS + 1 + MIN_SESSION_CHARACTERS + 1 + 1;
    if (buf.length < minLen) return false;
    if (buf[RESPONSE_CMD.length] !== 0x3A) return false;
    return asString(buf, 0, RESPONSE_CMD.length) === RESPONSE_CMD;
  },

  responseFromBuffer(buf) {
    if (!GenerateMeasurementsCommand.responseMatches(buf)) return null;
    const parts = asString(buf).split(':', 4);
    if (parts.length < 4) return null;
    return { ipAddress: parts[1], sessionId: hexToNumber(parts[2]), returnValue: parts[3] };
  },

  parse(sessionId, decryptedBuf) {
    const resp = GenerateMeasurementsCommand.responseFromBuffer(decryptedBuf);
    if (!resp) return null;
    if (resp.sessionId !== sessionId) return null;
    return resp.returnValue;
  },
};
