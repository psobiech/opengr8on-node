import dgram from 'node:dgram';
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, normalize, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

export const TFTP_DEFAULT_PORT = 69;

const BLOCK_SIZE    = 512;
const TIMEOUT_MS    = 5_000;
const MAX_RETRIES   = 3;

const PKT_RRQ   = 1;
const PKT_WRQ   = 2;
const PKT_DATA  = 3;
const PKT_ACK   = 4;
const PKT_ERROR = 5;

const ERR_UNDEFINED   = 0;
const ERR_NOT_FOUND   = 1;
const ERR_ACCESS      = 2;
const ERR_ILLEGAL     = 4;
const ERR_UNKNOWN_TID = 5;
const ERR_EXISTS      = 6;

export type TFTPServerMode = 'GET_ONLY' | 'PUT_ONLY' | 'GET_AND_PUT' | 'GET_AND_REPLACE';

export class TFTPServer {
  private readonly _rootDirectory: string;
  private readonly _mode: TFTPServerMode;
  private _socket: dgram.Socket | null = null;
  private _port: number;

  constructor(
    rootDirectory: string,
    port = TFTP_DEFAULT_PORT,
    mode: TFTPServerMode = 'GET_AND_REPLACE',
  ) {
    this._rootDirectory = resolve(rootDirectory);
    this._port = port;
    this._mode = mode;
  }

  get port(): number { return this._port; }

  start(): Promise<void> {
    return new Promise((resolvePromise, rejectPromise) => {
      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      this._socket = socket;
      socket.once('error', rejectPromise);
      socket.bind(this._port, () => {
        this._port = (socket.address() as { port: number }).port;
        socket.removeAllListeners('error');
        socket.on('error', (error) => console.error('[TFTPServer] error:', error));
        socket.on('message', (message, remoteInfo) =>
          this._onRequest(message, remoteInfo.address, remoteInfo.port),
        );
        resolvePromise();
      });
    });
  }

  close(): void { this.stop(); }

  stop(): void {
    this._socket?.close();
    this._socket = null;
  }

  private _onRequest(message: Buffer, remoteAddr: string, remotePort: number): void {
    if (message.length < 4) return;
    const opcode = message.readUInt16BE(0);

    if (opcode === PKT_RRQ) {
      if (this._mode === 'PUT_ONLY') {
        this._errorTo(remoteAddr, remotePort, ERR_ACCESS, 'server is write-only');
        return;
      }
      const { filename, mode } = parseRequest(message);
      const filePath = this._resolvePath(filename);
      if (filePath == null) {
        this._errorTo(remoteAddr, remotePort, ERR_ACCESS, 'access denied');
        return;
      }
      if (!existsSync(filePath)) {
        this._errorTo(remoteAddr, remotePort, ERR_NOT_FOUND, 'file not found');
        return;
      }
      void this._sendFile(remoteAddr, remotePort, filePath, mode);

    } else if (opcode === PKT_WRQ) {
      if (this._mode === 'GET_ONLY') {
        this._errorTo(remoteAddr, remotePort, ERR_ACCESS, 'server is read-only');
        return;
      }
      const { filename, mode } = parseRequest(message);
      const filePath = this._resolvePath(filename);
      if (filePath == null) {
        this._errorTo(remoteAddr, remotePort, ERR_ACCESS, 'access denied');
        return;
      }
      if (this._mode === 'GET_AND_PUT' && existsSync(filePath)) {
        this._errorTo(remoteAddr, remotePort, ERR_EXISTS, 'file exists');
        return;
      }
      void this._receiveFile(remoteAddr, remotePort, filePath, mode);
    }
  }

  private _errorTo(addr: string, port: number, code: number, message: string): void {
    this._socket?.send(errorPacket(code, message), port, addr);
  }

  /** Resolve a TFTP path within server root. Returns null if outside root. */
  private _resolvePath(filename: string): string | null {
    // Convert Windows path: a:\file.txt or a:/file.txt → a/file.txt
    let normalized = filename.replace(/^([a-z]):[\\\/]/i, '$1/').replace(/\\/g, '/');
    // Strip directory traversal attempts
    normalized = normalized.split('/').filter((segment) => segment !== '..' && segment !== '.').join('/');
    normalized = normalized.replace(/^\/+/, '');
    const full = normalize(resolve(this._rootDirectory, normalized));
    if (full !== this._rootDirectory && !full.startsWith(this._rootDirectory + '/')) {
      return null;
    }
    return full;
  }

