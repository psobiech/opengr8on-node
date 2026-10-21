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
