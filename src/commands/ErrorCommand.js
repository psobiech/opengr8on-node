import { asString } from './serialize.js';
import { CRLF } from '../constants.js';

const RESPONSE_CMD = 'resp:ERROR';

export const ErrorCommand = {
  responseMatches(buf) {
    if (buf.length !== RESPONSE_CMD.length && buf.length !== RESPONSE_CMD.length + CRLF.length) return false;
    return asString(buf, 0, RESPONSE_CMD.length) === RESPONSE_CMD;
  },

  responseFromBuffer(buf) {
    if (!ErrorCommand.responseMatches(buf)) return null;
    return {};
  },
};
