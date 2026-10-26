# TFBUS — DALI_GEAR_DT8 Module

**hwType=40, fwType=8**

Objects: `DALI_GEAR_DT8` ×1

---

## Init Sequence

DALI_GEAR_DT8 is a virtual object hosted on DALI_MASTER_DIN (hwType=39), same as DALI_GEAR_BASIC but for DALI DT8 colour gear. No independent RS485 address.

Init: DALI_MASTER sends DT8-specific addressing and colour type configuration commands to the gear over the DALI bus via TFBUS_CMD (0x31) frames.

TYPE_TFBUS_CMD (0x31) frame: always 26 bytes — `AA dest 0x31 cmd data[21] XOR_crc` (zero-padded).

(hwType=40, fwType=8 identifies DT8 colour gear; no independent TFBUS RS485 frames)

---

## STATUS_POLL Response

No direct STATUS_POLL — same as DALI_GEAR_BASIC. All status relayed from DALI_MASTER_DIN.

DT8 additional state fields beyond DALI_GEAR_BASIC:
- colour temperature (CCT) in Kelvin
- RGBWAF component levels
- colour type (CCT / XY / RGBWAF)

---

## Wire Examples

All DT8 gear commands are sent TO the DALI_MASTER_DIN module's RS485 address using 26-byte TFBUS_CMD frames:

```
set CCT 4000K:
  aa <dali_master_addr> 31 06 [R] [G] [B] [W] [flags] [zero-pad to 21 bytes] <crc>
  (sub_cmd=0x06 RGBW_SET with DT8 colour fields)

set DT8 RGBW brightness:
  aa <dali_master_addr> 31 1b [R] [G] [B] [W] [zero-pad to 21 bytes] <crc>
  (sub_cmd=0x1b RGBW_SET_ALT)
```

---

## CLU Lua API

Source of truth: `docs/device-interfaces/module_2_0_DALI_GEAR_DT8_fv05_08.xml`

### DALI_GEAR_DT8 (class=35, ×1)

**Features:**

| Index | Name | R/W | Type | Range / Default | Unit | Description |
|-------|------|-----|------|-----------------|------|-------------|
| 1 | Address | R | num | 0-63, def= | - | Ballast address |
| 0 | Group | RW | str | 0-51, def=0 | - | Ballast group numbers, subsequent groups from the 1-16 range are given after the decimal … |
| 2 | DAPCValue | R | num | 0-254, def= | - | The value of the power with which the luminaire shines |
| 6 | HSVValue | R | num | 0-1, def= | - | Brightness value as per the HSV model (range: 0.00-1.00) |
| 5 | HSVSaturation | R | num | 0-1, def= | - | Colour saturation value as per the HSV model (0.00-1.00) |
| 4 | HSVHue | R | num | 0-360, def= | - | Colour hue value as per the HSV model (0-360) |
| 7 | ColourTemperature | RW | num | 0-100, def=50 | - | The color temperature is set based on the called SetColourTemperature method. The feature… |

**Methods:**

| Call | Index | Name | Params | Description |
|------|-------|------|--------|-------------|
| execute | 18 | GetDAPCValue |  | Queries the gear for the DAPC value. |
| execute | 0 | Identify |  | Turns on the luminaire for 2 seconds |
| execute | 1 | SetDAPCValue | Value(0-254), RampTime(0-15) | Sets the value of the power with which the luminaire shines. RampTime parameter set on a … |
| execute | 2 | Switch | RampTime(0-15), Mode(0-1) | Changes the luminaire state to the opposite. RampTime parameter set on a logarithmic scal… |
| execute | 3 | SwitchOn | RampTime(0-15) | Turns on the luminaire. RampTime parameter set on a logarithmic scale 0.8 - 90 [s] |
| execute | 4 | SwitchOff | RampTime(0-15) | Turns off the luminaire. RampTime parameter set on a logarithmic scale 0.8 - 90 [s] |
| execute | 5 | Hold | RampTime(0-10000 ms) | Executes the function of illuminating / dimming the luminaire |
| execute | 6 | HoldUp | RampTime(0-10000 ms) | Executes the function of illuminating the luminaire |
| execute | 7 | HoldDown | RampTime(0-10000 ms) | Executes the function of dimming the luminaire |
| execute | 17 | SetHSVValue | Value(0-1 number), RampTime(0-15 number) | Sets brightness value (0.00-1.00). RampTime parameter set on a logarithmic scale 0.8 - 90… |
| execute | 16 | SetHSVSaturation | Value(0-1 number), RampTime(0-15 number) | Sets saturation value (0.00-1.00). RampTime parameter set on a logarithmic scale 0.8 - 90… |
| execute | 15 | SetHSVHue | Value(0-360 number), RampTime(0-15 number) | Sets hue value (0-360). RampTime parameter set on a logarithmic scale 0.8 - 90 [s] |
| execute | 13 | SetRGBValue | R(0-254), G(0-254), B(0-254), RampTime(0-15) | Sets the value of the R (Red), G (Green), B (Blue) channels. RampTime parameter set on a … |
| execute | 14 | SetWAFValue | W(0-254), A(0-254), F(0-254), RampTime(0-15) | Sets the value of the W (White) channel, and the A (Amber) and F (Freecolour) parameters.… |
| execute | 12 | SetColourTemperature | Value(0-100), RampTime(0-15) | Sets the colour temperature value, where 0 - physical minimum, 100 - physical maximum. Ra… |

**Events:**

| Address | Name | Description |
|---------|------|-------------|
| 0 | OnDAPCValueChange | Event occurring when changing the DAPCValue |
| 1 | OnSwitchOn | Event occurring when the DAPCValue value is changed from 0 to the greater value |
| 2 | OnSwitchOff | Event occurring when the DAPCValue value is changed to 0 |

