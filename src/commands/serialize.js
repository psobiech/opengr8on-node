export function serializeCommand(...parts) {
  return Buffer.concat(parts.map(part => {
    if (Buffer.isBuffer(part)) return part;
    if (typeof part === 'string') return Buffer.from(part, 'utf8');
    if (typeof part === 'number' || typeof part === 'bigint') return Buffer.from(String(part), 'utf8');
    throw new Error(`Unsupported serialize type: ${typeof part}`);
  }));
}

export function asString(buf, offset = 0, length) {
  const end = length != null ? offset + length : buf.length;
  return buf.slice(offset, end).toString('utf8').replace(/\0+$/, '').trim();
}

export function splitExact(str, sep, count) {
  const parts = str.split(sep);
  if (parts.length !== count) return null;
  return parts;
}

export function splitAtLeast(str, sep, minCount) {
  const parts = str.split(sep);
  if (parts.length < minCount) return null;
  return parts;
}
