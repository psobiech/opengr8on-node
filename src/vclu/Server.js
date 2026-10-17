import dgram from 'node:dgram';
import { randomBytes as nodeRandomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { VirtualSystem } from './VirtualSystem.js';
import { LuaThread } from './LuaThread.js';
import { CLU_STATE } from './VirtualCLU.js';
import { TFTPServer } from './TFTPServer.js';
import { ProjectRegistry } from './ProjectRegistry.js';
// Re-use existing library pieces
// @ts-ignore - JS file in project
import { CipherKey } from '../CipherKey.js';
// @ts-ignore - JS file in project
import { DiscoverCLUsCommand } from '../commands/DiscoverCLUsCommand.js';
// @ts-ignore - JS file in project
import { SetIpCommand } from '../commands/SetIpCommand.js';
// @ts-ignore - JS file in project
import { SetKeyCommand } from '../commands/SetKeyCommand.js';
// @ts-ignore - JS file in project
import { ResetCommand } from '../commands/ResetCommand.js';
// @ts-ignore - JS file in project
import { LuaScriptCommand } from '../commands/LuaScriptCommand.js';
// @ts-ignore - JS file in project
import { StartTFTPdCommand } from '../commands/StartTFTPdCommand.js';
// @ts-ignore - JS file in project
import { StopTFTPdCommand } from '../commands/StopTFTPdCommand.js';
// @ts-ignore - JS file in project
import { GenerateMeasurementsCommand } from '../commands/GenerateMeasurementsCommand.js';
// @ts-ignore - JS file in project
import { ErrorCommand } from '../commands/ErrorCommand.js';
// @ts-ignore - JS file in project
import { COMMAND_PORT } from '../constants.js';
const CLIENT_REGISTER_PREFIX = 'SYSTEM:clientRegister(';
export class Server {
    _opts;
    _vs;
    _projectCipherKey;
    _temporaryIV = null;
    _unicastKeys;
    _broadcastKeys;
    _broadcastSocket = null;
    _commandSocket = null;
    _responseSocket = null;
    _tftpServer = null;
    _registry = ProjectRegistry.empty();
    _luaThread = null;
    _closed = false;
    constructor(opts) {
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
        // Wire up client report sending
        this._vs.setSendClientReportFn((addr, port, response) => {
            void this._sendLuaResponse(addr, port, 0, response);
        });
    }
    get virtualSystem() {
        return this._vs;
    }
    async start() {
        if (this._opts.projectOmpPath) {
            this._registry = await ProjectRegistry.loadFromOmp(this._opts.projectOmpPath);
        }
        await this._startClu();
        await this._bindSockets();
        console.info(`[Server] VCLU listening on ${this._opts.localAddress}:${this._opts.port ?? COMMAND_PORT}`);
    }
    get registry() { return this._registry; }
    async _startClu() {
        // Close previous LuaThread if restarting
        if (this._luaThread != null) {
            this._luaThread.close();
            this._luaThread = null;
        }
        const vsOptions = {
            rootDirectory: this._opts.rootDirectory,
            localAddress: this._opts.localAddress,
            port: this._opts.port,
            cluName: this._opts.cluName,
            httpListenerPort: this._opts.httpListenerPort,
        };
        const aDriveDirectory = resolve(this._opts.rootDirectory, 'a');
        if (this._opts.mainLuaPath != null && existsSync(this._opts.mainLuaPath)) {
            const thread = new LuaThread();
            thread.onClientReport((addr, port, response) => {
                void this._sendLuaResponse(addr, port, 0, response);
            });
            try {
                await thread.start(this._opts.mainLuaPath, false, vsOptions, aDriveDirectory);
                this._luaThread = thread;
                await thread.awaitStarted();
                await this._validateCheckAlive();
            }
            catch (e) {
                console.error('[Server] Failed to start Lua thread, entering emergency mode:', e);
                thread.close();
                this._luaThread = null;
                const emergencyPath = resolve(aDriveDirectory, 'EMERGNCY.LUA');
                const emergencyThread = new LuaThread();
                emergencyThread.onClientReport((addr, port, response) => {
                    void this._sendLuaResponse(addr, port, 0, response);
                });
                try {
                    await emergencyThread.start(emergencyPath, true, vsOptions, aDriveDirectory);
                    this._luaThread = emergencyThread;
                    await emergencyThread.awaitStarted();
                }
                catch (e2) {
                    console.error('[Server] Emergency Lua thread also failed:', e2);
                    this._vs.setup();
                    this._vs.getVirtualClu().setState(CLU_STATE.EMERGENCY);
                    this._vs.startLoop();
                }
            }
        }
        else {
            // No Lua script — JS-only mode, VS runs in main thread
            this._vs.setup();
            this._vs.getVirtualClu().setState(CLU_STATE.OK);
            this._vs.startLoop();
        }
    }
    async _bindSockets() {
        this._broadcastSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        this._commandSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        this._responseSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        await bindSocket(this._broadcastSocket, '0.0.0.0', this._opts.port ?? COMMAND_PORT);
        this._broadcastSocket.setBroadcast(true);
        await bindSocket(this._commandSocket, this._opts.localAddress, this._opts.port ?? COMMAND_PORT);
        await bindSocket(this._responseSocket, this._opts.localAddress, 0);
        this._broadcastSocket.on('message', (msg, rinfo) => this._handleIncoming(msg, rinfo.address, rinfo.port, true));
        this._commandSocket.on('message', (msg, rinfo) => this._handleIncoming(msg, rinfo.address, rinfo.port, false));
    }
    _handleIncoming(encrypted, fromAddress, fromPort, isBroadcast) {
        const keys = isBroadcast ? this._broadcastKeys : this._unicastKeys;
        for (const key of keys) {
            const decrypted = key.decrypt(encrypted);
            if (decrypted == null)
                continue;
            void this._dispatch(decrypted, fromAddress, fromPort, isBroadcast, key);
            return;
        }
    }
    async _dispatch(buf, fromAddr, fromPort, isBroadcast, usedKey) {
        try {
            // DiscoverCLU (broadcast only)
            if (DiscoverCLUsCommand.requestMatches(buf)) {
                const cmd = DiscoverCLUsCommand.requestFromBuffer(buf);
                if (cmd) {
                    const resp = this._onDiscover(cmd);
                    if (resp)
                        this._sendEncrypted(resp.key, resp.cmd.toBuffer(), fromAddr, fromPort);
                    return;
                }
            }
            // SetIP — both broadcast and unicast
            if (SetIpCommand.requestMatches(buf)) {
                const cmd = SetIpCommand.requestFromBuffer(buf);
                if (cmd) {
                    const resp = this._onSetIp(cmd, isBroadcast, usedKey);
                    if (resp)
                        this._sendEncrypted(resp.key, resp.cmd.toBuffer(), fromAddr, fromPort);
                    return;
                }
            }
            if (isBroadcast)
                return; // no further unicast-only commands on broadcast
            // SetKey
            if (SetKeyCommand.requestMatches(buf)) {
                const cmd = SetKeyCommand.requestFromBuffer(buf);
                if (cmd) {
                    const resp = this._onSetKey(cmd, usedKey);
                    if (resp)
                        this._sendEncrypted(resp.key, resp.cmd.toBuffer(), fromAddr, fromPort);
                    return;
                }
            }
            // Reset
            if (ResetCommand.requestMatches(buf)) {
                const cmd = ResetCommand.requestFromBuffer(buf);
                if (cmd) {
                    const resp = this._onReset();
                    if (resp)
                        this._sendEncrypted(resp.key, resp.cmd.toBuffer(), fromAddr, fromPort);
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
                        const resp = GenerateMeasurementsCommand.response(this._opts.localAddress, cmd.sessionId, GenerateMeasurementsCommand.RESPONSE_OK);
                        this._sendEncrypted(this._projectCipherKey, resp.toBuffer(), fromAddr, fromPort);
                        return;
                    }
                }
                if (GenerateMeasurementsCommand.responseMatches(buf)) {
                    const cmd = GenerateMeasurementsCommand.responseFromBuffer(buf);
                    if (cmd) {
                        await this._startTftp();
                        const resp = GenerateMeasurementsCommand.response(this._opts.localAddress, cmd.sessionId, GenerateMeasurementsCommand.RESPONSE_OK);
                        this._sendEncrypted(this._projectCipherKey, resp.toBuffer(), fromAddr, fromPort);
                        return;
                    }
                }
            }
            // Unknown — send error
            this._sendEncrypted(usedKey, ErrorCommand.response().toBuffer(), fromAddr, fromPort);
        }
        catch (e) {
            console.error('[Server] dispatch error:', e);
        }
    }
    _onDiscover(cmd) {
        const decrypted = this._projectCipherKey.decrypt(cmd.encrypted);
        const hash = DiscoverCLUsCommand.hash(decrypted ?? nodeRandomBytes(30));
        const tempKey = this._generateTemporaryKey();
        const responseEncrypted = tempKey.encrypt(hash);
        return {
            key: CipherKey.DEFAULT_BROADCAST.withIV(cmd.iv),
            cmd: DiscoverCLUsCommand.response(responseEncrypted, tempKey.getIV(), this._opts.serialNumber, this._opts.macAddress),
        };
    }
    _generateTemporaryKey() {
        if (this._temporaryIV == null) {
            this._temporaryIV = nodeRandomBytes(16);
        }
        const tempKey = this._projectCipherKey.withIV(this._temporaryIV);
        this._unicastKeys = [tempKey, this._projectCipherKey];
        this._broadcastKeys = [CipherKey.DEFAULT_BROADCAST, tempKey, this._projectCipherKey];
        this._persistKeys();
        return tempKey;
    }
    _onSetIp(cmd, isBroadcast, usedKey) {
        if (cmd.serialNumber === this._opts.serialNumber) {
            if (cmd.ipAddress === this._opts.localAddress) {
                return {
                    key: usedKey,
                    cmd: SetIpCommand.response(this._opts.serialNumber, this._opts.localAddress),
                };
            }
        }
        if (isBroadcast)
            return null;
        return { key: usedKey, cmd: ErrorCommand.response() };
    }
    _onSetKey(cmd, oldKey) {
        const newKey = new CipherKey(cmd.key, cmd.iv);
        this._temporaryIV = null;
        this._projectCipherKey = newKey;
        this._unicastKeys = [newKey];
        this._broadcastKeys = [CipherKey.DEFAULT_BROADCAST, newKey];
        this._persistKeys();
        return { key: oldKey, cmd: SetKeyCommand.response() };
    }
    _onReset() {
        this._unicastKeys = [this._projectCipherKey];
        return { key: this._projectCipherKey, cmd: ResetCommand.response(this._opts.localAddress) };
    }
    async _onLuaScript(cmd, fromAddr, fromPort, usedKey) {
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
    async _luaCall(script) {
        if (this._luaThread != null) {
            return this._luaThread.luaCall(script);
        }
        // Fallback: handle basic built-in scripts without Lua
        if (script.toLowerCase() === 'checkalive()') {
            return this._opts.serialNumber.toString(16).padStart(8, '0');
        }
        return null;
    }
    async _validateCheckAlive() {
        const result = await this._luaCall('checkAlive()');
        if (typeof result !== 'string') {
            throw new Error(`VCLU health check failed: checkAlive() returned ${JSON.stringify(result)}`);
        }
    }
    async _sendLuaResponse(addr, port, sessionId, response) {
        const cmd = LuaScriptCommand.response(this._opts.localAddress, sessionId, response);
        this._sendEncrypted(this._projectCipherKey, cmd.toBuffer(), addr, port);
    }
    _sendEncrypted(key, buf, address, port) {
        if (this._responseSocket == null || this._closed)
            return;
        const encrypted = key.encrypt(buf);
        this._responseSocket.send(encrypted, port, address, (err) => {
            if (err)
                console.error('[Server] send error:', err);
        });
    }
    _persistKeys() {
        try {
            // keys.json lives one level above rootDirectory (i.e., in runtimeDirectory)
            const dir = resolve(this._opts.rootDirectory, '..');
            mkdirSync(dir, { recursive: true });
            const keysPath = resolve(dir, 'keys.json');
            const data = {
                key: this._projectCipherKey.getSecretKey().toString('base64'),
                iv: this._projectCipherKey.getIV().toString('base64'),
                defaultIV: (this._opts.deviceIV ?? this._projectCipherKey.getIV()).toString('base64'),
                pin: (this._opts.pin ?? Buffer.alloc(0)).toString('base64'),
            };
            writeFileSync(keysPath, JSON.stringify(data), 'utf8');
        }
        catch (e) {
            console.error('[Server] persist keys error:', e);
        }
    }
    /** Load persisted keys from disk (optional, call before start()). */
    static loadKeys(keysPath) {
        if (!existsSync(keysPath))
            return {};
        try {
            const data = JSON.parse(readFileSync(keysPath, 'utf8'));
            const result = {};
            // Support both Java format (key/iv) and legacy Node format (projectKey/projectIV)
            const k = data.key ?? data.projectKey;
            const iv = data.iv ?? data.projectIV;
            if (k)
                result.projectKey = Buffer.from(k, 'base64');
            if (iv)
                result.projectIV = Buffer.from(iv, 'base64');
            return result;
        }
        catch {
            return {};
        }
    }
    async _startTftp() {
        if (this._tftpServer != null)
            return;
        this._tftpServer = new TFTPServer(this._opts.rootDirectory);
        try {
            await this._tftpServer.start();
            console.info(`[Server] TFTP server started on port ${this._tftpServer.port}`);
        }
        catch (e) {
            console.error('[Server] TFTP start error:', e);
            this._tftpServer = null;
        }
    }
    _stopTftp() {
        this._tftpServer?.stop();
        this._tftpServer = null;
    }
    close() {
        this._closed = true;
        this._stopTftp();
        this._vs.close();
        this._luaThread?.close();
        this._broadcastSocket?.close();
        this._commandSocket?.close();
        this._responseSocket?.close();
    }
}
function bindSocket(socket, address, port) {
    return new Promise((resolve, reject) => {
        socket.once('error', reject);
        socket.bind({ address, port }, () => {
            socket.removeListener('error', reject);
            resolve();
        });
    });
}
