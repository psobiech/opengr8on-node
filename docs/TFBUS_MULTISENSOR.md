# TFBUS — MULTISENSOR Module

**hwType=45, fwType=2**

Objects: `TEMPERATURE_SENSOR` ×1, `LIGHT_SENSOR_LUX` ×1, `HUMIDITY_SENSOR` ×1, `PRESSURE_SENSOR` ×1, `AIR_CO2_SENSOR` ×1, `AIR_VOC_SENSOR` ×1, `SOUND_SENSOR` ×1, `IR_CONTROLLER` ×1, `POWER_SUPPLY_VOLTAGE` ×1

---

## Init Sequence

All sensor channels are read-only inputs. Per sensor channel:

1. `CHANNEL_INIT [0x00, ch, 0]`
2. `MODULE_PARAM [0, ch, 0, 0]`

IR_CONTROLLER output channel:
3. `CHANNEL_INIT [0x2c, ch, 0]`  (type=0x2c = IR output)
4. `MODULE_PARAM [0, ch, 1, 0]`

Batched F0 frames (fwType=2, hwType=45>9).

Each sub-record layout: `type(1) len(1) meta(1) data[len]`. The F0 frame plen = count_byte + all_sub_record_bytes + 1.

---

## STATUS_POLL Response

Multiple sensor readings. TLV response includes sub-records for each active sensor:

```
count=N
  02 02 10 [lo hi]    temperature LE int16 ÷ 100 = °C
  02 02 10 [lo hi]    humidity LE int16 ÷ 100 = %
  02 02 10 [lo hi]    pressure LE int16 ÷ 10 = hPa
  02 02 10 [lo hi]    CO2 LE int16 = ppm
  02 02 10 [lo hi]    VOC LE int16 = ppb
  07 02 10 [lo hi]    light LE int16 raw ADC → lux
  02 02 10 [lo hi]    sound LE int16 = dB
  02 02 10 [lo hi]    power supply voltage LE u16 ÷ 100 = V
```

Meta byte encodes channel/sensor identity. Only sensors with changed values are reported; unchanged sensors may be absent from poll response.

Standard ACK `AA 00 01 AB` returned when no state change.

---

## Wire Examples

No direct output commands for most sensors — read-only.

Poll response example (temp=21.5°C, hum=45%):
```
aa 00 0e 02  02 02 10 6c 08  02 02 11 c4 11  <crc>
             type=0x02 len=2 meta=0x10 data=[0x6c 0x08]  (0x086c = 2156 ÷ 100 = 21.56°C)
             type=0x02 len=2 meta=0x11 data=[0xc4 0x11]  (0x11c4 = 4548 ÷ 100 = 45.48%)
```

---

## CLU Lua API

Source of truth: `docs/device-interfaces/module_2_0_MULTISENSOR_fv01_02.xml`

### TEMPERATURE_SENSOR (class=20, ×1)

**Features:**

| Index | Name | R/W | Type | Range / Default | Unit | Description |
|-------|------|-----|------|-----------------|------|-------------|
| 1 | Threshold | RW | num | 0-1, def=0.1 | number | Hysteresis size (accuracy 0.1 °C) specifying the sensitivity when the following events ar… |
| 2 | Sensitivity | RW | num | 100-5000, def=300 | ms | Time (in ms) for which the sampled values are averaged |
| 8 | Calibration | RW | num | def=0 | °C | Temperature calibration factor within -10 °C to +10° C |
| 3 | MinValue | RW | num | 0-100, def=0 | °C | Minimum value of the Value property after exceeding which the OnOutOfRange event is gener… |
| 4 | MaxValue | RW | num | 0-100, def=100 | °C | Maximum value of the Value property after exceeding which the OnOutOfRange event is gener… |
| 9 | StatisticState | RW | num | 0=Off 1=On | number | Enables measurement reporting to the statistics module |
| 0 | Value | R | num | 0-45 | °C | Ambient temperature value from 0.0 °C to 45.0 °C |

**Methods:**

_None._

**Events:**

| Address | Name | Description |
|---------|------|-------------|
| 0 | OnValueChange | Event resulting from changing input state |
| 1 | OnValueRise | Event resulting from exceeding the upper threshold of hysteresis |
| 2 | OnValueLower | Event resulting from exceeding the lower threshold of hysteresis |
| 3 | OnOutOfRange | Event resulting from exceeding the (MinValue - MaxValue) range |
| 4 | OnInRange | Event occurs when value returns to MinValue - MaxValue range |

