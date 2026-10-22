# TFBUS — DALI_MASTER_DIN Module

**hwType=39, fwType=2**

Objects: `DALI_MASTER` ×1, `PowerSupplyVoltage` ×1

---

## Init Sequence

TODO: requires bus capture

---

## STATUS_POLL Response

TODO: requires bus capture

---

## Wire Examples

TODO: requires bus capture

---

## CLU Lua API

Source of truth: `docs/device-interfaces/module_2_0_DALI_MASTER_DIN_fv04_02.xml`

### DALI_MASTER (class=27, ×1)

**Features:**

| Index | Name | R/W | Type | Range / Default | Unit | Description |
|-------|------|-----|------|-----------------|------|-------------|
| 0 | State | R | num | 0=WithoutGears 1=DaliDiscovery 2=DaliBusPowerFailure 3=ConfigurationSaved 4=GettingGroupInformation |  | 0 - no ballast configuration 1 - DALI Discovery 2 - power failure on DALI bus 3 - ballast… |
| 1 | NumberOfGear | R | num | def= |  | Number of active ballasts connected to the device. The feature value is refreshed after r… |
| 3 | GearAddresses | R | str | def= | - | Ballast addresses given during DALI_Discovery. The feature value is refreshed after resta… |
| 4 | ActiveGears | R | str | def= | - | Addresses of active ballasts in the configuration. The value of the feature is refreshed … |
| 5 | MissingGears | R | str | def= | - | Addresses of inactive ballasts in the configuration. The value of the feature is refreshe… |

**Methods:**

| Call | Index | Name | Params | Description |
|------|-------|------|--------|-------------|
| execute | 16 | GetDAPCValue | Address(0-63) | Queries the gear for the DAPC value |
| execute | 3 | Identify | Address(0-63) | Turns on the luminaire for 2 seconds |
| execute | 1 | ResetGear | Address(0-63) | Restarts the ballast |
| execute | 4 | ResetLocalAddress | Address(0-63), RemoveFromController(0-1) | Removes the address on the ballast. RemoveFromController parameter: - True - Removes the … |
| execute | 0 | ChangeLocalAddress | ActualAddress(0-63), AddressToSet(0-63) | Changes the current LocalAddress of the ballast to the selected one. The address is not d… |
| execute | 10 | RemoveGear | Address(0-63) | Remove the ballast from controller memory |
| execute | 13 | ResolveAddressDuplicate | Address(0-63) | Solving the problem of address duplication |
| execute | 15 | UpdateMissingGears |  |  |
| execute | 5 | DALI_Discovery | Type(0-254) | Searching for ballasts connected to the DALI bus and assigning them local addresses. At t… |
| execute | 12 | SetPowerOnLevel | Address(0-63), DAPCValue(0-254) | For the selected address, it saves in the ballast memory the DAPCValue that is to be set … |
| execute | 2 | SetDAPCValue | Address(0-63), Value(0-254), RampTime(0-15) | Sets the value of the power with which the luminaire shines. RampTime parameter set on a … |
| execute | 14 | SetLastActiveLevel | Address(0-63) | If the ballast is off, turns on the ballast with the DAPCValue value set before it was tu… |
| execute | 21 | SetGroupLastActiveLevel | GroupAddress(1-16) | If the ballasts in the group are off, turns them on with the DAPCValue value set before t… |
| execute | 6 | SetGroupDAPCValue | GroupAddress(1-16), Value(0-254), RampTime(0-15) | Sets the value of the power with which the luminaire shines for a given group. RampTime p… |
| execute | 7 | GroupSwitch | GroupAddress(1-16), RampTime(0-15) | Changes the output state for a ballast group to the opposite. RampTime parameter set on a… |
| execute | 8 | GroupSwitchOn | GroupAddress(1-16), RampTime(0-15) | Turns on the luminaire for a given group. RampTime parameter set on a logarithmic scale 0… |
| execute | 9 | GroupSwitchOff | GroupAddress(1-16), RampTime(0-15) | Turns off the luminaire for a given group. RampTime parameter set on a logarithmic scale … |
| execute | 17 | HoldGroup | GroupAddress(1-16), RampTime(0-10000 ms) | Executes the function of illuminating / dimming the luminaires for a given ballast group |
| execute | 18 | HoldGroupUp | GroupAddress(1-16), RampTime(0-10000 ms) | Executes the function of illuminating the luminaires for a given ballast group |
| execute | 19 | HoldGroupDown | GroupAddress(1-16), RampTime(0-10000 ms) | Executes the function of dimming the luminaires for a given ballast group |
| execute | 20 | SetGroupColourTemperature | GroupAddress(1-16), Value(0-100), RampTime(0-15) | Sets the colour temperature value for a given group, where 0 - physical minimum, 100 - ph… |
| execute | 22 | SetGroupHSVValue | GroupAddress(1-16), Value(0-1 number), RampTime(0-15) | Sets brightness value (0.00-1.00) for a given group. RampTime parameter set on a logarith… |
| execute | 23 | SetGroupHSVSaturation | GroupAddress(1-16), Value(0-1 number), RampTime(0-15) | Sets saturation value (0.00-1.00) for a given group. RampTime parameter set on a logarith… |
| execute | 24 | SetGroupHSVHue | GroupAddress(1-16), Value(0-360 number), RampTime(0-15) | Sets hue value (0-360) for a given group. RampTime parameter set on a logarithmic scale 0… |
| execute | 25 | SetGroupRGBValue | GroupAddress(1-16), R(0-254), G(0-254), B(0-254), RampTime(0-15) | Sets the value of the R (Red), G (Green), B (Blue) channels for a given group. RampTime p… |
| execute | 26 | SetGroupWAFValue | GroupAddress(1-16), W(0-254), A(0-254), F(0-254), RampTime(0-15) | Sets the value of the W (White) channel, and the A (Amber) and F (Freecolour) parameters … |

