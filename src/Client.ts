import dgram from 'dgram';
import { CipherKey } from './CipherKey.js';
import { DiscoverCLUsCommand } from './commands/DiscoverCLUsCommand.js';
import { randomBytes } from './util/random.js';
import {
  COMMAND_PORT,
  MAX_PACKET_SIZE,
  DEFAULT_TIMEOUT_MS,
  RANDOM_BYTES,
} from './constants.js';
import type { CLUDevice } from './device/CLUDevice.js';

interface RawMessage {
  buffer: Buffer;
  address: string;
  port: number;
}

export class Client {
  protected readonly localAddress: string;
  protected readonly broadcastAddress: string;
  protected readonly port: number;
  private _socket: dgram.Socket | null;
  private _bound: boolean;

  constructor(localAddress: string, broadcastAddress = '255.255.255.255', port = COMMAND_PORT) {
    this.localAddress = localAddress;
    this.broadcastAddress = broadcastAddress;
    this.port = port;
    this._socket = null;
    this._bound = false;
  }

  protected async _ensureOpen(): Promise<void> {
    if (this._bound) return;
    this._socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    await new Promise<void>((resolve, reject) => {
      this._socket!.once('error', reject);
      this._socket!.bind({ address: this.localAddress }, () => {
        this._socket!.removeListener('error', reject);
        resolve();
      });
    });
    this._socket.setBroadcast(true);
    this._bound = true;
  }

  protected async _sendEncrypted(cipherKey: CipherKey, buf: Buffer, address: string, port?: number): Promise<void> {
    await this._ensureOpen();
    if (buf.length > MAX_PACKET_SIZE) throw new Error(`Packet too large: ${buf.length} > ${MAX_PACKET_SIZE}`);
    const encrypted = cipherKey.encrypt(buf);
    return new Promise((resolve, reject) => {
      this._socket!.send(encrypted, port ?? this.port, address, err => err ? reject(err) : resolve());
    });
  }

  protected _receiveRaw(timeoutMs: number): Promise<RawMessage | null> {
    return new Promise((resolve) => {
      let done = false;
      const timeout = setTimeout(() => {
        if (!done) {
          done = true;
          this._socket!.removeListener('message', handler);
          resolve(null);
        }
      }, timeoutMs);

      const handler = (msg: Buffer, rinfo: dgram.RemoteInfo) => {
        if (!done) {
          done = true;
          clearTimeout(timeout);
          resolve({ buffer: Buffer.from(msg), address: rinfo.address, port: rinfo.port });
        }
      };

      this._socket!.once('message', handler);
    });
  }

  async discover(
    projectCipherKey: CipherKey,
    privateKeys: Record<number, Buffer> = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
    limit = Infinity,
    resendIntervalMs = 1000,
  ): Promise<CLUDevice[]> {
    await this._ensureOpen();

    const randomBuf = randomBytes(RANDOM_BYTES);
    const command = DiscoverCLUsCommand.request(
      projectCipherKey.encrypt(randomBuf),
      projectCipherKey.getIV(),
      this.localAddress,
    );

    const requestCipherKey = CipherKey.DEFAULT_BROADCAST;
    const responseCipherKey = CipherKey.DEFAULT_BROADCAST.withIV(projectCipherKey.getIV());

    // UDP gives no delivery feedback: on a lossy link either the broadcast or the reply may be
    // lost. Re-broadcast the same request every resendIntervalMs until the deadline; CLUs answer
    // idempotently, so replies are deduplicated by serial number.
    const request = command.toBuffer();
    const send = () => this._sendEncrypted(requestCipherKey, request, this.broadcastAddress).catch(() => {});
    await this._sendEncrypted(requestCipherKey, request, this.broadcastAddress);
    const resend = resendIntervalMs > 0 ? setInterval(send, resendIntervalMs) : null;

    const devices = new Map<number | string, CLUDevice>();
    const deadline = Date.now() + timeoutMs;

    try {
      while (Date.now() < deadline && devices.size < limit) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;

        const raw = await this._receiveRaw(remaining);
        if (!raw) break;

        const decrypted = responseCipherKey.decrypt(raw.buffer);
        if (!decrypted) continue;

        const device = DiscoverCLUsCommand.parse(randomBuf, raw.address, decrypted, privateKeys);
        if (!device) continue;
        const key = device.serialNumber ?? raw.address;
        if (!devices.has(key)) devices.set(key, device);
      }
    } finally {
      if (resend) clearInterval(resend);
    }

    return [...devices.values()];
  }

  close(): void {
    if (this._socket && this._bound) {
      this._socket.close();
      this._bound = false;
      this._socket = null;
    }
  }
}
