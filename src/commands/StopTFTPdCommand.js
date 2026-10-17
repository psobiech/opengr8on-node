import { asString } from './serialize.js';
import { CRLF } from '../constants.js';

const REQUEST_CMD = 'req_tftp_stop';
const RESPONSE_CMD = 'resp:OK';

export const StopTFTPdCommand = {
  request() {
    return {
      toBuffer() { return Buffer.from(REQUEST_CMD, 'utf8'); },
    };
  },

  requestMatches(buf) {
    if (buf.length !== REQUEST_CMD.length && buf.length !== REQUEST_CMD.length + CRLF.length) return false;
    return asString(buf, 0, REQUEST_CMD.length) === REQUEST_CMD;
  },

  requestFromBuffer(buf) {
    if (!StopTFTPdCommand.requestMatches(buf)) return null;
    return {};
  },

  responseMatches(buf) {
    if (buf.length !== RESPONSE_CMD.length && buf.length !== RESPONSE_CMD.length + CRLF.length) return false;
    return asString(buf, 0, RESPONSE_CMD.length) === RESPONSE_CMD;
  },

  responseFromBuffer(buf) {
    if (!StopTFTPdCommand.responseMatches(buf)) return null;
    return {};
  },
};
