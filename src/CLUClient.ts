import { Client } from './Client.js';
import { TFTPClient } from './tftp/TFTPClient.js';
import { LuaScriptCommand } from './commands/LuaScriptCommand.js';
import { SetIpCommand } from './commands/SetIpCommand.js';
import { SetKeyCommand } from './commands/SetKeyCommand.js';
import { ResetCommand } from './commands/ResetCommand.js';
import { StartTFTPdCommand } from './commands/StartTFTPdCommand.js';
import { StopTFTPdCommand } from './commands/StopTFTPdCommand.js';
import { GenerateMeasurementsCommand } from './commands/GenerateMeasurementsCommand.js';
import { CipherKey } from './CipherKey.js';
import { randomBytes, randomInt } from './util/random.js';
import { hexToNumber } from './util/hex.js';
import { RANDOM_BYTES, DEFAULT_TIMEOUT_MS, COMMAND_PORT } from './constants.js';
import type { CLUDevice } from './device/CLUDevice.js';

export class CLUClient extends Client {
  readonly device: CLUDevice;
  cipherKey: CipherKey;
  private _tftpClient: TFTPClient | null;

  constructor(localAddress: string, device: CLUDevice, cipherKey?: CipherKey) {
    super(localAddress, '255.255.255.255', device?.port ?? COMMAND_PORT);
    this.device = device;
    this.cipherKey = cipherKey ?? device?.getCipherKey() ?? CipherKey.DEFAULT_BROADCAST;
    this._tftpClient = null;
  }

  get deviceAddress(): string | null {
    return this.device?.address ?? null;
  }

  protected async _request(command: { toBuffer(): Buffer }, timeoutMs = DEFAULT_TIMEOUT_MS, responseCipherKey?: CipherKey): Promise<Buffer | null> {
    await this._ensureOpen();
    const respKey = responseCipherKey ?? this.cipherKey;

    await this._sendEncrypted(this.cipherKey, command.toBuffer(), this.deviceAddress!);

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      const raw = await this._receiveRaw(remaining);
      if (!raw) return null;
      const decrypted = respKey.decrypt(raw.buffer);
      if (decrypted) return decrypted;
    }
    return null;
  }

  protected async _send(command: { toBuffer(): Buffer }): Promise<void> {
    await this._ensureOpen();
    await this._sendEncrypted(this.cipherKey, command.toBuffer(), this.deviceAddress!);
  }

  async execute(script: string): Promise<string | null> {
    const sessionId = randomInt(0xFFFFFFFF);
    const command = LuaScriptCommand.request(this.localAddress, sessionId, script);
    const decrypted = await this._request(command);
    if (!decrypted) return null;
    return LuaScriptCommand.parse(sessionId, decrypted);
  }

  async checkAlive(): Promise<boolean | null> {
    const result = await this.execute(LuaScriptCommand.CHECK_ALIVE);
    if (result === null) return null;
    if (result === 'emergency') return false;
    if (result === 'true' || result === 'false') return result === 'true';
    if (this.device?.serialNumber != null) {
      return hexToNumber(result) === this.device.serialNumber;
    }
    return Boolean(result);
  }

  async setAddress(newAddress: string, gatewayAddress: string): Promise<string | null> {
    const command = SetIpCommand.request(this.device.serialNumber!, newAddress, gatewayAddress);
    const decrypted = await this._request(command);
    if (!decrypted) return null;
    const resp = SetIpCommand.responseFromBuffer(decrypted);
    if (!resp) return null;
    this.device.setAddress(resp.ipAddress);
    return resp.ipAddress;
  }

  async updateCipherKey(newCipherKey: CipherKey): Promise<true | null> {
    const randomBuf = randomBytes(RANDOM_BYTES);
    const command = SetKeyCommand.request(
      newCipherKey.encrypt(randomBuf),
      newCipherKey.getSecretKey(),
      newCipherKey.getIV(),
    );
    const decrypted = await this._request(command);
    if (!decrypted) return null;
    const resp = SetKeyCommand.responseFromBuffer(decrypted);
    if (!resp) return null;
    this.cipherKey = newCipherKey;
    return true;
  }

  async reset(timeoutMs = 30000): Promise<boolean> {
    const command = ResetCommand.request(this.localAddress);
    await this._request(command);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 1000));
      const alive = await this.checkAlive();
      if (alive) return true;
    }
    return false;
  }

  async startTFTPdServer(): Promise<true | null> {
    const decrypted = await this._request(StartTFTPdCommand.request());
    if (!decrypted) return null;
    return StartTFTPdCommand.responseFromBuffer(decrypted) ? true : null;
  }

  async stopTFTPdServer(): Promise<true | null> {
    const decrypted = await this._request(StopTFTPdCommand.request());
    if (!decrypted) return null;
    return StopTFTPdCommand.responseFromBuffer(decrypted) ? true : null;
  }

  async uploadFile(localPath: string, location: string): Promise<void> {
    this._tftpClient ??= new TFTPClient(this.localAddress);
    await this._tftpClient.upload(this.device.address!, localPath, location);
  }

  async downloadFile(location: string, localPath: string): Promise<string | null> {
    this._tftpClient ??= new TFTPClient(this.localAddress);
    try {
      await this._tftpClient.download(this.device.address!, location, localPath);
      return localPath;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === '1') return null;
      throw err;
    }
  }

  async generateMeasurements(unknown = '0'): Promise<string | null> {
    const sessionId = randomInt(0xFFFFFFFF);
    const command = GenerateMeasurementsCommand.request(this.localAddress, sessionId, unknown);
    const decrypted = await this._request(command);
    if (!decrypted) return null;
    return GenerateMeasurementsCommand.parse(sessionId, decrypted);
  }

  close(): void {
    super.close();
  }
}
