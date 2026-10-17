export const CLUDataTypeEnum = Object.freeze({
  VOID: 'void',
  NUMBER: 'num',
  STRING: 'str',
  BOOLEAN: 'confirmation',
  TIMESTAMP: 'timestamp',
});

const BY_TYPE = new Map(Object.entries(CLUDataTypeEnum).map(([k, v]) => [v, k]));

export function cluDataTypeOf(typeStr) {
  const key = BY_TYPE.get(typeStr);
  if (key === undefined) throw new Error(`Unsupported data type: ${typeStr}`);
  return key;
}