  /** RRQ: send file to client via ephemeral socket */
  private async _sendFile(
    remoteAddr: string,
    remotePort: number,
    filePath: string,
    mode: string,
  ): Promise<void> {
    const socket = await bindEphemeral();
    const send = (packetBuffer: Buffer) =>
      new Promise<void>((resolvePromise, rejectPromise) =>
        socket.send(packetBuffer, remotePort, remoteAddr, (sendError) => (sendError ? rejectPromise(sendError) : resolvePromise())));

    try {
      let fileData = await readFile(filePath);
      if (mode === 'netascii') fileData = octetToNetascii(fileData);

      // Always at least 1 block; exact multiples of 512 need a trailing zero-length block
      const totalBlocks = Math.floor(fileData.length / BLOCK_SIZE) + 1;

      for (let block = 1; block <= totalBlocks; block++) {
        const offset = (block - 1) * BLOCK_SIZE;
        const chunk = fileData.subarray(offset, Math.min(offset + BLOCK_SIZE, fileData.length));
        const packet = dataPacket(block, chunk);

        let acked = false;
        for (let attempt = 0; attempt < MAX_RETRIES && !acked; attempt++) {
          await send(packet);
          try {
            const { message } = await receiveFrom(socket, TIMEOUT_MS, remoteAddr, null);
            if (
              message.readUInt16BE(0) === PKT_ACK &&
              message.readUInt16BE(2) === (block & 0xffff)
            ) {
              acked = true;
            }
            // duplicate ACK or wrong block: retry
          } catch {
            /* timeout — retry */
          }
        }
        if (!acked) {
          await send(errorPacket(ERR_UNDEFINED, 'timeout waiting for ACK')).catch(() => {/* ignore */});
          return;
        }
      }
    } catch (error) {
      console.error(`[TFTPServer] sendFile error (${filePath}):`, error);
      await send(errorPacket(ERR_UNDEFINED, 'server error')).catch(() => {/* ignore */});
    } finally {
      socket.close();
    }
  }

  /** WRQ: receive file from client via ephemeral socket */
  private async _receiveFile(
    remoteAddr: string,
    remotePort: number,
    filePath: string,
    mode: string,
  ): Promise<void> {
    const socket = await bindEphemeral();
    const send = (packetBuffer: Buffer) =>
      new Promise<void>((resolvePromise, rejectPromise) =>
        socket.send(packetBuffer, remotePort, remoteAddr, (sendError) => (sendError ? rejectPromise(sendError) : resolvePromise())));

    const chunks: Buffer[] = [];

    try {
      // ACK 0 starts the transfer
      await send(ackPacket(0));

      let block = 1;
      let clientPort: number | null = null;

      for (;;) {
        let packet: Buffer | null = null;
        for (let attempt = 0; attempt < MAX_RETRIES && packet == null; attempt++) {
          try {
            const received = await receiveFrom(socket, TIMEOUT_MS, remoteAddr, clientPort);
            packet = received.message;
            if (clientPort == null) clientPort = received.port;
          } catch {
            // timeout — retransmit last ACK
            await send(ackPacket(block - 1)).catch(() => {/* ignore */});
          }
        }
        if (packet == null) {
          await send(errorPacket(ERR_UNDEFINED, 'timeout')).catch(() => {/* ignore */});
          return;
        }

        const opcode = packet.readUInt16BE(0);
        if (opcode === PKT_ERROR) {
          const code = packet.readUInt16BE(2);
          const message = packet.subarray(4, packet.indexOf(0, 4)).toString('ascii');
          console.error(`[TFTPServer] client error ${code}: ${message}`);
          return;
        }
        if (opcode !== PKT_DATA) {
          await send(errorPacket(ERR_ILLEGAL, 'expected DATA packet')).catch(() => {/* ignore */});
          return;
        }

        const packetBlock = packet.readUInt16BE(2);
        const expectedBlock = block & 0xffff;

        if (packetBlock === expectedBlock) {
          chunks.push(Buffer.from(packet.subarray(4)));
          await send(ackPacket(block));
          const isLastBlock = packet.length - 4 < BLOCK_SIZE;
          block++;
          if (isLastBlock) break;
        } else if (packetBlock === ((block - 1) & 0xffff)) {
          // duplicate — re-ack previous
          await send(ackPacket(block - 1));
        } else {
          await send(errorPacket(ERR_ILLEGAL, 'unexpected block number')).catch(() => {/* ignore */});
          return;
        }
      }

      let fileData = Buffer.concat(chunks);
      if (mode === 'netascii') fileData = netasciiToOctet(fileData);

      const directory = dirname(filePath);
      mkdirSync(directory, { recursive: true });

      const temporaryPath = filePath + '.tmp.' + randomBytes(4).toString('hex');
      await writeFile(temporaryPath, fileData);
      renameSync(temporaryPath, filePath);

    } catch (error) {
      console.error(`[TFTPServer] receiveFile error (${filePath}):`, error);
      await send(errorPacket(ERR_UNDEFINED, 'server error')).catch(() => {/* ignore */});
    } finally {
      socket.close();
    }
  }
}

