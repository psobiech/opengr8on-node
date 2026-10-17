export interface EnumValue {
  name: string;
  value: number;
  /** Translated description (resKey resolved) */
  desc?: string;
}

export interface Feature {
  name: string;
  type: string;
  unit?: string;
  default?: string;
  get: boolean;
  set: boolean;
  index: number;
  range?: string;
  enumValues?: string[] | null;
  enums: EnumValue[];
  /** Translated description (resKey resolved) */
  desc?: string;
}

export interface MethodParam {
  name: string;
  type: string;
  range?: string;
  unit?: string;
  default?: string;
}

export interface Method {
  index: number;
  call: string;
  name: string;
  return?: string;
  unit?: string;
  params: MethodParam[];
  /** Translated description (resKey resolved) */
  desc?: string;
}

export interface Event {
  address: number;
  name: string;
  /** Translated description (resKey resolved) */
  desc?: string;
}

export interface ModuleObject {
  name: string;
  type: string;
  /** Keyed by feature index */
  features: Record<number, Feature>;
  /** Keyed by method index */
  methods: Record<number, Method>;
  /** Keyed by event address */
  events: Record<number, Event>;
}

export interface ModuleEntry {
  name: string | null;
  /** Source XML file name */
  file: string;
  /** Keyed by CLU object class ID */
  objects: Record<number, ModuleObject>;
}

/**
 * Nested lookup: transcript[hwType][fwType][fwApiVer] → ModuleEntry
 * All keys are decimal integers (JSON object keys are strings but represent numbers).
 */
export type ModuleTranscript = Record<number, Record<number, Record<number, ModuleEntry>>>;