**Events:**

| Address | Name | Description |
|---------|------|-------------|
| 1 | OnDALI_DiscoveryCompleted | Event occurring after the ballasts have been found and given local addresses |
| 2 | OnDALI_BusPowerFailure | Event generated: - in the event of a power failure on the DALI bus for more than 1s, - in… |
| 3 | OnDALI_BusPowerRestored | Event generated when the DALI bus power is restored |

### PowerSupplyVoltage (class=12, ×1)

**Features:**

| Index | Name | R/W | Type | Range / Default | Unit | Description |
|-------|------|-----|------|-----------------|------|-------------|
| 0 | Value | R | num | 0-24, def=0 | V | Current power supply voltage value |
| 1 | Value% | R | num | 0-1000000, def=0 | % | Current percentage input value of the maximum value (MaxValue characteristic) |
| 3 | Sensitivity | RW | num | 0-10, def=0.5 | V | Minimum change of input state when the OnValueChange, OnValueLower or OnValueRise event i… |
| 5 | MinValue | RW | num | def=21 | V | Minimum value of the Value characteristic after exceeding which the OnOutOfRange event is… |
| 6 | MaxValue | RW | num | def=24 | V | Maximum value of the Value characteristic after exceeding which the OnOutOfRange event is… |

**Methods:**

| Call | Index | Name | Params | Description |
|------|-------|------|--------|-------------|
| set | 3 | SetSensitivity | Sensitivity(0-10 V) | Sets input sensitivity value |
| set | 5 | SetMinValue | MinValue | Sets MinValue |
| set | 6 | SetMaxValue | MaxValue | Sets MaxValue |

**Events:**

| Address | Name | Description |
|---------|------|-------------|
| 0 | OnValueChange | Event resulting from changing input state |
| 1 | OnValueLower | Event occurs when a value lower than the value from the last reading appears at input |
| 2 | OnValueRise | Event occurs when a value higher than the value from the last reading appears at input |
| 3 | OnOutOfRange | Event resulting from exceeding the permissible range (MinValue - MaxValue) |
| 6 | OnInRange | Event occurs when value returns to MinValue - MaxValue range |

