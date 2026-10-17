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
export {};
//# sourceMappingURL=LuaWorker.d.ts.map