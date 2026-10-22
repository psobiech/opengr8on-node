# TFBUS — ROLLER_SH_DIN_3 Module

**hwType=42, fwType=2** — 3-channel roller shutter controller (DIN rail)

Objects: `ROLLER` ×3

---

## Init Sequence (per logical roller channel, 1-based)

1. `CHANNEL_INIT [0x16, ch, 0]`
2. `FEATURE_PARAM ×4` (compact_idx 0,2,3 = configured values; idx 1 = 0)
3. `MODULE_PARAM [0, ch-1, 1, 0]`
4. `ROLLER_CHAN_REG [0, ch]`

Runtime refresh: 2-record `CHANNEL_MAP` (up/dn relay pair) + 2-record `FEATURE_PARAM [idx0,ch]+[idx1,ch,0,0]` + single FEATURE_PARAM for idx 2 and 3 + `CHANNEL_INIT` + `ROLLER_CHAN_REG`.

### FEATURE_PARAM compact_idx

| compact_idx | Feature name | Unit | Description |
|-------------|-------------|------|-------------|
| 0 | MaxTime | 10ms | Full open/close travel time |
| 1 | MechanicalOffset | 10ms | Drive start compensation |
| 2 | BlindsUpMaxTime | 10ms | Open time (0 = use MaxTime) |
| 3 | BlindsDownMaxTime | 10ms | Close time (0 = use MaxTime) |

---

## STATUS_POLL Response (23 bytes)

```
04
  01 01 [meta] [state]
  16 03 [meta] [inst] [pos%] [flags]   roller channel 0
  16 03 [meta] [inst] [pos%] [flags]   roller channel 1
  16 03 [meta] [inst] [pos%] [flags]   roller channel 2
```

Type 0x16 fields:
- `instance(u8)`: 1-based channel index
- `pos%(u8)`: 0–100% where **100=fully open, 0=fully closed**
- `flags(u8)`: motion/error flags

Known flag values:
- `0x00` — stopped at target (after physical movement completes)
- `0x5a` — position uncertain (CLU-only state update, no physical motor run, or uninitialized)

Type 0x01 state byte:
- `0x00` — stopped
- `0x01` — moving up (normal: MoveUp / SetPosition going up)
- `0x02` — moving down (normal: MoveDown / SetPosition going down)
- `0x10` — moving up in calibration mode (execute(8, 1))
- `0x20` — moving down in calibration mode (execute(8, 0)) or SetPosition (observed)

---

## Wire Examples

```
roller STOP:  aa 07 f0  06 01 09 01 01 30  63    DEACTIVATE val=48
setpos 41%:   aa 07 f0  08 01 16 03 00 00 03 29  6b  SET_POSITION ch3 → 41%
```

---

## CLU Lua API

Source of truth: `docs/device-interfaces/module_2_0_ROLLER_SHUTTER_DIN_3_fv02_02.xml`

Object nameOnCLU: one per ROLLER_SHUTTER object in the project (one per channel).

**Features (get-only unless noted):**

| Index | Name            | Values / unit         |
|-------|-----------------|-----------------------|
| 0     | State           | 0=Stop 1=Up 2=Down 3=Blocked |
| 3     | Up              | 0/1 relay state       |
| 4     | Down            | 0/1 relay state       |
| 7     | Position        | 0–100% (0=closed, 100=open) |
| 8     | LamelPosition   | 0–90°                 |
| 9     | MaxTime         | ms, read+write        |
| 10    | LamelMoveTimeout| ms, read+write        |

**Methods:**

| Call                   | Name             | Notes                              |
|------------------------|------------------|------------------------------------|
| `execute(0, ms)`       | MoveUp           | ms=0 → full travel (MaxTime)       |
| `execute(1, ms)`       | MoveDown         | ms=0 → full travel (MaxTime)       |
| `execute(2, ms)`       | Start            | toggle direction                   |
| `execute(3)`           | Stop             | stop if moving                     |
| `execute(4)`           | Hold             | with direction reversal            |
| `execute(5)`           | HoldUp           | hold always up                     |
| `execute(6)`           | HoldDown         | hold always down                   |
| `execute(8, dir)`      | Calibration      | 1=Up 0=Down                        |
| `execute(9, pos)`      | SetLamelPosition | 0–90°                              |
| `execute(10, pos)`     | SetPosition      | **0–100% — primary move command**  |
| `execute(13, state)`   | SetRollerBlocked | 0=unblocked 1=blocked              |
| `set(9, ms)`           | SetMaxTime       | full travel time in ms             |
| `set(10, ms)`          | SetLamelMoveTimeout |                                 |

