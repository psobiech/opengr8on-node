import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { CLUClient } from '../CLUClient.js';
import { readProjectClus, findProjectClu, projectCluClient } from '../clu/project.js';
import type { ProjectClu } from '../clu/project.js';
import { serveHttp } from './serve-http.js';

export interface CluServerConfig {
  ompFile: string;
  localAddress: string;
  cluPort: number;
  httpPort?: number;
}

let _cluEntries: ProjectClu[] | null = null;
let _clients: Map<string, CLUClient> | null = null;
let _localAddress: string | null = null;
let _port: number | null = null;

function init(config: CluServerConfig): void {
  if (_clients) return;

  _localAddress = config.localAddress;
  _port = config.cluPort;

  _cluEntries = readProjectClus(config.ompFile);
  _clients = new Map();
}

let _config: CluServerConfig | null = null;

function resolveClu(cluId: string): CLUClient {
  init(_config!);
  const entry = findProjectClu(_cluEntries!, cluId);
  if (!entry) throw new Error(`CLU not found: "${cluId}". Use clu_list_clus to see available CLUs.`);

  if (!_clients!.has(entry.serial)) {
    _clients!.set(entry.serial, projectCluClient(entry, _localAddress!, _port!));
  }

  return _clients!.get(entry.serial)!;
}

const ok   = (text: unknown) => ({ content: [{ type: 'text' as const, text: String(text ?? 'null') }] });
const fail = (msg: string)   => ({ content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true as const });

export function createServer(): McpServer {
  const server = new McpServer({ name: 'opengr8on-clu', version: '0.1.0' });

  server.registerTool('clu_list_clus', {
    description: 'List all CLUs defined in the OMP project file.',
  }, async () => {
    try {
      init(_config!);
      return ok(_cluEntries!.map(c => `${c.name}  serial=${c.serial}  ip=${c.ipAddress}`).join('\n'));
    } catch (e) { return fail((e as Error).message); }
  });

  server.registerTool('clu_execute', {
    description: 'Execute a Lua script or expression on a CLU. Returns the string result.',
    inputSchema: {
      clu:    z.string().describe('CLU name (e.g. "ALARM") or serial hex (e.g. "1e754612")'),
      script: z.string().describe('Lua expression, e.g. "checkAlive()" or "RELAY_1:get()"'),
    },
  }, async ({ clu, script }) => {
    try { return ok(await resolveClu(clu).execute(script)); }
    catch (e) { return fail((e as Error).message); }
  });

  server.registerTool('clu_get_object', {
    description: 'Get the current value of a CLU object.',
    inputSchema: {
      clu:      z.string().describe('CLU name or serial hex'),
      objectId: z.string().describe('Object name on the CLU, e.g. "RELAY_1"'),
    },
  }, async ({ clu, objectId }) => {
    try { return ok(await resolveClu(clu).execute(`${objectId}:get()`)); }
    catch (e) { return fail((e as Error).message); }
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
    catch (e) { return fail((e as Error).message); }
  });

  return server;
}

export async function start(config: CluServerConfig): Promise<void> {
  _config = config;
  if (config.httpPort) {
    await serveHttp(createServer, config.httpPort);
  } else {
    const server = createServer();
    await server.connect(new StdioServerTransport());
  }
}
