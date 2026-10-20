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
    _onClientReport = null;
    _emergency = false;
    // Serialise concurrent luaCall invocations — only one SAB slot available
    _callQueue = Promise.resolve();
    _pendingCallCount = 0;
    static MAX_PENDING_CALLS = 250;
    static CALL_TIMEOUT_MS = 4_000;
    constructor() {
        this._sab = new SharedArrayBuffer(SAB_SIZE);
        this._i32 = new Int32Array(this._sab);
        this._u8 = new Uint8Array(this._sab);
    }
    get isEmergency() { return this._emergency; }
    start(scriptPath, emergency, vsOptions, aDriveDirectory, timeoutMs = 30_000) {
        this._emergency = emergency;
        // cipherKeyProvider is a function — cannot be transferred to a Worker.
        const { cipherKeyProvider: _, ...transferableOpts } = vsOptions;
        return new Promise((resolve, reject) => {
            let settled = false;
            const settle = (err) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timer);
                if (err != null)
                    reject(err);
                else
                    resolve();
            };
            const timer = setTimeout(() => settle(new Error('VirtualSystem did not start in time')), timeoutMs);
            this._worker = new Worker(WORKER_SCRIPT, {
                workerData: { vsOptions: transferableOpts, scriptPath, emergency, sab: this._sab, aDriveDirectory },
            });
            const handlers = {
                started: () => settle(),
                clientReport: (msg) => this._onClientReport?.(msg.addr, msg.port, msg.sessionId, msg.response),
                error: (msg) => settle(new Error(msg.message)),
                scriptError: (msg) => settle(new Error(msg.message)),
            };
            this._worker.on('message', (msg) => handlers[msg.type](msg));
            this._worker.on('error', (e) => settle(e));
        });
    }
    onClientReport(fn) {
        this._onClientReport = fn;
    }
    /** Execute a Lua expression and return its result. Thread-safe via internal queue. */
    luaCall(script) {
        if (this._pendingCallCount >= LuaThread.MAX_PENDING_CALLS) {
            return Promise.reject(new Error('luaCall queue full'));
        }
        this._pendingCallCount++;
        // _callQueue serializes SAB writes: only one call can use the shared buffer at a time.
        // We keep tracking the underlying execution even when a caller times out, so the SAB
        // state stays clean for the next call.
        const execution = this._callQueue.then(() => this._doLuaCall(script));
        this._callQueue = execution.catch(() => undefined);
        // Race the execution against a timeout. The `done` flag prevents double-settlement
        // if execution completes right as the timer fires.
        return new Promise((resolve, reject) => {
            let done = false;
            const finish = (err, value) => {
                if (done)
                    return;
                done = true;
                clearTimeout(timer);
                this._pendingCallCount--;
                if (err != null)
                    reject(err);
                else
                    resolve(value);
            };
            const timer = setTimeout(() => finish(new Error('luaCall timeout')), LuaThread.CALL_TIMEOUT_MS);
            execution.then((v) => finish(null, v), (e) => finish(e));
        });
    }
    async _doLuaCall(script) {
        if (this._worker == null)
            return null;
        // Write script to shared buffer and signal the worker.
        const sb = Buffer.from(script, 'utf8');
        this._u8.set(sb, SCRIPT_OFFSET);
        Atomics.store(this._i32, 1, sb.length);
        Atomics.store(this._i32, 0, STATE_PENDING); // signal: script is ready
        Atomics.notify(this._i32, 0, 1); // wake worker's Atomics.wait
        // Wait for the worker to write STATE_RESULT.
        const waiter = Atomics.waitAsync(this._i32, 0, STATE_PENDING);
        if (waiter.async)
            await waiter.value;
        // Read result and release the buffer back to IDLE.
        const resultLen = Atomics.load(this._i32, 2);
        const result = Buffer.from(this._sab, RESULT_OFFSET, resultLen).toString('utf8');
        Atomics.store(this._i32, 0, STATE_IDLE);
        Atomics.notify(this._i32, 0, 1); // wake worker's Atomics.wait(STATE_RESULT)
        return result === 'nil' ? null : result;
    }
    close() {
        void this._worker?.terminate();
        this._worker = null;
    }
}
