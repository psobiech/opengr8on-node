#!/usr/bin/env node
import { resolve } from 'node:path';
import { SerialTransport } from '../dist/tfbus/transport/SerialTransport.js';
import { runMonitor } from '../dist/tfbus/monitor.js';

const args = process.argv.slice(2);
function argValue(flag) { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; }
function hasFlag(flag) { return args.includes(flag); }

const port = argValue('--port');
if (!port) {
  process.stderr.write(
    'Usage: tfbus-monitor --port /dev/ttyUSB0 [--baud 115200] [--dir ./docs/device-interfaces]\n' +
    '                     [--lang pl] [--range 1-30] [--seek] [--reset] [--interval 500]\n' +
    '                     [--omp ./project.omp] [--clu 221010198]\n' +
    '                     [--active]  (default: passive mode — listen only, no TX)\n',
  );
  process.exit(1);
}

const baud = parseInt(argValue('--baud') ?? '115200', 10);
const [scanFrom, scanTo] = (argValue('--range') ?? '1-30').split('-').map(Number);

const transport = new SerialTransport(port, { baudRate: baud, rxTimeoutMs: 250 });
process.stdout.write(`Opening ${port} @ ${baud} baud…\n`);
await transport.open();

process.on('SIGINT', async () => {
  process.stdout.write('\nShutting down…\n');
  await transport.close();
  process.exit(0);
});

const ompArg = argValue('--omp');
await runMonitor(transport, {
  dir: resolve(argValue('--dir') ?? 'docs/device-interfaces'),
  lang: argValue('--lang') ?? 'pl',
  scanRange: [scanFrom, scanTo],
  reset: hasFlag('--reset'),
  seek: hasFlag('--seek'),
  pollIntervalMs: parseInt(argValue('--interval') ?? '500', 10),
  passive: !hasFlag('--active'),
  ompPath: ompArg ? resolve(ompArg) : undefined,
  cluSerial: argValue('--clu') ?? undefined,
});

await transport.close();
