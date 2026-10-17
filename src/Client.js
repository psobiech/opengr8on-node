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

export class Client {
  constructor(localAddress, broadcastAddress = '255.255.255.255', port = COMMAND_PORT) {
    this.localAddress = localAddress;
    this.broadcastAddress = broadcastAddress;
    this.port = port;
    this._socket = null;
    this._bound = false;
  }

  async _ensureOpen() {
    if (this._bound) return;
    this._socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    await new Promise((resolve, reject) => {
      this._socket.once('error', reject);
      this._socket.bind({ address: this.localAddress }, () => {
        this._socket.removeListener('error', reject);
        resolve();
      });
    });
    this._socket.setBroadcast(true);
    this._bound = true;
  }

  // Send raw (unencrypted) bytes - encrypt them with cipherKey first
  async _sendEncrypted(cipherKey, buf, address, port) {
    await this._ensureOpen();
    if (buf.length > MAX_PACKET_SIZE) throw new Error(`Packet too large: ${buf.length} > ${MAX_PACKET_SIZE}`);
    const encrypted = cipherKey.encrypt(buf);
    return new Promise((resolve, reject) => {
      this._socket.send(encrypted, port ?? this.port, address, err => err ? reject(err) : resolve());
    });
  }

  // Await one raw UDP message within timeoutMs; returns {buffer, address, port} or null
  _receiveRaw(timeoutMs) {
    return new Promise((resolve) => {
      let done = false;
      const timeout = setTimeout(() => {
        if (!done) {
          done = true;
          this._socket.removeListener('message', handler);
          resolve(null);
        }
      }, timeoutMs);

      const handler = (msg, rinfo) => {
        if (!done) {
          done = true;
          clearTimeout(timeout);
          resolve({ buffer: Buffer.from(msg), address: rinfo.address, port: rinfo.port });
        }
      };

      this._socket.once('message', handler);
    });
  }

  // Discover CLU devices on the network.
  // privateKeys: Map/object of { serialNumber -> Buffer (8 bytes) }
  // Returns array of CLUDevice
  async discover(projectCipherKey, privateKeys = {}, timeoutMs = DEFAULT_TIMEOUT_MS, limit = Infinity) {
    await this._ensureOpen();

    const randomBuf = randomBytes(RANDOM_BYTES);
    const command = DiscoverCLUsCommand.request(
      projectCipherKey.encrypt(randomBuf),
      projectCipherKey.getIV(),
      this.localAddress,
    );

    const requestCipherKey = CipherKey.DEFAULT_BROADCAST;
    const responseCipherKey = CipherKey.DEFAULT_BROADCAST.withIV(projectCipherKey.getIV());

    await this._sendEncrypted(requestCipherKey, command.toBuffer(), this.broadcastAddress);

    const devices = [];
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline && devices.length < limit) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;

      const raw = await this._receiveRaw(remaining);
      if (!raw) break;

      const decrypted = responseCipherKey.decrypt(raw.buffer);
      if (!decrypted) continue;

      const device = DiscoverCLUsCommand.parse(randomBuf, raw.address, decrypted, privateKeys);
      if (device) devices.push(device);
    }

    return devices;
  }

  close() {
    if (this._socket && this._bound) {
      this._socket.close();
      this._bound = false;
      this._socket = null;
    }
  }
}
