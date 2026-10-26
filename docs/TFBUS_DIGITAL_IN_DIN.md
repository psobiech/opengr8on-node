# TFBUS — DIGITAL_IN_DIN Module

**hwType=20, fwType=2**

Objects: `DIN` ×9, `PowerSupplyVoltage` ×1

---

## Init Sequence

Per input channel (ch=0–8):

1. `CHANNEL_INIT [0x00, ch, 0]`
2. `MODULE_PARAM [0, ch, 0, 0]`  (io_dir=0 = input)

Batched F0 frames (fwType=2, hwType=20>9).

Each sub-record layout: `type(1) len(1) meta(1) data[len]`. The F0 frame plen = count_byte + all_sub_record_bytes + 1.

---

## STATUS_POLL Response

Nine digital inputs + voltage sensor. TLV response:

```
count=02
  00 02 [meta] [inp_lo] [inp_hi]  9-bit digital input bitmask LE u16 (bit N = DIN_N active)
                                   parse_rx_input_bitmask: byte[1]=enable_mask, byte[2]=value_mask
  02 02 10 [lo hi]                power supply voltage LE u16 ÷ 100 = V
```

Standard ACK `AA 00 01 AB` returned when no state change.

---

## Wire Examples

No output commands — read-only module.

Poll response example (DIN0 active, voltage=24.00V):
```
aa 00 09 02  00 02 01 01 00  02 02 10 60 09  <crc>
             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
             type=0x00 len=2 meta=0x01 data=[0x01 0x00]  (bit 0 set = DIN0 active)
             type=0x02 len=2 meta=0x10 data=[0x60 0x09]  (0x0960 = 2400 → 24.00V)
```

---

## CLU Lua API

Source of truth: `docs/device-interfaces/module_2_0_DIGITAL_IN_DIN_fv01_02.xml`

### DIN (class=3, ×9)

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
| 5 | MinValue | RW | num | def=21 | scaled | Minimum value of the Value characteristic after exceeding which the OnOutOfRange event is… |
| 6 | MaxValue | RW | num | def=24 | scaled | Maximum value of the Value characteristic after exceeding which the OnOutOfRange event is… |

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

