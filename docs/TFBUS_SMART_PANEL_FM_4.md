# TFBUS — SMART_PANEL_FM_4 Module

**hwType=3, fwType=3** — 4-button touch panel with RGB LED feedback

Objects: `PANEL_BUTTON` (class=30) ×16, `PANEL` (class=29), `PANELSENSTEMP`, `PANELSENSLIGHT`, `PANEL_PAGE` (class=19) ×4

SN prefix: `0x0f05`. Does not respond to VERSION_QUERY.

---

## LED_CMD Frame (type 0x18)

```
AA  dest  0x18  btn_mask  0x00  cmd_byte  XOR_crc     (7 bytes total)
```

- `btn_mask`: `1 << button_idx` (bit N = button N, 0-indexed)
- second payload byte: always `0x00`
- `cmd_byte`: LED action

| cmd_byte | Command | Effect |
|----------|---------|--------|
| `0x00` | ShowOK | Green LED flash |
| `0x01` | ShowError | Red LED flash |
| `0x02` | LedSwitchOn | LED on (steady) |
| `0x04` | LedSwitchOff | LED off — **not** `0x03` |
| `0x10` | RedLedSwitchOn | Red LED on (steady) |

Frame length: 7 bytes. Parser detects by CRC-scanning lengths 7–15.

Wire examples (dest=0x14, button 4 = bit 3 = mask 0x08):
```
ShowOK          aa 14 18 01 00 00 a7   (btn1, mask=0x01)
ShowError       aa 14 18 08 00 01 af   (btn4, mask=0x08)
LedSwitchOn     aa 14 18 08 00 02 ac
LedSwitchOff    aa 14 18 08 00 04 aa
RedLedSwitchOn  aa 14 18 08 00 10 be
```

---

## STATUS_POLL Response — Idle Bitmask (13 bytes, non-TLV)

```
bytes[0–1]   LE u16  button bitmask: bit N = instance N active
bytes[2–3]   LE u16  edge bitmask: non-zero on press start, 0 on press end
bytes[4–5]   LE u16  PANELSENSLIGHT (ambient light ×100)
bytes[6–7]   LE u16  unknown
bytes[8–11]          zeros
bytes[12]            0x02 flag
```

---

## Button Identity Encoding

See TFBUS.md § Button Identity Encoding for full event table.

**Button numbering**: row-major order — top-left → top-right → bottom-left → bottom-right = indices 0→1→2→3.

Multi-CLU note: secondary CLU (TCP-notified) receives type=0x07 only — all buttons appear identical. Button identity (type=0x08) only available to primary CLU owning the RS485 bus.
