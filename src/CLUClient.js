import { Client } from './Client.js';
import { TFTPClient } from './tftp/TFTPClient.js';
import { LuaScriptCommand } from './commands/LuaScriptCommand.js';
import { SetIpCommand } from './commands/SetIpCommand.js';
import { SetKeyCommand } from './commands/SetKeyCommand.js';
import { ResetCommand } from './commands/ResetCommand.js';
import { StartTFTPdCommand } from './commands/StartTFTPdCommand.js';
import { StopTFTPdCommand } from './commands/StopTFTPdCommand.js';
import { GenerateMeasurementsCommand } from './commands/GenerateMeasurementsCommand.js';
import { randomBytes, randomInt } from './util/random.js';
import { hexToNumber } from './util/hex.js';
import { RANDOM_BYTES, DEFAULT_TIMEOUT_MS, COMMAND_PORT } from './constants.js';

export class CLUClient extends Client {
  constructor(localAddress, device, cipherKey) {
    super(localAddress, '255.255.255.255', device?.port ?? COMMAND_PORT);
    this.device = device;
    this.cipherKey = cipherKey ?? device?.getCipherKey();
    this._tftpClient = null;
  }

  get deviceAddress() {
    return this.device?.address ?? null;
  }

  // Send command, await single decrypted response
  async _request(command, timeoutMs = DEFAULT_TIMEOUT_MS, responseCipherKey) {
    await this._ensureOpen();
    const respKey = responseCipherKey ?? this.cipherKey;

    await this._sendEncrypted(this.cipherKey, command.toBuffer(), this.deviceAddress);

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

  // Send command, no response expected
  async _send(command) {
    await this._ensureOpen();
    await this._sendEncrypted(this.cipherKey, command.toBuffer(), this.deviceAddress);
  }

  // Execute Lua script, returns returnValue string or null on timeout
  async execute(script) {
    const sessionId = randomInt(0xFFFFFFFF);
    const command = LuaScriptCommand.request(this.localAddress, sessionId, script);
    const decrypted = await this._request(command);
    if (!decrypted) return null;
    return LuaScriptCommand.parse(sessionId, decrypted);
  }

  // Returns true if CLU is alive and responsive
  async checkAlive() {
    const result = await this.execute(LuaScriptCommand.CHECK_ALIVE);
    if (result === null) return null;
    if (result === 'emergency') return false;
    if (result === 'true' || result === 'false') return result === 'true';
    // CLU returns its serial number as hex
    if (this.device?.serialNumber != null) {
      return hexToNumber(result) === this.device.serialNumber;
    }
    return Boolean(result);
  }

  // Set CLU IP address, returns new address or null on timeout
  async setAddress(newAddress, gatewayAddress) {
    const command = SetIpCommand.request(this.device.serialNumber, newAddress, gatewayAddress);
    const decrypted = await this._request(command);
    if (!decrypted) return null;
    const resp = SetIpCommand.responseFromBuffer(decrypted);
    if (!resp) return null;
    this.device.setAddress(resp.ipAddress);
    return resp.ipAddress;
  }

  // Update CLU cipher key, returns true on success or null on timeout
  async updateCipherKey(newCipherKey) {
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

  // Reset CLU, then poll until alive or timeoutMs expires
  async reset(timeoutMs = 30000) {
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

  async startTFTPdServer() {
    const decrypted = await this._request(StartTFTPdCommand.request());
    if (!decrypted) return null;
    return StartTFTPdCommand.responseFromBuffer(decrypted) ? true : null;
  }

  async stopTFTPdServer() {
    const decrypted = await this._request(StopTFTPdCommand.request());
    if (!decrypted) return null;
    return StopTFTPdCommand.responseFromBuffer(decrypted) ? true : null;
  }

  // Upload local file to CLU via TFTP
  // location: e.g. 'a:\\MAIN.LUA'
  async uploadFile(localPath, location) {
    this._tftpClient ??= new TFTPClient(this.localAddress);
    await this._tftpClient.upload(this.deviceAddress, localPath, location);
  }

  // Download CLU file to local path via TFTP
  // Returns localPath on success, null if file not found
  async downloadFile(location, localPath) {
    this._tftpClient ??= new TFTPClient(this.localAddress);
    try {
      await this._tftpClient.download(this.deviceAddress, location, localPath);
      return localPath;
    } catch (err) {
      if (err.code === 1) return null; // FILE_NOT_FOUND
      throw err;
    }
  }

  // Trigger measurement file generation, returns returnValue or null
  async generateMeasurements(unknown = '0') {
    const sessionId = randomInt(0xFFFFFFFF);
    const command = GenerateMeasurementsCommand.request(this.localAddress, sessionId, unknown);
    const decrypted = await this._request(command);
    if (!decrypted) return null;
    return GenerateMeasurementsCommand.parse(sessionId, decrypted);
  }

  close() {
    super.close();
  }
}
