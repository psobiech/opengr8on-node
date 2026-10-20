# TFBUS — IO_MODULE_DIN_8 Module

**hwType=30, fwType=2** — 8-channel digital I/O module

Objects: `IO` ×8

---

## Init Sequence (2-phase)

**Phase 1** (relay outputs, ch 0–7 each):
- `DEACTIVATE` + `MODULE_PARAM [0, ch, 1, 0]`

**Phase 2** (DIN inputs, ch 0–7 each):
- `CHANNEL_INIT [0x00, ch, 0]` + `MODULE_PARAM [0, ch, 0, 0]`

Runtime: periodic `CHANNEL_INIT` + `CHANNEL_MAP` per input channel (descending order).

---

## STATUS_POLL Response (14 bytes)

```
03
  00 01 [meta] [inp_byte]      8 digital inputs — bit N = input N active
  01 01 [meta] [state]         output state (0=idle)
  02 02 [meta] [LO] [HI]       temperature LE uint16 ÷ 100 = °C
```

Example: `03 00 01 01 00 01 01 01 00 02 02 10 6c 09`
→ inputs=0x00 (all off), state=idle, temp=0x096C=2412 → **24.12°C**
