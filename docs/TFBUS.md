# TFBUS Protocol

## Overview

TFBUS is a proprietary field bus protocol used by Grenton CLU (Central Logic Unit) smart-home controllers to communicate with peripheral hardware modules over RS485. Protocol version: **TFBUS 2.0**.

The protocol defines:
- Physical RS485 framing for direct CLU-to-module communication
- A structured command layer for module control (relays, dimmers, rollers, LEDs, panels)
- TLV (Type-Length-Value) data model for bidirectional status and configuration exchange
- A discovery and address-assignment state machine for automatic module enumeration

---

## Architecture

TFBUS operates across one transport context:

| Layer | Transport | Frame structure | Purpose |
|-------|-----------|----------------|---------|
| RS485 Direct | UART | `{0xAA, addr, type, payload, XOR}` | Discovery, reset, address assignment, polling, module control |

The internal TCP/UDP queue format is not exposed on the wire. All RS485 communication uses the standard framing described below.

---

## RS485 Wire Frame Format

Byte[2] meaning differs by direction:

**CLU → module (command)**:
```
Byte [0]      = 0xAA           start byte (always)
Byte [1]      = dest_addr      destination RS485 address (1–48, 0xFF broadcast)
Byte [2]      = frame_type     command ID — see frame type table
Byte [3..N-1] = payload        0–29 bytes
Byte [N]      = XOR_crc        XOR of bytes [0..N-1]
```
No explicit length field. Receiver uses a type→length table for known frame types; falls back to CRC scan for unknown types. Exception: MODULE_CMD (0xF0) carries an explicit `plen` byte at byte[3] that encodes payload length (plen includes itself).

**Module → CLU response** (dest_addr = 0x00):
```
Byte [0]      = 0xAA           start byte
Byte [1]      = 0x00           CLU address
Byte [2]      = payload_len    number of payload bytes that follow
Byte [3..N-1] = payload        TLV records
Byte [N]      = XOR_crc        XOR of bytes [0..N-1]
```
Explicit length field at byte[2] — no CRC scan needed.

**Address space**: modules use addresses 1–48; `0xFF` = broadcast; `0x00` = CLU's own RS485 address.

**Checksum**: XOR of all bytes including start byte. Zero-payload shortcut: `XOR = 0xAA ^ dest_addr ^ type`.

**Standard ACK**: `AA 00 01 AB` — sent by modules in response to most commands (SEEK, ADDR_ASSIGN, MODULE_CMD).

---

## Frame Types

Frame types fall into three groups:

- **Universal (< 0x10)**: work with any module — discovery, reset, address assignment, polling
- **Class-specific (0x10–0x2F)**: type byte equals the CLU object class ID; same type byte carries different payloads to different module classes
- **Command wrappers / special (0x30+)**: structured command frames, provisioning, version query

| Type | Name             | Size | Dest | Payload |
|------|------------------|------|------|---------|
| `0x02` | ADDR_ASSIGN      | 9 | 0xFF | `serial_number(u32 LE), channel(u8)` |
| `0x04` | STATUS_POLL      | 4 | unicast | none |
| `0x07` | RESET            | 4 | any | none |
| `0x09` | ADDR_CONFIRM     | 5 | unicast | `{0x02}` |
| `0x0A` | ???              | 4 | any | none |
| `0x0B` | FORCE_GET_STATUS | 4 | 0xFF | none |
| `0x10`–`0x28` | CLASS_UPDATE     | variable | unicast | class-specific; see Class-Specific section |
| `0x2A` | SEEK             | 4 | 0xFF | none |
| `0xF9` | VERSION_QUERY    | 4 | unicast | none |
| `0x30` | DISPLAY_BLOCK    | 26 | unicast | `chan(1) sub(1) data[20]` |
| `0x31` | TFBUS_CMD        | 26 | unicast | `cmd(1) data[21]` |
| `0xF0` | MODULE_CMD       | variable | unicast | `plen(1) count(1) sub-records...` |
| `0xFB` | PROVISION        | 25 | 0xFF | `type(1) serial(4) key(16)` |
| `0xFD` | ???              | 7 | 0xFF | `{r4, r5, r6}` |
| `0xFE` | ???              | 7 | 0xFF | `{r4, r5, r6}` |

