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

type WithResKey<T> = T & { resKey?: string };

/**
 * Reads all `module_*.xml` files from `dir`, parses them, resolves translations,
 * and returns a nested lookup keyed by `[hwType][fwType][fwApiVer]`.
 */
export function transcribeModules(dir: string, options: TranscribeOptions = {}): TranscribeResult {
  const lang = options.lang ?? 'pl';
  const translate = makeTranslator(join(dir, 'text-resources'), lang);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const withDescription = <T>(entry: WithResKey<T>) => withDesc(translate, entry);

  const files = readdirSync(dir).filter((fileName) => fileName.startsWith('module_') && fileName.endsWith('.xml'));
  const output: Record<number, unknown> = {};
  const errors: string[] = [];

  for (const fileName of files) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const moduleDefinition: any = parseModuleXml(readFileSync(join(dir, fileName), 'utf8'));
      if (!moduleDefinition) { errors.push(`${fileName}: no root element`); continue; }

      const hwType = moduleDefinition.typeId != null ? parseInt(moduleDefinition.typeId as string, 16) : NaN;
      const fwType = moduleDefinition.firmware?.typeId != null ? parseInt(moduleDefinition.firmware.typeId as string, 16) : NaN;
      const fwApiVer = moduleDefinition.firmware?.version != null ? parseInt(moduleDefinition.firmware.version as string, 16) : NaN;

      if (isNaN(hwType) || isNaN(fwType) || isNaN(fwApiVer)) {
        errors.push(`${fileName}: missing hwType/fwType/fwApiVer`); continue;
      }

      const objects: Record<number, unknown> = {};
      for (const objectDefinition of (moduleDefinition.firmware?.objects ?? []) as {
        class: string; name: string; type: string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        interface: { features: any[]; methods: any[]; events: any[] };
      }[]) {
        objects[parseInt(objectDefinition.class, 10)] = {
          name: objectDefinition.name,
          type: objectDefinition.type,
          features: indexBy<Feature>(
            objectDefinition.interface.features.map((feature) => withDescription({ ...feature, enums: (feature.enums as WithResKey<EnumValue>[]).map(withDescription) })),
            (feature) => feature.index,
          ),
          methods: indexBy<Method>(objectDefinition.interface.methods.map(withDescription), (method) => method.index),
          events: indexBy<Event>(objectDefinition.interface.events.map(withDescription), (event) => event.address),
        };
      }

      setNested(output, [hwType, fwType, fwApiVer], { name: (moduleDefinition.name as string) ?? null, file: fileName, objects });
    } catch (error) {
      errors.push(`${fileName}: ${(error as Error).message}`);
    }
  }

  return { output: output as ModuleTranscript, errors };
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

export function loadProperties(filePath: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!existsSync(filePath)) return map;
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    if (line.startsWith('#') || !line.includes('=')) continue;
    const separatorIdx = line.indexOf('=');
    const key = line.slice(0, separatorIdx).trim();
    const value = line.slice(separatorIdx + 1).trim()
      .replace(/\\u([0-9a-fA-F]{4})/g, (_match: string, hexCode: string) => String.fromCharCode(parseInt(hexCode, 16)));
    map.set(key, value);
  }
  return map;
}

function withDesc<T>(translate: (resKey: string | undefined) => string | undefined, entry: WithResKey<T>): T & { desc?: string } {
  const { resKey, ...rest } = entry as WithResKey<T> & Record<string, unknown>;
  const desc = translate(resKey);
  const result = rest as T & { desc?: string };
  if (desc !== undefined) result.desc = desc;
  return result;
}

function indexBy<T>(items: T[], keyFn: (item: T) => number): Record<number, T> {
  const result: Record<number, T> = {};
  for (const item of items) result[keyFn(item)] = item;
  return result;
}

function setNested(target: Record<string | number, unknown>, keys: number[], value: unknown): void {
  let current = target;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current)) current[key] = {};
    current = current[key] as Record<string | number, unknown>;
  }
  current[keys[keys.length - 1]] = value;
}
