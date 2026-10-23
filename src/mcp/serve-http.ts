import http from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export async function serveHttp(createMcpServer: () => McpServer, port: number): Promise<http.Server> {
  const httpServer = http.createServer(async (req, res) => {
    if (req.url !== '/mcp') {
      res.writeHead(404).end();
      return;
    }

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const mcpServer = createMcpServer();
    await mcpServer.connect(transport);

    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const rawBody = Buffer.concat(chunks).toString('utf8');

    try {
      await transport.handleRequest(req, res, rawBody ? JSON.parse(rawBody) : undefined);
    } catch (err) {
      if (!res.headersSent) res.writeHead(500).end(String((err as Error).message));
    }
  });

  return new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, () => {
      process.stderr.write(`MCP HTTP server listening on :${port}/mcp\n`);
      resolve(httpServer);
    });
  });
}
