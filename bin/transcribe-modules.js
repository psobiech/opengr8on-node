#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { transcribeModules } from '../src/parsers/interfaces/transcribeModules.js';

const args = process.argv.slice(2);

function argValue(flag) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
}

const dir = resolve(argValue('--dir') ?? 'docs/device-interfaces');
const outputPath = argValue('--output');
const lang = argValue('--lang') ?? 'pl';

const { output, errors } = transcribeModules(dir, { lang });

for (const err of errors) process.stderr.write(`warn: ${err}\n`);

const json = JSON.stringify(output, null, 2);

if (outputPath) {
  writeFileSync(resolve(outputPath), json, 'utf8');
  process.stderr.write(`wrote to ${outputPath}\n`);
} else {
  process.stdout.write(json + '\n');
}
