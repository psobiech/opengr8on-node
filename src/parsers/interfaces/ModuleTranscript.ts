export interface EnumValue {
  name: string;
  value: number;
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
  desc?: string;
}

export interface Event {
  address: number;
  name: string;
  desc?: string;
}

export interface ModuleObject {
  name: string;
  type: string;
  features: Record<number, Feature>;
  methods: Record<number, Method>;
  events: Record<number, Event>;
}

export interface ModuleEntry {
  name: string | null;
  file: string;
  objects: Record<number, ModuleObject>;
}

export type ModuleTranscript = Record<number, Record<number, Record<number, ModuleEntry>>>;
