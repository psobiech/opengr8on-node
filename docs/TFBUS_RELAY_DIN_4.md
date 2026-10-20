# TFBUS — RELAY_DIN_4 Module

**hwType=21, fwType=2** — 4-channel relay (DIN rail)

Objects: `RELAY` ×4

---

## Init Sequence (per relay channel)

`DEACTIVATE` + `CHANNEL_MAP [ch, 0x02]` + `MODULE_PARAM [0, ch, 1, 0]`

Runtime: periodic `CHANNEL_MAP [ch, 0x02]` for all channels (descending).

---

## Wire Examples

```
light ON:   aa 03 f0  06 01 08 01 01 80  d6    ACTIVATE level=128
light OFF:  aa 03 f0  06 01 09 01 01 80  d7    DEACTIVATE val=128
```
