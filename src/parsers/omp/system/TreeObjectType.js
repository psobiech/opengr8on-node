const NAMES = [
  'UNSUPPORTED', 'INPUT', 'OUTPUT', 'CLU', 'HARDWARE_PERIPHERY',
  'OBJECT_MANAGER', 'SCRIPT', 'CONTAINER', 'SCRIPT_CONTAINER',
  'APPLICATIONS_CONTAINER', 'VISUAL_BUILDER', 'MYGRENTON_INTERFACE', 'MYGRENTON_INTERFACES',
];

export const TreeObjectType = Object.freeze(Object.fromEntries(NAMES.map(v => [v, v])));

export function treeObjectTypeFrom(label) {
  if (!label) return TreeObjectType.UNSUPPORTED;
  return TreeObjectType[label.toUpperCase()] ?? TreeObjectType.UNSUPPORTED;
}
