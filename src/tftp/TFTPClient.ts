import dgram from 'dgram';
import fs from 'fs';
import { TFTP_PORT } from '../constants.js';

const OP_RRQ   = 1 as const;
const OP_WRQ   = 2 as const;
const OP_DATA  = 3 as const;
const OP_ACK   = 4 as const;
const OP_ERROR = 5 as const;

const BLOCK_SIZE = 512;
const TFTP_TIMEOUT_MS = 5000;

export class TFTPError extends Error {
  code: number;
  constructor(code: number, message: string) {
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
} as const);

type DataPacket  = { opcode: typeof OP_DATA;  block: number; data: Buffer };
type AckPacket   = { opcode: typeof OP_ACK;   block: number };
type ErrorPacket = { opcode: typeof OP_ERROR; code: number; message: string };
type UnknownPacket = { opcode: number };
type TFTPPacket = DataPacket | AckPacket | ErrorPacket | UnknownPacket;

export class TFTPClient {
  readonly localAddress: string;

  constructor(localAddress: string) {
    this.localAddress = localAddress;
  }

  async upload(deviceAddress: string, localPath: string, remoteFilename: string): Promise<void> {
    const data = fs.readFileSync(localPath);
    const socket = await createSocket(this.localAddress);
    try {
      await sendPacket(socket, buildWRQ(remoteFilename), deviceAddress, TFTP_PORT);

      const { datagram, address: serverAddr, port: serverPort } = await receivePacket(socket);
      let packet = parsePacket(datagram);
      if (isErrorPacket(packet)) throw new TFTPError(packet.code, packet.message);
      if (!isAckPacket(packet)) throw new Error(`TFTP: expected ACK(0), got opcode=${packet.opcode}`);
      if (packet.block !== 0) throw new Error(`TFTP: expected ACK(0), got block=${packet.block}`);

      let block = 1;
      let offset = 0;
      while (true) {
        const chunk = data.subarray(offset, offset + BLOCK_SIZE);
        await sendPacket(socket, buildDATA(block, chunk), serverAddr, serverPort);

        const response = await receivePacket(socket);
        packet = parsePacket(response.datagram);
        if (isErrorPacket(packet)) throw new TFTPError(packet.code, packet.message);
        if (!isAckPacket(packet)) throw new Error(`TFTP: expected ACK(${block})`);
        if (packet.block !== block) throw new Error(`TFTP: expected ACK(${block})`);

        offset += chunk.length;
        if (chunk.length < BLOCK_SIZE) break;
        block = (block + 1) & 0xFFFF;
      }
    } finally {
      socket.close();
    }
  }

  async download(deviceAddress: string, remoteFilename: string, localPath: string): Promise<void> {
    const socket = await createSocket(this.localAddress);
    const chunks: Buffer[] = [];
    try {
      await sendPacket(socket, buildRRQ(remoteFilename), deviceAddress, TFTP_PORT);

      let serverAddr = '';
      let serverPort = 0;
      let expectedBlock = 1;

      while (true) {
        const { datagram, address, port } = await receivePacket(socket);
        const packet = parsePacket(datagram);

        if (isErrorPacket(packet)) throw new TFTPError(packet.code, packet.message);
        if (!isDataPacket(packet)) throw new Error(`TFTP: expected DATA, got opcode=${packet.opcode}`);
        if (packet.block !== expectedBlock) continue;

        serverAddr = address;
        serverPort = port;

        chunks.push(Buffer.from(packet.data));
        await sendPacket(socket, buildACK(packet.block), serverAddr, serverPort);

        if (packet.data.length < BLOCK_SIZE) break;
        expectedBlock = (expectedBlock + 1) & 0xFFFF;
      }
    } finally {
      socket.close();
    }

    fs.writeFileSync(localPath, Buffer.concat(chunks));
  }
}

function createSocket(localAddress: string): Promise<dgram.Socket> {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket({ type: 'udp4' });
    socket.on('error', reject);
    socket.bind({ address: localAddress }, () => {
      socket.removeListener('error', reject);
      resolve(socket);
    });
  });
}

function sendPacket(socket: dgram.Socket, packetBuffer: Buffer, address: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.send(packetBuffer, port, address, sendError => sendError ? reject(sendError) : resolve());
  });
}

function receivePacket(socket: dgram.Socket, timeoutMs = TFTP_TIMEOUT_MS): Promise<{ datagram: Buffer; address: string; port: number }> {
  return new Promise((resolve, reject) => {
    let done = false;
    const timeout = setTimeout(() => {
      if (!done) { done = true; reject(new Error('TFTP timeout')); }
    }, timeoutMs);

    socket.once('message', (message: Buffer, remoteInfo: dgram.RemoteInfo) => {
      if (!done) {
        done = true;
        clearTimeout(timeout);
        resolve({ datagram: message, address: remoteInfo.address, port: remoteInfo.port });
      }
    });
  });
}

function parsePacket(datagram: Buffer): TFTPPacket {
  const opcode = datagram.readUInt16BE(0);
  if (opcode === OP_DATA) {
    return { opcode, block: datagram.readUInt16BE(2), data: datagram.subarray(4) };
  }
  if (opcode === OP_ACK) {
    return { opcode, block: datagram.readUInt16BE(2) };
  }
  if (opcode === OP_ERROR) {
    const code = datagram.readUInt16BE(2);
    const message = datagram.subarray(4).toString('utf8').replace(/\0.*/, '');
    return { opcode, code, message };
  }
  return { opcode };
}

function isErrorPacket(packet: TFTPPacket): packet is ErrorPacket { return packet.opcode === OP_ERROR; }
function isAckPacket(packet: TFTPPacket): packet is AckPacket { return packet.opcode === OP_ACK; }
function isDataPacket(packet: TFTPPacket): packet is DataPacket { return packet.opcode === OP_DATA; }

function buildWRQ(filename: string): Buffer {
  const filenameBytes = Buffer.from(filename + '\0', 'utf8');
  const modeBytes = Buffer.from('octet\0', 'utf8');
  const packetBuffer = Buffer.alloc(2 + filenameBytes.length + modeBytes.length);
  packetBuffer.writeUInt16BE(OP_WRQ, 0);
  filenameBytes.copy(packetBuffer, 2);
  modeBytes.copy(packetBuffer, 2 + filenameBytes.length);
  return packetBuffer;
}

function buildDATA(block: number, data: Buffer): Buffer {
  const packetBuffer = Buffer.alloc(4 + data.length);
  packetBuffer.writeUInt16BE(OP_DATA, 0);
  packetBuffer.writeUInt16BE(block, 2);
  data.copy(packetBuffer, 4);
  return packetBuffer;
}

function buildRRQ(filename: string): Buffer {
  const filenameBytes = Buffer.from(filename + '\0', 'utf8');
  const modeBytes = Buffer.from('octet\0', 'utf8');
  const packetBuffer = Buffer.alloc(2 + filenameBytes.length + modeBytes.length);
  packetBuffer.writeUInt16BE(OP_RRQ, 0);
  filenameBytes.copy(packetBuffer, 2);
  modeBytes.copy(packetBuffer, 2 + filenameBytes.length);
  return packetBuffer;
}

function buildACK(block: number): Buffer {
  const packetBuffer = Buffer.alloc(4);
  packetBuffer.writeUInt16BE(OP_ACK, 0);
  packetBuffer.writeUInt16BE(block, 2);
  return packetBuffer;
}
