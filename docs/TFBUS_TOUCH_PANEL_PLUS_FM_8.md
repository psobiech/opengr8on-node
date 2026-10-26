# TFBUS — TOUCH_PANEL_PLUS_FM_8 Module

**hwType=9, fwType=8**

Objects: `BUTTON` ×8, `PANELSENSTEMP` ×1, `PANELSENSLIGHT` ×1, `PANEL` ×1, `PowerSupplyVoltage` ×1

---

## Init Sequence

Same as TOUCH_PANEL_PLUS_FM_4 (hwType=9, fwType=9) but ×8 buttons. hwType=9 always uses batched F0 path.

1. 8× `SET_OUTPUT [1<<btn, 0, 0]`  (LED init=off) + `MODULE_PARAM [0, btn, 0, 0]`
2. `SENSOR_SENSITIVITY` records (2 per sensor: PANELSENSTEMP=0x07, PANELSENSLIGHT=0x08)
3. `SET_MODE [mode]`

`SENSOR_SENSITIVITY` (sub-record type=0x00): `[sensor_id, threshold×10, sensitivity/100ms, 0]`

`SET_MODE` values: 0=Monostable, 1=Bistable, 2=Locked.

Each sub-record layout: `type(1) len(1) meta(1) data[len]`. The F0 frame plen = count_byte + all_sub_record_bytes + 1.

---

## STATUS_POLL Response

Same TLV format as TOUCH_PANEL_FM_4/FM_8:

```
count=02
  06 01 01 [state]      baseline status; type=0x06, len=1, meta=0x01; state: 0x00=idle, 0x01=button active
  02 02 10 [lo hi]      temperature: type=0x02, len=2, meta=0x10; LE int16 ÷ 100 = °C     (periodic)
  -- or --
  07 02 10 [lo hi]      light sensor: type=0x07, len=2, meta=0x10; LE int16 raw ADC        (on change)
  -- or --
  08 02 10 [VAL 00]     button event: type=0x08, len=2, meta=0x10; VAL = btn_idx×7 + event_id
```

Button identity: `VAL = btn_idx × 7 + event_id` where btn_idx=0–7.

---

## Wire Examples

LED_CMD frame: `AA dest 0x18 btn_mask 0x00 cmd_byte XOR_crc`

cmd_byte: 0x00=ShowOK, 0x01=ShowError, 0x02=LedSwitchOn, 0x04=LedSwitchOff, 0x10=RedLedSwitchOn.

```
LED on btn1:   aa <addr> 18  01 00 02  <crc>    LedSwitchOn btn0 (mask=0x01)
LED off btn8:  aa <addr> 18  80 00 04  <crc>    LedSwitchOff btn7 (mask=0x80)
```

---

## CLU Lua API

Source of truth: `docs/device-interfaces/module_TOUCH_PANEL_PLUS_FM_8_fv00_08.xml`

### BUTTON (class=7, ×8)

**Features:**

| Index | Name | R/W | Type | Range / Default | Unit | Description |
|-------|------|-----|------|-----------------|------|-------------|
| 1 | Mode | RW | num | 0=Monostable 1=Bistable 2=Locked |  | Returns the selected mode of button action (0 - Monostable, 1 - Bistable, 2 - Locked). In… |
| 2 | HoldDelay | RW | num | 100-5000, def=1000 | ms | Time in milliseconds after which, when pressing and holding a button, the OnHold event oc… |
| 3 | HoldInterval | RW | num | 100-2000, def=100 | ms | Cyclical interval in milliseconds after which, when pressing and holding a button, the On… |
| 0 | Value | R | num |  | bool | Returns input state as 0 or 1 |

**Methods:**

| Call | Index | Name | Params | Description |
|------|-------|------|--------|-------------|
| set | 1 | SetMode | Mode | Sets mode of button action (0 - Monostable, 1 - Bistable, 2 - Locked). In locked mode, th… |
| set | 2 | SetHoldDelay | HoldDelay | Sets HoldDelay value |
| set | 3 | SetHoldInterval | HoldInterval | Sets HoldInterval value |
| execute | 0 | ShowOK |  | Causes the green diode on the button to flash for 2 seconds (frequency 500 ms). The red d… |
| execute | 0 | ShowError |  | Causes the red diode on the button to flash for 2 seconds (frequency 500 ms). The green d… |
| execute | 1 | LedSwitchOn |  | Activates the green diode on the button |
| execute | 2 | LedSwitchOff |  | Deactivates the green diode on the button |