### LIGHT_SENSOR_LUX (class=42, ×1)

**Features:**

| Index | Name | R/W | Type | Range / Default | Unit | Description |
|-------|------|-----|------|-----------------|------|-------------|
| 1 | Threshold | RW | num | 0-100, def=1 | number | Hysteresis size (accuracy 0.1 lx) specifying the sensitivity when the following events ar… |
| 2 | Sensitivity | RW | num | 100-5000, def=500 | ms | Time (in ms) for which the sampled values are averaged |
| 3 | MinValue | RW | num | 0-15000, def=0 | lx | Minimum value of the Value property after exceeding which the OnOutOfRange event is gener… |
| 4 | MaxValue | RW | num | 0-15000, def=15000 | lx | Maximum value of the Value property after exceeding which the OnOutOfRange event is gener… |
| 5 | StatisticState | RW | num | 0=Off 1=On | number | Enables measurement reporting to the statistics module |
| 0 | Value | R | num | 0-15000 | lx | Light intensity value from 0 to 15000 lx |

**Methods:**

_None._

**Events:**

| Address | Name | Description |
|---------|------|-------------|
| 0 | OnValueChange | Event resulting from changing input state |
| 1 | OnValueRise | Event resulting from exceeding the upper threshold of hysteresis |
| 2 | OnValueLower | Event resulting from exceeding the lower threshold of hysteresis |
| 3 | OnOutOfRange | Event resulting from exceeding the (MinValue - MaxValue) range |
| 4 | OnInRange | Event occurs when value returns to the (MinValue - MaxValue) range |

### HUMIDITY_SENSOR (class=22, ×1)

**Features:**

| Index | Name | R/W | Type | Range / Default | Unit | Description |
|-------|------|-----|------|-----------------|------|-------------|
| 1 | Threshold | RW | num | 0-100, def=0.1 | number | Hysteresis size (accuracy 0.1 %) specifying the sensitivity when the following events are… |
| 2 | Sensitivity | RW | num | 100-5000, def=500 | ms | Time (in ms) for which the sampled values are averaged |
| 3 | MinValue | RW | num | 0-100, def=0 | % | Minimum value of the Value property after exceeding which the OnOutOfRange event is gener… |
| 4 | MaxValue | RW | num | 0-100, def=100 | % | Maximum value of the Value property after exceeding which the OnOutOfRange event is gener… |
| 9 | StatisticState | RW | num | 0=Off 1=On | number | Enables measurement reporting to the statistics module |
| 0 | Value | R | num | 0-100 | % | The value of air humidity from 0 to 100 % |

**Methods:**

_None._

**Events:**

| Address | Name | Description |
|---------|------|-------------|
| 0 | OnValueChange | Event resulting from changing input state |
| 1 | OnValueRise | Event resulting from exceeding the upper threshold of hysteresis |
| 2 | OnValueLower | Event resulting from exceeding the lower threshold of hysteresis |
| 3 | OnOutOfRange | Event resulting from exceeding the (MinValue - MaxValue) range |
| 4 | OnInRange | Event occurs when value returns to the (MinValue - MaxValue) range |

### PRESSURE_SENSOR (class=34, ×1)

**Features:**

| Index | Name | R/W | Type | Range / Default | Unit | Description |
|-------|------|-----|------|-----------------|------|-------------|
| 1 | Threshold | RW | num | 0-100, def=0.1 | number | Hysteresis size (accuracy 0.1 hPa) specifying the sensitivity when the following events a… |
| 2 | Sensitivity | RW | num | 100-5000, def=500 | ms | Time (in ms) for which the sampled values are averaged |
| 3 | MinValue | RW | num | 300-1100, def=300 | hPa | Minimum value of the Value property after exceeding which the OnOutOfRange event is gener… |
| 4 | MaxValue | RW | num | 300-1100, def=1100 | hPa | Maximum value of the Value property after exceeding which the OnOutOfRange event is gener… |
| 0 | Value | R | num | 300-1100 | hPa | The value of the atmospheric pressure from 300 to 1100 hPa |
| 7 | Altitude | RW | num | 0-5000, def=0 | m | Height of the measuring point in meters above sea level |
| 9 | StatisticState | RW | num | 0=Off 1=On | number | Enables measurement reporting to the statistics module |

