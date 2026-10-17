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
import type { VirtualSystemOptions } from './VirtualSystem.js';
import type { LuaLike, Subscription, WorkerMessage } from './types.js';

function send(msg: WorkerMessage): void {
  parentPort!.postMessage(msg);
}

const SCRIPT_OFFSET = 12;
const RESULT_OFFSET = 12 + 65536;
const STATE_IDLE    = 0;
const STATE_PENDING = 1;
const STATE_RESULT  = 2;

const {
  vsOptions,
  scriptPath,
  sab,
  aDriveDirectory,
} = workerData as {
  vsOptions: VirtualSystemOptions;
  scriptPath: string;
  sab: SharedArrayBuffer;
  aDriveDirectory: string;
};

const i32 = new Int32Array(sab);
const u8  = new Uint8Array(sab);

// ── VirtualSystem ─────────────────────────────────────────────────────────────
const vs = new VirtualSystem(vsOptions);

vs.setSendClientReportFn((addr: string, port: number, sessionId: number, response: string) => {
  send({ type: 'clientReport', addr, port, sessionId, response });
});

await vs.loadRegistries();

// ── wasmoon ───────────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mod = await import('wasmoon') as any;
const LuaFactory = mod.LuaFactory ?? mod.default?.LuaFactory;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const engine: any = await new LuaFactory().createEngine();

// ── Mount .LUA files into wasmoon's virtual FS ────────────────────────────────
// MAIN.LUA does `require "user"` / `require "om"` — standard Lua looks for
// lowercase filenames, so mount each file as its lowercase equivalent.
try {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const FS: any = engine.cmodule.module.FS;
  FS.mkdir('/lua');
  if (existsSync(aDriveDirectory)) {
    for (const file of readdirSync(aDriveDirectory)) {
      if (file.toUpperCase().endsWith('.LUA')) {
        const content = readFileSync(resolve(aDriveDirectory, file), 'utf8');
        FS.writeFile(`/lua/${file.toLowerCase()}`, content);
      }
    }
  }
} catch (e) {
  console.error('[LuaWorker] FS mount error:', e);
}

// ── Globals: luaCall ──────────────────────────────────────────────────────────
vs.setLuaCallFn((script: string): LuaLike => {
  try {
    return engine.doStringSync(`return ${script}`) as LuaLike;
  } catch {
    return null;
  }
});

// ── SAB luaCall handler ───────────────────────────────────────────────────────
// Called each Lua tick (from SYSTEM.Loop).
// Three-phase handshake with the main thread:
//   1. Main writes script → sets STATE_PENDING → notifies worker
//   2. Worker reads script, runs Lua, writes result → sets STATE_RESULT → notifies main
//   3. Main reads result → sets STATE_IDLE → notifies worker  (releases buffer for reuse)
// The final Atomics.wait(STATE_RESULT) keeps the worker blocked while main reads,
// so the buffer is never overwritten before main is done with it.
function handlePendingCall(): void {
  if (Atomics.load(i32, 0) !== STATE_PENDING) return;

  const len    = Atomics.load(i32, 1);
  const script = Buffer.from(sab, SCRIPT_OFFSET, len).toString('utf8');

  let result = 'nil';
  try {
    const r = engine.doStringSync(`return ${script}`) as LuaLike;
    result = r == null ? 'nil' : String(r);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[LuaWorker] luaCall error:', msg);
  }

  const rb = Buffer.from(result, 'utf8');
  u8.set(rb, RESULT_OFFSET);
  Atomics.store(i32, 2, rb.length);
  Atomics.store(i32, 0, STATE_RESULT); // signal main thread: result is ready
  Atomics.notify(i32, 0, 1);           // wake main thread's Atomics.waitAsync
  Atomics.wait(i32, 0, STATE_RESULT);  // block until main resets to IDLE
}

