# Grenton System Communication Overview

Three device types participate in the Grenton system:

- **CLU** — central logic unit; runs Lua scripts, owns one RS485 TFBUS bus, communicates over UDP
- **GATE** — simplified CLU variant; runs Lua scripts, communicates over UDP, no RS485 bus; connects to external systems instead (Modbus, HTTP, Z-Wave, etc.)
- **OM / Tool** — Object Manager or developer tool; manages CLUs and GATEs over UDP

Two independent communication planes:

- **UDP** — text protocol (port 1234, AES-128-CBC); used by OM, CLUs, and GATEs to exchange commands and state over the network
- **TFBUS** — proprietary RS485 binary protocol; used exclusively by CLUs to control and poll directly-attached hardware modules

```
  ┌──────────────────────────────────────────────────────────────────────────────┐
  │                              IP NETWORK                                      │
  │                                                                              │
  │  ┌────────────┐  UDP 1234  ┌──────────┐  UDP 1234  ┌──────────┐             │
  │  │  OM / Tool │◄──────────►│  CLU  A  │◄──────────►│  CLU  B  │             │
  │  └────────────┘  AES/CBC   └──────┬───┘  AES/CBC   └──────┬───┘             │
  │        │                          │                         │                │
  │        │         UDP 1234         │                         │                │
  │        └──────────────────►┌──────┴────┐   UDP 1234  ┌─────┴──────┐        │
  │                             │  GATE     │◄────────────►│  GATE      │        │
  │                             │ (Modbus)  │  AES/CBC    │  (HTTP)    │        │
  │                             └──────┬────┘             └────────────┘        │
  └───────────────────────────────┬────┼────────────────────────────────────────┘
                                  │    │ Modbus RTU (RS485)
                       RS485      │    └──────────────────────────┐
           ┌───────────┴────────┐ │                   ┌──────────┴──────────┐
           │ TFBUS modules (A)  │ │                   │ External Modbus     │
           │  relay  dimmer ...  │ │                   │  devices (RS485)    │
           └────────────────────┘ │ RS485             └─────────────────────┘
                       ┌──────────┴────────┐
                       │ TFBUS modules (B)  │
                       │  roller  panel ... │
                       └────────────────────┘
```

Each CLU owns exactly one RS485 bus. GATEs have no RS485 bus. Both CLUs and GATEs use the same UDP protocol (port 1234, AES/CBC) and the same Lua execution model — a GATE is a CLU without TFBUS. Modules are not shared between CLUs. Events from modules on CLU A reach CLU B or GATEs via inter-device UDP.

---

## UDP Command Protocol

All UDP traffic uses **port 1234/UDP**. Every packet is AES-128-CBC encrypted. The plaintext is a colon-delimited ASCII string: `command_prefix:field1:field2:...`

Two command styles exist:
- **Management** (`req_discovery_clu`, `req_set_key`, `req_reset`, …) — one-shot request/response pairs
- **Lua execution** (`req`/`resp`) — execute any Lua expression in the CLU/GATE runtime; used for control, cross-device calls, and push subscriptions

GATEs use the same UDP protocol as CLUs. The initialization sequence (discovery, set key, TFTP, reset) is identical for both device types.

### OM → CLU/GATE initialization sequence

```
 OM                                          CLU or GATE
  │── broadcast req_discovery_clu ───────────────►│  find devices on network
  │◄── resp_discovery_clu  SN  IV  MAC ───────────│
  │── broadcast req_set_clu_ip  SN  new_ip ──────►│  assign static IP
  │◄── resp_set_clu_ip  SN  new_ip ───────────────│
  │── unicast req_set_key  new_key ──────────────►│  provision project AES key
  │◄── resp:OK ───────────────────────────────────│
  │── req_start_ftp ─────────────────────────────►│  enable TFTP (port 69)
  │◄── resp:OK ───────────────────────────────────│
  │═══ TFTP GET: config, LUA files ═══════════════│
  │═══ TFTP PUT: new LUA files ═══════════════════│
  │── req_reset:<host_ip> ────────────────────────►│  apply new scripts
  │◄── resp_reset:<device_ip> ────────────────────│
  │── req:...:checkAlive() (poll) ────────────────►│  wait for reboot
  │◄── resp:...:<sn_hex or true> ─────────────────│  CLU→sn_hex, GATE→true
```

### Cross-device calls

CLUs and GATEs call each other using the same `req:`/`resp:` Lua execution transport — unicast to the target device's IP. The `RemoteCLU` Lua object forwards `execute()` calls this way.

Module events from CLU B's bus reach CLU A or GATEs only as UDP notifications — only CLU B is on the RS485 bus. CLU A and GATEs receive a simplified event notification (no button index or event type); full button identity is only available to the CLU owning the RS485 bus.

### Push subscriptions

CLU pushes feature value changes via `SYSTEM:clientRegister("ip", port, id, {{ObjName, feat_idx}, ...})`. On each change CLU sends an unsolicited `resp:0.0.0.0:00000000:clientReport:<id>:{values...}` to the registered address. Default port: 4344.

