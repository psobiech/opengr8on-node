import { VirtualObject } from './VirtualObject.js';
import { VirtualCLU } from './VirtualCLU.js';
import { RemoteCLU } from './RemoteCLU.js';
import { Timer } from './Timer.js';
import { Storage } from './Storage.js';
import { HttpRequest } from './HttpRequest.js';
import { HttpListener } from './HttpListener.js';
import { MqttTopic } from './MqttTopic.js';
const LOOP_INTERVAL_MS = 512;
export class VirtualSystem {
    _objectsByName = new Map();
    _virtualClu;
    _options;
    _luaCallFn = null;
    _loopTimer = null;
    _clientReportFns = new Map();
    _lastClientReportMs = 0;
    constructor(options) {
        this._options = options;
        const cluName = options.cluName ?? 'VIRTUAL_CLU';
        this._virtualClu = new VirtualCLU(this, options.rootDirectory, cluName);
        this._objectsByName.set(cluName, this._virtualClu);
    }
    get localAddress() {
        return this._options.localAddress;
    }
    getCipherKeyFor(address) {
        return this._options.cipherKeyProvider?.(address) ?? null;
    }
    getObject(name) {
        return this._objectsByName.get(name) ?? null;
    }
    getVirtualClu() {
        return this._virtualClu;
    }
    setLuaCallFn(fn) {
        this._luaCallFn = fn;
    }
    luaCall(script) {
        if (this._luaCallFn != null) {
            try {
                return this._luaCallFn(script);
            }
            catch (e) {
                console.error('[VirtualSystem] luaCall error:', e);
            }
        }
        return null;
    }
    newObject(index, name, ipAddress) {
        let obj;
        switch (index) {
            case VirtualCLU.INDEX:
                this._virtualClu.name = name;
                // re-register under new name if changed
                for (const [k, v] of this._objectsByName) {
                    if (v === this._virtualClu) {
                        this._objectsByName.delete(k);
                        break;
                    }
                }
                this._objectsByName.set(name, this._virtualClu);
                return;
            case RemoteCLU.INDEX:
                obj = new RemoteCLU(this, name, ipAddress ?? '');
                break;
            case Timer.INDEX:
                obj = new Timer(this, name);
                break;
            case Storage.INDEX:
                obj = new Storage(this, name, `${this._options.rootDirectory}/../storage`);
                break;
            case MqttTopic.INDEX:
                obj = new MqttTopic(this, name);
                break;
            default:
                obj = new VirtualObject(this, name);
                break;
        }
        void ipAddress;
        this._objectsByName.set(name, obj);
    }
    newGate(index, name) {
        let obj;
        switch (index) {
            case HttpRequest.INDEX:
                obj = new HttpRequest(this, name);
                break;
            case HttpListener.INDEX:
                obj = new HttpListener(this, name, this._options.httpListenerPort ?? HttpListener.DEFAULT_PORT, this._options.localAddress);
                break;
            case MqttTopic.INDEX:
                obj = new MqttTopic(this, name);
                break;
            default:
                obj = new VirtualObject(this, name);
                break;
        }
        this._objectsByName.set(name, obj);
    }
    setup() {
        for (const obj of this._objectsByName.values()) {
            try {
                obj.setup();
            }
            catch (e) {
                console.error(`[VirtualSystem] setup error for ${obj.name}:`, e);
            }
        }
    }
    loop() {
        for (const obj of this._objectsByName.values()) {
            try {
                obj.loop();
            }
            catch (e) {
                console.error(`[VirtualSystem] loop error for ${obj.name}:`, e);
            }
        }
        // Drive client-report pushes (works in both setInterval-driven and Lua-loop-driven modes)
        const now = Date.now();
        if (now - this._lastClientReportMs >= 1000) {
            this._lastClientReportMs = now;
            for (const fn of this._clientReportFns.values()) {
                try {
                    fn();
                }
                catch { /* ignore */ }
            }
        }
    }
    /** Start the periodic loop. Call once after setup(). */
    startLoop() {
        if (this._loopTimer != null)
            return;
        this._loopTimer = setInterval(() => this.loop(), LOOP_INTERVAL_MS);
    }
    stopLoop() {
        if (this._loopTimer != null) {
            clearInterval(this._loopTimer);
            this._loopTimer = null;
        }
    }
    fetchValues(subscriptions) {
        const values = subscriptions.map((sub) => {
            const val = sub.object.get(sub.index);
            return luaStringify(val);
        });
        return `{${values.join(',')}}`;
    }
    clientRegister(remoteAddr, addr, port, sessionId, subs) {
        const key = `${addr}:${port}:${sessionId}`;
        const sendValues = () => {
            const valStr = this.fetchValues(subs);
            const response = `clientReport:${sessionId}:${valStr}`;
            this._sendClientReport(addr, port, sessionId, response);
            if (addr !== remoteAddr) {
                this._sendClientReport(remoteAddr, port, sessionId, response);
            }
        };
        this._clientReportFns.set(key, sendValues);
        return `clientReport:${sessionId}:${this.fetchValues(subs)}`;
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _sendClientReport(_addr, _port, _sessionId, _response) {
        // Implemented by Server — override or inject
    }
    setSendClientReportFn(fn) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this._sendClientReport = (_addr, _port, _sessionId, response) => fn(_addr, _port, response);
    }
    clientDestroy(addr, port, sessionId) {
        this._clientReportFns.delete(`${addr}:${port}:${sessionId}`);
        return sessionId;
    }
    close() {
        this.stopLoop();
        this._clientReportFns.clear();
        for (const obj of this._objectsByName.values()) {
            try {
                obj.close();
            }
            catch (e) {
                console.error(`[VirtualSystem] close error for ${obj.name}:`, e);
            }
        }
        this._objectsByName.clear();
    }
}
function luaStringify(value) {
    if (value === null || value === undefined)
        return 'nil';
    if (typeof value === 'boolean')
        return value ? 'true' : 'false';
    if (typeof value === 'number')
        return String(value);
    if (typeof value === 'string')
        return `"${value.replace(/"/g, '\\"')}"`;
    if (Array.isArray(value))
        return `{${value.map(luaStringify).join(',')}}`;
    if (typeof value === 'object') {
        const entries = Object.entries(value)
            .map(([k, v]) => `${k}=${luaStringify(v)}`)
            .join(',');
        return `{${entries}}`;
    }
    return String(value);
}
