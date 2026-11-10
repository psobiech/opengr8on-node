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

All RS485 communication uses the standard framing described below.

---

## RS485 Wire Frame Format

Byte[2] meaning differs by direction:

**CLU → module (command)**:
```
Byte [0]      = 0xAA           start byte (always)
Byte [1]      = dest_addr      destination RS485 address (1–48, 0xFF broadcast)
Byte [2]      = frame_type     command ID — see frame type table
Byte [3..N-1] = payload        0–28 bytes (frame ≤ 32)
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

**Max frame size**: 32 bytes in both directions (command payload ≤ 28; response `payload_len` ≤ 29, i.e. ≤ 28 payload bytes + XOR). Matches the real CLU firmware: its TX builder rejects payload ≥ 0x1D and its RX parser drops frames ≥ 0x21 bytes.

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
| `0x08` | DISCOVER         | 4 | 0xFF | none; an unaddressed module replies `SN(u32 LE) hwType fwType fwApiVer`, a plain ACK / silence = no more. See [Discovering new modules](#discovering-new-modules) |
| `0x09` | ADDR_CONFIRM     | 5 | unicast | `{0x02}` |
| `0x0A` | DEVICE_SEARCH (sub-device enumeration, likely 1-Wire) | 4 | unicast | none; reply = device record (8-byte ROM-style ID), all-zero ID = no (more) devices. See [TFBUS_ANALOG_DIN.md](TFBUS_ANALOG_DIN.md#query-0x0a--sub-device-search-decompiled) |
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

See [TFBUS_SMART_PANEL_FM_4.md](TFBUS_SMART_PANEL_FM_4.md) for LED_CMD (type 0x18) wire examples.

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
| `0x0A` | PRINT_TEXT | `x(u8) y(u8) font(u8) text[16] 2×0x00` |
| `0x0B` | SET_FEATURE | `feature_id(u8)` |
| `0x0E` | EXEC_METHOD | `method_id(u8)` |
| `0x0F` | BUZZER_BEEP | `freq(u16LE) dur(u16LE) vol(u16LE) reserved(u8) + 14×0x00` |
| `0x12` | ITEM_SENSITIVITY | variable; `sensitivity_class(u8)` at buf[0], caller data at buf[1..] |
| `0x19` | DRAW | 21 zero bytes — commits display buffer |
| `0x1B` | RGBW_SET_ALT | `a(u8) b(u8) c(u8) d(u8) e(u8)` |

**BUZZER_BEEP parameter ranges**: freq 30–5700 Hz, duration 1–2000 ms, volume 0–16 (u16 LE), reserved=0.

**PRINT_TEXT**: text field is exactly 16 bytes. Always follow with DRAW (0x19) to commit display.

**SMART_PANEL_FM_4 init**: during boot the CLU sends SMART_PANEL_FM_4 0x31 frames whose `cmd` bytes (`0x01 0x02 0x0c 0x0d 0x0e 0x10 0x11 0x12 0x14 0x15 0x16 0x1a`) are panel config registers, not the commands above. `01 05` is ProximitySens=5, not RESP_CHECK_ALIVE. See [TFBUS_SMART_PANEL_FM_4.md](TFBUS_SMART_PANEL_FM_4.md#init-sequence-type-0x31).

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

See individual module files for init sequences and wire examples:
- [TFBUS_LED_RGBW_DIN.md](TFBUS_LED_RGBW_DIN.md)
- [TFBUS_RELAY_DIN_4.md](TFBUS_RELAY_DIN_4.md)
- [TFBUS_ROLLER_SH_DIN_3.md](TFBUS_ROLLER_SH_DIN_3.md)
- [TFBUS_IO_MODULE_DIN_8.md](TFBUS_IO_MODULE_DIN_8.md)
- [TFBUS_DIMMER_MOSFET_DIN.md](TFBUS_DIMMER_MOSFET_DIN.md)
- [TFBUS_TOUCH_PANEL_FM_4.md](TFBUS_TOUCH_PANEL_FM_4.md)
- [TFBUS_SMART_PANEL_FM_4.md](TFBUS_SMART_PANEL_FM_4.md)

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

See [TFBUS_IO_MODULE_DIN_8.md](TFBUS_IO_MODULE_DIN_8.md), [TFBUS_ROLLER_SH_DIN_3.md](TFBUS_ROLLER_SH_DIN_3.md), [TFBUS_SMART_PANEL_FM_4.md](TFBUS_SMART_PANEL_FM_4.md) for module-specific payload formats.

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

### Discovering new modules

The CLU learns the serial numbers of modules that are **not** in its configuration with a
broadcast DISCOVER (`AA FF 08 5D`). Decompiled real CLU firmware: when the last frame sent was
type `0x08`, `tfbus_rx_dispatcher` hands the reply payload to `parse_rx_discover_msg`, which reads
`SN(u32 LE)` plus three bytes into module fields `+0x10 +0x11 +0x12` and registers the module in a
free slot (or updates the slot with that SN). An empty reply (`AA 00 01 AB`) is ignored. `+0x10`
is the hwType and `+0x12` the fwApiVer (`hw_type_check_type3`: hwType 3 with `+0x12 < 5` is not
VERSION_QUERY'd), so the payload is `SN hwType fwType fwApiVer`. A newly registered module is
inactive, and the poll loop sends it ADDR_ASSIGN (`send_status_poll`).

```
CLU: AA FF 08 5D
mod: AA 00 08 79 7B 05 0F 03 03 04 AE      SN 0x0f057b79, hwType 3, fwType 3, fwApiVer 4
CLU: AA FF 02 79 7B 05 0F 04 ..            address it, then DISCOVER again until no reply
```

**Module refresh (`req_refresh_modules`, OM "Clear CLU").** Captured on a real CLU with 26 modules
(opengr8on-esp32-clu: `test/host/fixtures/capture_refresh_modules_clu2.txt`):

```
AA FF 07 52                                RESET broadcast, then ~1.2 s with no valid frames (junk only)
AA FF 02 SN[4 LE] CH   (x23, 3 ms apart)   ADDR_ASSIGN in OM.LUA order, each ACKed. No SEEK
AA FF 08 5D                                DISCOVER
  <- AA 00 08 8B 65 27 10 1C 02 01 ..      SN 0x1027658b, hwType 0x1c, fwType 2, fwApiVer 1