For full packet layouts, key derivation, discovery hash, and per-command byte formats see [UDP.md](./UDP.md) · [UDP.pl.md](./UDP.pl.md).

---

## Device Interfaces

Every CLU, GATE, and hardware module ships a companion **device interface XML** file that declares the full API contract for that firmware version. OM bundles a library of these files and uses them in two ways: to build its visual project editor, and to generate the Lua scripts it uploads to devices.

**What an interface file defines**:

| Element | Description |
|---------|-------------|
| `feature` | Indexed readable/writable state value — name, numeric `index`, type, unit, enum values, get/set flags |
| `method` | Indexed callable action — name, numeric `index`, params, return type; `call=set` sets a feature value, `call=execute` triggers an action |
| `event` | Named event with a numeric `address` (= event index) — fired by the runtime when device state changes |

**File naming and lookup key**:
- Module interfaces: `module_<name>_fv<fwType>_<fwApiVer>.xml` — looked up by `hwType : fwType : fwApiVer` (from SEEK_RESPONSE + VERSION_QUERY)
- CLU/GATE interfaces: `clu_<name>_ft<fwType>_fv<fwApiVer>_ht<hwType>_hv<hwVer>.xml` — looked up by `hwType : hwVer : fwType : fwApiVer`

**Integration flow**:
1. Device discovery returns `hwType`, `hwVer`, `fwType`, `fwApiVer` — OM looks up the matching interface file
2. OM presents named features, methods, and events in its visual wiring editor
3. On deploy, OM generates `OM.LUA` using the **numeric indices** from the interface — `ObjName:get(idx)`, `ObjName:set(idx, val)`, `ObjName:execute(method_id, args...)`
4. CLU/GATE loads `OM.LUA` at boot; the Lua runtime maps those indices to actual device functionality over TFBUS or the GATE's external protocol

Developers interacting directly with a device via `req:` UDP commands must use the same numeric indices defined in the interface file.

---

## Lua Runtime

