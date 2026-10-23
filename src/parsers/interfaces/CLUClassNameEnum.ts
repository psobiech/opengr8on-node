export const CLUClassNameEnum = Object.freeze({
  CLU: 'CLU',
  GATE: 'GATE',
} as const);

export function cluClassNameOf(str: string | null | undefined): string {
  const upper = str?.toUpperCase();
  return (upper && (CLUClassNameEnum as Record<string, string>)[upper]) ?? CLUClassNameEnum.CLU;
}