**Note on type 0x18**: serves dual purpose — LED control for SMART_PANEL_FM_4 modules, and WAKE_UP class notification for Z-Wave modules. The destination address determines which interpretation applies.

---

## Class-Specific Frame Types (0x10–0x28)

### Conceptual Model

The CLU maintains an internal object model where **objects** (software abstractions in the CLU's Lua runtime) map to **modules** (physical RS485 devices). When object state changes, the CLU sends a class-update frame to the RS485 address of the module hosting that object.

Frame type byte `0x10`–`0x28` = the object's class ID (decimal class ID interpreted as hex byte). The destination module interprets the frame based on its firmware support for that class.

**Two dispatcher paths** based on module firmware generation:
- **New TLV path** (newer firmware types): builds multi-record TLV frame and enqueues for RS485
- **Old direct path** (older firmware types): builds inline payload and sends directly

Both paths emit the same frame type byte on the wire.

### Class ID Mapping

| Class ID | XML Name | Old-path payload | New-path TLV rec_type |
|---|---|---|---|
| `0x10` (16) | Scheduler | 2B: `[1<<channel, value_lo]` | — |
| `0x11` (17) | GENERIC_ZW_NODE | 1B: `[1<<channel]` or `[value]` | rec_type=0x08, len=1 |
| `0x12` (18) | Thermostat | 1B: `[1<<channel]` or `[value]` | rec_type=0x09, len=1 |
| `0x13` (19) | PANEL_PAGE | 5B: `[1<<channel, v0, v1, v2, v3]` (full 32-bit) | rec_type=0x0A, len=5 |
| `0x14` (20) | PANELSENSTEMP | 3B: `[1<<channel, v_lo, v_hi]` (16-bit, 0.01°C) | rec_type=0x0C, len=3 |
| `0x15` (21) | PANELSENSLIGHT | 3B: `[1<<channel, v_lo, v_hi]` | rec_type=0x06, len=3 |
| `0x16` (22) | HUMIDITY_SENSOR | 4B: `[chan, lo, mid, hi]` | rec_type=0x00, len=4 |
| `0x17` (23) | ONEW_SENSOR | 3B: `[mask_lo, mask_hi, v_lo]` | rec_type=0x01, len=3 |
| `0x18` (24) | WAKE_UP | 3B: `[mask_lo, mask_hi, v_lo]` | rec_type=0x02, len=3 |
| `0x19` (25) | ZWAVE_BINARY_SENSOR | **no frame** | — |
| `0x1A` (26) | BATTERY | 4B: `[v2, v3, v1, v0]` (shuffled byte order) | — |
| `0x1B` (27) | DALI_MASTER | 3B: `[v0, v1, v2]` (lower 24 bits) | 4× TLV recs: each `[chan_idx(0-3), byte_of_value]` |
| `0x1C` (28) | *(unassigned in XML)* | 2B: `[v0, v1]` (lower 16 bits) | rec_type=0x06, len=5 |
| `0x1D` (29) | PANEL | 3B: `[v0, v1, v2]` (lower 24 bits) | 1 TLV rec: `[v_lo, v_hi8, 0]` |
| `0x1E` (30) | PANEL_BUTTON | **empty payload** | — |
| `0x1F` (31) | Push | 20B from buffer pointer | — |
| `0x20` (32) | DALI_GEAR | **empty payload** | — |
| `0x21` (33) | RS232_CONTROLLER | **empty payload** | — |
| `0x22` (34) | PRESSURE_SENSOR | **empty payload** | — |
| `0x23` (35) | DALI_GEAR_DT8 | 22B from buffer pointer | — |
| `0x24` (36) | AIR_VOC_SENSOR | **empty payload** | — |
| `0x25` (37) | SOUND_SENSOR | 4B: `[v3, v2, v1, v0]` (big-endian 32-bit) | — |
| `0x26` (38) | IR_CONTROLLER | 3B: `[obj_class_byte, v_lo, v_hi]` | — |
| `0x27` (39) | SunriseSunsetCalendar | 3B: `[obj_class_byte, v_lo, v_hi]` | — |
| `0x28` (40) | PresenceSensor | 1B: `[v_lo]` | — |

**Empty-payload classes** (0x1E, 0x20–0x22, 0x24): a 4-byte `AA dest type CRC` notification frame is still sent to the physical module. Functions as a sync or update-trigger pulse.

**Pointer-arg classes** (0x1F Push, 0x23 DALI_GEAR_DT8): the value argument is a pointer to a caller-prepared data buffer rather than a scalar.

---

### Examples

## LED_CMD Frame (type 0x18) — SMART_PANEL_FM_4 LED Control

```
AA  dest  0x18  btn_mask  0x00  cmd_byte  XOR_crc     (7 bytes total)
```

- `btn_mask`: bit N = button N (0-indexed); value = `1 << button_idx`
- second payload byte: always `0x00`
- `cmd_byte`: LED action

| cmd_byte | Command | Effect |
|----------|---------|--------|
| `0x00` | ShowOK | Green LED flash |
| `0x01` | ShowError | Red LED flash |
| `0x02` | LedSwitchOn | LED on (steady) |
| `0x04` | LedSwitchOff | LED off — **not** `0x03` |
| `0x10` | RedLedSwitchOn | Red LED on (steady) |

Example captures (dest=0x14, button 4 = bit 3 = mask 0x08):
```
ShowOK        aa 14 18 01 00 00 a7   (btn1, mask=0x01)
ShowError     aa 14 18 08 00 01 af   (btn4, mask=0x08)
LedSwitchOn   aa 14 18 08 00 02 ac
LedSwitchOff  aa 14 18 08 00 04 aa
RedLedSwitchOn aa 14 18 08 00 10 be
```

Frame length: 7 bytes. Parser detects by CRC-scanning lengths 7–15.

---

## TFBUS_CMD Frame (type 0x31)

All TFBUS_CMD frames are exactly 26 bytes on the wire. The CLU always sends the full 22-byte payload (cmd + 21 data bytes, zero-padded).

**RS485 wire format:**
```
AA  dest  0x31  cmd  [data — up to 21 bytes, zero-padded to 21]  XOR_crc
```

Parser detects frame length by CRC-scanning lengths 5–32.

### Commands

| cmd | Name | Data layout |
|-----|------|-------------|
| `0x00` | CHECK_ALIVE | none |
| `0x01` | RESP_CHECK_ALIVE | `arg(u32)` |
| `0x03` | RESET | `reset_type(u32)` |
| `0x04` | FORCE_GET_STATUS | none |
| `0x05` | SEEK_BCAST | `hw_type(u8) fw_type(u8) name[15] null` |
| `0x06` | RGBW_SET | `W(u8) R(u8) G(u8) B(u8) channel_idx(u8)` |
| `0x08` | SEEK_RESPONSE | `hw_type(u8) fw_type(u8) name[15] null` |
| `0x0A` | PRINT_TEXT | `x(u8) y(u8) font(u8) text[16] null 2×0x00` |
| `0x0B` | SET_FEATURE | `feature_id(u8)` |
| `0x0E` | EXEC_METHOD | `method_id(u8)` |
| `0x0F` | BUZZER_BEEP | `freq(u16LE) dur(u16LE) vol(u16LE) reserved(u8) + 14×0x00` |
| `0x12` | ITEM_SENSITIVITY | variable; `sensitivity_class(u8)` at buf[0], caller data at buf[1..] |
| `0x19` | DRAW | 21 zero bytes — commits display buffer |
| `0x1B` | RGBW_SET_ALT | `a(u8) b(u8) c(u8) d(u8) e(u8)` |

**BUZZER_BEEP parameter ranges**: freq 30–5700 Hz, duration 1–2000 ms, volume 0–16 (u16 LE), reserved=0.

**PRINT_TEXT**: text field is exactly 16 bytes. Always follow with DRAW (0x19) to commit display.

**Internal queue vs wire format**:

| Field | RS485 wire | Internal TCP/UDP queue |
|-------|-----------|----------------------|
| Header | `AA dest 0x31` | `addr 0x31` |
| Length field | absent | `payload_len` byte |
| Gap byte | absent | `0x00` |
| Terminator | XOR CRC | length-delimited |

---

## MODULE_CMD Frame (type 0xF0)

```
AA  dest  0xF0  plen  count  [sub-records...]  XOR_crc
```

- `plen`: total payload byte count **including** the `plen` byte itself (= `count` byte + sub-record bytes + 1)
- `count`: number of TLV sub-records (1 or more for batched commands)
- Sub-records: TLV format — `type(1) len(1) meta(1) data(len bytes)`

Module responds with empty ACK: `AA 00 01 AB`.

Parser detects frame length by CRC-scanning lengths 5–15.

**Multi-record frames**: multiple sub-records can be batched in a single MODULE_CMD (e.g., 2× motor-channel CHANNEL_MAP, or 2× FEATURE_PARAM). `plen` always spans all sub-records.

### Sub-Record Types

The same TLV format and type codes are used in **both directions** — STATUS_POLL responses (module → CLU) and MODULE_CMD frames (CLU → module).

| type | Name | len | meta | data |
|------|------|-----|------|------|
| `0x00` | SENSOR_SENSITIVITY | 4 | 0x00 | `[sensor_id(1), threshold×10(1), sensitivity/100ms(1), 0(1)]`; sensor_id: 0x07=PANELSENSTEMP, 0x08=PANELSENSLIGHT |
| `0x01` | SET_OUTPUT | 3 | 0x00 | `[chan_mask(1), val_lo(1), val_hi(1)]`; relay: chan_mask=`1<<ch`, val=0=off; TOUCH_PANEL: chan_mask=`1<<btn`, val[0]=0=init LED off |
| `0x02` | BUTTON_HOLDDELAY | 3 | 0x01 | `[0x00, delay_lo, delay_hi]`; LE u16 in ms |
| `0x03` | SET_MODE | 1 | 0x01 | `[mode]`; 0=Monostable, 1=Bistable, 2=Locked |
| `0x04` | CHANNEL_INIT | 3 | 0x00 | `[chan_type(1), chan_idx(1), 0(1)]`; chan_type: 0x00=DIN input, 0x16=ROLLER motor channel |
| `0x05` | SET_CHANNEL_VALUE | 2 | 0x10 | `[chan_idx(1), value(1)]`; LED_RGBW brightness 0–255; all 4 RGBW channels sent as one count=4 batch |
| `0x06` | SET_RAMP_TIME | 5 | 0x00 | `[0, time_lo, time_hi, 0x00, 0x00]`; LE u16 ms; send before SET_CHANNEL_VALUE or DIMMER_SET_VALUE |
| `0x08` | ACTIVATE | 1 | 0x01 | `[level]`; switch on; level = CLU-configured value |
| `0x09` | DEACTIVATE | 1 | 0x01 | `[val]`; switch off / stop; val = CLU-configured constant (not live module state) |
| `0x0b` | CHANNEL_MAP | 2 | 0x00 | `[chan_id(1), obj_type(1)]`; obj_type: 0x00=DIN/motor, 0x02=relay/DOUT; roller: 2 relays per logical channel (up=2n-1, dn=2n), sent as 2-record batch |
| `0x0c` | DIMMER_SET_VALUE | 3 | 0x00 | `[0, val_lo, val_hi]`; LE u16, scale 0–1000 (÷1000 = 0.0–1.0, 0.1% resolution); preceded by SET_RAMP_TIME |
| `0x0f` | MODULE_PARAM | 4 | 0x00 | `[0, chan_idx(1), io_dir(1), 0]`; io_dir: 0=input, 1=output; sent once per channel at init |
| `0x16` | SET_POSITION | 3 | 0x00 | `[flags(1), channel(1), target%(1)]`; roller target position 0–100%; **byte order differs from STATUS_POLL RX** |
| `0x17` | FEATURE_PARAM | 4 | 0x00 | `[compact_idx(1), channel(1), val_lo(1), val_hi(1)]`; LE u16; roller timing unit = 10ms |
| `0x1c` | ROLLER_CHAN_REG | 2 | 0x00 | `[0x00, channel_1based(1)]`; sent per roller channel after CHANNEL_INIT + FEATURE_PARAMs |

### ROLLER_SHUTTER Feature Parameter Index (sub-type 0x17)

`compact_idx` is a sequential compact index, **not** the XML feature index.

| compact_idx | Feature name | Unit | Description |
|-------------|-------------|------|-------------|
| 0 | MaxTime | 10ms | Full open/close travel time |
| 1 | MechanicalOffset | 10ms | Drive start compensation |
| 2 | BlindsUpMaxTime | 10ms | Open time (0 = use MaxTime) |
| 3 | BlindsDownMaxTime | 10ms | Close time (0 = use MaxTime) |

### Per-Module Protocol Sequences

**IO_MODULE_DIN_8** — 2-phase init:
- Phase 1 (relay outputs, ch 0–7 each): `DEACTIVATE` + `MODULE_PARAM [0, ch, 1, 0]`
- Phase 2 (DIN inputs, ch 0–7 each): `CHANNEL_INIT [0x00, ch, 0]` + `MODULE_PARAM [0, ch, 0, 0]`
- Runtime: periodic `CHANNEL_INIT` + `CHANNEL_MAP` per input channel (descending order)

**RELAY_DIN_4** — per relay channel:
`DEACTIVATE` + `CHANNEL_MAP [ch, 0x02]` + `MODULE_PARAM [0, ch, 1, 0]`
- Runtime: periodic `CHANNEL_MAP [ch, 0x02]` for all channels (descending)

**ROLLER_SH_DIN_3** — per logical roller channel (1-based):
1. `CHANNEL_INIT [0x16, ch, 0]`
2. `FEATURE_PARAM ×4` (compact_idx 0,2,3 = configured values; idx 1 = 0)
3. `MODULE_PARAM [0, ch-1, 1, 0]`
4. `ROLLER_CHAN_REG [0, ch]`
- Runtime refresh: 2-record `CHANNEL_MAP` (up/dn relay pair) + 2-record `FEATURE_PARAM [idx0,ch]+[idx1,ch,0,0]` + single FEATURE_PARAM for idx 2 and 3 + `CHANNEL_INIT` + `ROLLER_CHAN_REG`

**LED_RGBW_DIN** — one-shot init:
1. `SET_RAMP_TIME` (type=0x06; default ramp=0ms for RGBW)
2. count=4 batch: `SET_CHANNEL_VALUE [0,R] [1,G] [2,B] [3,W]` (type=0x05, meta=0x10, values 0–255)

**DIMMER_MOSFET_DIN** — SetValue sequence:
1. `SET_RAMP_TIME` (type=0x06; default 500ms)
2. `DIMMER_SET_VALUE` (type=0x0c; LE u16 scale 0–1000)

**TOUCH_PANEL_FM_4** — init:
1. 4× `SET_OUTPUT [1<<btn, 0, 0]` (LED init=off) + `MODULE_PARAM [0, btn, 0, 0]`
2. `SENSOR_SENSITIVITY` records (2 per sensor: PANELSENSTEMP=0x07, PANELSENSLIGHT=0x08)
3. `SET_MODE [mode]`
- Runtime refresh: SET_MODE + partial SENSOR_SENSITIVITY + SET_OUTPUT ×4 + BUTTON_HOLDDELAY

### Wire Examples

```
light ON:    aa 03 f0  06 01 08 01 01 80  d6    ACTIVATE level=128
light OFF:   aa 03 f0  06 01 09 01 01 80  d7    DEACTIVATE val=128
roller STOP: aa 07 f0  06 01 09 01 01 30  63    DEACTIVATE val=48
setpos 41%:  aa 07 f0  08 01 16 03 00 00 03 29  6b  SET_POSITION ch3 → 41%
```

---

## STATUS_POLL Response Payload Format

The CLU polls each module sequentially with `AA dest 0x04 CRC`. Modules reply immediately with current state.

### Universal TLV Format

All STATUS_POLL response payloads follow TLV structure (exceptions: 13-byte SMART_PANEL bitmask and 18-byte CLU multichannel response):

```
payload[0]        = count          number of sub-records
payload[1..]      = sub-records    repeated count times

Each sub-record:
  type (1 byte)   feature/property identifier
  len  (1 byte)   data length in bytes
  meta (1 byte)   context qualifier
  data (len bytes)

Total sub-record size = 3 + len bytes.
```

The same TLV format is used in **both directions** — STATUS_POLL responses (module → CLU) and MODULE_CMD frames (CLU → module) — with matching type codes.

### Meta Byte

| meta | Interpretation |
|------|----------------|
| `0x00` | No qualifier / channel 0 |
| `0x01` | Primary / first instance |
| `0x10` | Sensor / secondary |

### Sub-Record Types

| type | Name | typical len | Data |
|------|------|-------------|------|
| `0x00` | Input bitmask | 1 | bit N = digital input N active |
| `0x01` | State/output | 1–2 | `0x00`=idle, `0x01`=active; or multi-byte output level |
| `0x02` | Temperature | 2 | LE uint16, unit 0.01°C |
| `0x05` | Poll counter | 3 | `[counter_lo, 0x00, 0x00]` — increments each poll cycle, resets on CLU reset |
| `0x06` | Digital state | 1 | `0x00`=idle, `0x02`=active |
| `0x07` | Light / touch level | 2 | LE uint16, unit 0.01% |
| `0x08` | Button event | 1–2 | `VAL = btn_idx × 7 + event_id`; trailing 0x00 |
| `0x16` | Roller position (RX) | 3 | `instance(u8) pos%(u8) flags(u8)` — instance 1-based, 0=stopped |

### Confirmed Payload Patterns by Module Type

Notation: `count  type len meta [data]  type len meta [data]  …`

| Bytes | Pattern | Module type |
|-------|---------|-------------|
| 0 | — | No data / CLU own address |
| 5 | `01  06 01 01 [state]` | Digital (relay/DIN), 1 channel |
| 6 | `01  02 02 10 [LO HI]` | Temp sensor only |
| 10 | `02  06 01 01 [state]  02 02 10 [LO HI]` | Touch panel: state + temp |
| 10 | `02  06 01 01 [state]  07 02 10 [LO HI]` | Touch panel: touch event (PANELSENSLIGHT) |
| 10 | `02  06 01 01 [state]  08 02 10 [VAL 00]` | Touch panel: button identity event |
| 10 | `02  01 02 10 [s0 s1]  01 01 00 [state]` | Multi-output state (relay/DOUT) |
| 10 | `02  01 02 10 [v0 v1]  00 01 01 [on]` | DIMMER_MOSFET_DIN — dim level LE u16 (0–1000) + on/off |
| 13 | *(special — not TLV; see below)* | SMART_PANEL_FM_4 idle bitmask |
| 14 | `03  00 01 01 [inp]  01 01 01 [st]  02 02 10 [LO HI]` | IO_MODULE_DIN_8 |
| 18 | *(special — not TLV; see below)* | CLU internal multichannel |
| 23 | `04  01 01 [meta] [st]  16 03 00 [i p f]  16 03 00 …  16 03 00 …` | ROLLER_SH_DIN_3 — 1 state + 3 roller channels |

### Button Identity Encoding (sub-record type=0x08)

**Encoding**: `VAL = btn_idx × 7 + event_id`
- `btn_idx = VAL / 7` (integer divide) → which button (0-indexed)
- `event_id = VAL % 7` → event type

| event_id | Name | Description |
|----------|------|-------------|
| 0 | OnChange | state changed |
| 1 | OnSwitchOn | button pressed |
| 2 | OnSwitchOff | button released |
| 3 | OnShortPress | short press confirmed |
| 4 | OnLongPress | long press |
| 5 | OnHold | hold (repeating) |
| 6 | OnClick | click confirmed |

One physical button press queues multiple events (OnSwitchOn → OnShortPress → OnClick → OnChange), reported one per poll cycle (~780ms each), draining over 3–5 cycles.

**Button numbering**: row-major order — top-left → top-right → bottom-left → bottom-right = indices 0→1→2→3.

### IO_MODULE_DIN_8 Payload (14 bytes)

```
03
  00 01 [meta] [inp_byte]      8 digital inputs — bit N = input N active
  01 01 [meta] [state]         output state (0=idle)
  02 02 [meta] [LO] [HI]       temperature LE uint16 ÷ 100 = °C
```

Example: `03 00 01 01 00 01 01 01 00 02 02 10 6c 09`
→ inputs=0x00 (all off), state=idle, temp=0x096C=2412→**24.12°C**

### ROLLER_SH_DIN_3 Payload (23 bytes)

```
04
  01 01 [meta] [state]
  16 03 [meta] [inst] [pos%] [flags]   roller channel 0
  16 03 [meta] [inst] [pos%] [flags]   roller channel 1
  16 03 [meta] [inst] [pos%] [flags]   roller channel 2
```

Type 0x16 fields: `instance(u8)` = 1-based channel index, `pos%(u8)` = 0–100%, `flags(u8)` = motion/error flags (0=stopped).

### SMART_PANEL_FM_4 Idle Bitmask Payload (13 bytes, non-TLV)

```
bytes[0–1]   LE u16  button bitmask: bit N = instance N active
bytes[2–3]   LE u16  edge bitmask: non-zero on press start, 0 on press end
bytes[4–5]   LE u16  PANELSENSLIGHT (ambient light ×100)
bytes[6–7]   LE u16  unknown
bytes[8–11]          zeros
bytes[12]            0x02 flag
```

### Temperature Encoding

All temperature values: LE uint16, unit = 0.01°C.

```
6a 09  →  0x096A = 2410  →  24.10°C
5e 09  →  0x095E = 2398  →  23.98°C
```

### Multi-CLU Bus Behavior

A module is physically connected to one CLU's RS485 bus. Other CLUs learn of events via **TCP inter-CLU notification**, not RS485.

| Bus | Events visible | Button identity |
|-----|---------------|-----------------|
| Primary CLU (owns module) | type=0x07 (touch) then type=0x08 (button events, multiple per press) | Full: btn_idx + event_id in VAL |
| Secondary CLU (TCP-notified) | type=0x07 only | None — all buttons appear identical |

---

## Discovery / Address Assignment

The CLU knows all module serial numbers from its configuration. Discovery assigns dynamic RS485 addresses to known modules via serial number matching.

### Sequence

```
1. AA FF 07 52                         RESET broadcast (all modules reset)
2. AA FF 2A 7F                         SEEK broadcast (modules enter address-accepting state)
   ← AA 00 01 AB                       all modules ACK
3. per module:
   AA FF 02 SN[4 LE] CH CRC           ADDR_ASSIGN broadcast: SN + assigned channel
   ← AA 00 01 AB                       matching module ACKs; others ignore
4. AA dest 04 CRC                      STATUS_POLLs resume at new addresses
5. AA dest F9 CRC                      VERSION_QUERY unicast to each module
   ← AA 00 len hwType hwVer fwApiVer CRC  module responds with 3–4 byte version info
```

Only the module whose serial number matches the ADDR_ASSIGN payload accepts the address. SMART_PANEL_FM_4 modules (SN prefix `0x0f05`) do not respond to VERSION_QUERY.

### VERSION_QUERY Response Format

3–4 bytes: `[hwType, hwVer, fwApiVer]` or `[hwType, 0x00, 0x00, 0x01]`.

`hwType` identifies the hardware family (see Module Types table). `hwVer` is a hardware revision byte. `fwApiVer` is the firmware API version used with `fwType` (from SEEK_RESPONSE cmd 0x08) to select the module interface definition.

### State Machine

| State | Action | RS485 frames |
|-------|--------|--------------|
| 0 | Initialize | `AA FF 07 52` (RESET broadcast) |
| 1 | Re-send Reset (retry) | `AA FF 07 52` |
| 2 | Address assignment | `AA FF 2A 7F` then `AA FF 02 SN[4] CH CRC` per module |
| 3 | Identify modules | STATUS_POLL + VERSION_QUERY per module |
| 4 | Hardware init | Module-specific init sequences |

---

## Module Types

Module identity tuple: `hwType:fwType:fwApiVer`. Multiple fwTypes can share one hwType.

| hwType | fwType | Module name | Hosted objects |
|--------|--------|-------------|----------------|
| 1 | 0/1/2/3 | DOUTModule | DOUT ×1–4 |
| 2 | 0/1 | DIMMModule | DIMMER ×1 |
| 3 | 1/2 | BUTTModule | BUTTON(class=7) ×8, PANELSENSTEMP, PANELSENSLIGHT |
| 3 | 3 | SMART_PANEL_FM_4 | PANEL_BUTTON(class=30) ×16, PANEL(class=29), PANELSENSTEMP, PANELSENSLIGHT, PANEL_PAGE(class=19) ×4 |
| 4 | 0/1 | LEDRGBmodule | LED ×1 |
| 5 | 0 | GSM | GSM ×1 |
| 7 | 0/1/2 | ROLLER_SH | ROLLER ×1 |
| 8 | 0/1 | ANALOGModule | ANALOG (also reads 1-Wire sensors) |
| 9 | 8 | TOUCH_PANEL_FM_8 | BUTTON(class=7) ×8 |
| 9 | 9 | TOUCH_PANEL_FM_4 | BUTTON(class=7) ×4, PANELSENSTEMP, PANELSENSLIGHT, PANEL(buzzer), PowerSupply |
| 21 | 2 | RELAY_DIN_4 | RELAY ×4 |
| 22 | 2 | RELAY_DIN_2 | RELAY ×2 |
| 23 | 2 | ROLLER_SH_DIN | ROLLER ×1 |
| 24 | 2 | LED_RGBW_DIN | LED_CHANNEL(class=49) ×4 |
| 25 | 2 | ANALOG_DIN | AnalogOUT(class=13) ×4 |
| 26 | 2 | DIMMER_MOSFET_DIN | DIMM(class=5) ×1 |
| 27 | 2 | TOUCH_PANEL_FM_8 | BUTTON ×8 |
| 28 | 2 | TOUCH_PANEL_FM_4 | BUTTON(class=7) ×4 |
| 29 | 2 | LED_RGBW_FM | LED ×1 |
| 30 | 2 | IO_MODULE_DIN_8 | IO ×8 |
| 31 | 2 | RELAY_FM | RELAY ×1 |
| 32 | 2 | ROLLER_SH_FM | ROLLER ×1 |
| 34 | 2 | RELAY_PLUS_WIFI_FM_2 | RELAY ×2 |
| 35 | 2 | RELAY_WIFI_FM_2 | RELAY ×2 |
| 39 | 2 | DALI_MASTER | DALI master |
| 40 | 8/9 | DALI_GEAR_DT8 / DALI_GEAR | DALI gear |
| 41 | 2 | ROLLER_SH_WIFI_FM | ROLLER ×1 |
| 42 | 2 | ROLLER_SH_DIN_3 | ROLLER ×3 |
| 43 | 2 | RS232_CONTROLLER_DIN | RS232 |
| 44 | 2 | DIMMER_MOSFET_FM | DIMMER ×1 |
| 45 | 2 | MULTISENSOR | SENSOR |
| 51 | 2 | DIGITAL_IN_FM | DIN ×1 |
| 52 | 2 | GRENTON_SWITCH_FM | SWITCH ×1 |
| 53 | 2 | ROLLER_SH_DIN_4 | ROLLER ×4 |
| 55 | 2 | DIGITAL_INPUT_MINI_FM | DIN ×1 |

**Note on hwType=3**: covers both BUTTModule (fwType=1/2, 8 buttons, BUTTON class=7) and SMART_PANEL_FM_4 (fwType=3, up to 16 PANEL_BUTTONs, class=30). Distinguish by fwType in the module identity tuple.

---

## Encryption

Default factory key for CLU communications (AES/CBC):
- Key: `<16-byte AES key>`
- IV: `<16-byte IV>`

The provisioning frame (`0xFB`) includes 16 bytes of per-device key material in the payload. Per-device key derivation: XOR the factory key with the device's private key.