**Methods:**

_None._

**Events:**

| Address | Name | Description |
|---------|------|-------------|
| 0 | OnValueChange | Event resulting from changing input state |
| 1 | OnValueRise | Event resulting from exceeding the upper threshold of hysteresis |
| 2 | OnValueLower | Event resulting from exceeding the lower threshold of hysteresis |
| 3 | OnOutOfRange | Event resulting from exceeding the (MinValue - MaxValue) range |
| 4 | OnInRange | Event occurs when value returns to the (MinValue - MaxValue) range |

### AIR_CO2_SENSOR (class=41, ×1)

**Features:**

| Index | Name | R/W | Type | Range / Default | Unit | Description |
|-------|------|-----|------|-----------------|------|-------------|
| 1 | Threshold | RW | num | 0-100, def=1 | number | Hysteresis size (accuracy 1 ppm) specifying the sensitivity when the following events are… |
| 2 | Sensitivity | RW | num | 100-5000, def=500 | ms | Time (in ms) for which the sampled values are averaged |
| 3 | MinValue | RW | num | 400-60000, def=400 | ppm | Minimum value of the Value property after exceeding which the OnOutOfRange event is gener… |
| 4 | MaxValue | RW | num | 400-60000, def=60000 | ppm | Maximum value of the Value property after exceeding which the OnOutOfRange event is gener… |
| 9 | StatisticState | RW | num | 0=Off 1=On | number | Enables measurement reporting to the statistics module |
| 0 | Value | R | num | 400-60000 | ppm | Estimated value of CO2 in the range from 400 to 60000 ppm |

**Methods:**

| Call | Index | Name | Params | Description |
|------|-------|------|--------|-------------|
| execute | 0 | Recalibration | State(0-1) | Forces CO2 sensor calibration (calibration time up to 12 h) |

**Events:**

| Address | Name | Description |
|---------|------|-------------|
| 0 | OnValueChange | Event resulting from changing input state |
| 1 | OnValueRise | Event resulting from exceeding the upper threshold of hysteresis |
| 2 | OnValueLower | Event resulting from exceeding the lower threshold of hysteresis |
| 3 | OnOutOfRange | Event resulting from exceeding the (MinValue - MaxValue) range |
| 4 | OnInRange | Event occurs when value returns to the (MinValue - MaxValue) range |

### AIR_VOC_SENSOR (class=36, ×1)

**Features:**

| Index | Name | R/W | Type | Range / Default | Unit | Description |
|-------|------|-----|------|-----------------|------|-------------|
| 1 | Threshold | RW | num | 0-100, def=1 | number | Hysteresis size (accuracy 1 ppb) specifying the sensitivity when the following events are… |
| 2 | Sensitivity | RW | num | 100-5000, def=500 | ms | Time (in ms) for which the sampled values are averaged |
| 3 | MinValue | RW | num | 0-60000, def=0 | % | Minimum value of the Value property after exceeding which the OnOutOfRange event is gener… |
| 4 | MaxValue | RW | num | 0-60000, def=60000 | % | Maximum value of the Value property after exceeding which the OnOutOfRange event is gener… |
| 9 | StatisticState | RW | num | 0=Off 1=On | number | Enables measurement reporting to the statistics module |
| 0 | Value | R | num | 0-60000 | ppb | Volatile Organic Compounds (VOC) value in the range from 0 to 60000 ppb |

**Methods:**

_None._

**Events:**

| Address | Name | Description |
|---------|------|-------------|
| 0 | OnValueChange | Event resulting from changing input state |
| 1 | OnValueRise | Event resulting from exceeding the upper threshold of hysteresis |
| 2 | OnValueLower | Event resulting from exceeding the lower threshold of hysteresis |
| 3 | OnOutOfRange | Event resulting from exceeding the (MinValue..MaxValue) range |
| 4 | OnInRange | Event occurs when value returns to the (MinValue - MaxValue) range |

### SOUND_SENSOR (class=37, ×1)

**Features:**

