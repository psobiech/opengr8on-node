import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ModuleTranscript, Feature, Method, Event, EnumValue } from './ModuleTranscript.js';
import { parseModuleXml } from './InterfaceRegistry.js';

export interface TranscribeOptions {
  /** Translation language code. Default: `'pl'`. Falls back to `'en'` if key missing. */
  lang?: string;
}

export interface TranscribeResult {
  output: ModuleTranscript;
  errors: string[];
}

export function loadProperties(filePath: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!existsSync(filePath)) return map;
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    if (line.startsWith('#') || !line.includes('=')) continue;
    const eq = line.indexOf('=');
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim()
      .replace(/\\u([0-9a-fA-F]{4})/g, (_match: string, c: string) => String.fromCharCode(parseInt(c, 16)));
    map.set(key, val);
  }
  return map;
}

function makeTranslator(resDir: string, lang: string): (resKey: string | undefined) => string | undefined {
  const translations = loadProperties(join(resDir, `device-interfaces_${lang}.properties`));
  const fallback = lang !== 'en'
    ? loadProperties(join(resDir, 'device-interfaces_en.properties'))
    : new Map<string, string>();
  return (resKey) => {
    if (!resKey) return undefined;
    return translations.get(resKey) ?? fallback.get(resKey);
  };
}

type WithResKey<T> = T & { resKey?: string };

function withDesc<T>(t: (k: string | undefined) => string | undefined, obj: WithResKey<T>): T & { desc?: string } {
  const { resKey, ...rest } = obj as WithResKey<T> & Record<string, unknown>;
  const desc = t(resKey);
  const result = rest as T & { desc?: string };
  if (desc !== undefined) result.desc = desc;
  return result;
}

function indexBy<T>(arr: T[], keyFn: (item: T) => number): Record<number, T> {
  const out: Record<number, T> = {};
  for (const item of arr) out[keyFn(item)] = item;
  return out;
}

function setNested(obj: Record<string | number, unknown>, keys: number[], value: unknown): void {
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (!(k in cur)) cur[k] = {};
    cur = cur[k] as Record<string | number, unknown>;
  }
  cur[keys[keys.length - 1]] = value;
}

/**
 * Reads all `module_*.xml` files from `dir`, parses them, resolves translations,
 * and returns a nested lookup keyed by `[hwType][fwType][fwApiVer]`.
 */
export function transcribeModules(dir: string, options: TranscribeOptions = {}): TranscribeResult {
  const lang = options.lang ?? 'pl';
  const t = makeTranslator(join(dir, 'text-resources'), lang);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wd = <T>(obj: WithResKey<T>) => withDesc(t, obj);

  const files = readdirSync(dir).filter((f) => f.startsWith('module_') && f.endsWith('.xml'));
  const output: Record<number, unknown> = {};
  const errors: string[] = [];

  for (const fileName of files) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m: any = parseModuleXml(readFileSync(join(dir, fileName), 'utf8'));
      if (!m) { errors.push(`${fileName}: no root element`); continue; }

      const hwType = m.typeId != null ? parseInt(m.typeId as string, 16) : NaN;
      const fwType = m.firmware?.typeId != null ? parseInt(m.firmware.typeId as string, 16) : NaN;
      const fwApiVer = m.firmware?.version != null ? parseInt(m.firmware.version as string, 16) : NaN;

      if (isNaN(hwType) || isNaN(fwType) || isNaN(fwApiVer)) {
        errors.push(`${fileName}: missing hwType/fwType/fwApiVer`); continue;
      }

      const objects: Record<number, unknown> = {};
      for (const o of (m.firmware?.objects ?? []) as {
        class: string; name: string; type: string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        interface: { features: any[]; methods: any[]; events: any[] };
      }[]) {
        objects[parseInt(o.class, 10)] = {
          name: o.name,
          type: o.type,
          features: indexBy<Feature>(
            o.interface.features.map((f) => wd({ ...f, enums: (f.enums as WithResKey<EnumValue>[]).map(wd) })),
            (f) => f.index,
          ),
          methods: indexBy<Method>(o.interface.methods.map(wd), (m) => m.index),
          events: indexBy<Event>(o.interface.events.map(wd), (e) => e.address),
        };
      }

      setNested(output, [hwType, fwType, fwApiVer], { name: (m.name as string) ?? null, file: fileName, objects });
    } catch (e) {
      errors.push(`${fileName}: ${(e as Error).message}`);
    }
  }

  return { output: output as ModuleTranscript, errors };
}
