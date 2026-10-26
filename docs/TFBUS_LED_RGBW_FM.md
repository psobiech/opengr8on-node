# TFBUS — LED_RGBW_FM Module

**hwType=29, fwType=2**

Objects: `LEDRGB` ×1, `LED_CHANNEL` ×4, `DIN` ×2, `LED_CCT` ×2, `PowerSupplyVoltage` ×1

---

## Init Sequence

Same pattern as LED_RGBW_DIN (hwType=24). Four RGBW channels (ch=0–3), two DIN inputs (ch=0,1).

Per RGBW channel (ch=0–3):
1. `CHANNEL_INIT [0x1b, ch, 0]`  (type=0x1b = RGBW)
2. `MODULE_PARAM [0, ch, 1, 0]`

Initial state (all channels 0):
3. `SET_RAMP_TIME [0, 0, 0, 0, 0]`
4. `SET_CHANNEL_VALUE ×4` — `[0,0] [1,0] [2,0] [3,0]`

DIN inputs (ch=0,1):
5. `CHANNEL_INIT [0x00, ch, 0]`
6. `MODULE_PARAM [0, ch, 0, 0]`

Batched F0 frames using `batch_buf_append_rgbw_channels` (fwType=2, hwType=29>9).

Each sub-record layout: `type(1) len(1) meta(1) data[len]`. The F0 frame plen = count_byte + all_sub_record_bytes + 1.

---

## STATUS_POLL Response

Four RGBW channel values + two digital inputs. TLV response:

```
count=06
  01 04 00 [R] [G] [B] [W]    RGBW output values (current level 0–255 each)
  05 01 10 [R]                 ch0 (R): type=0x05, len=1, meta=0x10; parse_rx_dimmer_channel_value reads 2 bytes at [chan_idx*2 - 0x23]
  05 01 11 [G]                 ch1 (G): meta=0x11 (chan_idx=1)
  05 01 12 [B]                 ch2 (B): meta=0x12 (chan_idx=2)
  05 01 13 [W]                 ch3 (W): meta=0x13 (chan_idx=3)
  00 01 [meta] [inp]           digital input bitmask; byte[2]=value bitmask (bit 0=DIN0, bit 1=DIN1)
```

Standard ACK `AA 00 01 AB` returned when no state change.

---

## Wire Examples

F0 (MODULE_CMD) frame: `AA dest 0xF0 plen count [type len meta data...]... XOR_crc`

`batch_buf_append_rgbw_channels` produces 4 × sub-type 0x05: `type=0x05 len=2 meta=0x10 data=[chan_idx, value]`
- chan 0=R, 1=G, 2=B, 3=W; value 0–255

`SET_RAMP_TIME` (batched, `batch_buf_append_ramp_time`): sub-type 0x07, meta=0x10, 2 bytes: `[ramp_ms_lo, ramp_ms_hi]`

```
set R=255 G=0 B=0 W=0 ramp=0:
  aa <addr> f0  0a 01  06 05 00 00 00 00 00 00
                        1b 08 00 ff 00 00 00 00 01 00  <crc>
  (SET_RAMP_TIME type=0x06 len=5 [0,0,0,0,0] = 0ms)
  (SET_CHANNEL_VALUE type=0x1b len=8 meta=0x00 [R=0xff,G=0x00,B=0x00,W=0x00, flags=0x00, 0x01, 0x00])

all off:
  aa <addr> f0  0a 01  06 05 00 00 00 00 00 00
                        1b 08 00 00 00 00 00 00 01 00  <crc>
```

---

## CLU Lua API

Source of truth: `docs/device-interfaces/module_2_0_LED_RGBW_FM_fv03_02.xml`

### LEDRGB (class=9, ×1)

**Features:**

| Index | Name | R/W | Type | Range / Default | Unit | Description |
|-------|------|-----|------|-----------------|------|-------------|
| 0 | Value | R | num | 0-1 | number | Brightness value as per the HSV model (range: 0.00-1.00) |
| 1 | Hue | R | num | 0-360 | number | Colour hue value as per the HSV model (0-360) |
| 2 | Saturation | R | num | 0-1 | number | Colour saturation value as per the HSV model (0.00-1.00) |
| 3 | RedValue | R | num | 0-255 | number | R component value (0-255) - Red |
| 4 | GreenValue | R | num | 0-255 | number | G component value (0-255) - Green |
| 5 | BlueValue | R | num | 0-255 | number | B component value (0-255) - Blue |
| 15 | WhiteValue | R | num | 0-255 | number | W component value (0-255) - White |
| 6 | RGB | R | str |  | HEX | Colour value as per the RGB model #RRGGBB (specified in HEX) |
| 7 | RampTime | RW | num | 0-15000, def=0 | ms | Time value of increment of colour and brightness (in ms) |
| 8 | MaxValue | RW | num | 0-1, def=1 | number | Maximum value which Value can adopt. Attempting to set a higher value will generate an er… |
| 9 | MinValue | RW | num | 0-1, def=0 | number | Minimum value which Value can adopt. Attempting to set a lower value will generate an err… |
| 10 | RedCorrection | RW | num | 0-100, def=100 | % | White correction - channel R (0-100), default 100% |
| 11 | GreenCorrection | RW | num | 0-100, def=100 | % | White correction - G channel (0-100%), default 100% |
| 12 | BlueCorrection | RW | num | 0-100, def=100 | % | White correction - B channel (0-100%), default 100% |
| 13 | StatisticState | RW | num | 0=Off 1=Continuous | number | Enables measurement reporting to the statistics module |
| 14 | Load | RW | num | 0-60000, def=0 | W | The measured value multiplier. For StatisticState: Continuous - load measurement value in… |