Position convention (`RemoteCLUShutter.java`): `OPEN_POSITION=100`, `CLOSE_POSITION=0`.

**`execute(10, N)` — SetPosition behaviour depends on calibration state:**

- `flags=0x5a` (position uncertain): CLU-only update — position jumps instantly, no motor. Module doesn't know real position so refuses to drive.
- `flags=0x00` (position known, after calibration): physical motor runs — position changes gradually ~1%/250ms, state byte = `0x20` (moving down) or `0x10` (moving up).

**Prerequisite for physical movement:** run `execute(8, 1)` (Calibration Up) or `execute(8, 0)` (Calibration Down) first to establish known position. Calibration drives motor to the physical limit and sets flags=0x00.

Calibration behaviour on bus:
- Position counter **does not update** during calibration — stays frozen at starting value
- CLU runs motor for `MaxTime × (100% - startPos) / 100` milliseconds (time-based, no endstop detection)
- Motor runs against physical endstop for remaining time if it arrives early
- On completion: position **jumps instantly to 100%** (or 0% for Down calibration), state→0x00, flags→0x00

Physical movement signature: gradual position change + state=0x01/0x02 (or 0x10 for calibration).
CLU-only update signature: instant position jump + state=0x00.

Note on flags=0x5a + physical movement: a module with flags=0x5a CAN still run the motor if it has some prior position tracking. Flags=0x5a means position estimate is uncertain (not anchored to a physical limit), not necessarily that motor is locked. Full motor lockout (CLU-only update) occurs only when the module has no position track at all — typically after power-on with no prior calibration.

---

## STATUS_POLL Examples

Stopped (mixed calibration state):
```
aa 00 18 04
  01 01 02 00          state=0x00
  16 03 00 01 64 00    ch1 pos=100% flags=0x00
  16 03 00 02 00 5a    ch2 pos=0%   flags=0x5a
  16 03 00 03 22 5a    ch3 pos=34%  flags=0x5a
```

Calibration running (ch3 moving up, execute(8, 1)):
```
aa 00 18 04
  01 01 02 10          state=0x10 (calibration up)
  16 03 00 01 64 00    ch1 pos=100% flags=0x00
  16 03 00 02 00 5a    ch2 pos=0%   flags=0x5a
  16 03 00 03 2b 5a    ch3 pos=43%  flags=0x5a  ← frozen at start, not updating
```

SetPosition physical move (ch3 moving down, execute(8,1) then execute(10,50)):
```
aa 00 18 04
  01 01 02 20          state=0x20 (moving down)
  16 03 00 01 64 00    ch1 pos=100% flags=0x00
  16 03 00 02 00 5a    ch2 pos=0%   flags=0x5a
  16 03 00 03 63 00    ch3 pos=99%  flags=0x00  ← ~1%/250ms descent
  ...
  16 03 00 03 32 00    ch3 pos=50%  flags=0x00  ← stopped at target
```

Stop mid-motion (execute(3)):
```
aa 00 18 04
  01 01 02 00          state=0x00  ← immediate, first STATUS_POLL after stop
  16 03 00 01 64 00    ch1 pos=100% flags=0x00
  16 03 00 02 00 5a    ch2 pos=0%   flags=0x5a
  16 03 00 03 2c 00    ch3 pos=44%  flags=0x00  ← position preserved
```
Stop takes effect within one STATUS_POLL cycle (~120ms).

---

## CLU Lua API — Full Reference

Source of truth: `docs/device-interfaces/module_2_0_ROLLER_SHUTTER_DIN_3_fv03_02.xml`

### ROLLER_SHUTTER (class=24, ×3)

**Features:**

