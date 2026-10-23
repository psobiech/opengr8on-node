export const SpecificObjectClass = Object.freeze({
  UNSUPPORTED: 'UNSUPPORTED',
  INPUT: 'INPUT',
  OUTPUT: 'OUTPUT',
  CONTAINER: 'CONTAINER',
  SCRIPT: 'SCRIPT',
  CLU: 'CLU',
  MOBILE_INTERFACE: 'MOBILE_INTERFACE',
} as const);

const BY_RAW = new Map<string, string>([
  ['input', SpecificObjectClass.INPUT],
  ['output', SpecificObjectClass.OUTPUT],
  ['container', SpecificObjectClass.CONTAINER],
  ['script', SpecificObjectClass.SCRIPT],
  ['clu', SpecificObjectClass.CLU],
  ['com.grenton.om.mobile.gui.mobileinterfacetreeobject', SpecificObjectClass.MOBILE_INTERFACE],
]);

export function specificObjectClassFrom(rawValue: string | null | undefined): string {
  if (!rawValue) return SpecificObjectClass.UNSUPPORTED;
  return BY_RAW.get(rawValue.toLowerCase()) ?? SpecificObjectClass.UNSUPPORTED;
}
