import { VirtualObject } from './VirtualObject.js';
// @ts-ignore - JS file in project
import { CLUClient } from '../CLUClient.js';
export const REMOTE_CLU_METHODS = {
    EXECUTE: 0,
};
/**
 * Proxy for a remote CLU. Forwards get/set/execute calls as LuaScript commands
 * over UDP to the remote CLU at the configured address.
 *
 * Created when Lua calls OBJECT:new(1, ipAddress, name).
 */
export class RemoteCLU extends VirtualObject {
    static INDEX = 1;
    static METHODS = REMOTE_CLU_METHODS;
    _remoteAddress;
    _client = null;
    constructor(virtualSystem, name, remoteAddress) {
        super(virtualSystem, name);
        this._remoteAddress = remoteAddress;
    }
    _getClient() {
        if (this._client != null)
            return this._client;
        const vs = this.virtualSystem;
        if (vs == null)
            return null;
        const localAddress = vs.localAddress;
        if (!localAddress)
            return null;
        const cipherKey = vs.getCipherKeyFor(this._remoteAddress);
        if (cipherKey == null)
            return null;
        const device = { address: this._remoteAddress };
        this._client = new CLUClient(localAddress, device, cipherKey);
        return this._client;
    }
    async remoteExecute(script) {
        const client = this._getClient();
        if (client == null)
            return null;
        try {
            return await client.execute(script);
        }
        catch (e) {
            console.error(`[${this.name}] remote execute error:`, e.message);
            return null;
        }
    }
    remoteSet(objectName, featureIndex, value) {
        const v = luaLiteral(value);
        void this.remoteExecute(`${objectName}:set(${featureIndex}, ${v})`);
    }
    async remoteGet(objectName, featureIndex) {
        const result = await this.remoteExecute(`${objectName}:get(${featureIndex})`);
        return parseRemoteResult(result);
    }
    remoteMethod(objectName, methodIndex, ...args) {
        const argStr = args.map(luaLiteral).join(', ');
        const script = args.length > 0
            ? `${objectName}:execute(${methodIndex}, ${argStr})`
            : `${objectName}:execute(${methodIndex})`;
        void this.remoteExecute(script);
    }
    /** Proxy set: forwards to remote object with same name as this RemoteCLU. */
    set(index, value) {
        this.remoteSet(this.name, index, value);
    }
    /** Proxy execute: forwards method call to remote object. */
    execute(index, ...args) {
        this.remoteMethod(this.name, index, ...args);
        return null;
    }
    close() {
        if (this._client != null) {
            try {
                this._client.close();
            }
            catch { /* ignore */ }
            this._client = null;
        }
    }
}
function luaLiteral(value) {
    if (value === null || value === undefined)
        return 'nil';
    if (typeof value === 'boolean')
        return value ? 'true' : 'false';
    if (typeof value === 'number')
        return String(value);
    if (typeof value === 'string')
        return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    if (Array.isArray(value))
        return `{${value.map(luaLiteral).join(',')}}`;
    return JSON.stringify(value);
}
function parseRemoteResult(raw) {
    if (raw === null || raw === 'nil')
        return null;
    if (raw === 'true')
        return true;
    if (raw === 'false')
        return false;
    const n = Number(raw);
    if (!isNaN(n) && raw.trim() !== '')
        return n;
    // strip surrounding quotes if present
    if (raw.startsWith('"') && raw.endsWith('"'))
        return raw.slice(1, -1);
    return raw;
}