// ── Lua subscription helper ───────────────────────────────────────────────────
function parseSubs(subs: unknown): Subscription[] {
  if (!subs || typeof subs !== 'object') return [];
  const result: Subscription[] = [];
  for (const entry of Object.values(subs as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object') continue;
    const arr   = Object.values(entry as Record<string, unknown>);
    const ref   = arr[0] as { name?: string } | null;
    const index = arr[1] as number | null;
    if (ref?.name == null || index == null) continue;
    const obj = vs.getObject(ref.name);
    if (obj == null) continue;
    result.push({ object: obj, index: Number(index) });
  }
  return result;
}

// ── OBJECT / GATE prototypes ──────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const OBJECT_PROTO: any = {
  new: (_s: unknown, idx: number, ipOrName: unknown, name?: unknown) => {
    const n  = name !== undefined ? String(name) : String(ipOrName);
    const ip = name !== undefined ? String(ipOrName) : null;
    vs.newObject(idx, n, ip);
    return { name: n, _prototype: OBJECT_PROTO };
  },
  get:       (s: { name: string }, idx: number)             => vs.getObject(s.name)?.get(idx)             ?? null,
  set:       (s: { name: string }, idx: number, v: LuaLike) => { vs.getObject(s.name)?.set(idx, v); },
  execute:   (s: { name: string }, idx: number, ...a: LuaLike[]) => vs.getObject(s.name)?.execute(idx, ...a) ?? null,
  add_event: (s: { name: string }, idx: number, fn: () => void)  => { vs.getObject(s.name)?.addEventHandler(idx, fn); },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GATE_PROTO: any = {
  new: (_s: unknown, idx: number, _u: unknown, name: string) => {
    vs.newGate(idx, name);
    return { name, _prototype: GATE_PROTO };
  },
  get:       (s: { name: string }, idx: number)             => vs.getObject(s.name)?.get(idx)             ?? null,
  set:       (s: { name: string }, idx: number, v: LuaLike) => { vs.getObject(s.name)?.set(idx, v); },
  execute:   (s: { name: string }, idx: number, ...a: LuaLike[]) => vs.getObject(s.name)?.execute(idx, ...a) ?? null,
  add_event: (s: { name: string }, idx: number, fn: () => void)  => { vs.getObject(s.name)?.addEventHandler(idx, fn); },
};

// ── SYSTEM global ─────────────────────────────────────────────────────────────
const SYSTEM = {
  Init: () => {
    vs.setup();
    send({ type: 'started' });
  },
  Loop: () => {
    vs.loop();

    // Sleep up to 1ms. Wakes early if main thread writes STATE_PENDING (a luaCall arrived),
    // so luaCall latency is bounded without busy-spinning.
    Atomics.wait(i32, 0, STATE_IDLE, 1);

    handlePendingCall();
  },
  Wait: (_s: unknown, ms: number) => {
    // Synchronous wait — Atomics.wait is allowed in Worker threads
    if (ms > 0) Atomics.wait(i32, 0, STATE_IDLE, Math.max(1, Math.floor(ms)));
  },
  clientRegister: (_s: unknown, remoteAddr: string, addr: string, port: number, sid: number, subs: unknown) =>
    vs.clientRegister(remoteAddr, addr, port, sid, parseSubs(subs)),
  clientDestroy: (_s: unknown, addr: string, port: number, sid: number) =>
    vs.clientDestroy(addr, port, sid),
  fetchValues: (_s: unknown, subs: unknown) =>
    `values:${vs.fetchValues(parseSubs(subs))}`,
  mqttRegister: () => {},
  mqttDestroy:  () => {},
};

engine.global.set('SYSTEM',        SYSTEM);
engine.global.set('OBJECT',        OBJECT_PROTO);
engine.global.set('GATE',          GATE_PROTO);
engine.global.set('logDebug',      (...a: unknown[]) => console.debug(...a));
engine.global.set('logInfo',       (...a: unknown[]) => console.info(...a));
engine.global.set('log',           (...a: unknown[]) => console.info(...a));
engine.global.set('logWarning',    (...a: unknown[]) => console.warn(...a));
engine.global.set('logError',      (...a: unknown[]) => console.error(...a));
engine.global.set('print',         (...a: unknown[]) => console.info(...a));
engine.global.set('collectgarbage', () => {});

// Set package.path so `require "user"` resolves to /lua/user.lua
await engine.doString('package.path = "/lua/?.lua;" .. package.path');

// ── Run the Lua script ────────────────────────────────────────────────────────
if (!existsSync(scriptPath)) {
  send({ type: 'error', message: `Script not found: ${scriptPath}` });
  process.exit(1);
}

const luaScript = readFileSync(scriptPath, 'utf8');
try {
  await engine.doString(luaScript);
} catch (e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error('[LuaWorker] script error:', msg);
  send({ type: 'scriptError', message: msg });
}
