export const CLUClassNameEnum = Object.freeze({
  CLU: 'CLU',
  GATE: 'GATE',
});

export function cluClassNameOf(str) {
  const upper = str?.toUpperCase();
  return CLUClassNameEnum[upper] ?? CLUClassNameEnum.CLU;
}
