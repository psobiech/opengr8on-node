import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const HARDWARE_TYPE    = 0x13;
const HARDWARE_VERSION = 0x01;
const FIRMWARE_TYPE    = 0x03;
const FIRMWARE_VERSION = 0x00aa55aa;
const KEY_BYTES        = 16;
const IV_BYTES         = 16;

export interface CluKeys {
  key:       Buffer;
  iv:        Buffer;
  defaultIV: Buffer;
  pin:       Buffer;
}

export interface CLUDeviceConfig {
  sn:            number;
  mac:           string;
  hwType:        number;
  hwVer:         number;
  fwType:        number;
  fwApiVer:      number;
  fwVer:         string;
  status:        string;
  tfbusDevices:  unknown[];
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

export function readOrGenerateKeys(runtimeDirectory: string): CluKeys {
  mkdirSync(runtimeDirectory, { recursive: true });
  const keysPath = resolve(runtimeDirectory, 'keys.json');

  if (existsSync(keysPath)) {
    const raw = JSON.parse(readFileSync(keysPath, 'utf8')) as {
      key: string; iv: string; defaultIV: string; pin: string;
    };
    return {
      key:       Buffer.from(raw.key,       'base64'),
      iv:        Buffer.from(raw.iv,        'base64'),
      defaultIV: Buffer.from(raw.defaultIV, 'base64'),
      pin:       Buffer.from(raw.pin,       'base64'),
    };
  }

  const iv  = randomBytes(IV_BYTES);
  const pin = randomBytes(4).toString('hex').toUpperCase(); // 8-char uppercase hex
  const keys: CluKeys = {
    key:       randomBytes(KEY_BYTES),
    iv,
    defaultIV: iv,
    pin:       Buffer.from(pin, 'ascii'),
  };

  writeKeys(runtimeDirectory, keys);
  return keys;
}

export function writeKeys(runtimeDirectory: string, keys: CluKeys): void {
  mkdirSync(runtimeDirectory, { recursive: true });
  const keysPath = resolve(runtimeDirectory, 'keys.json');
  const data = {
    key:       keys.key.toString('base64'),
    iv:        keys.iv.toString('base64'),
    defaultIV: keys.defaultIV.toString('base64'),
    pin:       keys.pin.toString('base64'),
  };
  writeFileSync(keysPath, JSON.stringify(data), 'utf8');
}

// ---------------------------------------------------------------------------
// Device config
// ---------------------------------------------------------------------------

export function readOrGenerateDeviceConfig(aDriveDirectory: string, macAddress: string): CLUDeviceConfig {
  mkdirSync(aDriveDirectory, { recursive: true });
  const configJsonPath = resolve(aDriveDirectory, 'CONFIG.JSON');

  let config: CLUDeviceConfig;
  if (existsSync(configJsonPath)) {
    const raw = JSON.parse(readFileSync(configJsonPath, 'utf8')) as CLUDeviceConfig;
    config = { ...raw, mac: macAddress };
  } else {
    const sn = Number(BigInt('0x' + randomBytes(4).toString('hex')));
    config = {
      sn,
      mac:          macAddress,
      hwType:       HARDWARE_TYPE,
      hwVer:        HARDWARE_VERSION,
      fwType:       FIRMWARE_TYPE,
      fwApiVer:     FIRMWARE_VERSION,
      fwVer:        `${FIRMWARE_VERSION.toString(16).padStart(8, '0')}-0000`,
      status:       'OK',
      tfbusDevices: [],
    };
  }

  writeDeviceConfig(aDriveDirectory, config);
  return config;
}

export function writeDeviceConfig(aDriveDirectory: string, config: CLUDeviceConfig): void {
  mkdirSync(aDriveDirectory, { recursive: true });
  writeFileSync(resolve(aDriveDirectory, 'CONFIG.JSON'), JSON.stringify(config), 'utf8');

  const hex = (n: number, bytes = 4) =>
    n.toString(16).toLowerCase().padStart(bytes * 2, '0');

  const macHex = config.mac.toLowerCase().replace(/[^0-9a-f]/g, '').padStart(12, '0')
    .match(/.{2}/g)!.join(':');

  const lines = [
    hex(0x00000000),
    hex(config.sn),
    macHex,
    hex(config.fwType),
    hex(config.fwApiVer),
    hex(config.hwType),
    hex(config.hwVer),
  ];
  writeFileSync(resolve(aDriveDirectory, 'config.txt'), lines.join('\r\n') + '\r\n', 'utf8');
}
