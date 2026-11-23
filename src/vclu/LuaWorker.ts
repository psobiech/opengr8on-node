/**
 * Worker thread that hosts the wasmoon Lua engine + VirtualSystem.
 * Spawned by LuaThread. Communicates with the main thread via:
 *   - SharedArrayBuffer (SAB) for synchronous luaCall requests/responses
 *   - postMessage for async notifications (clientReport, started, error{kind})
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

const sabWords = new Int32Array(sab);
const sabBytes = new Uint8Array(sab);

// ── VirtualSystem ─────────────────────────────────────────────────────────────
const virtualSystem = new VirtualSystem(vsOptions);

virtualSystem.setSendClientReportFn((addr: string, port: number, sessionId: number, response: string) => {
  send({ type: 'clientReport', addr, port, sessionId, response });
});

await virtualSystem.loadRegistries();

// ── wasmoon ───────────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const wasmoonModule = await import('wasmoon') as any;
const LuaFactory = wasmoonModule.LuaFactory ?? wasmoonModule.default?.LuaFactory;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const engine: any = await new LuaFactory().createEngine();

// ── Mount .LUA files into wasmoon's virtual FS ────────────────────────────────
// MAIN.LUA does `require "user"` / `require "om"` — standard Lua looks for
// lowercase filenames, so mount each file as its lowercase equivalent.
try {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const virtualFs: any = engine.cmodule.module.FS;
  virtualFs.mkdir('/lua');
  if (existsSync(aDriveDirectory)) {
    for (const file of readdirSync(aDriveDirectory)) {
      if (file.toUpperCase().endsWith('.LUA')) {
        const content = readFileSync(resolve(aDriveDirectory, file), 'utf8');
        virtualFs.writeFile(`/lua/${file.toLowerCase()}`, content);
      }
    }
  }
} catch (error) {
  console.error('[LuaWorker] FS mount error:', error);
}

// ── Globals: luaCall ──────────────────────────────────────────────────────────
virtualSystem.setLuaCallFn((script: string): LuaLike => {
  try {
    return engine.doStringSync(`return ${script}`) as LuaLike;
  } catch {
    return null;
  }
});

// ── OBJECT / GATE prototypes ──────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const OBJECT_PROTO: any = {
  new: (_self: unknown, index: number, ipOrName: unknown, name?: unknown) => {
    const objectName = name !== undefined ? String(name) : String(ipOrName);
    const ipAddress  = name !== undefined ? String(ipOrName) : null;
    virtualSystem.newObject(index, objectName, ipAddress);
    return { name: objectName, _prototype: OBJECT_PROTO };
  },
  get:       (self: { name: string }, index: number)                 => virtualSystem.getObject(self.name)?.get(index)                ?? null,
  set:       (self: { name: string }, index: number, value: LuaLike) => { virtualSystem.getObject(self.name)?.set(index, value); },
  execute:   (self: { name: string }, index: number, ...args: LuaLike[]) => virtualSystem.getObject(self.name)?.execute(index, ...args) ?? null,
  add_event: (self: { name: string }, index: number, handler: () => void) => { virtualSystem.getObject(self.name)?.addEventHandler(index, handler); },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GATE_PROTO: any = {
  new: (_self: unknown, index: number, _unused: unknown, name: string) => {
    virtualSystem.newGate(index, name);
    return { name, _prototype: GATE_PROTO };
  },
  get:       (self: { name: string }, index: number)                 => virtualSystem.getObject(self.name)?.get(index)                ?? null,
  set:       (self: { name: string }, index: number, value: LuaLike) => { virtualSystem.getObject(self.name)?.set(index, value); },
  execute:   (self: { name: string }, index: number, ...args: LuaLike[]) => virtualSystem.getObject(self.name)?.execute(index, ...args) ?? null,
  add_event: (self: { name: string }, index: number, handler: () => void) => { virtualSystem.getObject(self.name)?.addEventHandler(index, handler); },
};

// ── SYSTEM global ─────────────────────────────────────────────────────────────
const SYSTEM = {
  Init: () => {
    virtualSystem.setup();
    send({ type: 'started' });
  },
  Loop: () => {
    virtualSystem.loop();

    // Sleep up to 1ms. Wakes early if main thread writes STATE_PENDING (a luaCall arrived),
    // so luaCall latency is bounded without busy-spinning.
    Atomics.wait(sabWords, 0, STATE_IDLE, 1);

    handlePendingCall();
  },
  Wait: (_self: unknown, waitMs: number) => {
    // Synchronous wait — Atomics.wait is allowed in Worker threads
    if (waitMs > 0) Atomics.wait(sabWords, 0, STATE_IDLE, Math.max(1, Math.floor(waitMs)));
  },
  clientRegister: (_self: unknown, remoteAddr: string, addr: string, port: number, sessionId: number, subscriptions: unknown) =>
    virtualSystem.clientRegister(remoteAddr, addr, port, sessionId, parseSubscriptions(subscriptions)),
  clientDestroy: (_self: unknown, addr: string, port: number, sessionId: number) =>
    virtualSystem.clientDestroy(addr, port, sessionId),
  fetchValues: (_self: unknown, subscriptions: unknown) =>
    `values:${virtualSystem.fetchValues(parseSubscriptions(subscriptions))}`,
  mqttRegister: () => {},
  mqttDestroy:  () => {},
};

engine.global.set('SYSTEM',        SYSTEM);
engine.global.set('OBJECT',        OBJECT_PROTO);
engine.global.set('GATE',          GATE_PROTO);
engine.global.set('logDebug',      (...args: unknown[]) => console.debug(...args));
engine.global.set('logInfo',       (...args: unknown[]) => console.info(...args));
engine.global.set('log',           (...args: unknown[]) => console.info(...args));
engine.global.set('logWarning',    (...args: unknown[]) => console.warn(...args));
engine.global.set('logError',      (...args: unknown[]) => console.error(...args));
engine.global.set('print',         (...args: unknown[]) => console.info(...args));
engine.global.set('collectgarbage', () => {});

// Set package.path so `require "user"` resolves to /lua/user.lua
await engine.doString('package.path = "/lua/?.lua;" .. package.path');

// ── Run the Lua script ────────────────────────────────────────────────────────
if (!existsSync(scriptPath)) {
  send({ type: 'error', kind: 'notFound', message: `Script not found: ${scriptPath}` });
  process.exit(1);
}

const luaScript = readFileSync(scriptPath, 'utf8');
try {
  await engine.doString(luaScript);
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[LuaWorker] script error:', message);
  send({ type: 'error', kind: 'scriptError', message });
}

function send(message: WorkerMessage): void {
  parentPort!.postMessage(message);
}

// ── SAB luaCall handler ───────────────────────────────────────────────────────
// Called each Lua tick (from SYSTEM.Loop).
// Three-phase handshake with the main thread:
//   1. Main writes script → sets STATE_PENDING → notifies worker
//   2. Worker reads script, runs Lua, writes result → sets STATE_RESULT → notifies main
//   3. Main reads result → sets STATE_IDLE → notifies worker  (releases buffer for reuse)
// The final Atomics.wait(STATE_RESULT) keeps the worker blocked while main reads,
// so the buffer is never overwritten before main is done with it.
function handlePendingCall(): void {
  if (Atomics.load(sabWords, 0) !== STATE_PENDING) return;

  const scriptLength = Atomics.load(sabWords, 1);
  const script = Buffer.from(sab, SCRIPT_OFFSET, scriptLength).toString('utf8');

  let result = 'nil';
  try {
    const luaResult = engine.doStringSync(`return ${script}`) as LuaLike;
    result = luaResult == null ? 'nil' : String(luaResult);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[LuaWorker] luaCall error:', message);
  }

  const resultBytes = Buffer.from(result, 'utf8');
  sabBytes.set(resultBytes, RESULT_OFFSET);
  Atomics.store(sabWords, 2, resultBytes.length);
  Atomics.store(sabWords, 0, STATE_RESULT); // signal main thread: result is ready
  Atomics.notify(sabWords, 0, 1);           // wake main thread's Atomics.waitAsync
  Atomics.wait(sabWords, 0, STATE_RESULT);  // block until main resets to IDLE
}

// ── Lua subscription helper ───────────────────────────────────────────────────
function parseSubscriptions(subscriptions: unknown): Subscription[] {
  if (!subscriptions || typeof subscriptions !== 'object') return [];
  const result: Subscription[] = [];
  for (const entry of Object.values(subscriptions as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object') continue;
    const pair  = Object.values(entry as Record<string, unknown>);
    const objectRef = pair[0] as { name?: string } | null;
    const index = pair[1] as number | null;
    if (objectRef?.name == null || index == null) continue;
    const virtualObject = virtualSystem.getObject(objectRef.name);
    if (virtualObject == null) continue;
    result.push({ object: virtualObject, index: Number(index) });
  }
  return result;
}
