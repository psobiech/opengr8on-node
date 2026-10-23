export const CipherType = Object.freeze({
  NONE: 'NONE',
  PROJECT: 'PROJECT',
  UNKNOWN: 'UNKNOWN',
} as const);

export type CipherTypeValue = typeof CipherType[keyof typeof CipherType];
