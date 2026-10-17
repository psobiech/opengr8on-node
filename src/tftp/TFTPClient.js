import dgram from 'dgram';
import fs from 'fs';
import { TFTP_PORT } from '../constants.js';

const OP_RRQ   = 1;
const OP_WRQ   = 2;
const OP_DATA  = 3;
const OP_ACK   = 4;
const OP_ERROR = 5;

const BLOCK_SIZE = 512;
const TFTP_TIMEOUT_MS = 5000;

export class TFTPError extends Error {
  constructor(code, message) {
    super(`TFTP error ${code}: ${message}`);
    this.code = code;
  }
}

export const TFTPErrorCode = Object.freeze({
  NOT_DEFINED:        0,
  FILE_NOT_FOUND:     1,
  ACCESS_VIOLATION:   2,
  DISK_FULL:          3,
  ILLEGAL_OPERATION:  4,
  UNKNOWN_TID:        5,
  FILE_EXISTS:        6,
  NO_SUCH_USER:       7,
});

function buildRRQ(filename) {
  const filenameBuf = Buffer.from(filename + '\0', 'utf8');
  const modeBuf = Buffer.from('octet\0', 'utf8');
  const buf = Buffer.alloc(2 + filenameBuf.length + modeBuf.length);
  buf.writeUInt16BE(OP_RRQ, 0);
  filenameBuf.copy(buf, 2);
  modeBuf.copy(buf, 2 + filenameBuf.length);
  return buf;
}

function buildWRQ(filename) {
  const filenameBuf = Buffer.from(filename + '\0', 'utf8');
  const modeBuf = Buffer.from('octet\0', 'utf8');
  const buf = Buffer.alloc(2 + filenameBuf.length + modeBuf.length);
  buf.writeUInt16BE(OP_WRQ, 0);
  filenameBuf.copy(buf, 2);
  modeBuf.copy(buf, 2 + filenameBuf.length);
  return buf;
}

function buildACK(block) {
  const buf = Buffer.alloc(4);
  buf.writeUInt16BE(OP_ACK, 0);
  buf.writeUInt16BE(block, 2);
  return buf;
}

function buildDATA(block, data) {
  const buf = Buffer.alloc(4 + data.length);
  buf.writeUInt16BE(OP_DATA, 0);
  buf.writeUInt16BE(block, 2);
  data.copy(buf, 4);
  return buf;
}

function parsePacket(buf) {
  const opcode = buf.readUInt16BE(0);
  if (opcode === OP_DATA) {
    return { opcode, block: buf.readUInt16BE(2), data: buf.slice(4) };
  }
  if (opcode === OP_ACK) {
    return { opcode, block: buf.readUInt16BE(2) };
  }
  if (opcode === OP_ERROR) {
    const code = buf.readUInt16BE(2);
    const message = buf.slice(4).toString('utf8').replace(/\0.*/, '');
    return { opcode, code, message };
  }
  return { opcode };
}

function createSocket(localAddress) {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket({ type: 'udp4' });
    sock.on('error', reject);
    sock.bind({ address: localAddress }, () => {
      sock.removeListener('error', reject);
      resolve(sock);
    });
  });
}

function sendPacket(sock, buf, address, port) {
  return new Promise((resolve, reject) => {
    sock.send(buf, port, address, err => err ? reject(err) : resolve());
  });
}

function receivePacket(sock, timeoutMs = TFTP_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timeout = setTimeout(() => {
      if (!done) { done = true; reject(new Error('TFTP timeout')); }
    }, timeoutMs);

    sock.once('message', (msg, rinfo) => {
      if (!done) {
        done = true;
        clearTimeout(timeout);
        resolve({ buf: msg, address: rinfo.address, port: rinfo.port });
      }
    });
  });
}

export class TFTPClient {
  constructor(localAddress) {
    this.localAddress = localAddress;
  }

  // Upload localPath to remoteFilename on deviceAddress
  async upload(deviceAddress, localPath, remoteFilename) {
    const data = fs.readFileSync(localPath);
    const sock = await createSocket(this.localAddress);
    try {
      await sendPacket(sock, buildWRQ(remoteFilename), deviceAddress, TFTP_PORT);

      // Await ACK(0) from server - comes from a new TID port
      let { buf, address: serverAddr, port: serverPort } = await receivePacket(sock);
      let pkt = parsePacket(buf);
      if (pkt.opcode === OP_ERROR) throw new TFTPError(pkt.code, pkt.message);
      if (pkt.opcode !== OP_ACK || pkt.block !== 0) throw new Error(`TFTP: expected ACK(0), got opcode=${pkt.opcode} block=${pkt.block}`);

      let block = 1;
      let offset = 0;
      while (true) {
        const chunk = data.subarray(offset, offset + BLOCK_SIZE);
        await sendPacket(sock, buildDATA(block, chunk), serverAddr, serverPort);

        const resp = await receivePacket(sock);
        pkt = parsePacket(resp.buf);
        if (pkt.opcode === OP_ERROR) throw new TFTPError(pkt.code, pkt.message);
        if (pkt.opcode !== OP_ACK || pkt.block !== block) throw new Error(`TFTP: expected ACK(${block})`);

        offset += chunk.length;
        if (chunk.length < BLOCK_SIZE) break;
        block = (block + 1) & 0xFFFF;
      }
    } finally {
      sock.close();
    }
  }

  // Download remoteFilename from deviceAddress to localPath
  async download(deviceAddress, remoteFilename, localPath) {
    const sock = await createSocket(this.localAddress);
    const chunks = [];
    try {
      await sendPacket(sock, buildRRQ(remoteFilename), deviceAddress, TFTP_PORT);

      let serverAddr, serverPort;
      let expectedBlock = 1;

      while (true) {
        const { buf, address, port } = await receivePacket(sock);
        const pkt = parsePacket(buf);

        if (pkt.opcode === OP_ERROR) throw new TFTPError(pkt.code, pkt.message);
        if (pkt.opcode !== OP_DATA) throw new Error(`TFTP: expected DATA, got opcode=${pkt.opcode}`);
        if (pkt.block !== expectedBlock) continue; // retransmit

        serverAddr = address;
        serverPort = port;

        chunks.push(Buffer.from(pkt.data));
        await sendPacket(sock, buildACK(pkt.block), serverAddr, serverPort);

        if (pkt.data.length < BLOCK_SIZE) break;
        expectedBlock = (expectedBlock + 1) & 0xFFFF;
      }
    } finally {
      sock.close();
    }

    fs.writeFileSync(localPath, Buffer.concat(chunks));
  }
}
