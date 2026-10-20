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
- `pos%(u8)`: 0–100%
- `flags(u8)`: motion/error flags (0=stopped)

---

## Wire Examples

```
roller STOP:  aa 07 f0  06 01 09 01 01 30  63    DEACTIVATE val=48
setpos 41%:   aa 07 f0  08 01 16 03 00 00 03 29  6b  SET_POSITION ch3 → 41%
```