**Methods:**

| Call | Index | Name | Params | Description |
|------|-------|------|--------|-------------|
| execute | 0 | SetValue | Value(0-1 number), Ramp(0-15000 ms) | Sets output value (0.00-1.00) |
| execute | 1 | SetHue | Value(0-360 number), Ramp(0-15000 ms) | Sets hue value (0-360) |
| execute | 2 | SetSaturation | Value(0-1 number), Ramp(0-15000 ms) | Sets saturation value (0.00-1.00) |
| execute | 3 | SetRedValue | Value(0-255 number), Ramp(0-15000 ms) | Sets R component value (0-255) |
| execute | 4 | SetGreenValue | Value(0-255 number), Ramp(0-15000 ms) | Sets G component value (0-255) |
| execute | 5 | SetBlueValue | Value(0-255 number), Ramp(0-15000 ms) | Sets B component value (0-255) |
| execute | 12 | SetWhiteValue | Value(0-255 number), Ramp(0-15000 ms) | Sets W channel value (0-255) |
| execute | 6 | SetRGBvalue | Value(HEX), Ramp(0-15000 ms) | Sets RGB value using the #RRGGBB string |
| execute | 7 | HoldValue | Ramp(ms) | Executes illumination/ dimming function |
| execute | 8 | HoldHue | Ramp(ms) | Executes smooth hue transition |
| execute | 9 | SwitchOn | Time(ms), Ramp(0-15000 ms) | Sets output value to MaxValue |
| execute | 10 | SwitchOff | Time(ms), Ramp(0-15000 ms) | Turns off all of the channels |
| execute | 11 | Switch | Time(ms), Ramp(0-15000 ms) | Changes the output value from 0 to 1 or from 1 to 0. The first parameter is the time of c… |
| set | 7 | SetRampTime | RampTime(ms) | Sets value of increment of colour and input (in ms) |
| set | 8 | SetMaxValue | Value | Sets maximum value for Value |
| set | 9 | SetMinValue | Value | Sets minimum value for Value |
| execute | 13 | HoldRedValue | Ramp(0-10000 ms) | Executes illumination/ dimming function for R channel |
| execute | 14 | HoldGreenValue | Ramp(0-10000 ms) | Executes illumination/ dimming function for G channel |
| execute | 15 | HoldBlueValue | Ramp(0-10000 ms) | Executes illumination/ dimming function for B channel |
| execute | 16 | HoldWhiteValue | Ramp(0-10000 ms) | Executes illumination/ dimming function for W channel |

**Events:**

| Address | Name | Description |
|---------|------|-------------|
| 0 | OnValueChange | Event occurring when changing the output state |
| 1 | OnSwitchOn | Event occurring when the output state is changed from 0 to greater than 0 |
| 2 | OnSwitchOff | Event occurring when 0 is set at the output |
| 3 | OnValueRise | Event occurring when the set value is higher than the current value |
| 4 | OnValueLower | Event occurring when the set value is lower than the current value |
| 5 | OnOutOfRange | Event occurring when setting a value which is higher than the maximum value or lower than… |

### LED_CHANNEL (class=49, ×4)

**Features:**

| Index | Name | R/W | Type | Range / Default | Unit | Description |
|-------|------|-----|------|-----------------|------|-------------|
| 0 | Value | R | num | 0-255 | number | Brightness value (range\: 0-255) |
| 1 | RampTime | RW | num | 0-15000, def=0 | ms | Delay value when changing illumination |
| 2 | MaxValue | RW | num | 0-255, def=255 | number | Maximum value which Value can adopt. Attempting to set a higher value will generate an er… |
| 3 | MinValue | RW | num | 0-255, def=0 | number | Minimum value which Value can adopt. Attempting to set a lower value will generate an err… |
| 4 | DistributedLogicGroup | RW | num | 0-10000, def=0 |  | Distributed Logic group - broadcast group for distributed logic |
| 5 | StatisticState | RW | num | 0=Off 1=Continuous | number | Enables measurement reporting to the statistics module |
| 6 | Load | RW | num | 0-60000, def=0 | W | The measured value multiplier. For StatisticState: Continuous - load measurement value in… |

**Methods:**