function parseRequest(request: Buffer): { filename: string; mode: string } {
  let position = 2;
  const filenameStart = position;
  while (position < request.length && request[position] !== 0) position++;
  const filename = request.subarray(filenameStart, position).toString('ascii');
  position++;
  const modeStart = position;
  while (position < request.length && request[position] !== 0) position++;
  const mode = request.subarray(modeStart, position).toString('ascii').toLowerCase();
  return { filename, mode };
}

function bindEphemeral(): Promise<dgram.Socket> {
  return new Promise((resolvePromise, rejectPromise) => {
    const socket = dgram.createSocket('udp4');
    socket.once('error', rejectPromise);
    socket.bind(0, () => {
      socket.removeAllListeners('error');
      socket.on('error', (error) => console.error('[TFTPServer] transfer socket error:', error));
      resolvePromise(socket);
    });
  });
}

function readFile(path: string): Promise<Buffer> {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = [];
    createReadStream(path)
      .on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      .on('end', () => resolvePromise(Buffer.concat(chunks)))
      .on('error', rejectPromise);
  });
}

function octetToNetascii(input: Buffer): Buffer<ArrayBuffer> {
  const output: number[] = [];
  for (let i = 0; i < input.length; i++) {
    if (input[i] === 0x0a) { output.push(0x0d, 0x0a); }
    else if (input[i] === 0x0d) { output.push(0x0d, 0x00); }
    else { output.push(input[i]); }
  }
  return Buffer.from(output) as Buffer<ArrayBuffer>;
}

function dataPacket(block: number, chunk: Buffer): Buffer {
  const packet = Buffer.allocUnsafe(4 + chunk.length);
  packet.writeUInt16BE(PKT_DATA, 0);
  packet.writeUInt16BE(block & 0xffff, 2);
  chunk.copy(packet, 4);
  return packet;
}

/** Receive one UDP packet from expectedAddr. Returns { message, port }. */
function receiveFrom(
  socket: dgram.Socket,
  timeoutMs: number,
  expectedAddr: string,
  clientPort: number | null,
): Promise<{ message: Buffer; port: number }> {
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const settle = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeListener('message', onMessage);
      action();
    };
    const timer = setTimeout(() => settle(() => rejectPromise(new Error('timeout'))), timeoutMs);
    const onMessage = (message: Buffer, remoteInfo: dgram.RemoteInfo) => {
      if (settled) return;
      if (remoteInfo.address !== expectedAddr) {
        socket.send(errorPacket(ERR_UNKNOWN_TID, 'unknown TID'), remoteInfo.port, remoteInfo.address);
        return;
      }
      // If clientPort known, enforce it
      if (clientPort !== null && remoteInfo.port !== clientPort) {
        socket.send(errorPacket(ERR_UNKNOWN_TID, 'unknown TID'), remoteInfo.port, remoteInfo.address);
        return;
      }
      settle(() => resolvePromise({ message, port: remoteInfo.port }));
    };
    socket.on('message', onMessage);
  });
}

function errorPacket(code: number, message: string): Buffer {
  const messageBytes = Buffer.from(message + '\0', 'ascii');
  const packet = Buffer.allocUnsafe(4 + messageBytes.length);
  packet.writeUInt16BE(PKT_ERROR, 0);
  packet.writeUInt16BE(code, 2);
  messageBytes.copy(packet, 4);
  return packet;
}

function ackPacket(block: number): Buffer {
  const packet = Buffer.allocUnsafe(4);
  packet.writeUInt16BE(PKT_ACK, 0);
  packet.writeUInt16BE(block & 0xffff, 2);
  return packet;
}

function netasciiToOctet(input: Buffer): Buffer<ArrayBuffer> {
  // \r\n → \n, \r\0 → \r  (RFC 783 NETASCII receive)
  const output: number[] = [];
  for (let i = 0; i < input.length; i++) {
    if (input[i] === 0x0d) {
      const next = input[i + 1];
      if (next === 0x0a) { output.push(0x0a); i++; }
      else if (next === 0x00) { output.push(0x0d); i++; }
      else { output.push(0x0d); }
    } else {
      output.push(input[i]);
    }
  }
  return Buffer.from(output) as Buffer<ArrayBuffer>;
}

function writeFile(path: string, contents: Buffer): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const writeStream = createWriteStream(path);
    writeStream.on('finish', resolvePromise);
    writeStream.on('error', rejectPromise);
    writeStream.end(contents);
  });
}