All CLU and GATE logic runs in an embedded Lua 5.x runtime. Scripts are stored on the device flash filesystem (`a:\`) and loaded at boot:

| File | Role |
|------|------|
| `a:\main.lua` | Main script — declares all objects and event handlers; renamed `bad_m.lua` on fatal crash |
| `a:\OM.LUA` | OM-generated object and wiring script |
| `a:\USER.LUA` | User-defined script |
| `a:\emergncy.lua` | Emergency script — runs in place of main.lua when main.lua fails fatally |
| `a:\settings.usr` | Persistent feature values (survives reboot) |

**Object model** — every functional entity (relay, dimmer, GATE integration, etc.) is a named Lua object:
- **Features** — indexed state values; readable and writable via Lua or the `req:` UDP command (`ObjName:get(idx)` / `ObjName:set(idx, val)`)
- **Methods** — indexed actions; invoked via Lua or `req:` (`ObjName:execute(method_id, args...)`)
- **Events** — fired by the runtime when module state changes; handlers are Lua functions registered in scripts

**Execution model** — each incoming `req:` UDP call is executed as a Lua coroutine in the shared runtime. The Lua environment is single-threaded; calls that need to wait (e.g., cross-CLU `req:`) yield the coroutine until the response arrives. A periodic loop (~512 ms) drives timer objects and polling.

**Emergency mode** — if `main.lua` crashes fatally, the device renames it `bad_m.lua`, loads `emergncy.lua` instead, and reports `emergency` to `checkAlive()` queries.

---

## TFBUS — RS485 Module Protocol

See detailed specification: [TFBUS.md](./TFBUS.md) · [TFBUS.pl.md](./TFBUS.pl.md)

TFBUS 2.0 is a half-duplex RS485 master/slave protocol. The CLU is always master. Modules respond only when polled or commanded.

### Wire frame format

```
 CLU → module (command):

  Byte 0     Byte 1      Byte 2       Bytes 3..N-1    Byte N
 ┌──────┬───────────┬────────────┬─────────────────┬────────┐
 │ 0xAA │ dest_addr │ frame_type │    payload      │  XOR   │
 └──────┴───────────┴────────────┴─────────────────┴────────┘
   start   RS485 addr  command ID   0–29 bytes       checksum

 Module → CLU response (dest_addr = 0x00):

  Byte 0     Byte 1      Byte 2          Bytes 3..N-1    Byte N
 ┌──────┬──────┬─────────────────┬─────────────────┬────────┐
 │ 0xAA │ 0x00 │  payload_len    │    payload      │  XOR   │
 └──────┴──────┴─────────────────┴─────────────────┴────────┘
   start  CLU    length of payload  TLV records       checksum
```

- `dest_addr`: modules use `1–48`; `0xFF` = broadcast; `0x00` = CLU (used by module responses)
- `XOR`: XOR of all bytes including `0xAA`
- **Length field**: absent in CLU→module commands — receiver uses a known type→length table or CRC-scans; present in module→CLU responses as `payload_len` at byte[2]. Exception: MODULE_CMD (0xF0) carries an explicit `plen` byte at byte[3]

### Frame type groups

| Range | Category | Description |
|-------|----------|-------------|
| `0x00–0x0F` | Universal | Discovery, address assignment, reset, status poll — work with any module |
| `0x10–0x28` | Class-specific | CLU object class ID; payload depends on module type |
| `0x30+` | Command frames | MODULE_CMD (`0xF0`), TFBUS_CMD (`0x31`), provisioning, version query |

### Standard ACK

Most commands (SEEK, ADDR_ASSIGN, MODULE_CMD) are acknowledged by:
```
AA 00 01 AB
```
Destination `0x00` means "to CLU"; length 4 bytes.

### CLU-to-module runtime cycle

```
 CLU                                    Module (addr N)
  │                                          │
  │── AA N 04 CRC ───────────────────────────►│  STATUS_POLL (unicast)
  │◄── AA 00 len [TLV payload] CRC ───────────│  current state (TLV records)
  │                                          │
  │── AA N F0 plen count [TLV records] CRC ──►│  MODULE_CMD (control/config)
  │◄── AA 00 01 AB ───────────────────────────│  ACK
  │                                          │
  │   (repeat for each module in address space)
```

The CLU polls modules sequentially, typically every ~780 ms per module. Between polls it sends MODULE_CMD frames to apply state changes requested by the Lua runtime.

### Module discovery and address assignment

On startup or reset, the CLU assigns RS485 addresses dynamically by serial number:

```
 CLU                                    All modules (broadcast)
  │                                          │
  │── AA FF 07 CRC ──────────────────────────►│  RESET broadcast
  │── AA FF 2A CRC ──────────────────────────►│  SEEK broadcast
  │◄── AA 00 01 AB (×N) ──────────────────────│  all modules ACK
  │                                          │
  │  for each known module (SN from config): │
  │── AA FF 02 SN[4 LE] CH CRC ─────────────►│  ADDR_ASSIGN (SN + channel)
  │◄── AA 00 01 AB ───────────────────────────│  matching module ACKs only
  │                                          │
  │── AA <assigned_addr> 04 CRC ────────────►│  STATUS_POLL begins
  │── AA <assigned_addr> F9 CRC ────────────►│  VERSION_QUERY
  │◄── AA 00 [type hw fw] CRC ────────────────│  version response
  │                                          │
  │  module-type-specific init sequences...  │
```

### TLV sub-record format (bidirectional)

Both STATUS_POLL responses (module → CLU) and MODULE_CMD payloads (CLU → module) use the same TLV structure:

```
 Each sub-record:
 ┌──────┬─────┬──────┬────────────────┐
 │ type │ len │ meta │  data[len]     │
 │  1B  │ 1B  │ 1B  │  variable      │
 └──────┴─────┴──────┴────────────────┘
   what   size  ctx   payload bytes
```

`meta` qualifies the record: `0x00` = no qualifier / ch 0, `0x01` = primary, `0x10` = sensor.

### Key TLV types

| type | Direction | Name | Description |
|------|-----------|------|-------------|
| `0x01` | RX | State/output | Active (`0x01`) or idle (`0x00`) |
| `0x02` | RX | Temperature | LE uint16, 0.01°C |
| `0x08` | RX | Button event | `val = btn_idx×7 + event_id` |
| `0x16` | RX/TX | Roller position | `instance, pos%, flags` |
| `0x08` | TX | ACTIVATE | Switch output on at configured level |
| `0x09` | TX | DEACTIVATE | Switch output off / stop motor |
| `0x0c` | TX | DIMMER_SET_VALUE | LE u16, scale 0–1000 |
| `0x04` | TX | CHANNEL_INIT | Initialize channel type and index |

### Class-update frames (`0x10–0x28`)

When a Lua object's state changes, the CLU sends a class-update frame whose type byte equals the object's class ID. The module interprets the payload based on its firmware generation:

- **New firmware path**: multi-record TLV frame
- **Old firmware path**: inline scalar payload

Both emit the same type byte on the wire.

---

## Encryption

Both planes use AES-128-CBC. UDP encryption wraps the entire plaintext packet. TFBUS provisioning (`0xFB`) distributes per-module key material over RS485.

| Plane | Algorithm | Default key source |
|-------|-----------|-------------------|
| UDP | AES-128-CBC | Factory key XOR device private key |
| TFBUS provision | AES-128-CBC (payload only) | Factory key (per-device derived) |

Per-device key derivation: `device_key = factory_key XOR private_key_from_sticker`

---

## Related Documents

| Document | Content |
|----------|---------|
| [UDP.md](./UDP.md) | Full UDP protocol: packet layout, key derivation, discovery hash, per-command byte formats |
| [UDP.pl.md](./UDP.pl.md) | Polish translation of UDP.md |
| [TFBUS.md](./TFBUS.md) | Full TFBUS 2.0 wire protocol: all frame types, TLV records, module init sequences, wire examples |
| [TFBUS.pl.md](./TFBUS.pl.md) | Polish translation of TFBUS.md |