| Call | Index | Name | Params | Description |
|------|-------|------|--------|-------------|
| execute | 0 | SetValue | Value(0-255 number), Ramp(0-15000 ms) | Sets output value (0-255) |
| execute | 1 | SwitchOn | Time(ms), Ramp(0-15000 ms), Mode | Sets output value to MaxValue. LastValue mode switches the output on with the last non-ze… |
| execute | 2 | SwitchOff | Time(ms), Ramp(0-15000 ms) | Sets output value to 0. The value 0 of the Ramp parameter applies the time from the RampT… |
| execute | 3 | Switch | Time(ms), Ramp(0-15000 ms), Mode | Toggles the output state. LastValue mode restores the last non-zero value instead of MaxV… |
| set | 1 | SetRampTime | RampTime(ms) | Sets value of delay for changing illumination |
| set | 2 | SetMaxValue | Value | Sets maximum value for Value |
| set | 3 | SetMinValue | Value | Sets minimum value for Value |
| execute | 4 | HoldValue | Ramp(0-15000 ms) | Executes illumination/ dimming function |
| execute | 5 | HoldValueUp | Ramp(0-15000 ms) | Executes illumination function |
| execute | 6 | HoldValueDown | Ramp(0-15000 ms) | Executes dimming function |

**Events:**

| Address | Name | Description |
|---------|------|-------------|
| 0 | OnValueChange | Event occurring when changing the output value |
| 1 | OnSwitchOn | Event occurring when the output state is changed from 0 to greater than 0 |
| 2 | OnSwitchOff | Event occurring when 0 is set at the output |
| 3 | OnValueRise | Event occurring when the set value is higher than the current value |
| 4 | OnValueLower | Event occurring when the set value is lower than the current value |
| 5 | OnOutOfRange | Event occurring when setting a value which is higher than the maximum value or lower than… |

### DIN (class=3, ×2)

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

### LED_CCT (class=72, ×2)

**Features:**

| Index | Name | R/W | Type | Range / Default | Unit | Description |
|-------|------|-----|------|-----------------|------|-------------|
| 0 | ColorTemp | R | num | 2700-6500 | K | Color temperature (range 2700-6500 K) |
| 1 | ColorTemp% | R | num | 0-100 | % | Color temperature in percent (0% = 6500K cool, 100% = 2700K warm) |
| 2 | Value | R | num | 0-255 | number | Brightness value (range\: 0-255) |
| 3 | WarmValue | R | num | 0-255 | number | Computed warm white channel value WW (0-255) |
| 4 | ColdValue | R | num | 0-255 | number | Computed cold white channel value CW (0-255) |
| 5 | RampTime | RW | num | 0-15000, def=0 | ms | Ramp time for value changes |
| 6 | MaxValue | RW | num | 0-255, def=255 | number | Maximum value which Value can adopt |
| 7 | MinValue | RW | num | 0-255, def=0 | number | Minimum value which Value can adopt |

**Methods:**

| Call | Index | Name | Params | Description |
|------|-------|------|--------|-------------|
| execute | 0 | SetColorTemp | ColorTemp(2700-6500 K), Ramp(0-15000 ms) | Sets color temperature (2700-6500 K) |
| execute | 1 | SetColorTempPercent | Value(0-100 %), Ramp(0-15000 ms) | Sets color temperature in percent (0-100%) |
| execute | 2 | SetValue | Value(0-255 number), Ramp(0-15000 ms) | Sets output value (0-255) |
| execute | 4 | SwitchOn | Time(ms), Ramp(0-15000 ms), Mode | Sets output value to MaxValue. LastValue mode switches the output on with the last non-ze… |
| execute | 5 | SwitchOff | Time(ms), Ramp(0-15000 ms) | Sets output value to 0. The value 0 of the Ramp parameter applies the time from the RampT… |
| execute | 3 | Switch | Time(ms), Ramp(0-15000 ms), Mode | Toggles the output state. LastValue mode restores the last non-zero brightness together w… |
| set | 5 | SetRampTime | RampTime(ms) | Sets ramp time for value changes |
| set | 6 | SetMaxValue | Value | Sets maximum value for Value |
| set | 7 | SetMinValue | Value | Sets minimum value for Value |
| execute | 6 | HoldValue | Ramp(0-15000 ms) | Executes illumination/dimming function |
| execute | 7 | HoldValueUp | Ramp(0-15000 ms) | Executes illumination function |
| execute | 8 | HoldValueDown | Ramp(0-15000 ms) | Executes dimming function |
| execute | 9 | HoldColorTemp | Ramp(0-15000 ms) | Executes smooth color temperature transition |
| execute | 10 | HoldColorTempWarm | Ramp(0-15000 ms) | Shift color temperature towards warm (2700K) |
| execute | 11 | HoldColorTempCool | Ramp(0-15000 ms) | Shift color temperature towards cool (6500K) |

**Events:**

| Address | Name | Description |
|---------|------|-------------|
| 0 | OnValueChange | Event occurring when changing the output value |
| 1 | OnColorTempChange | Event occurring when color temperature changes |
| 2 | OnSwitchOn | Event occurring when the output state is changed from 0 to greater than 0 |
| 3 | OnSwitchOff | Event occurring when 0 is set at the output |
| 4 | OnOutOfRange | Event occurring when setting a value which is higher than the maximum value or lower than… |

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

