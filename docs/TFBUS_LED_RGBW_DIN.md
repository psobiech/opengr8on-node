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

## STATUS_POLL Response

No specific STATUS_POLL payload documented for LED_RGBW_DIN. Module uses standard ACK on commands.

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
