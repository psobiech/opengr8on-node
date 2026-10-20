#!/usr/bin/env node
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { runCluRepl } from '../src/clu/repl.js';

const { values } = parseArgs({
  options: {
    'omp-file':        { type: 'string' },
    'local-address':   { type: 'string' },
    'clu-port':        { type: 'string' },
    'interfaces-dir':  { type: 'string' },
  },
});

if (!values['omp-file']) {
  process.stderr.write(
    'Usage: clu-repl --omp-file ./project.omp --local-address 192.168.1.100 [--clu-port 1234] [--interfaces-dir ./docs/device-interfaces]\n',
  );
  process.exit(1);
}

if (!values['local-address']) {
  process.stderr.write('Error: --local-address required\n');
  process.exit(1);
}

await runCluRepl({
  ompFile:        resolve(values['omp-file']),
  localAddress:   values['local-address'],
  cluPort:        values['clu-port'] ? Number(values['clu-port']) : undefined,
  interfacesDir:  values['interfaces-dir'] ? resolve(values['interfaces-dir']) : undefined,
});
