# UDP Protocol — Detailed Reference

All CLU network communication uses **port 1234/UDP**, AES-128-CBC encrypted. See [COMMUNICATION.md](./COMMUNICATION.md) for system-level context.

---

## Transport and framing

```
 UDP datagram (max 1472 bytes)
 ┌─────────────────────────────────────────────────────────┐
 │  AES-128-CBC( key, IV, plaintext )   — zero-padded      │
 └─────────────────────────────────────────────────────────┘

 Plaintext (decrypted, colon-delimited ASCII)
 ┌──────────────────┬─────────────────────────────────────┐
 │  command prefix  │  :field1:field2:...                  │
 └──────────────────┴─────────────────────────────────────┘
```

- Delimiter: `:` (0x3A)
- Some commands append `\r\n` (CRLF) as a terminator; parsers strip it
- Binary fields (encrypted blobs, IV, key) are raw bytes inline between `:` separators — **not** hex-encoded

---

## Encryption and keys

| Phase | Encrypt with | IV source |
|-------|-------------|-----------|
| Discovery broadcast | Factory GRENTON_KEY | OWN_IV — 16 random bytes, caller-generated |
| Discovery response | Factory GRENTON_KEY | OWN_IV from the matching discovery request |
| Post-`req_set_key` unicast | Per-device CLU key | Exchanged during `req_set_key` |

**Factory GRENTON_KEY** is identical for all devices and known at compile time.

**Per-device default key** derived from the device private key (printed on the CLU sticker):

```
input:  DEFAULT_IV (16 bytes, fixed),  privateKey (8 bytes)
output: device_key (16 bytes)

for i in [0, 8):   device_key[i]  = DEFAULT_IV[i]  XOR privateKey[i]
for i in [8, 16):  device_key[i]  = DEFAULT_IV[i]  XOR privateKey[15 - i]
```

After `req_set_key` the CLU switches to the caller-supplied key for all subsequent unicast messages.

---

## Command reference

| Request prefix | Response prefix | Transport | Description |
|----------------|-----------------|-----------|-------------|
| `req_discovery_clu` | `resp_discovery_clu` | broadcast | Discover CLUs on the network; exchange keys |
| `req_set_clu_ip` | `resp_set_clu_ip` | broadcast | Assign static IP to CLU by serial number |
| `req_set_key` | `resp:OK` | unicast | Provision new AES key |
| `req_start_ftp` | `resp:OK` | unicast | Enable TFTP server (port 69) |
| `req_tftp_stop` | — | unicast | Disable TFTP server |
| `req_reset` | `resp_reset` | unicast | Reboot CLU |
| `req` | `resp` | unicast/broadcast | Execute Lua expression in CLU runtime |
| `req_gen_measurements` | `meas_file_download` | unicast | Flush and expose meas.bin via TFTP |
| `req_check_alive` | `resp_check_alive` | unicast | Low-level alive check (non-Lua) |
| `req_refresh_modules` | `resp_refresh_modules` | unicast | Reload module list |
| `req_refresh_config` | `resp_refresh_config` | unicast | Reload CLU config |
| `req_diagnostic_pack` | `resp_diagnostic_pack` | unicast | JSON CLU + module diagnostics |
| `req_start_fw_upgrade` | `resp_fw_upgrade_status` | unicast | Begin OTA firmware upgrade |

---

## Discovery — `req_discovery_clu` / `resp_discovery_clu`

Sent as UDP broadcast to `255.255.255.255:1234`. All reachable CLUs respond.

**Request plaintext layout** (bytes, in order):

```
 [0..31]   encrypted(32)   = AES-128-CBC(GRENTON_KEY, OWN_IV, randomBytes(30))
 [32]      0x3A            ':'
 [33..48]  OWN_IV(16)      caller-generated 16-byte IV
 [49]      0x3A            ':'
 [50..]    "req_discovery_clu"
 [..]      0x3A            ':'
 [..]      host_ip         ASCII dotted-decimal (e.g. "10.0.0.1")
```

Outer AES envelope uses `GRENTON_KEY` + `OWN_IV`.

**Response plaintext layout**:

```
 [0..31]   encrypted(32)   = AES-128-CBC(device_key, OWN_IV, hash(randomBytes))
 [32]      0x3A            ':'
 [33..48]  CLU_IV(16)      current IV of this CLU (randomized on each reset)
 [49]      0x3A            ':'
 [50..]    "resp_discovery_clu"
 [..]      0x3A            ':'
 [..]      sn_hex(8)       CLU serial number as 8 uppercase hex chars (e.g. "0D123456")
 [..]      0x3A            ':'
 [..]      mac(12)         MAC address, no separators (e.g. "80AABBCCDDEE")
```

Response encrypted with `GRENTON_KEY` + `OWN_IV` (IV from the request).

**Discovery hash** — verifies CLU knows the device key:

```
result[0] = (randomBytes[0] XOR randomBytes[29]) & 0xFF
for i in [1, 30):
    a = result[i-1] % 13
    b = randomBytes[i] % 19
    result[i] = ((a + 1) * (b + 1)) & 0xFF
```

Caller re-derives `hash(randomBytes)` using the device private key and compares with `encrypted` in the response. Match → `CipherType.PROJECT` (CLU has project key); mismatch or no private key → `CipherType.NONE`.

---

## Set IP — `req_set_clu_ip` / `resp_set_clu_ip`

Assigns a static IP address. Sent as broadcast; CLU matches on serial number.

**Request plaintext**:
```
req_set_clu_ip:<sn_hex8>:<new_ip>:<gateway_ip>
e.g. req_set_clu_ip:0D123456:192.168.1.50:192.168.1.1
```

