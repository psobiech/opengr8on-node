import { asString } from './serialize.js';
import { CRLF } from '../constants.js';

const REQUEST_CMD = 'req_start_ftp';
const RESPONSE_CMD = 'resp:OK';

export const StartTFTPdCommand = {
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
    if (!StartTFTPdCommand.requestMatches(buf)) return null;
    return {};
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
    if (!StartTFTPdCommand.responseMatches(buf)) return null;
    return {};
  },
};
