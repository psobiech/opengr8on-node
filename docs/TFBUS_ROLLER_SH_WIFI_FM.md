# TFBUS — ROLLER_SH_WIFI_FM Module

**hwType=41, fwType=2**

Objects: `ROLLER_SHUTTER` ×1, `DIN` ×2

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

Source of truth: `docs/device-interfaces/module_ROLLER_SH_WIFI_FM_fv01_02.xml`

### ROLLER_SHUTTER (class=24, ×1)

**Features:**

| Index | Name | R/W | Type | Range / Default | Unit | Description |
|-------|------|-----|------|-----------------|------|-------------|
| 0 | State | R | num | 0=Stop 1=Up 2=Down | - | Output state: 0 - no movement, 1 - moving upwards, 2 - moving downwards |
| 1 | MaxTime | RW | num | def=30000 | ms | Default Time parameter value. 0 if not specified |
| 3 | Up | R | num | 0=Off 1=On |  | State of UP relay (moving upwards) |
| 4 | Down | R | num | 0=Off 1=On |  | State of DOWN relay (moving downwards) |

**Methods:**

| Call | Index | Name | Params | Description |
|------|-------|------|--------|-------------|
| execute | 0 | MoveUp | Time(ms) | Roller shutter up or STOP if moving. Parameter Time: number - output is active for specif… |
| execute | 1 | MoveDown | Time(ms) | Roller shutter down or STOP if moving. Parameter Time: number - output is active for spec… |
| execute | 2 | Start | Time(ms) | Roller shutter up if the preceding motion was down or roller shutter down if the precedin… |
| execute | 3 | Stop |  | STOP if moving |
| execute | 4 | Hold |  | Blind movement hold |
| execute | 5 | HoldUp |  | Hold always up |
| execute | 6 | HoldDown |  | Hold always down |

**Events:**

| Address | Name | Description |
|---------|------|-------------|
| 0 | OnStateChange | Result from a change in the state of any of the outputs |
| 1 | OnUp | Occurs when changing the Stop state to the Up state |
| 2 | OnDown | Occurs when changing the Stop state to the Down state |
| 3 | OnStart | Occurs when the blind has been turned on |
| 4 | OnStop | Occurs when the blind has stopped |

### DIN (class=3, ×2)

**Features:**

| Index | Name | R/W | Type | Range / Default | Unit | Description |
|-------|------|-----|------|-----------------|------|-------------|
| 1 | Inertion | RW | num | 20-500, def=60 | ms | Specifies the entry time constant. The value step is 20ms |
| 2 | HoldDelay | RW | num | 100-5000, def=500 | ms | Time in milliseconds after which, when pressing and holding a button, the OnHold event oc… |
| 3 | HoldInterval | RW | num | 100-2000, def=200 | ms | Cyclical interval in milliseconds after which, when pressing and holding a button, the On… |
| 0 | Value | R | num | 0-1 | bool | Returns input state as 0 or 1 |
| 4 | Coupling | R | num | 0-120 | % | Returns the percentage of coupling between wires: 0% - no coupling when input physically … |

**Methods:**

| Call | Index | Name | Params | Description |
|------|-------|------|--------|-------------|
| set | 1 | SetInertion | Inertion(ms) | Sets the input inertia time |
| set | 2 | SetHoldDelay | HoldDelay(ms) | Sets HoldDelay value |
| set | 3 | SetHoldInterval | HoldInterval(ms) | Sets HoldInterval value |

**Events:**

| Address | Name | Description |
|---------|------|-------------|
| 0 | OnValueChange | Occurs when a change in the input state takes place (regardless of the value) |
| 1 | OnSwitchOn | Occurs when the high state is set at input |
| 2 | OnSwitchOff | Occurs when the low state is set at input |
| 3 | OnShortPress | Occurs after pressing the button for 500 - 2000ms |
| 4 | OnLongPress | Occurs after pressing the button for at least 2000ms |
| 5 | OnHold | Occurs for the first time after HoldDelay time and then cyclically every HoldInterval val… |
| 6 | OnClick | Occurs after pressing the button for less than 500 ms |

