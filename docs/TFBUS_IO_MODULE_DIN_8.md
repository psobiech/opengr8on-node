# TFBUS — IO_MODULE_DIN_8 Module

**hwType=30, fwType=2** — 8-channel digital I/O module

Objects: `IO` ×8

---

## Init Sequence (2-phase)

**Phase 1** (relay outputs, ch 0–7 each):
- `DEACTIVATE` + `MODULE_PARAM [0, ch, 1, 0]`

**Phase 2** (DIN inputs, ch 0–7 each):
- `CHANNEL_INIT [0x00, ch, 0]` + `MODULE_PARAM [0, ch, 0, 0]`

Runtime: periodic `CHANNEL_INIT` + `CHANNEL_MAP` per input channel (descending order).

---

## STATUS_POLL Response (14 bytes)

```
03
  00 01 [meta] [inp_byte]      8 digital inputs — bit N = input N active
  01 01 [meta] [state]         output state (0=idle)
  02 02 [meta] [LO] [HI]       temperature LE uint16 ÷ 100 = °C
```

Example: `03 00 01 01 00 01 01 01 00 02 02 10 6c 09`
→ inputs=0x00 (all off), state=idle, temp=0x096C=2412 → **24.12°C**

---

## CLU Lua API — Full Reference

Source of truth: `docs/device-interfaces/module_2_0_IO_MODULE_DIN_8_fv02_02.xml`

### DOUT (class=4, ×8)

**Features:**

| Index | Name | R/W | Type | Range / Default | Unit | Description |
|-------|------|-----|------|-----------------|------|-------------|
| 0 | Value | RW | num | 0=Off 1=On | bool | Returns 1 for output set at On and 0 for output set at Off state |
| 6 | DistributedLogicGroup | RW | num | 0-10000, def=0 |  | Distributed Logic group - broadcast group for distributed logic |
| 1 | StatisticState | RW | num | 0=Off 1=Continuous | number | Enables measurement reporting to the statistics module: Off - turned off, Continuous - lo… |
| 2 | Load | RW | num | 0-60000, def=0 | W | The measured value multiplier. For StatisticState: Continuous - load measurement value in… |

**Methods:**

| Call | Index | Name | Params | Description |
|------|-------|------|--------|-------------|
| set | 0 | SetValue | Value(bool) | Sets output state to 1 or 0 |
| execute | 0 | Switch | Time(ms) | Changes the output value from 0 to 1 or from 1 to 0. The first parameter is the time of c… |
| execute | 1 | SwitchOn | Time(ms) | Sets output value to 1 |
| execute | 2 | SwitchOff | Time(ms) | Sets output value to 0 |

**Events:**

| Address | Name | Description |
|---------|------|-------------|
| 0 | OnValueChange | Occurs when a change in the state takes place (regardless of the value) |
| 1 | OnSwitchOn | Occurs when On(1) is set at output |
| 2 | OnSwitchOff | Occurs when Off(0) is set at output |

### DIN (class=3, ×8)

**Features:**

| Index | Name | R/W | Type | Range / Default | Unit | Description |
|-------|------|-----|------|-----------------|------|-------------|
| 1 | Inertion | RW | num | 0-500, def=0 | ms | Specifies the time constant of the input |
| 2 | HoldDelay | RW | num | 100-5000, def=500 | ms | Time in milliseconds after which, when pressing and holding a button, the OnHold event oc… |
| 3 | HoldInterval | RW | num | 100-2000, def=100 | ms | Cyclical interval in milliseconds after which, when pressing and holding a button, the On… |
| 0 | Value | R | num | 0-1 | bool | Returns input state as 0 or 1 |
| 6 | DistributedLogicGroup | RW | num | 0-10000, def=0 |  | Distributed Logic group - broadcast group for distributed logic |
| 4 | StatisticState | RW | num | 0=Off 1=Continuous 2=Pulse | number | Enables measurement reporting to the statistics module: Off - turned off, Continuous - lo… |
| 5 | Load | RW | num | 0-60000, def=0 | W | The measured value multiplier. For StatisticState: Continuous - load measurement value in… |

**Methods:**

| Call | Index | Name | Params | Description |
|------|-------|------|--------|-------------|
| set | 1 | SetInertion | Inertion(ms) | Minimum interval in milliseconds which has to pass between presses of a button so that it… |
| set | 2 | SetHoldDelay | HoldDelay(ms) | Sets HoldDelay value |
| set | 3 | SetHoldInterval | HoldInterval(ms) | Sets HoldInterval value |

**Events:**

| Address | Name | Description |
|---------|------|-------------|
| 0 | OnValueChange | Occurs when a change in the input state takes place (regardless of the value) |
| 1 | OnSwitchOn | Occurs when the high state is set at input |
| 2 | OnSwitchOff | Occurs when the low state is set at input |
| 3 | OnShortPress | Occurs after pressing the button for 500 ms - 2000 ms |
| 4 | OnLongPress | Occurs after pressing the button for at least 2000 ms |
| 5 | OnHold | Occurs for the first time after HoldDelay time and then cyclically every HoldInterval val… |
| 6 | OnClick | Occurs after pressing the button for less than 500 ms |

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

