#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { transcribeModules } from '../dist/parsers/interfaces/transcribeModules.js';

const args = process.argv.slice(2);

const dir = resolve(argValue('--dir') ?? 'docs/device-interfaces');
const outputPath = argValue('--output');
const lang = argValue('--lang') ?? 'pl';

const { output, errors } = transcribeModules(dir, { lang });

for (const error of errors) process.stderr.write(`warn: ${error}\n`);

const json = JSON.stringify(output, null, 2);

if (outputPath) {
  writeFileSync(resolve(outputPath), json, 'utf8');
  process.stderr.write(`wrote to ${outputPath}\n`);
} else {
  process.stdout.write(json + '\n');
}

function argValue(flag) {
  const flagIdx = args.indexOf(flag);
  return flagIdx !== -1 ? args[flagIdx + 1] : null;
}
