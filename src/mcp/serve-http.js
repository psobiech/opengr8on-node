import http from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

/**
 * Expose an McpServer factory over stateless Streamable HTTP on /mcp.
 * Creates a fresh server+transport per request (stateless mode).
 *
 * @param {() => import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} createMcpServer
 * @param {number} port
 */
export async function serveHttp(createMcpServer, port) {
  const httpServer = http.createServer(async (req, res) => {
    if (req.url !== '/mcp') {
      res.writeHead(404).end();
      return;
    }

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const mcpServer = createMcpServer();
    await mcpServer.connect(transport);

    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString('utf8');

    try {
      await transport.handleRequest(req, res, rawBody ? JSON.parse(rawBody) : undefined);
    } catch (err) {
      if (!res.headersSent) res.writeHead(500).end(String(err.message));
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
