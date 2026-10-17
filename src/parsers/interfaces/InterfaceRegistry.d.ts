export interface ParsedEnumValue {
  name: string;
  resKey?: string;
  value: number;
}

export interface ParsedFeature {
  name: string;
  type: string;
  unit?: string;
  default?: string;
  get: boolean;
  set: boolean;
  index: number;
  range?: string;
  resKey?: string;
  enumValues?: string[] | null;
  enums: ParsedEnumValue[];
}

export interface ParsedMethodParam {
  name: string;
  type: string;
  range?: string;
  unit?: string;
  default?: string;
}

export interface ParsedMethod {
  index: number;
  call: string;
  name: string;
  return?: string;
  unit?: string;
  resKey?: string;
  params: ParsedMethodParam[];
}

export interface ParsedEvent {
  address: number;
  name: string;
  resKey?: string;
}

export interface ParsedInterface {
  features: ParsedFeature[];
  methods: ParsedMethod[];
  events: ParsedEvent[];
}

export interface ParsedModuleObject {
  class: string;
  count?: string;
  name: string;
  type: string;
  interface: ParsedInterface;
}

export interface ParsedModule {
  name?: string;
  typeId?: string;
  firmware: {
    typeId?: string;
    version?: string;
    objects: ParsedModuleObject[];
  } | null;
}

export interface ParsedCluObject {
  maxInstances: number;
  name: string;
  version: number;
}

export interface ParsedClu {
  className: string;
  firmwareType?: string;
  firmwareVersion?: string;
  hardwareType?: string;
  hardwareVersion?: string;
  typeName?: string;
  interface: ParsedInterface;
  objects: ParsedCluObject[];
  modulesVersionConstraints: { type: string; version: number }[];
  options: { name: string; value: string }[];
}

export interface ParsedObject {
  class: string;
  name: string;
  version: string;
  className: string;
  features: ParsedFeature[];
  methods: ParsedMethod[];
  events: ParsedEvent[];
}

export declare function parseModuleXml(content: string): ParsedModule | null;
export declare function parseCluXml(content: string): ParsedClu | null;
export declare function parseObjectXml(content: string): ParsedObject | null;

export declare class InterfaceRegistry {
  static get EMPTY(): InterfaceRegistry;
  static fromDirectory(dirPath: string): InterfaceRegistry;
  static fromZip(zipPath: string): InterfaceRegistry;

  getCLU(hardwareType: number, hardwareVersion: number, firmwareType: number, firmwareVersion: number): ParsedClu | null;
  getModule(hardwareType: number, firmwareType: number, firmwareVersion: number): ParsedModule | null;
  getObject(name: string, version: number | string): ParsedObject | null;

  allModules(): ParsedModule[];
  allCLUs(): ParsedClu[];
  allObjects(): ParsedObject[];

  get cluCount(): number;
  get moduleCount(): number;
  get objectCount(): number;
}