**Response plaintext**:
```
resp_set_clu_ip:<sn_hex8>:<new_ip>
e.g. resp_set_clu_ip:0D123456:192.168.1.50
```

Encrypted with `GRENTON_KEY` + `OWN_IV` (same IV as the discovery request).

---

## Set Key — `req_set_key` / `resp:OK`

Provisions a new AES key. From this point on, caller must use the new key.

**Request plaintext layout** (bytes):

```
 [0..31]   encrypted(32)   = AES-128-CBC(new_key, new_iv, randomBytes(30))
 [32]      0x3A            ':'
 [33..48]  new_iv(16)      16-byte IV for the new key
 [49]      0x3A            ':'
 [50..]    "req_set_key"
 [..]      0x3A            ':'
 [..]      new_key(16)     raw 16-byte AES key bytes
```

Encrypted with the **current** CLU key. Total plaintext: 32 + 1 + 16 + 1 + 11 + 1 + 16 = 78 bytes.

**Response plaintext**: `resp:OK`

---

## TFTP control — `req_start_ftp` / `req_tftp_stop`

Enables or disables the TFTP server (port 69). OM sends `req_start_ftp` before every file transfer.

**Request**: `req_start_ftp` (no fields) → **Response**: `resp:OK`

**Stop**: `req_tftp_stop` (no response documented)

---

## Reset — `req_reset` / `resp_reset`

Reboots the CLU; applies newly uploaded Lua scripts.

```
req_reset:<host_ip>          e.g. req_reset:10.0.0.5
resp_reset:<clu_ip>          e.g. resp_reset:192.168.1.50
```

CLU reboots after sending the response. Poll `checkAlive()` until it comes back online.

---

## Lua execution — `req` / `resp`

Any Lua expression in the CLU runtime can be invoked. Dispatched as a Lua coroutine.

```
req:<host_ip>:<session_id_hex8>:<lua_expression>\r\n
resp:<clu_ip>:<session_id_hex8>:<return_value>

e.g. req:10.0.0.5:00003649:checkAlive()
     resp:192.168.1.50:00003649:0D123456
```

- `session_id_hex8`: random u32 as 8 hex chars, zero-padded (e.g. `00003649`)
- OM uses 6 chars; CLU pads to 8 in responses — both work
- `return_value`: Lua `tostring()` of the return value, or `nil` / `true` / `false` / `emergency`

**`checkAlive()` response variants**:

| Value | Meaning |
|-------|---------|
| `<sn_hex>` | CLU — returns own serial number as hex |
| `true` | GATE device |
| `false` | CLU not fully ready |
| `emergency` | CLU or GATE in emergency mode (main.lua crashed) |

Any Lua function declared in CLU scripts can be called this way, including cross-CLU calls.

---

## Generate measurements — `req_gen_measurements` / `meas_file_download`

Flushes the in-RAM measurement log to `p:\meas.bin` and starts TFTP on it.

```
req_gen_measurements:<host_ip>:<session_id_hex8>:<unknown>\r\n
meas_file_download:<clu_ip>:<session_id_hex8>:<path>

e.g. req_gen_measurements:10.0.0.5:0000ABCD:0
     meas_file_download:192.168.1.50:0000ABCD:p:\meas.bin
```

After receiving the response, do a TFTP GET of the returned path. File format: `MEAS05` binary — 6-byte magic, record count, normalized min/max power readings per module.

---

## SYSTEM Lua API — push subscriptions

CLU pushes feature value changes to a registered IP:port whenever a subscribed feature changes.

```
 Client                                          CLU
  │                                               │
  │── req:...:SYSTEM:clientRegister("ip",port,    │
  │           id,{{ObjName,feat_idx},...}) ───────►│
  │◄── resp:...:clientReport:<id>:{v0,v1,...} ────│  immediate snapshot
  │◄── resp:0.0.0.0:00000000:clientReport:<id>:{..}  on each change (session=0)
  │── req:...:SYSTEM:clientDestroy("ip",port,id) ►│
  │◄── resp:...:<id> ─────────────────────────────│
```

- Default push destination port: `4344`
- `id`: caller-chosen integer echoed in every `clientReport`
- `{{ObjName,feat_idx},...}`: Lua table of `{object_name, feature_index}` pairs
- Unsolicited push uses `resp:0.0.0.0:00000000:clientReport:...` (session=0)

| Lua call | Description |
|----------|-------------|
| `SYSTEM:clientRegister("ip",port,id,{{obj,feat},...})` | Subscribe; CLU pushes `clientReport` on change |
| `SYSTEM:clientDestroy("ip",port,id)` | Unsubscribe |
| `SYSTEM:mqttRegister(id,topics)` | Subscribe via MQTT/AWS IoT cloud channel |
| `SYSTEM:mqttDestroy(id,topics)` | Unsubscribe MQTT |

---

## CLU-to-CLU calls

CLU Lua objects call remote CLUs using the same `req:` transport — unicast to the remote CLU's IP.

```
 CLU A                                          CLU B
  │── req:<B_ip>:<session_hex8>:<lua_expr> ──────►│
  │◄── resp:<B_ip>:<session_hex8>:<return_val> ───│
```

`RemoteCLU` objects serialize `OBJECT:execute(method_id, args...)` as `ObjectName:execute(...)` Lua source and send it as a `req:` call. Requires a yieldable Lua coroutine context.

Module events from CLU B reach CLU A only as UDP notifications — CLU A is not on the RS485 bus and does not parse TFBUS frames. As a result, CLU A receives only a simplified event notification (no button index or event type); full button identity is available only to CLU B, which owns the RS485 bus.
