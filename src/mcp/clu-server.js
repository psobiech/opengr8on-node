import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { readAllObjects } from '../parsers/omp/OmpReader.js';
import { SpecificObjectClass } from '../parsers/omp/system/specificObjects/SpecificObjectClass.js';
import { CLUClient } from '../CLUClient.js';
import { CLUDevice } from '../device/CLUDevice.js';
import { CipherKey } from '../CipherKey.js';
import { serveHttp } from './serve-http.js';

// ─── OMP loading ──────────────────────────────────────────────────────────────

function getTextValue(node) {
  if (typeof node === 'string') return node;
  if (node && typeof node === 'object') return node['#text'] ?? '';
  return '';
}

// ─── Client registry (shared across requests) ─────────────────────────────────

let _cluEntries = null;
let _clients = null;
let _localAddress = null;
let _port = null;

function init(config) {
  if (_clients) return;

  _localAddress = config.localAddress;
  _port = config.cluPort;

  const objects = readAllObjects(config.ompFile);
  const rawClus = [...objects.values()].filter(o => o.objectClassEnum === SpecificObjectClass.CLU);

  const keysPath = resolve(dirname(config.ompFile), 'keys.json');
  let projectCipherKey = null;
  try {
    const keys = JSON.parse(readFileSync(keysPath, 'utf8'));
    if (keys.key && keys.iv) {
      projectCipherKey = new CipherKey(
        Buffer.from(keys.key, 'base64'),
        Buffer.from(keys.iv, 'base64'),
      );
    }
  } catch { /* no keys.json — fall back to per-device derivation */ }

  _cluEntries = rawClus.map(c => ({
    name:      getTextValue(c.name),
    serial:    getTextValue(c.serialNumber),
    ipAddress: getTextValue(c.ipAddress),
    cipherKey: (c.cipherKeyType === 'PROJECT_KEY' && projectCipherKey)
      ? projectCipherKey
      : CipherKey.getInitialCipherKey(
          Buffer.from(getTextValue(c.iv), 'base64'),
          Buffer.from(getTextValue(c.privateKey), 'base64'),
        ),
  }));

  _clients = new Map();
}

let _config = null;

function resolveClu(cluId) {
  init(_config);
  const id = cluId.toLowerCase();
  const entry = _cluEntries.find(c => c.name.toLowerCase() === id || c.serial.toLowerCase() === id);
  if (!entry) throw new Error(`CLU not found: "${cluId}". Use clu_list_clus to see available CLUs.`);

  if (!_clients.has(entry.serial)) {
    const device = new CLUDevice({ address: entry.ipAddress, port: _port, serialNumber: parseInt(entry.serial, 16) });
    _clients.set(entry.serial, new CLUClient(_localAddress, device, entry.cipherKey));
  }

  return _clients.get(entry.serial);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ok   = (text) => ({ content: [{ type: 'text', text: String(text ?? 'null') }] });
const fail = (msg)  => ({ content: [{ type: 'text', text: `Error: ${msg}` }], isError: true });

// ─── Server factory ───────────────────────────────────────────────────────────

export function createServer() {
  const server = new McpServer({ name: 'opengr8on-clu', version: '0.1.0' });

  server.registerTool('clu_list_clus', {
    description: 'List all CLUs defined in the OMP project file.',
  }, async () => {
    try {
      init(_config);
      return ok(_cluEntries.map(c => `${c.name}  serial=${c.serial}  ip=${c.ipAddress}`).join('\n'));
    } catch (e) { return fail(e.message); }
  });

  server.registerTool('clu_execute', {
    description: 'Execute a Lua script or expression on a CLU. Returns the string result.',
    inputSchema: {
      clu:    z.string().describe('CLU name (e.g. "ALARM") or serial hex (e.g. "1e754612")'),
      script: z.string().describe('Lua expression, e.g. "checkAlive()" or "RELAY_1:get()"'),
    },
  }, async ({ clu, script }) => {
    try { return ok(await resolveClu(clu).execute(script)); }
    catch (e) { return fail(e.message); }
  });

  server.registerTool('clu_get_object', {
    description: 'Get the current value of a CLU object.',
    inputSchema: {
      clu:      z.string().describe('CLU name or serial hex'),
      objectId: z.string().describe('Object name on the CLU, e.g. "RELAY_1"'),
    },
  }, async ({ clu, objectId }) => {
    try { return ok(await resolveClu(clu).execute(`${objectId}:get()`)); }
    catch (e) { return fail(e.message); }
  });

  server.registerTool('clu_set_object', {
    description: 'Set the value of a CLU object.',
    inputSchema: {
      clu:      z.string().describe('CLU name or serial hex'),
      objectId: z.string().describe('Object name on the CLU, e.g. "RELAY_1"'),
      value:    z.string().describe('Lua literal: "1", "true", "0.5", etc.'),
    },
  }, async ({ clu, objectId, value }) => {
    try { return ok(await resolveClu(clu).execute(`${objectId}:set(${value})`)); }
    catch (e) { return fail(e.message); }
  });

  return server;
}

// ─── Start ────────────────────────────────────────────────────────────────────

export async function start(config) {
  _config = config;
  if (config.httpPort) {
    await serveHttp(createServer, config.httpPort);
  } else {
    const server = createServer();
    await server.connect(new StdioServerTransport());
  }
}
