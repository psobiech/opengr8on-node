import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { readProjectClus, findProjectClu, projectCluClient } from './project.js';

export const CLU_CLI_USAGE = `Usage: clu-cli --omp-file ./project.omp --local-address <ip> [--clu-port 1234] <command>

Commands:
  list                                  CLUs in the project
  alive  <clu>                          checkAlive()
  reset  <clu> [--delay ms] [--wait ms] req_reset, then wait until checkAlive() answers
                                        (--delay: wait before sending, e.g. to start a bus sniffer first)
  refresh <clu> [--delay ms] [--wait ms] req_refresh_modules (TFBUS module discovery, what OM
                                        "Clear CLU" sends) without touching the OM project;
                                        --wait = reply timeout (default 30000, like OM)
                                        WARNING: a real CLU (5.13.x) runs the bus discovery but then
                                        stops answering UDP until rebooted
  fetch  <clu> <remote>... [--out dir]  TFTP download (TFTPd is started and stopped around it),
                                        e.g. fetch CLU_2 'a:\\OM.LUA' 'a:\\USER.LUA'
<clu> is the CLU name or serial hex from the project.`;

export interface CluCliArgs {
  ompFile: string;
  localAddress: string;
  cluPort: number;
  command: string;
  clu: string | null;
  files: string[];
  delayMs: number;
  waitMs: number;
  outDir: string;
}

/** Parses clu-cli arguments; throws an Error with a message for the user on bad input. */
export function parseCluCliArgs(argv: string[]): CluCliArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      'omp-file':      { type: 'string' },
      'local-address': { type: 'string' },
      'clu-port':      { type: 'string' },
      delay:           { type: 'string' },
      wait:            { type: 'string' },
      out:             { type: 'string' },
    },
  });
  const [command, clu, ...files] = positionals;
  if (!command) throw new Error('missing command');
  if (!['list', 'alive', 'reset', 'refresh', 'fetch'].includes(command)) throw new Error(`unknown command: ${command}`);
  if (!values['omp-file']) throw new Error('--omp-file required');
  if (command !== 'list' && !values['local-address']) throw new Error('--local-address required');
  if (command !== 'list' && !clu) throw new Error(`${command}: <clu> required`);
  if (command === 'fetch' && files.length === 0) throw new Error('fetch: at least one remote file required');
  const num = (v: string | undefined, def: number, flag: string) => {
    if (v === undefined) return def;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new Error(`${flag}: not a number: ${v}`);
    return n;
  };
  return {
    ompFile: resolve(values['omp-file']),
    localAddress: values['local-address'] ?? '',
    cluPort: num(values['clu-port'], 1234, '--clu-port'),
    command,
    clu: clu ?? null,
    files,
    delayMs: num(values.delay, 0, '--delay'),
    waitMs: num(values.wait, command === 'refresh' ? 30000 : 60000, '--wait'),
    outDir: resolve(values.out ?? '.'),
  };
}

/** Local file name for a CLU path: 'a:\\OM.LUA' -> 'OM.LUA'. */
export function localNameFor(remote: string): string {
  return remote.split(/[\\/]/).pop()!.replace(/^[a-z]:/i, '') || 'file';
}

const log = (msg: string) => process.stdout.write(`${new Date().toISOString()} ${msg}\n`);

export async function runCluCli(argv: string[]): Promise<number> {
  let args: CluCliArgs;
  try {
    args = parseCluCliArgs(argv);
  } catch (e) {
    process.stderr.write(`Error: ${(e as Error).message}\n\n${CLU_CLI_USAGE}\n`);
    return 2;
  }

  const clus = readProjectClus(args.ompFile);
  if (args.command === 'list') {
    for (const c of clus) process.stdout.write(`${c.name}\tserial=${c.serial}\tip=${c.ipAddress}\n`);
    return 0;
  }

  const clu = findProjectClu(clus, args.clu!);
  if (!clu) {
    process.stderr.write(`Error: CLU not found: ${args.clu}. Known: ${clus.map(c => c.name).join(', ')}\n`);
    return 1;
  }
  const client = projectCluClient(clu, args.localAddress, args.cluPort);

  switch (args.command) {
    case 'alive': {
      const r = await client.checkAlive();
      log(`${clu.name} checkAlive: ${r ?? 'no answer'}`);
      return r ? 0 : 1;
    }
    case 'reset': {
      if (args.delayMs) await new Promise(r => setTimeout(r, args.delayMs));
      const t0 = Date.now();
      log(`req_reset -> ${clu.name} ${clu.ipAddress}`);
      const ok = await client.reset(args.waitMs);
      log(ok ? `${clu.name} alive again after ${Date.now() - t0} ms` : `${clu.name} not alive within ${args.waitMs} ms`);
      return ok ? 0 : 1;
    }
    case 'refresh': {
      if (args.delayMs) await new Promise(r => setTimeout(r, args.delayMs));
      const t0 = Date.now();
      log(`req_refresh_modules -> ${clu.name} ${clu.ipAddress}`);
      const resp = await client.refreshModules(args.waitMs);
      log(resp ? `${resp} after ${Date.now() - t0} ms` : `${clu.name}: no resp_refresh_modules within ${args.waitMs} ms`);
      return resp ? 0 : 1;
    }
    case 'fetch': {
      mkdirSync(args.outDir, { recursive: true });
      const started = await client.startTFTPdServer();
      if (!started) {
        process.stderr.write(`Error: ${clu.name} ${started === false ? 'refused to start TFTPd (CLU in lockdown?)' : 'did not answer the TFTPd start'}\n`);
        return 1;
      }
      let failed = 0;
      try {
        for (const remote of args.files) {
          const out = join(args.outDir, localNameFor(remote));
          try {
            const got = await client.downloadFile(remote, out);
            log(got ? `${remote} -> ${got}` : `${remote}: not found`);
            failed += got ? 0 : 1;
          } catch (e) {
            // A real CLU answers a missing file with "TFTP error 0: TFTP Server Failure".
            log(`${remote}: ${(e as Error).message}`);
            failed++;
          }
        }
      } finally {
        await client.stopTFTPdServer();
      }
      return failed ? 1 : 0;
    }
  }
  return 2;
}
