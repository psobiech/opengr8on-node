#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { start } from '../dist/mcp/clu-server.js';

const { values } = parseArgs({
  options: {
    'omp-file':      { type: 'string' },
    'local-address': { type: 'string' },
    'clu-port':      { type: 'string' },
    'http-port':     { type: 'string' },
  },
});

if (!values['omp-file'])      { process.stderr.write('Error: --omp-file required\n');      process.exit(1); }
if (!values['local-address']) { process.stderr.write('Error: --local-address required\n'); process.exit(1); }

await start({
  ompFile:      values['omp-file'],
  localAddress: values['local-address'],
  cluPort:      values['clu-port']  ? Number(values['clu-port'])  : undefined,
  httpPort:     values['http-port'] ? Number(values['http-port']) : null,
});