| Index | Name | R/W | Type | Range / Default | Unit | Description |
|-------|------|-----|------|-----------------|------|-------------|
| 16 | MechanicalOffset | RW | num | 0-1000, def=0 | ms | The time of compensation for start of the drive |
| 9 | MaxTime | RW | num | 0-600000, def=30000 | ms | The time in milliseconds it takes to fully open / close the blind |
| 14 | BlindsUpMaxTime | RW | num | 0-600000, def=0 | ms | The time in milliseconds it takes to fully open the blind |
| 15 | BlindsDownMaxTime | RW | num | 0-600000, def=0 | ms | The time in milliseconds it takes to fully close the blind |
| 0 | State | R | num | 0=Stop 1=Up 2=Down 3=Blocked 4=Calibration | - | Output state: 0 - no movement, 1 - moving upwards, 2 - moving downwards, 3 - blocked, 4 -… |
| 3 | Up | R | num | 0=Off 1=On |  | State of UP relay (moving upwards) |
| 4 | Down | R | num | 0=Off 1=On |  | State of DOWN relay (moving downwards) |
| 7 | Position | R | num | def=0 | % | Percentage value of the shutter opening: 0% - fully closed, 100% - fully open |
| 8 | LamelPosition | R | num | def=0 | ° | Roller shutter lamel position 90 - fully closed, 0 - fully open |
| 10 | LamelMoveTimeout | RW | num | 0-60000, def=0 | ms | The maximum working time of the shutter's slats, if the shutter does not have slats, shou… |
| 11 | DistributedLogicGroup | RW | num | 0-10000, def=0 |  | Distributed Logic group - broadcast group for distributed logic |
| 13 | ReversePosition | RW | num | 0=No 1=Yes |  | The function for inverting position range (0-100% for 100-0%): 0 - No, 1 - Yes |
| 17 | ReverseDirections | RW | num | 0=Normal 1=Reverse |  | The function of reversing the direction of the roller shutter operation |

**Methods:**

| Call | Index | Name | Params | Description |
|------|-------|------|--------|-------------|
| set | 16 | SetMechanicalOffset | Offset(0-1000 ms) | Sets the time of compensation for start of the drive |
| set | 14 | SetBlindsUpMaxTime | Timeout(0-600000 ms) | Sets the shutter opening time |
| set | 15 | SetBlindsDownMaxTime | Timeout(0-600000 ms) | Sets the shutter closing time |
| execute | 10 | SetPosition | Position(0-100 %), Lamel(0-90 °) | Shutter opening percentage setting: 0% - fully open, 100% - fully closed |
| execute | 9 | SetLamelPosition | Position(0-90 °) | Sets the position of the slats |
| execute | 8 | Calibration | Direction(-) | Calibrates the shutter position |
| set | 10 | SetLamelMoveTimeout | Timeout(0-60000 ms) | Sets the cycle time of the slats |
| execute | 0 | MoveUp | Time(ms) | Roller shutter UP or STOP if moving. Parameter Time: num - move up time (or until roller … |
| execute | 1 | MoveDown | Time(ms) | Roller shutter DOWN or STOP if moving. Parameter Time: num - move down time (or until rol… |
| execute | 2 | Start | Time(ms) | Roller shutter up if the preceding motion was down or roller shutter down if the precedin… |
| execute | 3 | Stop |  | STOP if moving |
| execute | 4 | Hold |  | Hold with direction change |
| execute | 5 | HoldUp |  | Hold always up |
| execute | 6 | HoldDown |  | Hold always down |
| execute | 13 | SetRollerBlocked | State(0-1 ms) | Enables / disables the ability to control the roller shutter |
| execute | 14 | LamelStart |  | Changes the position of the slats by 45° |

**Events:**

| Address | Name | Description |
|---------|------|-------------|
| 0 | OnStateChange | Occurs when changing the State properties |
| 1 | OnUp | Occurs when changing the Stop state to the Up state |
| 2 | OnDown | Occurs when changing the Stop state to the Down state |
| 3 | OnStart | Occurs when the shutter is activated |
| 4 | OnStop | Occurs when the shutter is stopped |
| 6 | OnLamelClosed | Occurs when the slats are closed (value 90°) |
| 7 | OnLamelOpen | Occurs when the slats are opened (value 0°) |
| 8 | OnPositionChange | Occurs when the roller shutter position has changed |
| 9 | OnLamelPositionChange | Occurs when the position of the slats has changed |

### PowerSupplyVoltage (class=12, ×1)

**Features:**

| Index | Name | R/W | Type | Range / Default | Unit | Description |
|-------|------|-----|------|-----------------|------|-------------|
| 0 | Value | R | num | 0-24, def=0 | V | Current power supply voltage value |
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

