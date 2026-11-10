#!/usr/bin/env node
import { runCluCli } from '../dist/clu/cli.js';

// UDP/TFTP sockets may keep the event loop alive after the command is done.
process.exit(await runCluCli(process.argv.slice(2)));
