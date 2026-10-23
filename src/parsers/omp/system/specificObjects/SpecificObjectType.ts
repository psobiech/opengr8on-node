export const SpecificObjectType = Object.freeze({
  UNSUPPORTED: 'UNSUPPORTED',
  CLU: 'CLU',
  SCRIPT: 'SCRIPT',
  CONTAINER: 'CONTAINER',
  DIMM: 'DIMM',
  BUTTON: 'BUTTON',
  DIN: 'DIN',
  DOUT: 'DOUT',
  PANEL: 'PANEL',
  PANEL_PAGE: 'PANEL_PAGE',
  PANEL_BUTTON: 'PANEL_BUTTON',
  PANEL_TEMPERATURE: 'PANEL_TEMPERATURE',
  PANEL_LUMINOSITY: 'PANEL_LUMINOSITY',
  ANALOG_OUT: 'ANALOG_OUT',
  ANALOG_IN: 'ANALOG_IN',
  POWER_SUPPLY_VOLTAGE: 'POWER_SUPPLY_VOLTAGE',
  LED_RGB: 'LED_RGB',
  ROLLER_SHUTTER: 'ROLLER_SHUTTER',
  ZWAVE_CONFIG: 'ZWAVE_CONFIG',
  ZWAVE_FAKRO: 'ZWAVE_FAKRO',
  ZWAVE_UNKNOWN_MODULE: 'ZWAVE_UNKNOWN_MODULE',
} as const);

const BY_RAW = new Map<string, string>([
  ['clu', SpecificObjectType.CLU],
  ['script', SpecificObjectType.SCRIPT],
  ['container', SpecificObjectType.CONTAINER],
  ['dimm', SpecificObjectType.DIMM],
  ['button', SpecificObjectType.BUTTON],
  ['din', SpecificObjectType.DIN],
  ['dout', SpecificObjectType.DOUT],
  ['panel', SpecificObjectType.PANEL],
  ['panel_page', SpecificObjectType.PANEL_PAGE],
  ['panel_button', SpecificObjectType.PANEL_BUTTON],
  ['panelsenstemp', SpecificObjectType.PANEL_TEMPERATURE],
  ['panelsenslight', SpecificObjectType.PANEL_LUMINOSITY],
  ['analogout', SpecificObjectType.ANALOG_OUT],
  ['analogin', SpecificObjectType.ANALOG_IN],
  ['powersupplyvoltage', SpecificObjectType.POWER_SUPPLY_VOLTAGE],
  ['ledrgb', SpecificObjectType.LED_RGB],
  ['roller_shutter', SpecificObjectType.ROLLER_SHUTTER],
  ['zwave_config', SpecificObjectType.ZWAVE_CONFIG],
  ['zwave_fakro', SpecificObjectType.ZWAVE_FAKRO],
  ['zwave_unknown_module', SpecificObjectType.ZWAVE_UNKNOWN_MODULE],
]);

export function specificObjectTypeFrom(rawValue: string | null | undefined): string {
  if (!rawValue) return SpecificObjectType.UNSUPPORTED;
  return BY_RAW.get(rawValue.toLowerCase()) ?? SpecificObjectType.UNSUPPORTED;
}
