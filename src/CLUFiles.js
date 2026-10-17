export const CLUFiles = Object.freeze({
  USER_LUA:            { device: 'a', fileName: 'USER.LUA',           readable: true,  writable: true  },
  OM_LUA:              { device: 'a', fileName: 'OM.LUA',             readable: true,  writable: true  },
  MAIN_LUA:            { device: 'a', fileName: 'MAIN.LUA',           readable: true,  writable: true  },
  INIT_LUA:            { device: 'a', fileName: 'INIT.LUA',           readable: true,  writable: true  },
  EMERGNCY_LUA:        { device: 'a', fileName: 'EMERGNCY.LUA',       readable: true,  writable: true  },
  SETTINGS_USR:        { device: 'a', fileName: 'settings.usr',       readable: true,  writable: true  },
  CONFIG_TXT:          { device: 'a', fileName: 'config.txt',         readable: true,  writable: false },
  CONFIG_JSON:         { device: 'a', fileName: 'CONFIG.JSON',        readable: true,  writable: false },
  MEASUREMENT_FILE:    { device: 'p', fileName: 'meas.bin',           readable: true,  writable: false },
  IMAGE_FW:            { device: 'm', fileName: 'image.fw',           readable: false, writable: true  },
  DEBUG_BIN:           { device: 'm', fileName: 'debug.bin',          readable: true,  writable: false },
  DIAGNOSTIC_PACK_JSON:{ device: 'm', fileName: 'DIAGNOSTIC_PACK.JSON', readable: true, writable: false },
  CLOUD_PRIVATE_PEM:   { device: 'a', fileName: 'CLOUD-PRIVATE.PEM',  readable: true,  writable: true  },
  CLOUD_PUBLIC_CSR:    { device: 'a', fileName: 'CLOUD-PUBLIC.CSR',   readable: true,  writable: true  },
  CLOUD_PUBLIC_CRT:    { device: 'a', fileName: 'CLOUD-PUBLIC.CRT',   readable: true,  writable: true  },
  CLOUD_ROOT_PEM:      { device: 'a', fileName: 'CLOUD-ROOT.PEM',     readable: true,  writable: true  },
  OPEN_LUA:            { device: 'a', fileName: 'OPEN.LUA',           readable: true,  writable: true  },
});

export function getLocation(file) {
  return `${file.device}:\\${file.fileName}`;
}
