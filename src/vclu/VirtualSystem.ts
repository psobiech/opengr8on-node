import { statSync } from 'node:fs';
import { VirtualObject } from './VirtualObject.js';
import { VirtualCLU } from './VirtualCLU.js';
import { RemoteCLU } from './RemoteCLU.js';
import { Timer } from './Timer.js';
import { Storage } from './Storage.js';
import { HttpRequest } from './HttpRequest.js';
import { HttpListener } from './HttpListener.js';
import { MqttTopic } from './MqttTopic.js';
import { ProjectRegistry } from './ProjectRegistry.js';
import { InterfaceRegistry } from '../parsers/interfaces/InterfaceRegistry.js';
import type { IVirtualSystem, IVirtualCLU, Subscription, LuaLike } from './types.js';

export interface VirtualSystemOptions {
  rootDirectory: string;
  localAddress?: string;
  port?: number;
  /** Override CLU name. Defaults to "VIRTUAL_CLU". */
  cluName?: string;
  /** Override HTTP listener port. Defaults to 80. */
  httpListenerPort?: number;
  /** Returns CipherKey instance for a given remote address. Used by RemoteCLU. */
  cipherKeyProvider?: (address: string) => unknown;
  /** Path to device-interfaces directory or .zip — loaded by loadRegistries(). */
  interfaceRegistryPath?: string;
  /** Path to project.omp or system.xml — loaded by loadRegistries(). */
  projectOmpPath?: string;
}

const LOOP_INTERVAL_MS = 512;

export class VirtualSystem implements IVirtualSystem {
  private readonly _objectsByName = new Map<string, VirtualObject>();
  private readonly _virtualClu: VirtualCLU;
  private readonly _options: VirtualSystemOptions;
  private _luaCallFn: ((script: string) => LuaLike) | null = null;
  private _loopTimer: NodeJS.Timeout | null = null;
  private _clientReportFns = new Map<string, () => void>();
  private _lastClientReportMs = 0;
  private _interfaceRegistry: InterfaceRegistry = InterfaceRegistry.EMPTY;
  private _projectRegistry: ProjectRegistry = ProjectRegistry.empty();

  constructor(options: VirtualSystemOptions) {
    this._options = options;
    const cluName = options.cluName ?? 'VIRTUAL_CLU';
    this._virtualClu = new VirtualCLU(this, options.rootDirectory, cluName);
    this._objectsByName.set(cluName, this._virtualClu);
  }

  /** Load InterfaceRegistry and ProjectRegistry from the paths in options. Call once before setup(). */
  async loadRegistries(): Promise<void> {
    const { interfaceRegistryPath, projectOmpPath } = this._options;

    if (interfaceRegistryPath) {
      try {
        const stat = statSync(interfaceRegistryPath, { throwIfNoEntry: false });
        if (stat?.isDirectory()) {
          this._interfaceRegistry = InterfaceRegistry.fromDirectory(interfaceRegistryPath);
        } else if (stat) {
          this._interfaceRegistry = InterfaceRegistry.fromZip(interfaceRegistryPath);
        }
      } catch (e) {
        console.warn('[VirtualSystem] failed to load interface registry:', e);
      }
    }

    if (projectOmpPath) {
      try {
        this._projectRegistry = await ProjectRegistry.loadFromOmp(projectOmpPath);
      } catch (e) {
        console.warn('[VirtualSystem] failed to load project registry:', e);
      }
    }
  }

  getInterfaceRegistry(): InterfaceRegistry { return this._interfaceRegistry; }
  getProjectRegistry(): ProjectRegistry { return this._projectRegistry; }

  get localAddress(): string | undefined {
    return this._options.localAddress;
  }

  getCipherKeyFor(address: string): unknown {
    return this._options.cipherKeyProvider?.(address) ?? null;
  }

  getObject(name: string): VirtualObject | null {
    return this._objectsByName.get(name) ?? null;
  }

  getVirtualClu(): IVirtualCLU {
    return this._virtualClu;
  }

  setLuaCallFn(fn: (script: string) => LuaLike): void {
    this._luaCallFn = fn;
  }

  luaCall(script: string): LuaLike {
    if (this._luaCallFn != null) {
      try {
        return this._luaCallFn(script);
      } catch (e) {
        console.error('[VirtualSystem] luaCall error:', e);
      }
    }
    return null;
  }