AA FF 02 ..  (CH 0x0b, 0x19)               ~870 ms later: modules left out of the first pass
AA dd F9                                   VERSION_QUERY per module (after ~1.7 s and the first polls)
```

This is the only capture of a real module's DISCOVER reply: it matches `SN hwType fwType fwApiVer`.
Unexplained so far: the first pass left out CH 3, 0x0b and 0x19, and CH 3 was never assigned but
kept answering. VERSION_QUERY skipped CH 1, 0x16 and 0x17. The CLU sent no module init afterwards.
After the refresh, the real CLU (5.13.x) sent no `resp_refresh_modules` and stopped answering UDP
until it was rebooted. This happened twice.

The ESP32 CLU uses the same order on `req_refresh_modules` (RESET, ADDR_ASSIGN by SN, DISCOVER loop
for the leftovers, retry, VERSION_QUERY). At boot and reload it keeps RESET, SEEK, DISCOVER loop,
then ADDR_ASSIGN. It re-runs the driver init after both. The RP2350 panel emulator answers DISCOVER.

**config.txt / CONFIG.JSON.** OM 1.12.1 imports bus modules from **`a:\config.txt`**
(`utils/b/b.java`): after the 7 CLU header lines, one line per module,
`sn:hwType:fwType:fwApiVer` in hex, e.g. `0f057b7d:03:03:04` (real CLU file). It never reads
CONFIG.JSON for this. `a:\CONFIG.JSON` carries the same list in `tfbusDevices`. Entry fields match the VERSION_QUERY reply exactly (real CLU file):
`fwVer` = `"fwApiVer.verA.verB"`, `hwVer` = the optional 4th byte (default 1), modules that are
not queried get `"0.0.0"`:

```json
{"sn":252017533,"hwType":3,"hwVer":1,"fwType":3,"fwApiVer":4,"fwVer":"0.0.0","status":"OK"}
{"sn":461004209,"hwType":25,"hwVer":2,"fwType":2,"fwApiVer":1,"fwVer":"1.2.13","status":"OK"}
```

### VERSION_QUERY Response Format

3–4 bytes: `[fwApiVer, verA, verB]` or `[fwApiVer, verA, verB, 0x01]`.

Byte 0 is the module's **fwApiVer**, not hwType. Confirmed against the real OM.LUA, where each module line reads `OBJECT:new(2, SN, hwType, "sn") -- serial fwType fwApiVer`:

| Module (OM.LUA hwType) | OM.LUA `fwType fwApiVer` | VERSION_QUERY reply |
|---|---|---|
| ROLLER_SH_DIN (`0x17`) | `02 01` | `01 01 0b` |
| IO_MODULE_DIN_8 (`0x1e`) | `02 02` | `02 00 00` |
| RELAY_DIN_4 (`0x15`) | `02 02` | `02 00 00 01` |
| TOUCH_PANEL_FM_4 (`0x1c`) | `02 01` | `01 01 05` |
| ROLLER_SH_DIN_3 (`0x2a`) | `02 03` | `03 02 04` |
| SMART_PANEL_FM_4 (`0x03`) | `03 04` | *(not queried)* |
| SMART_PANEL_FM_4 (`0x03`) | `03 06` | `06 03 07` |
| ANALOG_DIN (`0x19`) | `02 01` | `01 02 0d 02` |
| DIMMER_MOSFET_DIN (`0x1a`) | `02 02` | `02 02 04 03` |
| LED_RGBW_DIN (`0x18`) | `02 01` | `01 04 08` |

The CLU skips VERSION_QUERY only for SMART_PANELs with fwApiVer 4. A panel with fwApiVer 6 on the second CLU was queried.

`verA verB` are probably the module firmware version (e.g. `02 04` = 2.4). This is unconfirmed, and `00 00` shows up on IO/RELAY modules. The trailing `0x01` appears only on RELAY_DIN_4. The real hwType never appears in the reply: the CLU takes it from its configuration.

### Observed Cold Boot (real CLU, 23 modules)

Captured passively with `tfbus_sniff` during a **full installation power cycle**: the real CLU and all modules restarted together. A CLU-only restart may behave differently and has not been captured yet. Times are relative to the CLU's first frame.

| t (ms) | Phase | Frames |
|---|---|---|
| 0 | ADDR_ASSIGN | 15× `AA FF 02 SN[4 LE] CH` for CH = 9…23, every ~8–14 ms, each ACKed `AA 00 01 AB` |
| +145 | First STATUS_POLL cycle | addr 1…23 in order; modules answer with full status |
| +330 | MODULE_CMD (0xF0) init | per-module init sequences, addr 1 → 23 (see module docs) |
| +510 | VERSION_QUERY | `AA dd F9` to addr 1–17 and 21–23; **skips SMART_PANEL_FM_4** (18–20). Interleaved with 0xF0 init |
| +1910 | SMART_PANEL init | 0x31 register writes, then `0x18 [00 00 02]` per panel; ~3 s per panel, the 3 panels overlap (see [TFBUS_SMART_PANEL_FM_4.md](TFBUS_SMART_PANEL_FM_4.md#init-sequence-type-0x31)) |
| +6410 | Steady state | only STATUS_POLL, one cycle over all 23 modules every ~145 ms, polls interleaved with config writes |

**Address = declaration order.** The CLU gives addresses 1, 2, 3, … to the TFBus modules (`OBJECT:new(2, …)`) in the order they appear in OM.LUA. Z-Wave entries (hwType `0x008500030011`) are skipped. 14 of 15 assigned serials matched OM.LUA at the expected index. The one miss (addr 23) is a module added after that OM.LUA was generated. The addr 1–8 module types, inferred from their 0xF0 init and status replies, also match the order.

**Init is driven by OM.LUA.** Apart from addressing, polling and VERSION_QUERY, the CLU sends no module init of its own. Each 0xF0/0x31/class frame is caused by a `:set()` line in OM.LUA and goes out in OM.LUA line order. Example: `ROL7957:set(9, 30000)` → FEATURE_PARAM `b8 0b` (3000 × 10 ms). The SMART_PANEL also gets a second pass in reverse order after OM.LUA ([details](TFBUS_SMART_PANEL_FM_4.md#init-sequence-type-0x31)).

**Sniffer limitation (fixed 2026-11-09):** the `tfbus_sniff` RX parser used to have no length for class frames `0x16`, `0x17` or `0x30` and dropped them silently, so the cold-boot capture above lacks them. The parser now CRC-scans unknown types.

**Soft restart (CLU only, after sending new scripts; modules stay powered).** Captured with the fixed sniffer:
- Again **no RESET or SEEK**. Polling stops for ~2.9 s, then ADDR_ASSIGN goes out for **CH 7–23** (the cold boot assigned CH 9–23), then the same init as the cold boot.
- All three SMART_PANELs received exactly the 275-frame sequence from the October capture, in identical order.
- Modules that were not reassigned kept answering at their addresses throughout.

In the October capture (`tfbus_capture_20261014_171505.log`, different tool, unknown trigger) the CLU sent RESET → 2.0 s → SEEK → ADDR_ASSIGN for **all** CH 1–23. A second soft restart, captured unfiltered with discarded-byte reporting (`tfbus_sniff compact:true junk:true`), confirmed this:
- Polling stops mid-cycle (right after polling addr 3).
- The bus is then **completely silent for 2.9 s**: zero bytes, valid or garbled, in the whole 180 s capture.
- Then ADDR_ASSIGN goes out for exactly CH 7–23 again.

So on a **soft restart**, firmware 5.13.8 really sends no RESET or SEEK and reassigns only the tail of the module list (the CLU kept running, so it knows the modules hold their addresses). The cold boot showed the same pattern, but that capture had no discarded-byte reporting, so garbled power-on frames are not ruled out. A second full power cycle, captured with `junk:true`, shows the same pattern:
- After the power-on silence, the first and only byte-level event is a **garbled ACK** `aa 00 01 db`.
- 76 ms later comes ADDR_ASSIGN for CH 8–23 only. None of these frames was preceded by RESET or SEEK.
- The garbled ACK looks like several modules answering a broadcast (SEEK) at once.
- The gap before CH 8 is about the time CH 1–7 would take, but none of them was seen and modules 1–7 sent no ACKs.

The number of skipped channels varies per boot (6–8).

**A second, independent CLU** (26 modules) was power-cycled and captured with `junk:true`:
- No RESET or SEEK.
- ADDR_ASSIGN for **CH 5–26** only, starting right after the power-on silence.
- Then VERSION_QUERY and the OM.LUA-driven init.
- It also sent a so far undocumented **type `0x0A`** frame: `AA 02 0A A2`, answered with `AA 00 0B 00 03 00 00 00 00 00 00 00 00 A2` (10-byte payload). Right after it came MODULE_CMD SET_RAMP_TIME / DIMMER_SET_VALUE to addr 1.

A plain UDP **`req_reset`** to the same CLU (no script upload) produced a bus trace identical to its power cycle:
- Polling continued ~1.6 s after the request, then the bus was silent for 2.7 s.
- ADDR_ASSIGN for the same CH 5–26 followed, then one `0x0A`.
- Every init frame count matched the power-cycle capture.
- `checkAlive()` answered 4.8 s after `req_reset`.

On a given CLU the skipped range is stable (CLU_2: CH 1–4 three times; CLU_1: the first 6–8 channels, varying per boot).

So partial reassignment without RESET/SEEK is normal behaviour of the real CLU firmware on any (re)start, whether power cycle, script upload or `req_reset`. It is not a quirk of one installation. The full RESET → SEEK → all-channels sequence in the October capture needs a special trigger, possibly a changed module list or a first start with new modules.

**Open points from this capture:**
- No RESET (`AA FF 07`) or SEEK (`AA FF 2A`) frame was seen. The bus was silent for 3.9 s, and the first CLU frame was ADDR_ASSIGN for CH 9.
- **CH 1–8 were never assigned**, yet modules 1–8 answered polls at their usual addresses only ~145 ms after the first frame, even though they had been power-cycled too. Either those modules keep their address in non-volatile memory, or their ADDR_ASSIGN frames (plus any RESET/SEEK) were sent while the bus or sniffer was still settling and were lost. A raw-byte capture, or a capture that starts with the sniffer already running and only the modules power-cycled, is needed to tell which.
- To compare: capture a CLU-only restart (modules stay powered) and a modules-only restart.

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

RS485 frames are **not encrypted** — plaintext with XOR checksum only.

The PROVISION frame (`0xFB`) distributes per-module key material over RS485 (see Frame Types table for payload layout).
