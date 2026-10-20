#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { start } from '../src/mcp/tfbus-server.js';

const { values } = parseArgs({
  options: {
    'port':      { type: 'string' },
    'http-port': { type: 'string' },
  },
});

await start({
  port:     values['port'] ?? null,
  httpPort: values['http-port'] ? Number(values['http-port']) : null,
});
