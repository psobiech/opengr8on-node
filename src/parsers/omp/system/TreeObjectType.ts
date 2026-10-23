const NAMES = [
  'UNSUPPORTED', 'INPUT', 'OUTPUT', 'CLU', 'HARDWARE_PERIPHERY',
  'OBJECT_MANAGER', 'SCRIPT', 'CONTAINER', 'SCRIPT_CONTAINER',
  'APPLICATIONS_CONTAINER', 'VISUAL_BUILDER', 'MYGRENTON_INTERFACE', 'MYGRENTON_INTERFACES',
] as const;

type TreeObjectTypeName = typeof NAMES[number];

export const TreeObjectType = Object.freeze(
  Object.fromEntries(NAMES.map(v => [v, v])) as Record<TreeObjectTypeName, TreeObjectTypeName>
);

export function treeObjectTypeFrom(label: string | null | undefined): string {
  if (!label) return TreeObjectType.UNSUPPORTED;
  return (TreeObjectType as Record<string, string>)[label.toUpperCase()] ?? TreeObjectType.UNSUPPORTED;
}
