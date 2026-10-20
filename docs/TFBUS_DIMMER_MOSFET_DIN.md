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