**Events:**

| Address | Name | Description |
|---------|------|-------------|
| 0 | OnValueChange | Event occurs when a change in the input state takes place (regardless of the value) |
| 1 | OnSwitchOn | Event occurs when the high state is set at input |
| 2 | OnSwitchOff | Event occurs when the low state is set at input |
| 3 | OnShortPress | Event occurs after pressing the button for 500 ms - 2000 ms |
| 4 | OnLongPress | Occurs after pressing the button for at least 2000m |
| 5 | OnHold | Event occurs for the first time after HoldDelay time passes and then cyclically every Hol… |
| 6 | OnClick | Event occurs after pressing the button for less than 500 ms |

### PANELSENSTEMP (class=20, ×1)

**Features:**

| Index | Name | R/W | Type | Range / Default | Unit | Description |
|-------|------|-----|------|-----------------|------|-------------|
| 1 | Threshold | RW | num | 0-1, def=0.1 | number | Hysteresis size (accuracy 0.1°C) specifying the sensitivity when the following events are… |
| 2 | Sensitivity | RW | num | 0-5000, def=300 | ms | Time (in ms) for which the sampled values are averaged |
| 3 | MinValue | RW | num | 0-40, def=0 | °C | Minimum value of the Value characteristic after exceeding which the OnOutOfRange event is… |
| 4 | MaxValue | RW | num | 0-40, def=40 | °C | Maximum value of the Value characteristic after exceeding which the OnOutOfRange event is… |
| 0 | Value | R | num | 0-40 | °C | Input value: for temperature sensor from 0.0 to 40.0 (°C) |

**Methods:**

_None._

**Events:**

| Address | Name | Description |
|---------|------|-------------|
| 0 | OnValueChange | Event resulting from changing input state |
| 1 | OnValueRise | Event resulting from exceeding the upper threshold of hysteresis |
| 2 | OnValueLower | Event resulting from exceeding the lower threshold of hysteresis |
| 3 | OnOutOfRange | Event resulting from exceeding any range |

### PANELSENSLIGHT (class=21, ×1)

**Features:**

| Index | Name | R/W | Type | Range / Default | Unit | Description |
|-------|------|-----|------|-----------------|------|-------------|
| 1 | Threshold | RW | num | 0-100, def=0.1 | number | Hysteresis size (accuracy 0.1%) specifying the sensitivity when the following events are … |
| 2 | Sensitivity | RW | num | 0-5000, def=500 | ms | Time (in ms) for which the sampled values are averaged |
| 3 | MinValue | RW | num | 0-100, def=0 | % | Minimum value of the Value characteristic after exceeding which the OnOutOfRange event is… |
| 4 | MaxValue | RW | num | 0-100, def=100 | % | Maximum value of the Value characteristic after exceeding which the OnOutOfRange event is… |
| 0 | Value | R | num | 0-100 | % | Input value: for light sensor from 0 to 100 % |

**Methods:**

_None._

**Events:**

| Address | Name | Description |
|---------|------|-------------|
| 0 | OnValueChange | Event resulting from changing input state |
| 1 | OnValueRise | Event resulting from exceeding the upper threshold of hysteresis |
| 2 | OnValueLower | Event resulting from exceeding the lower threshold of hysteresis |
| 3 | OnOutOfRange | Event resulting from exceeding any range |

### PANEL (class=29, ×1)

**Features:**

| Index | Name | R/W | Type | Range / Default | Unit | Description |
|-------|------|-----|------|-----------------|------|-------------|
| 13 | BuzzerValue | RW | num | 0=Off 1=On |  | Sound indication control: 0 - Off 1 - On |

**Methods:**

| Call | Index | Name | Params | Description |
|------|-------|------|--------|-------------|
| set | 13 | SetBuzzerValue | BuzzerValue(0-1) | Sets the BuzzerValue: 0 - Off 1 - On |

**Events:**

_None._

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
| 4 | OnSwitchOn | Event occurs when the input value reaches 100% (MaxValue) |
| 5 | OnSwitchOff | Event occurs when the input value reaches 0% (MinValue) |

