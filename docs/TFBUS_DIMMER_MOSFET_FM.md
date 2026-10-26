# TFBUS — DIMMER_MOSFET_FM Module

**hwType=44, fwType=2**

Objects: `DIMM` ×1, `DIN` ×1

---

## Init Sequence

Single dimmer channel (ch=0) + one DIN input (ch=1):

Dimmer channel:
1. `CHANNEL_INIT [0x0c, 0, 0]`  (type=0x0c = dimmer)
2. `MODULE_PARAM [0, 0, 1, 0]`
3. `SET_RAMP_TIME [0, 500ms_lo, 500ms_hi, 0, 0]`  (default 500ms ramp)
4. `DIMMER_SET_VALUE [0, 0, 0]`  (init to 0)

DIN input:
5. `CHANNEL_INIT [0x00, 1, 0]`
6. `MODULE_PARAM [0, 1, 0, 0]`

Batched F0 frames (fwType=2, hwType=44>9).

Each sub-record layout: `type(1) len(1) meta(1) data[len]`. The F0 frame plen = count_byte + all_sub_record_bytes + 1.

---

## STATUS_POLL Response

Same format as DIMMER_MOSFET_DIN (hwType=26). TLV response:

```
count=02
  01 02 10 [lo hi]    dim level LE u16 (0–1000, target level)
                       parsed by parse_rx_dimmer_state: type byte 0x05 → u32 dimmer level at [1]
  00 01 [meta] [inp]  digital input bitmask; byte[2]=value bitmask (bit 0=DIN active)
```

Standard ACK `AA 00 01 AB` returned when no state change.

---

## Wire Examples

F0 (MODULE_CMD) frame: `AA dest 0xF0 plen count [type len meta data...]... XOR_crc`

There are two ramp mechanisms:
- `SET_RAMP_TIME` (standalone): sub-type 0x06, 5 bytes: `[0, ramp_ms_lo, ramp_ms_hi, 0, 0]`
- `batch_buf_append_ramp_time` (batched): sub-type 0x07, meta=0x10, 2 bytes: `[ramp_ms_lo, ramp_ms_hi]`

`DIMMER_SET_VALUE`: sub-type 0x0c, 3 bytes: `[0, level_lo, level_hi]` (level 0–1000)

```
dim to 50%:   aa <addr> f0  0a 01  15 05 00 00 f4 01 00 00  0c 03 00 00 e8 03  <crc>
              (SET_RAMP_TIME type=0x15 len=5 meta=0x00 [0, 0xf4, 0x01, 0, 0] = 500ms)
              (DIMMER_SET_VALUE type=0x0c len=3 meta=0x00 [0, 0xe8, 0x03] = 1000)
dim to 0:     aa <addr> f0  0a 01  15 05 00 00 f4 01 00 00  0c 03 00 00 00 00  <crc>
              (SET_RAMP_TIME 500ms + DIMMER_SET_VALUE 0)
```

---

## CLU Lua API

Source of truth: `docs/device-interfaces/module_2_0_DIMMER_MOSFET_FM_fv03_02.xml`

### DIMM (class=5, ×1)

**Features:**

| Index | Name | R/W | Type | Range / Default | Unit | Description |
|-------|------|-----|------|-----------------|------|-------------|
| 0 | Value | RW | num | 0-1, def=0 | num | Specifies the current output value (0.0 - 1.0) |
| 1 | RampTime | RW | num | 0-15000, def=500 | ms | The value of the delay time of brightening or dimming the output (in ms) |
| 2 | MinValue | RW | num | 0-1, def=0 | num | Minimum value which Value can adopt. Attempting to set a lower value will generate an err… |
| 3 | MaxValue | RW | num | 0-1, def=1 | num | Maximum value which Value can adopt. Attempting to set a higher value will generate an er… |
| 6 | StartLevel | RW | num | 0-1, def=0 | num | Specifies the threshold of the output (0.0 - 1.0) |
| 7 | DimmingEdge | RW | num | 0=TrailingEdge 1=LeadingEdge |  | Returns the current type of dimming type: 0 - TrailingEdge, 1 - LeadingEdge |
| 8 | DistributedLogicGroup | RW | num | 0-10000, def=0 |  | Distributed Logic group - broadcast group for distributed logic |
| 4 | StatisticState | RW | num | 0=Off 1=Continuous | number | Enables measurement reporting to the statistics module: Off - turned off, Continuous - lo… |
| 5 | Load | RW | num | 0-60000, def=0 | W | The measured value multiplier. For StatisticState: Continuous - load measurement in the u… |

**Methods:**

| Call | Index | Name | Params | Description |
|------|-------|------|--------|-------------|
| set | 0 | SetValue | Value | Sets output value (0.0 - 1.0) |
| set | 1 | SetRampTime | RampTime(ms) | Sets the time for brightening or dimming the output (in ms) |
| set | 2 | SetMinValue | Value | Setting the minimum value which can be adopted by an output. Attempting to set a lower va… |
| set | 3 | SetMaxValue | Value | Setting the maximum value which can be adopted by an output. Attempting to set a higher v… |
| set | 6 | SetStartLevel | Value | Sets the threshold of the output (0.0 - 1.0) |
| set | 7 | SetDimmingEdge | Type | Sets the Dimming type |
| execute | 1 | Switch | Time(ms), Ramp(0-15000 ms), Mode | Changes the output value to opposite (MinValue - MaxValue). The first parameter (Time) is… |
| execute | 2 | SwitchOn | Time(ms), Ramp(0-15000 ms), Mode | Sets output value to MaxValue. The first parameter (Time) is the time of switching; the s… |
| execute | 3 | SwitchOff | Time(ms), Ramp(0-15000 ms) | Sets output value to MinValue. The first parameter (Time) is the time of switching; the s… |
| execute | 0 | HoldValue | Ramp(0-15000 ms) | Executes the function of illuminating/ dimming |

**Events:**

| Address | Name | Description |
|---------|------|-------------|
| 0 | OnValueChange | Event resulting from changing the output state |
| 1 | OnSwitchOn | Event occurring when the output value is changed from MinValue to a higher value |
| 2 | OnSwitchOff | Event occurring when MinValue is set at the output |
| 3 | OnValueRise | Event occurring when the set value is higher than the current value |
| 4 | OnValueLower | Event occurring when the set value is lower than the current value |
| 5 | OnOutOfRange | Event occurring when setting a value which is higher than the maximum value or lower than… |

### DIN (class=3, ×1)

**Features:**

| Index | Name | R/W | Type | Range / Default | Unit | Description |
|-------|------|-----|------|-----------------|------|-------------|
| 2 | HoldDelay | RW | num | 100-5000, def=500 | ms | Time in milliseconds after which, when pressing and holding a button, the OnHold event oc… |
| 3 | HoldInterval | RW | num | 100-2000, def=100 | ms | Cyclical interval in milliseconds after which, when pressing and holding a button, the On… |
| 0 | Value | R | num | 0-1 | bool | Returns input state as 0 or 1 |
| 6 | DistributedLogicGroup | RW | num | 0-10000, def=0 |  | Distributed Logic group - broadcast group for distributed logic |
| 4 | StatisticState | RW | num | 0=Off 1=Continuous 2=Pulse | number | Enables measurement reporting to the statistics module: Off - turned off, Continuous - lo… |
| 5 | Load | RW | num | 0-60000, def=0 | W | The measured value multiplier. For StatisticState: Continuous - load measurement value in… |

**Methods:**

| Call | Index | Name | Params | Description |
|------|-------|------|--------|-------------|
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

