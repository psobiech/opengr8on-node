export const SpecificObjectClass = Object.freeze({
  UNSUPPORTED: 'UNSUPPORTED',
  INPUT: 'INPUT',
  OUTPUT: 'OUTPUT',
  CONTAINER: 'CONTAINER',
  SCRIPT: 'SCRIPT',
  CLU: 'CLU',
  MOBILE_INTERFACE: 'MOBILE_INTERFACE',
});

const BY_RAW = new Map([
  ['input', SpecificObjectClass.INPUT],
  ['output', SpecificObjectClass.OUTPUT],
  ['container', SpecificObjectClass.CONTAINER],
  ['script', SpecificObjectClass.SCRIPT],
  ['clu', SpecificObjectClass.CLU],
  ['com.grenton.om.mobile.gui.mobileinterfacetreeobject', SpecificObjectClass.MOBILE_INTERFACE],
]);

export function specificObjectClassFrom(rawValue) {
  if (!rawValue) return SpecificObjectClass.UNSUPPORTED;
  return BY_RAW.get(rawValue.toLowerCase()) ?? SpecificObjectClass.UNSUPPORTED;
}
