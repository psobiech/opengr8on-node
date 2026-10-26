# TFBUS — DALI_GEAR_BASIC Module

**hwType=40, fwType=9**

Objects: `DALI_GEAR` ×1

---

## Init Sequence

DALI_GEAR is a virtual object hosted on DALI_MASTER_DIN (hwType=39). It does not exist as an independent TFBUS module and has no separate RS485 address. All communication goes through the DALI_MASTER_DIN module.

Init: DALI_MASTER sends DALI addressing/group assignment commands to the gear over the DALI bus, translated via TFBUS_CMD (0x31) frames to the master module.

TYPE_TFBUS_CMD (0x31) frame: always 26 bytes — `AA dest 0x31 cmd data[21] XOR_crc` (zero-padded).

(hwType=40, fwType=9 identifies DALI gear; no independent TFBUS RS485 frames)

---

## STATUS_POLL Response

No direct STATUS_POLL — gear status is relayed from DALI_MASTER. The master delivers gear feedback as asynchronous TFBUS_CMD (0x31) upstream frames when DALI device status changes.

Typical encoded state fields:
- dim level (0–254 DALI scale)
- fault/lamp fail flags

---

## Wire Examples

All DALI gear commands are sent TO the DALI_MASTER_DIN module's RS485 address using 26-byte TFBUS_CMD frames:

```
set gear 0x01 level 127 (≈50%):
  aa <dali_master_addr> 31 0e 00 01 fe 7f [zero-pad to 21 bytes] <crc>
  (sub_cmd=0x0e, gear=0x01, cmd bytes follow)

gear OFF:
  aa <dali_master_addr> 31 0e 00 01 00 00 [zero-pad to 21 bytes] <crc>
```

---

## CLU Lua API

Source of truth: `docs/device-interfaces/module_2_0_DALI_GEAR_BASIC_fv04_09.xml`

### DALI_GEAR (class=32, ×1)

**Features:**

| Index | Name | R/W | Type | Range / Default | Unit | Description |
|-------|------|-----|------|-----------------|------|-------------|
| 1 | Address | R | num | 0-63, def= | - | Ballast address |
| 0 | Group | RW | str | 0-51, def=0 | - | Ballast group numbers, subsequent groups from the 1-16 range are given after the decimal … |
| 2 | DAPCValue | R | num | 0-254, def= | - | The value of the power with which the luminaire shines |

**Methods:**

| Call | Index | Name | Params | Description |
|------|-------|------|--------|-------------|
| execute | 18 | GetDAPCValue |  | Queries the gear for the DAPC value |
| execute | 0 | Identify |  | Turns on the luminaire for 2 seconds |
| execute | 1 | SetDAPCValue | Value(0-254), RampTime(0-15) | Sets the value of the power with which the luminaire shines. RampTime parameter set on a … |
| execute | 2 | Switch | RampTime(0-15), Mode(0-1) | Changes the luminaire state to the opposite. RampTime parameter set on a logarithmic scal… |
| execute | 3 | SwitchOn | RampTime(0-15) | Turns on the luminaire. RampTime parameter set on a logarithmic scale 0.8 - 90 [s] |
| execute | 4 | SwitchOff | RampTime(0-15) | Turns off the luminaire. RampTime parameter set on a logarithmic scale 0.8 - 90 [s] |
| execute | 5 | Hold | RampTime(0-10000 ms) | Executes the function of illuminating / dimming the luminaire |
| execute | 6 | HoldUp | RampTime(0-10000 ms) | Executes the function of illuminating the luminaire |
| execute | 7 | HoldDown | RampTime(0-10000 ms) | Executes the function of dimming the luminaire |

**Events:**

| Address | Name | Description |
|---------|------|-------------|
| 0 | OnDAPCValueChange | Event occurring when changing the DAPCValue |
| 1 | OnSwitchOn | Event occurring when the DAPCValue value is changed from 0 to the greater value |
| 2 | OnSwitchOff | Event occurring when the DAPCValue value is changed to 0 |

