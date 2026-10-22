# TFBUS — DIMMER_MOSFET_DIN Module

**hwType=26, fwType=2** — single-channel MOSFET dimmer (DIN rail)

Objects: `DIMM` (class=5) ×1

---

## CLU Lua Features (DIMM object)

| Index | Name | Range | Default | Notes |
|-------|------|-------|---------|-------|
| 0 | Value | 0–1 | 0 | Normalized output level; clamped by Min/MaxValue |
| 1 | RampTime | 0–15000 ms | 500 | Sent as SET_RAMP_TIME on each SetValue |
| 2 | MinValue | 0–1 | 0 | Lower output clamp |
| 3 | MaxValue | 0–1 | 1 | Upper output clamp |
| 4 | StatisticState | 0=Off, 1=Continuous | 0 | Enables load measurement reporting |
| 5 | Load | 0–60000 W | 0 | Load multiplier (active when StatisticState=Continuous) |
| 6 | StartLevel | 0–1 | 0 | Output threshold |
| 8 | DistributedLogicGroup | 0–10000 | 0 | Broadcast group for distributed logic |

`get(0)` returns the programmed target level, not current ramp position.

---

## SetValue Sequence

1. `SET_RAMP_TIME` (type=0x06; default 500ms)
2. `DIMMER_SET_VALUE` (type=0x0c; LE u16 scale 0–1000)

`DIMMER_SET_VALUE` data: `[0, val_lo, val_hi]` — LE u16, 0–1000 (÷1000 = 0.0–1.0, 0.1% resolution).

---

## STATUS_POLL Response (10 bytes)

Raw frame: `aa 00 0b 02 01 02 10 [v0 v1] 00 01 01 [on] [crc]`

Decoded as TLV records:

| Record idx | type | meta | data | Meaning |
|-----------|------|------|------|---------|
| 0 | 0x01 | 0x10 | 2 bytes LE u16 | Dim level 0–1000 (programmed target) |
| 1 | 0x00 | 0x01 | 1 byte | Digital input bitmask (NOT output on/off) |

- `v0 v1`: LE u16 dim level (0–1000); reflects programmed target immediately after MODULE_CMD
- `on` byte: digital input state (0x00 = no input active)

**Ramp is hardware-internal.** The module ramps its MOSFET output between the old and new level over `SET_RAMP_TIME` ms, but STATUS_POLL always returns the *target* level, not the current ramp position. Intermediate ramp values are never visible on the bus.

Poll interval: ~113 ms per module address (26-address bus → full cycle ~2.9 s).

---

See [TFBUS_TESTING.md](TFBUS_TESTING.md) for general testing methodology.

---

## CLU Lua API — Full Reference

Source of truth: `docs/device-interfaces/module_2_0_DIMMER_MOSFET_DIN_fv03_02.xml`

### DIMM (class=5, ×1)

**Features:**

| Index | Name | R/W | Type | Range / Default | Unit | Description |
|-------|------|-----|------|-----------------|------|-------------|
| 0 | Value | RW | num | 0-1, def=0 | num | Specifies the current output value (0.0 - 1.0) |
| 1 | RampTime | RW | num | 0-15000, def=500 | ms | The value of the delay time of brightening or dimming the output (in ms) |
| 2 | MinValue | RW | num | 0-1, def=0 | num | Minimum value which Value can adopt. Attempting to set a lower value will generate an err… |
| 3 | MaxValue | RW | num | 0-1, def=1 | num | Maximum value which Value can adopt. Attempting to set a higher value will generate an er… |
| 6 | StartLevel | RW | num | 0-1, def=0 | num | Specifies the threshold of the output (0.0 - 1.0) |
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

