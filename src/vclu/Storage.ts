import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { VirtualObject } from './VirtualObject.js';
import type { IVirtualSystem, LuaLike } from './types.js';

export const STORAGE_FEATURES = {
  STORAGE_UTILIZATION: 1,
} as const;

export const STORAGE_METHODS = {
  ERASE_ALL: 3,
  STORE: 4,
} as const;

export class Storage extends VirtualObject {
  static readonly INDEX = 44;
  static readonly FEATURES = STORAGE_FEATURES;
  static readonly METHODS = STORAGE_METHODS;

  private readonly _storagePath: string;
  private _variables = new Map<string, LuaLike>();
  private _syncTimer: NodeJS.Timeout | null = null;

  constructor(virtualSystem: IVirtualSystem | null, name: string, storageRootPath: string) {
    super(virtualSystem, name);

    mkdirSync(storageRootPath, { recursive: true });
    this._storagePath = `${storageRootPath}/storage.json`;

    this.setValue(STORAGE_FEATURES.STORAGE_UTILIZATION, 0);

    this.registerMethod(STORAGE_METHODS.STORE, () => {
      this._persist();
      return null;
    });

    this.registerMethod(STORAGE_METHODS.ERASE_ALL, () => {
      this._variables.clear();
      try {
        writeFileSync(this._storagePath, '{}', 'utf8');
      } catch (e) {
        console.error(`[${this.name}] erase storage error:`, e);
      }
      this.setValue(STORAGE_FEATURES.STORAGE_UTILIZATION, 0);
      return null;
    });
  }

  override setup(): void {
    this._restore();
    this._syncTimer = setInterval(() => this._sync(), 1000);
  }

  /** Get a stored variable by name. */
  getVar(varName: string): LuaLike {
    return this._variables.get(varName) ?? null;
  }

  /** Set a stored variable by name (does not auto-persist; call store() or wait for sync). */
  setVar(varName: string, value: LuaLike): void {
    this._variables.set(varName, value);
  }

  /** All stored variable names. */
  getVarNames(): string[] {
    return [...this._variables.keys()];
  }

  private _restore(): void {
    if (!existsSync(this._storagePath)) return;
    try {
      const raw = readFileSync(this._storagePath, 'utf8').trim();
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, LuaLike>;
      for (const [k, v] of Object.entries(parsed)) {
        this._variables.set(k, v as LuaLike);
      }
    } catch (e) {
      console.error(`[${this.name}] restore error:`, e);
    }
  }

  private _sync(): void {
    // Pull current values from Lua globals if a luaCall function is available
    if (this.virtualSystem != null) {
      let changed = false;
      for (const [varName] of this._variables) {
        try {
          const current = this.virtualSystem.luaCall(`getVar("${varName}")`);
          if (current !== this._variables.get(varName)) {
            this._variables.set(varName, current);
            changed = true;
          }
        } catch {
          // luaCall not available or variable doesn't exist — skip
        }
      }
      if (changed) this._persist();
    }
  }

  private _persist(): void {
    try {
      const dir = dirname(this._storagePath);
      mkdirSync(dir, { recursive: true });
      const obj: Record<string, LuaLike> = {};
      for (const [k, v] of this._variables) obj[k] = v;
      writeFileSync(this._storagePath, JSON.stringify(obj, null, 2), 'utf8');
      this.setValue(STORAGE_FEATURES.STORAGE_UTILIZATION, this._variables.size);
    } catch (e) {
      console.error(`[${this.name}] persist error:`, e);
    }
  }

  override close(): void {
    if (this._syncTimer != null) {
      clearInterval(this._syncTimer);
      this._syncTimer = null;
    }
    this._persist();
  }
}
