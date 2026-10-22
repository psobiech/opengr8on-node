# TFBUS — LED_RGBW_DIN Module

**hwType=24, fwType=2** — 4-channel RGBW LED driver

Objects: `LED_CHANNEL` (class=49) ×4

---

## Init Sequence

1. `SET_RAMP_TIME` (type=0x06; plen includes 0x0a)
2. count=4 batch: `SET_CHANNEL_VALUE [0,R] [1,G] [2,B] [3,W]`

---

## Set Channel Brightness (MODULE_CMD 0xF0)

### Config (SET_RAMP_TIME)

Sent before every brightness command batch. Sets transition ramp in ms.

```
AA  dest  0xF0  plen  01  06 05 00  00 ramp_lo ramp_hi 00 00  CRC
```

Example (ramp=42ms, dest=5):
```
aa 05 f0 0a 01  06 05 00 00 2a 00 00 00  7d
```

### Brightness (SET_CHANNEL_VALUE, count=4 batch)

```
AA  dest  0xF0  16  04
  05 02 10  00  <ch0>
  05 02 10  01  <ch1>
  05 02 10  02  <ch2>
  05 02 10  03  <ch3>
CRC
```

Sub-record: `type=0x05  len=0x02  meta=0x10  [chan_idx(1)  value(1)]`

- `chan_idx`: 0=ch0(R), 1=ch1(G), 2=ch2(B), 3=ch3(W)
- `value`: 0x00–0xFF brightness

Example (ch0=150, ch1–3=0, dest=5):
```
aa 05 f0 16 04  05 02 10 00 96  05 02 10 01 00  05 02 10 02 00  05 02 10 03 00  db
```

### Frame Anatomy

```
aa 05 f0  16  04  05 02 10 00 96  05 02 10 01 00  05 02 10 02 00  05 02 10 03 00  db
│  │  │   │   │   │  │  │  │  │
│  │  │   │   │   │  │  │  │  └── brightness value (0x96 = 150)
│  │  │   │   │   │  │  │  └───── chan_idx (0x00 = ch0)
│  │  │   │   │   │  │  └──────── meta = 0x10
│  │  │   │   │   │  └─────────── len = 2
│  │  │   │   │   └────────────── type = 0x05 (SET_CHANNEL_VALUE)
│  │  │   │   └────────────────── count = 4 sub-records
│  │  │   └────────────────────── plen = 0x16 (22, includes plen byte)
│  │  └────────────────────────── MODULE_CMD
│  └───────────────────────────── dest addr
└──────────────────────────────── 0xAA start
```

Module responds: `AA 00 01 AB` (standard ACK).

---

## CLU Interface

### Method Indices (execute)

| Index | Method | Args |
|-------|--------|------|
| 3 | SetRedValue | value (0–255) |
| 4 | SetGreenValue | value (0–255) |
| 5 | SetBlueValue | value (0–255) |
| 12 | SetWhiteValue | value (0–255) |
| 6 | SetRGBvalue | R, G, B |

Ramp time can be passed as optional third arg: `<ObjName>:execute(3, 255, 500)` (500 ms).

### Feature Indices (set/get)

| Index | Feature | Default |
|-------|---------|---------|
| 3 | RedValue | — |
| 4 | GreenValue | — |
| 5 | BlueValue | — |
| 7 | RampTime (ms) | 0 |
| 8 | MaxValue | 1 |
| 9 | MinValue | 0 |
| 10 | RedCorrection (%) | 100 |
| 11 | GreenCorrection (%) | 100 |
| 12 | BlueCorrection (%) | 100 |

---

## STATUS_POLL Response

Module responds ACK (`AA 00 01 AB`) by default. A data frame is only emitted when a MODULE_CMD coincides with the STATUS_POLL exchange (timing collision — non-deterministic; see TFBUS_TESTING.md).

**One captured data frame** (R transitioning 255→0 with ramp=2000 ms):

```
aa 00 06 01  06 01 01 00  ab
│  │  │  │   │  │  │  │
│  │  │  │   │  │  │  └── data[0] = 0x00 (target value)
│  │  │  │   │  │  └───── meta = 0x01
│  │  │  │   │  └──────── len = 1
│  │  │  │   └─────────── type = 0x06
│  │  │  └─────────────── count = 1 TLV record
│  │  └────────────────── plen = 6 (5 payload bytes)
│  └───────────────────── addr = 0x00 (module → CLU)
└──────────────────────── 0xAA start
```

Decoded by sniffer: `{ type: 6, meta: 1, data: "00" }`

Type=6 matches `SET_RAMP_TIME` command code. Full mapping of type/meta/data across channels not yet decoded (capture is timing-dependent).

---

## Observed Wire Captures

Captured during live RGB brightness adjustment (addr=5, ~10s session):

| Value (dec) | Value (hex) | Notes |
|-------------|-------------|-------|
| 150 | 0x96 | initial |
| 199 | 0xC7 | |
| 214 | 0xD6 | peak |
| 71  | 0x47 | minimum observed |

Timing: ~200ms between frames during continuous slider manipulation.

---

## CLU Lua API — Full Reference

Source of truth: `docs/device-interfaces/module_2_0_LED_RGBW_DIN_fv04_02.xml`

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

