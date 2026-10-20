# TFBUS — DIMMER_MOSFET_DIN Module

**hwType=26, fwType=2** — single-channel MOSFET dimmer (DIN rail)

Objects: `DIMM` (class=5) ×1

---

## SetValue Sequence

1. `SET_RAMP_TIME` (type=0x06; default 500ms)
2. `DIMMER_SET_VALUE` (type=0x0c; LE u16 scale 0–1000)

`DIMMER_SET_VALUE` data: `[0, val_lo, val_hi]` — LE u16, 0–1000 (÷1000 = 0.0–1.0, 0.1% resolution).

---

## STATUS_POLL Response (10 bytes)

```
02  01 02 10 [v0 v1]  00 01 01 [on]
```

- `v0 v1`: LE u16 dim level (0–1000)
- `on`: 0x00=off, 0x01=on
