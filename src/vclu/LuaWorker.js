/**
 * Worker thread that hosts the wasmoon Lua engine + VirtualSystem.
 * Spawned by LuaThread. Communicates with the main thread via:
 *   - SharedArrayBuffer (SAB) for synchronous luaCall requests/responses
 *   - postMessage for async notifications (clientReport, started, error)
 *
 * SAB layout (131084 bytes):
 *   [0]        Int32  state: 0=idle, 1=pending, 2=result
 *   [1]        Int32  script byte length
 *   [2]        Int32  result byte length
 *   [12..65547]  Uint8  script bytes  (max 65536)
 *   [65548..131083] Uint8  result bytes  (max 65536)
 */
import { workerData, parentPort } from 'node:worker_threads';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { VirtualSystem } from './VirtualSystem.js';
const SCRIPT_OFFSET = 12;
const RESULT_OFFSET = 12 + 65536;
const STATE_IDLE = 0;
const STATE_PENDING = 1;
const STATE_RESULT = 2;
const { vsOptions, scriptPath, sab, aDriveDirectory, } = workerData;
const i32 = new Int32Array(sab);
const u8 = new Uint8Array(sab);
// ── VirtualSystem ─────────────────────────────────────────────────────────────
const vs = new VirtualSystem(vsOptions);
vs.setSendClientReportFn((addr, port, response) => {
    parentPort.postMessage({ type: 'clientReport', addr, port, response });
});
// ── wasmoon ───────────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let engine;
try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = await import('wasmoon');
    const LuaFactory = mod.LuaFactory ?? mod.default?.LuaFactory;
    engine = await new LuaFactory().createEngine();
}
catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    parentPort.postMessage({ type: 'error', message: `wasmoon unavailable: ${msg}` });
    process.exit(1);
}
// ── Mount .LUA files into wasmoon's virtual FS ────────────────────────────────
// MAIN.LUA does `require "user"` / `require "om"` — standard Lua looks for
// lowercase filenames, so mount each file as its lowercase equivalent.
try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const FS = engine.cmodule.module.FS;
    FS.mkdir('/lua');
    if (existsSync(aDriveDirectory)) {
        for (const file of readdirSync(aDriveDirectory)) {
            if (file.toUpperCase().endsWith('.LUA')) {
                const content = readFileSync(resolve(aDriveDirectory, file), 'utf8');
                FS.writeFile(`/lua/${file.toLowerCase()}`, content);
            }
        }
    }
}
catch (e) {
    console.error('[LuaWorker] FS mount error:', e);
}
// ── Globals: luaCall ──────────────────────────────────────────────────────────
vs.setLuaCallFn((script) => {
    try {
        return engine.doStringSync(`return ${script}`);
    }
    catch {
        return null;
    }
});
// ── SAB luaCall handler ───────────────────────────────────────────────────────
function handlePendingCall() {
    if (Atomics.load(i32, 0) !== STATE_PENDING)
        return;
    const len = Atomics.load(i32, 1);
    const script = Buffer.from(sab, SCRIPT_OFFSET, len).toString('utf8');
    let result = 'nil';
    try {
        const r = engine.doStringSync(`return ${script}`);
        result = r == null ? 'nil' : String(r);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[LuaWorker] luaCall error:', msg);
    }
    const rb = Buffer.from(result, 'utf8');
    u8.set(rb, RESULT_OFFSET);
    Atomics.store(i32, 2, rb.length);
    Atomics.store(i32, 0, STATE_RESULT);
    Atomics.notify(i32, 0, 1);
}
// ── Lua subscription helper ───────────────────────────────────────────────────
function parseSubs(subs) {
    if (!subs || typeof subs !== 'object')
        return [];
    const result = [];
    for (const entry of Object.values(subs)) {
        if (!entry || typeof entry !== 'object')
            continue;
        const arr = Object.values(entry);
        const ref = arr[0];
        const index = arr[1];
        if (ref?.name == null || index == null)
            continue;
        const obj = vs.getObject(ref.name);
        if (obj == null)
            continue;
        result.push({ object: obj, index: Number(index) });
    }
    return result;
}
// ── OBJECT / GATE prototypes ──────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const OBJECT_PROTO = {
    new: (_s, idx, ipOrName, name) => {
        const n = name !== undefined ? String(name) : String(ipOrName);
        const ip = name !== undefined ? String(ipOrName) : null;
        vs.newObject(idx, n, ip);
        return { name: n, _prototype: OBJECT_PROTO };
    },
    get: (s, idx) => vs.getObject(s.name)?.get(idx) ?? null,
    set: (s, idx, v) => { vs.getObject(s.name)?.set(idx, v); },
    execute: (s, idx, ...a) => vs.getObject(s.name)?.execute(idx, ...a) ?? null,
    add_event: (s, idx, fn) => { vs.getObject(s.name)?.addEventHandler(idx, fn); },
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GATE_PROTO = {
    new: (_s, idx, _u, name) => {
        vs.newGate(idx, name);
        return { name, _prototype: GATE_PROTO };
    },
    get: (s, idx) => vs.getObject(s.name)?.get(idx) ?? null,
    set: (s, idx, v) => { vs.getObject(s.name)?.set(idx, v); },
    execute: (s, idx, ...a) => vs.getObject(s.name)?.execute(idx, ...a) ?? null,
    add_event: (s, idx, fn) => { vs.getObject(s.name)?.addEventHandler(idx, fn); },
};
// ── SYSTEM global ─────────────────────────────────────────────────────────────
const SYSTEM = {
    Init: () => {
        vs.setup();
        parentPort.postMessage({ type: 'started' });
    },
    Loop: () => {
        vs.loop();
        // Sleep up to 1ms, waking early if a luaCall arrives (i32[0] becomes != 0)
        Atomics.wait(i32, 0, STATE_IDLE, 1);
        // Handle any pending luaCall from the main thread
        handlePendingCall();
    },
    Wait: (_s, ms) => {
        // Synchronous wait — Atomics.wait is allowed in Worker threads
        if (ms > 0)
            Atomics.wait(i32, 0, STATE_IDLE, Math.max(1, Math.floor(ms)));
    },
    clientRegister: (_s, remoteAddr, addr, port, sid, subs) => vs.clientRegister(remoteAddr, addr, port, sid, parseSubs(subs)),
    clientDestroy: (_s, addr, port, sid) => vs.clientDestroy(addr, port, sid),
    fetchValues: (_s, subs) => `values:${vs.fetchValues(parseSubs(subs))}`,
    mqttRegister: () => { },
    mqttDestroy: () => { },
};
engine.global.set('SYSTEM', SYSTEM);
engine.global.set('OBJECT', OBJECT_PROTO);
engine.global.set('GATE', GATE_PROTO);
engine.global.set('logDebug', (...a) => console.debug(...a));
engine.global.set('logInfo', (...a) => console.info(...a));
engine.global.set('log', (...a) => console.info(...a));
engine.global.set('logWarning', (...a) => console.warn(...a));
engine.global.set('logError', (...a) => console.error(...a));
engine.global.set('print', (...a) => console.info(...a));
engine.global.set('collectgarbage', () => { });
// Set package.path so `require "user"` resolves to /lua/user.lua
await engine.doString('package.path = "/lua/?.lua;" .. package.path');
// ── Run the Lua script ────────────────────────────────────────────────────────
if (!existsSync(scriptPath)) {
    parentPort.postMessage({ type: 'error', message: `Script not found: ${scriptPath}` });
    process.exit(1);
}
const luaScript = readFileSync(scriptPath, 'utf8');
try {
    await engine.doString(luaScript);
}
catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[LuaWorker] script error:', msg);
    parentPort.postMessage({ type: 'scriptError', message: msg });
}
