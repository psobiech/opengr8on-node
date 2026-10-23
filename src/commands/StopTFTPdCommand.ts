import { asString } from './serialize.js';
import { CRLF } from '../constants.js';

const REQUEST_CMD = 'req_tftp_stop';
const RESPONSE_CMD = 'resp:OK';

export const StopTFTPdCommand = {
  request(): { toBuffer(): Buffer } {
    return {
      toBuffer() { return Buffer.from(REQUEST_CMD, 'utf8'); },
    };
  },

  requestMatches(buf: Buffer): boolean {
    if (buf.length !== REQUEST_CMD.length && buf.length !== REQUEST_CMD.length + CRLF.length) return false;
    return asString(buf, 0, REQUEST_CMD.length) === REQUEST_CMD;
  },

  requestFromBuffer(buf: Buffer): Record<never, never> | null {
    if (!StopTFTPdCommand.requestMatches(buf)) return null;
    return {};
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
    if (!StopTFTPdCommand.responseMatches(buf)) return null;
    return {};
  },
};
