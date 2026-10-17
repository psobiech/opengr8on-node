import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
// SAB constants (must match LuaWorker.ts)
const SAB_SIZE = 12 + 65536 + 65536;
const SCRIPT_OFFSET = 12;
const RESULT_OFFSET = 12 + 65536;
const STATE_IDLE = 0;
const STATE_PENDING = 1;
const WORKER_SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), 'LuaWorker.js');
export class LuaThread {
    _worker = null;
    _sab;
    _i32;
    _u8;
    _startedResolve = null;
    _startedReject = null;
    _onClientReport = null;
    _emergency = false;
    // Serialise concurrent luaCall invocations — only one SAB slot available
    _callQueue = Promise.resolve();
    constructor() {
        this._sab = new SharedArrayBuffer(SAB_SIZE);
        this._i32 = new Int32Array(this._sab);
        this._u8 = new Uint8Array(this._sab);
    }
    get isEmergency() { return this._emergency; }
    async start(scriptPath, emergency, vsOptions, aDriveDirectory) {
        this._emergency = emergency;
        // cipherKeyProvider is a function — cannot be transferred to a Worker.
        // Drop it; the Worker VS uses null keys (RemoteCLU comms not needed in VCLU mode).
        const { cipherKeyProvider: _, ...transferableOpts } = vsOptions;
        this._worker = new Worker(WORKER_SCRIPT, {
            workerData: {
                vsOptions: transferableOpts,
                scriptPath,
                emergency,
                sab: this._sab,
                aDriveDirectory,
            },
        });
        this._worker.on('message', (msg) => {
            switch (msg.type) {
                case 'started':
                    this._startedResolve?.();
                    this._startedResolve = null;
                    this._startedReject = null;
                    break;
                case 'clientReport':
                    this._onClientReport?.(msg.addr, msg.port, msg.response);
                    break;
                case 'error':
                case 'scriptError':
                    this._startedReject?.(new Error(msg.message ?? 'LuaWorker error'));
                    this._startedResolve = null;
                    this._startedReject = null;
                    break;
            }
        });
        this._worker.on('error', (e) => {
            this._startedReject?.(e);
            this._startedResolve = null;
            this._startedReject = null;
        });
    }
    onClientReport(fn) {
        this._onClientReport = fn;
    }
    awaitStarted(timeoutMs = 30_000) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this._startedResolve = null;
                this._startedReject = null;
                reject(new Error('VirtualSystem did not start in time'));
            }, timeoutMs);
            this._startedResolve = () => { clearTimeout(timer); resolve(); };
            this._startedReject = (e) => { clearTimeout(timer); reject(e); };
        });
    }
    /** Execute a Lua expression and return its result. Thread-safe via internal queue. */
    luaCall(script) {
        const result = this._callQueue.then(() => this._doLuaCall(script));
        this._callQueue = result.catch(() => undefined);
        return result;
    }
    async _doLuaCall(script) {
        if (this._worker == null)
            return null;
        const sb = Buffer.from(script, 'utf8');
        this._u8.set(sb, SCRIPT_OFFSET);
        Atomics.store(this._i32, 1, sb.length);
        Atomics.store(this._i32, 0, STATE_PENDING);
        Atomics.notify(this._i32, 0, 1);
        const waiter = Atomics.waitAsync(this._i32, 0, STATE_PENDING);
        if (waiter.async)
            await waiter.value;
        const resultLen = Atomics.load(this._i32, 2);
        const result = Buffer.from(this._sab, RESULT_OFFSET, resultLen).toString('utf8');
        Atomics.store(this._i32, 0, STATE_IDLE);
        return result === 'nil' ? null : result;
    }
    close() {
        void this._worker?.terminate();
        this._worker = null;
    }
}
