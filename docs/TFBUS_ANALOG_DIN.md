# TFBUS — ANALOG_DIN Module

**hwType=25, fwType=2**

Objects: `AnalogOUT` ×4, `AnalogIN` ×7, `ONE_WIRE_HUB` ×1

---

## Init Sequence

Four analog output channels (ch=0–3) + seven analog inputs (ch=0–6, read-only):

Per analog output channel (ch=0–3):
1. `CHANNEL_INIT [0x25, ch, 0]`  (type=0x25 = analog output)
2. `MODULE_PARAM [0, ch, 1, 0]`

Per analog input channel (ch=0–6):
3. `CHANNEL_INIT [0x00, ch, 0]`
4. `MODULE_PARAM [0, ch, 0, 0]`

Batched F0 frames (fwType=2, hwType=25>9).

Each sub-record layout: `type(1) len(1) meta(1) data[len]`. The F0 frame plen = count_byte + all_sub_record_bytes + 1.

---

## STATUS_POLL Response

Analog input readings (7 channels) + voltage sensor. TLV response:

```
count=08
  02 04 [meta] [b0 b1 b2 b3]  analog input ch0 float32 LE; meta encodes channel index
  02 04 [meta] [b0 b1 b2 b3]  analog input ch1 float32 LE
  ...  (×7 total)
  02 02 10 [lo hi]             power supply voltage LE u16 ÷ 100 = V
```

Analog channel sub-records: type=0x02, len=4, meta=channel_index. Payload is IEEE 754 float32 little-endian (voltage 0–10V).

Standard ACK `AA 00 01 AB` returned when no state change.

---

## Wire Examples

F0 (MODULE_CMD) frame: `AA dest 0xF0 plen count [type len meta data...]... XOR_crc`

```
set analog output ch0 to 5.0V:
  aa <addr> f0  07 01  26 03 00 00 00 a0 40  <crc>
  (type=0x26 len=3 meta=0x00 data=[0x00, 0x00, 0xa0, 0x40] — last 3 bytes are float32 LE for 5.0)
```

---

## CLU Lua API

Source of truth: `docs/device-interfaces/module_2_0_ANALOG_DIN_fv02_02.xml`

### AnalogOUT (class=13, ×4)

**Features:**

| Index | Name | R/W | Type | Range / Default | Unit | Description |
|-------|------|-----|------|-----------------|------|-------------|
| 0 | Value | RW | num | 0-10, def=0 | V | Current output value |
| 1 | ScaledValue | R | num | 0-100000, def=0 | - | Current value multiplied by scalar |
| 2 | Scale | RW | num | 0-10000, def=1 | - | Output value scalar |
| 3 | Ramp | RW | num | 0-15000, def=500 | ms | Output value scalar |
| 4 | MinValue | RW | num | 0-10, def=0 | V | Minimum value which Value can adopt. Attempting to set a lower value will generate an err… |
| 5 | MaxValue | RW | num | 0-10, def=10 | V | Maximum value which Value can adopt. Attempting to set a higher value will generate an er… |

**Methods:**

| Call | Index | Name | Params | Description |
|------|-------|------|--------|-------------|
| set | 0 | SetValue | Value(0-10) | Sets output value (0.0 - 10.0V) |
| set | 1 | SetScaledValue | ScaledValue | Sets output value taking into account the scalar |
| set | 2 | SetScale | Scale | Sets scalar value |
| set | 3 | SetRamp | Ramp | Sets increments for output value |
| execute | 6 | HoldValue | Ramp | Reduces or increases the output value using a ramp specified in the parameter. If the ram… |
| execute | 7 | Switch | Time(ms), Ramp(0-15000 ms) | Switches output state to an opposite state. If time >0, after a specified period it resto… |
| execute | 8 | SwitchOn | Time(ms), Ramp(0-15000 ms) | Sets output value to 10.0 (MaxValue). The first parameter is the time of switching(how lo… |
| execute | 9 | SwitchOff | Time(ms), Ramp(0-15000 ms) | Sets output value to 0.0 (MinValue). The first parameter is the time of switching(how lon… |

**Events:**

| Address | Name | Description |
|---------|------|-------------|
| 0 | OnValueChange | Event from changing the output value (when SetValue is requested) |
| 1 | OnValueLower | Event occurring when the set value is lower than the previous value |
| 2 | OnValueRise | Event occurring when the set value is higher than the previous value |
| 3 | OnOutOfRange | Event occurring with an attempt to exceed the permissible range (MinValue - MaxValue). Th… |
| 4 | OnSwitchOn | Event occurring when 10.0 (MaxValue) is set at output |
| 5 | OnSwitchOff | Event occurring when 0.0 (MinValue) is set at output |

### AnalogIN (class=12, ×7)

**Features:**

| Index | Name | R/W | Type | Range / Default | Unit | Description |
|-------|------|-----|------|-----------------|------|-------------|
| 4 | RawValue | R | num | 0-10, def=0 | V | Current input value |
| 0 | Value | R | num | 0-100000, def=0 | V | Current input value taking into account the scalar |
| 1 | Value% | R | num | 0-1000000, def=0 | % | Current percentage input value of the maximum value (MaxValue characteristic) |
| 2 | Scale | RW | num | 0-10000, def=1 | - | Input scalar - parameter which is used for multiplying the input value during reading |
| 3 | Sensitivity | RW | num | 0-10, def=0.01 | V | Minimum change of input state when the OnValueChange, OnValueLower or OnValueRise event i… |
| 5 | MinValue | RW | num | def=0 | scaled | Minimum value of the Value characteristic after exceeding which the OnOutOfRange event is… |
| 6 | MaxValue | RW | num | def=10 | scaled | Maximum value of the Value characteristic after exceeding which the OnOutOfRange event is… |

**Methods:**

| Call | Index | Name | Params | Description |
|------|-------|------|--------|-------------|
| set | 2 | SetScale | Scale | Sets scalar value (float) |
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
| 6 | OnInRange | Event occurs when value returns to MinValue - MaxValue range |

### ONE_WIRE_HUB (class=73, ×1)

**Features:**

| Index | Name | R/W | Type | Range / Default | Unit | Description |
|-------|------|-----|------|-----------------|------|-------------|
| 0 | ConfiguredSensors | R | num | def=0 |  | Number of the hub's 1-Wire sensors in the project, found during CLU Discovery |
| 1 | ActiveSensors | R | num | def=0 |  | Number of 1-Wire sensors in the project (ConfiguredSensors) that were detected during the… |
| 2 | InactiveSensors | R | num | def=0 |  | Number of 1-Wire sensors in the project (ConfiguredSensors) that were not detected during… |
| 3 | ReportedSensors | R | num | def=0 |  | Number of all 1-Wire sensors detected during the last search, including those not in the … |

**Methods:**

| Call | Index | Name | Params | Description |
|------|-------|------|--------|-------------|
| execute | 0 | RefreshSensors |  | Searches for 1-Wire sensors again |

**Events:**

| Address | Name | Description |
|---------|------|-------------|
| 0 | OnRefreshCompleted | Event occurring after the 1-Wire sensor search is finished |

