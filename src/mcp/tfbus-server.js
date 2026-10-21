import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { SerialTransport } from '../tfbus/transport/SerialTransport.js';
import { sniffBus } from '../tfbus/sniff.js';
import { serveHttp } from './serve-http.js';

export function createServer({ defaultPort = null } = {}) {
  const server = new McpServer({ name: 'opengr8on-tfbus', version: '0.1.0' });

  server.registerTool('tfbus_sniff', {
    description: 'Passively capture RS485 TFBus frames from a serial port. Returns a JSON array of decoded events.',
    inputSchema: {
      durationMs: z.number().optional().describe('Capture duration in ms (default 5000)'),
      filter:     z.boolean().optional().describe('Drop STATUS_POLL pings and unchanged status responses (default true)'),
      addr:       z.number().int().optional().describe('Capture only frames for this module address (CLU↔module pair). Use filter:false to also see STATUS_POLL TX frames.'),
    },
  }, async ({ durationMs = 5000, filter = true, addr = null }) => {
    const port = defaultPort;
    if (!port) return { content: [{ type: 'text', text: 'Error: --port required at startup' }], isError: true };
    const transport = new SerialTransport(port);
    try {
      await transport.open();
      const events = await sniffBus(transport, { durationMs, filter, addr });
      return { content: [{ type: 'text', text: JSON.stringify(events, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
    } finally {
      await transport.close().catch(() => {});
    }
  });

  return server;
}

// ─── Start ────────────────────────────────────────────────────────────────────

export async function start({ port, httpPort }) {
  const factory = () => createServer({ defaultPort: port });
  if (httpPort) {
    await serveHttp(factory, httpPort);
  } else {
    const server = factory();
    await server.connect(new StdioServerTransport());
  }
}
