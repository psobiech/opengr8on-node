import dgram from 'node:dgram';
import { randomBytes as nodeRandomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { VirtualSystem } from './VirtualSystem.js';
import { LuaThread } from './LuaThread.js';
import { CLU_STATE } from './VirtualCLU.js';
import { TFTPServer } from './TFTPServer.js';
import { ProjectRegistry } from './ProjectRegistry.js';

import { CipherKey } from '../CipherKey.js';
import { DiscoverCLUsCommand, hash as discoverHash } from '../commands/DiscoverCLUsCommand.js';
import { SetIpCommand } from '../commands/SetIpCommand.js';
import { SetKeyCommand } from '../commands/SetKeyCommand.js';
import { ResetCommand } from '../commands/ResetCommand.js';
import { LuaScriptCommand } from '../commands/LuaScriptCommand.js';
import { StartTFTPdCommand } from '../commands/StartTFTPdCommand.js';
import { StopTFTPdCommand } from '../commands/StopTFTPdCommand.js';
import { GenerateMeasurementsCommand, RESPONSE_OK } from '../commands/GenerateMeasurementsCommand.js';
import { ErrorCommand } from '../commands/ErrorCommand.js';
import { COMMAND_PORT } from '../constants.js';

const CLIENT_REGISTER_PREFIX = 'SYSTEM:clientRegister(';

export interface ServerOptions {
  rootDirectory: string;
  localAddress: string;
  port?: number;
  serialNumber: number;
  macAddress: string;
  projectKey: Buffer;
  projectIV: Buffer;
  deviceIV?: Buffer;
  pin?: Buffer;
  privateKey?: Buffer;
  /** Path to MAIN.LUA. If provided, Lua execution is enabled via wasmoon. */
  mainLuaPath?: string;
  /** Override CLU name in VirtualSystem. */
  cluName?: string;
  httpListenerPort?: number;
  /** Path to project.omp or system.xml for ProjectRegistry. */
  projectOmpPath?: string;
}

export class Server {
  private readonly _opts: ServerOptions;
  private readonly _vs: VirtualSystem;
  private _projectCipherKey: InstanceType<typeof CipherKey>;
  private _temporaryIV: Buffer | null = null;
  private _unicastKeys: InstanceType<typeof CipherKey>[];
  private _broadcastKeys: InstanceType<typeof CipherKey>[];

  private _broadcastSocket: dgram.Socket | null = null;
  private _commandSocket: dgram.Socket | null = null;
  private _responseSocket: dgram.Socket | null = null;
  private _tftpServer: TFTPServer | null = null;
  private _registry: ProjectRegistry = ProjectRegistry.empty();

  private _luaThread: LuaThread | null = null;
  private _closed = false;

  constructor(opts: ServerOptions) {
    this._opts = opts;
    this._projectCipherKey = new CipherKey(opts.projectKey, opts.projectIV);
    this._unicastKeys = [this._projectCipherKey];
    this._broadcastKeys = [CipherKey.DEFAULT_BROADCAST, this._projectCipherKey];

    this._vs = new VirtualSystem({
      rootDirectory: opts.rootDirectory,
      localAddress: opts.localAddress,
      port: opts.port ?? COMMAND_PORT,
      cluName: opts.cluName,
      httpListenerPort: opts.httpListenerPort,
      cipherKeyProvider: () => this._projectCipherKey,
    });

  }

  get virtualSystem(): VirtualSystem {
    return this._vs;
  }

  async start(): Promise<void> {
    if (this._opts.projectOmpPath) {
      this._registry = await ProjectRegistry.loadFromOmp(this._opts.projectOmpPath);
    }
    await this._startClu();
    await this._bindSockets();
    console.info(
      `[Server] VCLU listening on ${this._opts.localAddress}:${this._opts.port ?? COMMAND_PORT}`,
    );
  }

  get registry(): ProjectRegistry { return this._registry; }

  private async _startClu(): Promise<void> {
    // Close previous LuaThread if restarting
    if (this._luaThread != null) {
      this._luaThread.close();
      this._luaThread = null;
    }

    const runtimeDir = resolve(this._opts.rootDirectory, '..');
    const zipPath = resolve(runtimeDir, 'device-interfaces.zip');
    const dirPath = resolve(runtimeDir, 'device-interfaces');
    const interfaceRegistryPath = existsSync(zipPath) ? zipPath
      : existsSync(dirPath) ? dirPath
      : undefined;

    const vsOptions = {
      rootDirectory:         this._opts.rootDirectory,
      localAddress:          this._opts.localAddress,
      port:                  this._opts.port,
      cluName:               this._opts.cluName,
      httpListenerPort:      this._opts.httpListenerPort,
      interfaceRegistryPath,
      projectOmpPath:        this._opts.projectOmpPath,
    };
    const aDriveDirectory = resolve(this._opts.rootDirectory, 'a');

    if (this._opts.mainLuaPath != null && existsSync(this._opts.mainLuaPath)) {
      const thread = new LuaThread();
      thread.onClientReport((addr, port, sessionId, response) => {
        void this._sendLuaResponse(addr, port, sessionId, response);
      });
      try {
        await thread.start(this._opts.mainLuaPath, false, vsOptions, aDriveDirectory);
        this._luaThread = thread;
        await this._validateCheckAlive();
      } catch (e) {
        console.error('[Server] Failed to start Lua thread, entering emergency mode:', e);
        thread.close();
        this._luaThread = null;

        const emergencyPath = resolve(aDriveDirectory, 'EMERGNCY.LUA');
        const emergencyThread = new LuaThread();
        emergencyThread.onClientReport((addr, port, sessionId, response) => {
          void this._sendLuaResponse(addr, port, sessionId, response);
        });
        try {
          await emergencyThread.start(emergencyPath, true, vsOptions, aDriveDirectory);
          this._luaThread = emergencyThread;
          console.warn('[Server] Emergency mode active — CLU state may not be OK');
        } catch (e2) {
          console.error('[Server] Emergency Lua thread also failed:', e2);
          this._vs.setup();
          this._vs.getVirtualClu().setState(CLU_STATE.EMERGENCY);
          this._vs.startLoop();
        }
      }
    } else {
      throw new Error('[Server] MAIN.LUA not found — cannot start VCLU without a Lua script');
    }
  }

  private async _bindSockets(): Promise<void> {
    this._broadcastSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this._commandSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this._responseSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    await bindSocket(this._broadcastSocket, '0.0.0.0', this._opts.port ?? COMMAND_PORT);
    this._broadcastSocket.setBroadcast(true);

    await bindSocket(this._commandSocket, this._opts.localAddress, this._opts.port ?? COMMAND_PORT);

    await bindSocket(this._responseSocket, this._opts.localAddress, 0);

    this._broadcastSocket.on('message', (msg, rinfo) =>
      this._handleIncoming(msg, rinfo.address, rinfo.port, true),
    );
    this._commandSocket.on('message', (msg, rinfo) =>
      this._handleIncoming(msg, rinfo.address, rinfo.port, false),
    );
  }

  private _handleIncoming(
    encrypted: Buffer,
    fromAddress: string,
    fromPort: number,
    isBroadcast: boolean,
  ): void {
    const keys = isBroadcast ? this._broadcastKeys : this._unicastKeys;

    for (const key of keys) {
      const decrypted: Buffer | null = key.decrypt(encrypted);
      if (decrypted == null) continue;

      void this._dispatch(decrypted, fromAddress, fromPort, isBroadcast, key);
      return;
    }
  }

  private async _dispatch(
    buf: Buffer,
    fromAddr: string,
    fromPort: number,
    isBroadcast: boolean,
    usedKey: InstanceType<typeof CipherKey>,
  ): Promise<void> {
    try {
      // DiscoverCLU (broadcast only)
      if (DiscoverCLUsCommand.requestMatches(buf)) {
        const cmd = DiscoverCLUsCommand.requestFromBuffer(buf);
        if (cmd) {
          const resp = this._onDiscover(cmd);
          if (resp) this._sendEncrypted(resp.key, resp.cmd.toBuffer(), fromAddr, fromPort);
          return;
        }
      }

      // SetIP — both broadcast and unicast
      if (SetIpCommand.requestMatches(buf)) {
        const cmd = SetIpCommand.requestFromBuffer(buf);
        if (cmd) {
          const resp = this._onSetIp(cmd, isBroadcast, usedKey);
          if (resp) this._sendEncrypted(resp.key, resp.cmd.toBuffer(), fromAddr, fromPort);
          return;
        }
      }

      if (isBroadcast) return; // no further unicast-only commands on broadcast

      // SetKey
      if (SetKeyCommand.requestMatches(buf)) {
        const cmd = SetKeyCommand.requestFromBuffer(buf);
        if (cmd) {
          const resp = this._onSetKey(cmd, usedKey);
          if (resp) this._sendEncrypted(resp.key, resp.cmd.toBuffer(), fromAddr, fromPort);
          return;
        }
      }

      // Reset
      if (ResetCommand.requestMatches(buf)) {
        const cmd = ResetCommand.requestFromBuffer(buf);
        if (cmd) {
          const resp = this._onReset();
          if (resp) this._sendEncrypted(resp.key, resp.cmd.toBuffer(), fromAddr, fromPort);
          void this._startClu();
          return;
        }
      }

      // LuaScript
      if (LuaScriptCommand.requestMatches(buf)) {
        const cmd = LuaScriptCommand.requestFromBuffer(buf);
        if (cmd) {
          await this._onLuaScript(cmd, fromAddr, fromPort, usedKey);
          return;
        }
      }

      // TFTP / Measurements — only with project key
      if (usedKey === this._projectCipherKey) {
        if (StartTFTPdCommand.requestMatches(buf)) {
          await this._startTftp();
          this._sendEncrypted(usedKey, StartTFTPdCommand.response().toBuffer(), fromAddr, fromPort);
          return;
        }
        if (StopTFTPdCommand.requestMatches(buf)) {
          this._stopTftp();
          this._sendEncrypted(usedKey, StopTFTPdCommand.response().toBuffer(), fromAddr, fromPort);
          return;
        }
        if (GenerateMeasurementsCommand.requestMatches(buf)) {
          const cmd = GenerateMeasurementsCommand.requestFromBuffer(buf);
          if (cmd) {
            await this._startTftp();
            const resp = GenerateMeasurementsCommand.response(
              this._opts.localAddress,
              cmd.sessionId,
              RESPONSE_OK,
            );
            this._sendEncrypted(this._projectCipherKey, resp.toBuffer(), fromAddr, fromPort);
            return;
          }
        }
        if (GenerateMeasurementsCommand.responseMatches(buf)) {
          const cmd = GenerateMeasurementsCommand.responseFromBuffer(buf);
          if (cmd) {
            await this._startTftp();
            const resp = GenerateMeasurementsCommand.response(
              this._opts.localAddress,
              cmd.sessionId,
              RESPONSE_OK,
            );
            this._sendEncrypted(this._projectCipherKey, resp.toBuffer(), fromAddr, fromPort);
            return;
          }
        }
      }

      // Unknown — send error
      this._sendEncrypted(usedKey, ErrorCommand.response().toBuffer(), fromAddr, fromPort);
    } catch (e) {
      console.error('[Server] dispatch error:', e);
    }
  }

  private _onDiscover(cmd: { encrypted: Buffer; iv: Buffer }) {
    const decrypted = this._projectCipherKey.decrypt(cmd.encrypted);
    const hash = discoverHash(decrypted ?? nodeRandomBytes(30));
    const tempKey = this._generateTemporaryKey();
    const responseEncrypted = tempKey.encrypt(hash);

    return {
      key: CipherKey.DEFAULT_BROADCAST.withIV(cmd.iv),
      cmd: DiscoverCLUsCommand.response(
        responseEncrypted,
        tempKey.getIV(),
        this._opts.serialNumber,
        this._opts.macAddress,
      ),
    };
  }

  private _generateTemporaryKey(): InstanceType<typeof CipherKey> {
    if (this._temporaryIV == null) {
      this._temporaryIV = nodeRandomBytes(16);
    }
    const tempKey = this._projectCipherKey.withIV(this._temporaryIV);
    this._unicastKeys = [tempKey, this._projectCipherKey];
    this._broadcastKeys = [CipherKey.DEFAULT_BROADCAST, tempKey, this._projectCipherKey];
    this._persistKeys();
    return tempKey;
  }

  private _onSetIp(
    cmd: { serialNumber: number; ipAddress: string },
    isBroadcast: boolean,
    usedKey: InstanceType<typeof CipherKey>,
  ) {
    if (cmd.serialNumber === this._opts.serialNumber) {
      if (cmd.ipAddress === this._opts.localAddress) {
        return {
          key: usedKey,
          cmd: SetIpCommand.response(this._opts.serialNumber, this._opts.localAddress),
        };
      }
    }
    if (isBroadcast) return null;
    return { key: usedKey, cmd: ErrorCommand.response() };
  }

  private _onSetKey(
    cmd: { key: Buffer; iv: Buffer },
    oldKey: InstanceType<typeof CipherKey>,
  ) {
    const newKey = new CipherKey(cmd.key, cmd.iv);
    this._temporaryIV = null;
    this._projectCipherKey = newKey;
    this._unicastKeys = [newKey];
    this._broadcastKeys = [CipherKey.DEFAULT_BROADCAST, newKey];
    this._persistKeys();
    return { key: oldKey, cmd: SetKeyCommand.response() };
  }

  private _onReset() {
    this._unicastKeys = [this._projectCipherKey];
    return { key: this._projectCipherKey, cmd: ResetCommand.response(this._opts.localAddress) };
  }

  private async _onLuaScript(
    cmd: { script: string; sessionId: number; ipAddress: string },
    fromAddr: string,
    fromPort: number,
    usedKey: InstanceType<typeof CipherKey>,
  ): Promise<void> {
    let script = cmd.script;

    // Only allow checkAlive() for non-project keys
    if (usedKey !== this._projectCipherKey && usedKey !== this._unicastKeys[0]) {
      if (script.toLowerCase() !== 'checkalive()') {
        this._sendEncrypted(usedKey, ErrorCommand.response().toBuffer(), fromAddr, fromPort);
        return;
      }
    }

    // Inject real source address for clientRegister
    if (script.startsWith(CLIENT_REGISTER_PREFIX)) {
      script = `${CLIENT_REGISTER_PREFIX}"${fromAddr}", ${script.slice(CLIENT_REGISTER_PREFIX.length)}`;
    }

    const result = await this._luaCall(script);
    const returnStr = result == null ? 'nil' : String(result);

    const response = LuaScriptCommand.response(this._opts.localAddress, cmd.sessionId, returnStr);
    this._sendEncrypted(usedKey, response.toBuffer(), fromAddr, fromPort);
  }

  private async _luaCall(script: string): Promise<unknown> {
    if (this._luaThread != null) {
      return this._luaThread.luaCall(script);
    }
    // Fallback: handle basic built-in scripts without Lua
    if (script.toLowerCase() === 'checkalive()') {
      return this._opts.serialNumber.toString(16).padStart(8, '0');
    }
    return null;
  }

  private async _validateCheckAlive(): Promise<void> {
    const result = await this._luaCall('checkAlive()');
    if (typeof result !== 'string') {
      throw new Error(`VCLU health check failed: checkAlive() returned ${JSON.stringify(result)}`);
    }
  }

  private async _sendLuaResponse(
    addr: string,
    port: number,
    sessionId: number,
    response: string,
  ): Promise<void> {
    const cmd = LuaScriptCommand.response(this._opts.localAddress, sessionId, response);
    this._sendEncrypted(this._projectCipherKey, cmd.toBuffer(), addr, port);
  }

  private _sendEncrypted(
    key: InstanceType<typeof CipherKey>,
    buf: Buffer,
    address: string,
    port: number,
  ): void {
    if (this._responseSocket == null || this._closed) return;
    const encrypted: Buffer = key.encrypt(buf);
    this._responseSocket.send(encrypted, port, address, (err) => {
      if (err) console.error('[Server] send error:', err);
    });
  }

  private _persistKeys(): void {
    try {
      // keys.json lives one level above rootDirectory (i.e., in runtimeDirectory)
      const dir = resolve(this._opts.rootDirectory, '..');
      mkdirSync(dir, { recursive: true });
      const keysPath = resolve(dir, 'keys.json');
      const data = {
        key:       this._projectCipherKey.getSecretKey().toString('base64'),
        iv:        this._projectCipherKey.getIV().toString('base64'),
        defaultIV: (this._opts.deviceIV ?? this._projectCipherKey.getIV()).toString('base64'),
        pin:       (this._opts.pin ?? Buffer.alloc(0)).toString('base64'),
      };
      writeFileSync(keysPath, JSON.stringify(data), 'utf8');
    } catch (e) {
      console.error('[Server] persist keys error:', e);
    }
  }

  /** Load persisted keys from disk (optional, call before start()). */
  static loadKeys(keysPath: string): Partial<Pick<ServerOptions, 'projectKey' | 'projectIV'>> {
    if (!existsSync(keysPath)) return {};
    try {
      const data = JSON.parse(readFileSync(keysPath, 'utf8')) as {
        key?: string; iv?: string;
        projectKey?: string; projectIV?: string;
      };
      const result: Partial<Pick<ServerOptions, 'projectKey' | 'projectIV'>> = {};
      // Support both Java format (key/iv) and legacy Node format (projectKey/projectIV)
      const k = data.key ?? data.projectKey;
      const iv = data.iv ?? data.projectIV;
      if (k)  result.projectKey = Buffer.from(k,  'base64');
      if (iv) result.projectIV  = Buffer.from(iv, 'base64');
      return result;
    } catch {
      return {};
    }
  }

  private async _startTftp(): Promise<void> {
    if (this._tftpServer != null) return;
    this._tftpServer = new TFTPServer(this._opts.rootDirectory);
    try {
      await this._tftpServer.start();
      console.info(`[Server] TFTP server started on port ${this._tftpServer.port}`);
    } catch (e) {
      console.error('[Server] TFTP start error:', e);
      this._tftpServer = null;
    }
  }

  private _stopTftp(): void {
    this._tftpServer?.stop();
    this._tftpServer = null;
  }

  close(): void {
    this._closed = true;
    this._stopTftp();
    this._vs.close();
    this._luaThread?.close();
    this._broadcastSocket?.close();
    this._commandSocket?.close();
    this._responseSocket?.close();
  }
}

function bindSocket(socket: dgram.Socket, address: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.bind({ address, port }, () => {
      socket.removeListener('error', reject);
      resolve();
    });
  });
}
