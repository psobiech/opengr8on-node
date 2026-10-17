import { toHexString, hexToNumber } from '../util/hex.js';
import { serializeCommand, asString, splitExact } from './serialize.js';
import { MIN_SERIAL_NUMBER_CHARACTERS, MAX_SERIAL_NUMBER_CHARACTERS, MIN_IP_CHARACTERS } from '../constants.js';

const REQUEST_CMD = 'req_set_clu_ip';
const RESPONSE_CMD = 'resp_set_clu_ip';

export const SetIpCommand = {
  request(serialNumber, ipAddress, gatewayIpAddress) {
    return {
      toBuffer() {
        return serializeCommand(
          REQUEST_CMD, ':',
          toHexString(serialNumber, MAX_SERIAL_NUMBER_CHARACTERS), ':',
          ipAddress, ':',
          gatewayIpAddress,
        );
      },
    };
  },

  requestMatches(buf) {
    const minLen = REQUEST_CMD.length + 1 + MIN_SERIAL_NUMBER_CHARACTERS + 1 + MIN_IP_CHARACTERS + 1 + MIN_IP_CHARACTERS;
    if (buf.length < minLen) return false;
    if (buf[REQUEST_CMD.length] !== 0x3A) return false;
    return asString(buf, 0, REQUEST_CMD.length) === REQUEST_CMD;
  },

  requestFromBuffer(buf) {
    if (!SetIpCommand.requestMatches(buf)) return null;
    const parts = splitExact(asString(buf), ':', 4);
    if (!parts) return null;
    return { serialNumber: hexToNumber(parts[1]), ipAddress: parts[2], gatewayIpAddress: parts[3] };
  },

  response(serialNumber, ipAddress) {
    return {
      toBuffer() {
        return serializeCommand(
          RESPONSE_CMD, ':',
          toHexString(serialNumber, MAX_SERIAL_NUMBER_CHARACTERS), ':',
          ipAddress,
        );
      },
    };
  },

  responseMatches(buf) {
    const minLen = RESPONSE_CMD.length + 1 + MIN_SERIAL_NUMBER_CHARACTERS + 1 + MIN_IP_CHARACTERS;
    if (buf.length < minLen) return false;
    if (buf[RESPONSE_CMD.length] !== 0x3A) return false;
    return asString(buf, 0, RESPONSE_CMD.length) === RESPONSE_CMD;
  },

  responseFromBuffer(buf) {
    if (!SetIpCommand.responseMatches(buf)) return null;
    const parts = splitExact(asString(buf), ':', 3);
    if (!parts) return null;
    return { serialNumber: hexToNumber(parts[1]), ipAddress: parts[2] };
  },
};
