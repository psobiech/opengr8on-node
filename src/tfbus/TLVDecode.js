import { TLVType } from './StatusPollResponse.js';

const TLV_NAMES = Object.fromEntries(Object.entries(TLVType).map(([k, v]) => [v, k]));

export function decodeValue(type, data) {
  switch (type) {
    case TLVType.TEMPERATURE:
      return data.length >= 2 ? `${(data.readUInt16LE(0) / 100).toFixed(2)}°C` : data.toString('hex');
    case TLVType.LIGHT:
      return data.length >= 2 ? `${(data.readUInt16LE(0) / 100).toFixed(2)}%` : data.toString('hex');
    case TLVType.ROLLER_POSITION:
      return data.length >= 3
        ? `ch${data[0]} ${data[1]}%${data[2] !== 0 ? ' moving' : ' stopped'}`
        : data.toString('hex');
    case TLVType.INPUT_BITMASK:
      return data.length >= 1 ? `0b${data[0].toString(2).padStart(8, '0')}` : data.toString('hex');
    case TLVType.STATE:
      if (data.length >= 2) return `${(data.readUInt16LE(0) / 10).toFixed(1)}%`;
      return data.length >= 1 ? (data[0] === 0 ? 'idle' : 'active') : data.toString('hex');
    case TLVType.DIGITAL_STATE:
      return data.length >= 1 ? (data[0] === 0 ? 'idle' : 'active') : data.toString('hex');
    case TLVType.POLL_COUNTER: {
      if (data.length < 1) return data.toString('hex');
      const v = data.length >= 3
        ? (data[2] << 16) | (data[1] << 8) | data[0]
        : data[0];
      return String(v);
    }
    default:
      return data.toString('hex');
  }
}

export function decodeTlvRecord(record) {
  const typeName = TLV_NAMES[record.type] ?? `0x${record.type.toString(16).padStart(2, '0')}`;
  return `${typeName}: ${decodeValue(record.type, record.data)}`;
}