  newObject(index: number, name: string, ipAddress: string | null): void {
    let obj: VirtualObject;

    switch (index) {
      case VirtualCLU.INDEX:
        this._virtualClu.name = name;
        // re-register under new name if changed
        for (const [k, v] of this._objectsByName) {
          if (v === this._virtualClu) {
            this._objectsByName.delete(k);
            break;
          }
        }
        this._objectsByName.set(name, this._virtualClu);
        return;

      case RemoteCLU.INDEX:
        obj = new RemoteCLU(this, name, ipAddress ?? '');
        break;

      case Timer.INDEX:
        obj = new Timer(this, name);
        break;

      case Storage.INDEX:
        obj = new Storage(
          this,
          name,
          `${this._options.rootDirectory}/../storage`,
        );
        break;

      case MqttTopic.INDEX:
        obj = new MqttTopic(this, name);
        break;

      default:
        obj = new VirtualObject(this, name);
        break;
    }

    this._objectsByName.set(name, obj);
  }

  newGate(index: number, name: string): void {
    let obj: VirtualObject;

    switch (index) {
      case HttpRequest.INDEX:
        obj = new HttpRequest(this, name);
        break;

      case HttpListener.INDEX:
        obj = new HttpListener(
          this,
          name,
          this._options.httpListenerPort ?? HttpListener.DEFAULT_PORT,
          this._options.localAddress,
        );
        break;

      case MqttTopic.INDEX:
        obj = new MqttTopic(this, name);
        break;

      default:
        obj = new VirtualObject(this, name);
        break;
    }

    this._objectsByName.set(name, obj);
  }

  setup(): void {
    for (const obj of this._objectsByName.values()) {
      try {
        obj.setup();
      } catch (e) {
        console.error(`[VirtualSystem] setup error for ${obj.name}:`, e);
      }
    }
  }

  loop(): void {
    for (const obj of this._objectsByName.values()) {
      try {
        obj.loop();
      } catch (e) {
        console.error(`[VirtualSystem] loop error for ${obj.name}:`, e);
      }
    }
    // Drive client-report pushes (works in both setInterval-driven and Lua-loop-driven modes)
    const now = Date.now();
    if (now - this._lastClientReportMs >= 1000) {
      this._lastClientReportMs = now;
      for (const fn of this._clientReportFns.values()) {
        try { fn(); } catch { /* ignore */ }
      }
    }
  }

  /** Start the periodic loop. Call once after setup(). */
  startLoop(): void {
    if (this._loopTimer != null) return;
    this._loopTimer = setInterval(() => this.loop(), LOOP_INTERVAL_MS);
  }

  stopLoop(): void {
    if (this._loopTimer != null) {
      clearInterval(this._loopTimer);
      this._loopTimer = null;
    }
  }

  fetchValues(subscriptions: Subscription[]): string {
    const values = subscriptions.map((sub) => {
      const val = sub.object.get(sub.index);
      return luaStringify(val);
    });
    return `{${values.join(',')}}`;
  }

  clientRegister(
    remoteAddr: string,
    addr: string,
    port: number,
    sessionId: number,
    subs: Subscription[],
  ): string {
    const key = `${addr}:${port}:${sessionId}`;

    const sendValues = (): void => {
      const valStr = this.fetchValues(subs);
      const response = `clientReport:${sessionId}:${valStr}`;
      this._sendClientReport(addr, port, sessionId, response);
      if (addr !== remoteAddr) {
        this._sendClientReport(remoteAddr, port, sessionId, response);
      }
    };

    this._clientReportFns.set(key, sendValues);
    return `clientReport:${sessionId}:${this.fetchValues(subs)}`;
  }

  private _sendClientReportImpl: ((addr: string, port: number, sessionId: number, response: string) => void) | null = null;

  private _sendClientReport(addr: string, port: number, sessionId: number, response: string): void {
    this._sendClientReportImpl?.(addr, port, sessionId, response);
  }

  setSendClientReportFn(fn: (addr: string, port: number, sessionId: number, response: string) => void): void {
    this._sendClientReportImpl = fn;
  }

  clientDestroy(addr: string, port: number, sessionId: number): number {
    this._clientReportFns.delete(`${addr}:${port}:${sessionId}`);
    return sessionId;
  }

  close(): void {
    this.stopLoop();
    this._clientReportFns.clear();
    for (const obj of this._objectsByName.values()) {
      try {
        obj.close();
      } catch (e) {
        console.error(`[VirtualSystem] close error for ${obj.name}:`, e);
      }
    }
    this._objectsByName.clear();
  }
}

function luaStringify(value: LuaLike): string {
  if (value === null || value === undefined) return 'nil';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return `"${value.replace(/"/g, '\\"')}"`;
  if (Array.isArray(value)) return `{${value.map(luaStringify).join(',')}}`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, LuaLike>)
      .map(([k, v]) => `${k}=${luaStringify(v)}`)
      .join(',');
    return `{${entries}}`;
  }
  return String(value);
}
