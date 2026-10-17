#!/usr/bin/env node
/**
 * VCLU startup entrypoint — equivalent to Java Main.java
 *
 * Usage: vclu [interfaceNameOrIpAddress]
 *
 * Runtime layout (relative to CWD):
 *   runtime/keys.json          — cipher keys (auto-generated on first run)
 *   runtime/root/              — TFTP root, serves files to CLU clients
 *   runtime/root/a/CONFIG.JSON — device config (auto-generated on first run)
 *   runtime/root/a/config.txt  — device config in hex text format
 *   runtime/root/a/MAIN.LUA   — main Lua script (required for Lua mode)
 *   runtime/root/a/EMERGNCY.LUA — emergency Lua fallback
 *   runtime/project.omp        — Grenton project file (optional)
 */

import { resolve, join } from 'node:path';
import { existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { readOrGenerateKeys, readOrGenerateDeviceConfig } from '../src/vclu/Config.js';
import { getLocalIPv4Interfaces, getInterfaceByName, getInterfaceByAddress } from '../src/util/networkInterfaces.js';
import { Server } from '../src/vclu/Server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const runtimeDirectory = resolve(process.cwd(), 'runtime');
const rootDirectory    = join(runtimeDirectory, 'root');
const aDriveDirectory  = join(rootDirectory, 'a');

mkdirSync(aDriveDirectory, { recursive: true });

// ── Keys ─────────────────────────────────────────────────────────────────────
const keys = readOrGenerateKeys(runtimeDirectory);
console.info(`[vclu] PIN: ${keys.pin.toString('ascii')}`);

// ── Network interface ─────────────────────────────────────────────────────────
let networkInterface = null;
const arg = process.argv[2];
if (arg) {
  networkInterface = getInterfaceByName(arg) ?? getInterfaceByAddress(arg);
  if (!networkInterface) {
    console.error(`[vclu] Cannot find interface: ${arg}`);
    process.exit(1);
  }
} else {
  const ifaces = getLocalIPv4Interfaces();
  if (ifaces.length === 0) {
    console.error('[vclu] No network interfaces found');
    process.exit(1);
  }
  networkInterface = ifaces[0];
}
console.info(`[vclu] Interface: ${networkInterface.name} (${networkInterface.address})`);

// ── Device config ─────────────────────────────────────────────────────────────
const deviceConfig = readOrGenerateDeviceConfig(aDriveDirectory, networkInterface.mac);
console.info(`[vclu] Serial number: ${deviceConfig.sn.toString(16).padStart(8, '0')}`);

// ── Emergency Lua fallback ────────────────────────────────────────────────────
const emergencyDst = join(aDriveDirectory, 'EMERGNCY.LUA');
if (!existsSync(emergencyDst)) {
  const emergencySrc = resolve(__dirname, '../runtime/root/a/EMERGNCY.LUA');
  if (existsSync(emergencySrc)) {
    copyFileSync(emergencySrc, emergencyDst);
  }
}

// ── Project registry ──────────────────────────────────────────────────────────
const projectOmpPath = join(runtimeDirectory, 'project.omp');

// ── Start server ──────────────────────────────────────────────────────────────
const server = new Server({
  rootDirectory:    rootDirectory,
  localAddress:     networkInterface.address,
  serialNumber:     deviceConfig.sn,
  macAddress:       deviceConfig.mac,
  projectKey:       keys.key,
  projectIV:        keys.iv,
  deviceIV:         keys.defaultIV,
  pin:              keys.pin,
  mainLuaPath:      existsSync(join(aDriveDirectory, 'MAIN.LUA')) ? join(aDriveDirectory, 'MAIN.LUA') : undefined,
  projectOmpPath:   existsSync(projectOmpPath) ? projectOmpPath : undefined,
});

await server.start();

const shutdown = () => {
  console.info('[vclu] Shutting down...');
  server.close();
  process.exit(0);
};

process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);

console.info('[vclu] Running. Press Ctrl+C to stop.');
