// Client-side entry point: talk to CLUs over UDP/TFTP and read OM projects / interface XMLs.
// Unlike the root index it does not pull in tfbus (serialport), vclu (wasmoon, mqtt) or the MCP
// servers, so it can be bundled into hosts like a VS Code extension.
// Runtime deps: Node builtins, fast-xml-parser, adm-zip.
export { CipherKey } from './CipherKey.js';
export { Client } from './Client.js';
export { CLUClient } from './CLUClient.js';
export { CLUFiles, getLocation } from './CLUFiles.js';
export type { CLUFile } from './CLUFiles.js';
export { CLUDevice } from './device/CLUDevice.js';
export { CipherType } from './device/CipherType.js';
export { TFTPClient, TFTPError, TFTPErrorCode } from './tftp/TFTPClient.js';

export { DiscoverCLUsCommand } from './commands/DiscoverCLUsCommand.js';
export { LuaScriptCommand } from './commands/LuaScriptCommand.js';
export { SetIpCommand } from './commands/SetIpCommand.js';
export { SetKeyCommand } from './commands/SetKeyCommand.js';
export { ResetCommand } from './commands/ResetCommand.js';
export { RefreshModulesCommand } from './commands/RefreshModulesCommand.js';
export { StartTFTPdCommand } from './commands/StartTFTPdCommand.js';
export { StopTFTPdCommand } from './commands/StopTFTPdCommand.js';
export { GenerateMeasurementsCommand, RESPONSE_OK } from './commands/GenerateMeasurementsCommand.js';
export { ErrorCommand } from './commands/ErrorCommand.js';

export { getLocalIPv4Interfaces, getInterfaceByName, getInterfaceByAddress, broadcastAddress } from './util/networkInterfaces.js';
export { toHexString, hexToBuffer, hexToNumber, hexToBigInt } from './util/hex.js';
export { randomBytes, randomInt, randomHexString } from './util/random.js';
export * from './constants.js';
export * from './parsers/index.js';

export { readProjectClus, findProjectClu, projectCluClient } from './clu/project.js';
export type { ProjectClu } from './clu/project.js';
