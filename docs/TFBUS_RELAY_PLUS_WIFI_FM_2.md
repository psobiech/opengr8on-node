# TFBUS — RELAY_PLUS_WIFI_FM_2 Module

**hwType=34, fwType=2**

Objects: `DOUT` ×2, `DIN` ×2

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

Source of truth: `docs/device-interfaces/module_RELAY_PLUS_WIFI_FM_2_fv01_02.xml`

### DOUT (class=4, ×2)

**Features:**

| Index | Name | R/W | Type | Range / Default | Unit | Description |
|-------|------|-----|------|-----------------|------|-------------|
| 0 | Value | RW | num | 0=Off 1=On | bool | Returns 1 for output set at On and 0 for output set at Off state |
| 1 | Overload | RW | num | 2-1000, def=300 | [W] | The value of power that it generates OnOverloadOn event when exceeded |
| 2 | OverloadTime | RW | num | 200-60000, def=1000 | [ms] | Minimal duration of the power overload needed for OnOverload event generation |
| 3 | LoadThreshold | RW | num | 2-1000, def=5 | [W] | The value of power that it generates OnPowerConsumptionOn event when exceeded |
| 4 | VoltageType | RW | num | 0=AC 1=DC | bool | Load voltage type: 0 - AC, 1 - DC |
| 5 | DCVoltage | RW | num | def=0 | [V] | Declared DC voltage supplying the load |
| 6 | ACVoltage | R | num |  | [V] | Actual AC voltage in the power network |
| 7 | Current | R | num |  | [A] | Current flowing through the load (for AC:Irms) |
| 8 | Load | R | num |  | [W] | Actual load power consumption |
| 9 | AverageLoad | R | num |  | [W] | Average Load since power up or ResetPowerStatistics() call |
| 10 | MaximumLoad | R | num |  | [W] | Maximum Load since power up or ResetPowerStatistics() call |
| 11 | PowerOnTime | R | num |  | [s] | Total time of the output ON state since power up or ResetPowerStatistics() call |
| 12 | PowerConsumption | R | num |  | [kWh] | Total power consumption since power up or ResetPowerStatistics() call |
| 13 | State | R | num | 0=POWER_OFF 1=POWER_ON 2=LOADED 3=OVERLOADED 4=ANTIBURN_OFF | - | Returns output state: [0]POWER_OFF - output off, [1]POWER_ON - output on, [2]LOADED - the… |

**Methods:**

| Call | Index | Name | Params | Description |
|------|-------|------|--------|-------------|
| set | 0 | SetValue | Value(bool) | Sets output state to 1 or 0 |
| set | 1 | SetOverload | OverloadThreshold([W]) | Sets OverLoad threshold |
| set | 2 | SetOverloadTime | OverloadTime([ms]) | Sets OverloadTime |
| set | 3 | SetLoadThreshold | LoadThreshold([W]) | Sets LoadThreshold |
| execute | 0 | Switch |  | Changes the output value to opposite state. |
| execute | 1 | SwitchOn | Time(ms) | Sets output value to 1. The first parameter is the time of change: 0 - switches output to… |
| execute | 2 | SwitchOff | Time(ms) | Sets output value to 0. The first parameter is the time of change: 0 - switches output to… |
| execute | 3 | ResetPowerStatistics |  | Resets power measurement statistics |

**Events:**

| Address | Name | Description |
|---------|------|-------------|
| 0 | OnValueChange | Occurs when a change in the state takes place (regardless of the value) |
| 1 | OnSwitchOn | Occurs when On(1) is set to output |
| 2 | OnSwitchOff | Occurs when Off(0) is set to output |
| 3 | OnPowerConsumptionOn | Occurs when the value of Load properties becomes higher than LoadThreshold |
| 4 | OnPowerConsumptionOff | Occurs when the value of Load properties becomes lower than LoadThreshold |
| 5 | OnOverloadOn | Occurs when the value of Load properties becomes higher than Overload |
| 6 | OnOverloadOff | Occurs when the value of Load properties becomes lower than Overload |
| 7 | OnAntiBurnRelayOff | Occurs when switching off the relay after significantly exceeding safe Current value |
| 8 | OnUpdate | Occurs when parameters(Current, Load, ..) are updated on all outputs. Calls every 250ms. |

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