| Index | Name | R/W | Type | Range / Default | Unit | Description |
|-------|------|-----|------|-----------------|------|-------------|
| 1 | Threshold | RW | num | 0-100, def=0.1 | number | Hysteresis size (accuracy 0.1 dB) specifying the sensitivity when the following events ar… |
| 2 | Sensitivity | RW | num | 100-5000, def=500 | ms | Time (in ms) for which the sampled values are averaged |
| 3 | MinValue | RW | num | 30-130, def=30 | dB | Minimum value of the Value property after exceeding which the OnOutOfRange event is gener… |
| 4 | MaxValue | RW | num | 30-130, def=130 | dB | Maximum value of the Value property after exceeding which the OnOutOfRange event is gener… |
| 9 | StatisticState | RW | num | 0=Off 1=On | number | Enables measurement reporting to the statistics module |
| 0 | Value | R | num | 30-130 | dB | Sound intensity from 30 to 130 dB |

**Methods:**

_None._

**Events:**

| Address | Name | Description |
|---------|------|-------------|
| 0 | OnValueChange | Event resulting from changing input state |
| 1 | OnValueRise | Event resulting from exceeding the upper threshold of hysteresis |
| 2 | OnValueLower | Event resulting from exceeding the lower threshold of hysteresis |
| 3 | OnOutOfRange | Event resulting from exceeding the (MinValue - MaxValue) range |
| 4 | OnInRange | Event occurs when value returns to the (MinValue - MaxValue) range |

### IR_CONTROLLER (class=38, ×1)

**Features:**

| Index | Name | R/W | Type | Range / Default | Unit | Description |
|-------|------|-----|------|-----------------|------|-------------|
| 2 | SavedCodes | R | num | 0-100, def=1 | - | Number of saved codes in Flash memory |

**Methods:**

| Call | Index | Name | Params | Description |
|------|-------|------|--------|-------------|
| execute | 0 | SendCode | CodeNumber(1-100) | Sends the IR code stored at index CodeNumber, signaling the fact with the green LED. The … |
| execute | 1 | LearnCode | CodeNumber(1-100) | Calls the IR code learning mode at index CodeNumber |
| execute | 3 | EraseCode | CodeNumber(1-100) | Erases the IR code stored at index CodeNumber |
| execute | 2 | EraseFlash | State(0-1) | Erasing all of the IR codes stored in Flash memory |

**Events:**

| Address | Name | Description |
|---------|------|-------------|
| 0 | OnIrSend | Event occurring when the IR code send takes place |
| 1 | OnLearningStatusChange | Event occurring when a change in the learning status takes place |
| 2 | OnLearningOK | Event occurring when the IR code learning status changes to "OK" |
| 3 | OnLearning | Event occurring when the IR code learning status changes to "Learning" |
| 4 | OnLearningFail | Event occurring when the IR code learning status changes to "Learning Fail" |

### POWER_SUPPLY_VOLTAGE (class=12, ×1)

**Features:**

| Index | Name | R/W | Type | Range / Default | Unit | Description |
|-------|------|-----|------|-----------------|------|-------------|
| 0 | Value | R | num | 0-36, def=0 | V | Current power supply voltage value |
| 1 | Value% | R | num | 0-1000000, def=0 | % | Current power supply voltage value as a percentage of the maximum value (MaxValue propert… |
| 3 | Sensitivity | RW | num | 0-10, def=0.5 | V | Minimum value change of the power supply voltage that generates OnValueChange, OnValueLow… |
| 5 | MinValue | RW | num | def=21 | V | Minimum value of the power supply voltage after exceeding which the OnOutOfRange event is… |
| 6 | MaxValue | RW | num | def=24 | V | Maximum value of the power supply voltage after exceeding which the OnOutOfRange event is… |

**Methods:**

| Call | Index | Name | Params | Description |
|------|-------|------|--------|-------------|
| set | 3 | SetSensitivity | Sensitivity(0-10 V) | Sets the sensitivity of measuring the power supply voltage |
| set | 5 | SetMinValue | MinValue | Sets the MinValue property |
| set | 6 | SetMaxValue | MaxValue | Sets the MaxValue property |

**Events:**

| Address | Name | Description |
|---------|------|-------------|
| 0 | OnValueChange | Event occurs when the value of the power supply voltage changes |
| 1 | OnValueLower | Event occurs when a value of the power supply voltage lower than the value from the last … |
| 2 | OnValueRise | Event occurs when a value of the power supply voltage higher than the value from the last… |
| 3 | OnOutOfRange | Event occurs when the value of the power supply voltage exceeding the permissible the (Mi… |
| 6 | OnInRange | Event occurs when the value of the power supply voltage returns to the (MinValue - MaxVal… |

