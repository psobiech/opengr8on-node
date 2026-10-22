# TFBUS — DALI_GEAR_BASIC Module

**hwType=40, fwType=9**

Objects: `DALI_GEAR` ×1

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

