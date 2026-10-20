#!/usr/bin/env node
import { resolve } from 'node:path';
import { SerialTransport } from '../src/tfbus/transport/SerialTransport.js';
import { runRepl } from '../src/tfbus/repl.js';

const args = process.argv.slice(2);
function argValue(flag) { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; }

const port = argValue('--port');
if (!port) {
  process.stderr.write(
    'Usage: tfbus-repl --port /dev/ttyUSB0 [--baud 115200] [--omp ./project.omp] [--clu 221010198]\n' +
    '                  [--dir ./docs/device-interfaces] [--lang pl] [--my-addr 0xFE]\n',
  );
  process.exit(1);
}

const baud = parseInt(argValue('--baud') ?? '115200', 10);
const ompArg = argValue('--omp');

const transport = new SerialTransport(port, { baudRate: baud, rxTimeoutMs: 300 });

process.on('SIGINT', async () => {
  process.stdout.write('\nShutting down…\n');
  await transport.close();
  process.exit(0);
});

const myAddrArg = argValue('--my-addr');
await runRepl(transport, {
  dir: resolve(argValue('--dir') ?? 'docs/device-interfaces'),
  lang: argValue('--lang') ?? 'pl',
  ompPath: ompArg ? resolve(ompArg) : undefined,
  cluSerial: argValue('--clu') ?? undefined,
  myAddr: myAddrArg ? parseInt(myAddrArg, 16) : 0xFE,
  baud,
});

await transport.close();
