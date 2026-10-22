# TFBUS — Module Testing Methodology

Tools: `mcp-tfbus` (sniff) + `mcp-clu` (execute Lua on CLU).

**Bus port**: CLU_1 and CLU_2 share `/dev/ttyUSB1` (same physical RS485 bus). `/dev/ttyUSB0` has no traffic.

---

## Step 1 — Resolve Project Name → nameOnCLU

Given a friendly object name (e.g. `ROLETY4_WYJ3_POKOJ4_DUZEOKNO`):

**Option A — CLU REPL info command (fastest):**
```
clu> info <CLU_NAME> <OBJECT_NAME>
```
Returns: nameOnCLU, object type, CLU assignment directly.

**Option B — Extract from project.omp:**
```bash
unzip -p runtime/project.omp system.xml | grep -B 2 -A 5 '<name>OBJECT_NAME</name>'
```
Look for the `<nameOnCLU>` sibling — that is the Lua identifier used in all `clu_execute` calls.

The `nameOnCLU` (e.g. `ROL5074`, `DIM3942`, `LED0173`) is what all Lua scripts must use, not the project name.

---

## Step 2 — Find Device Interface XML

Device interface files are in `docs/device-interfaces/`. They define exact feature indices, method signatures, value ranges, and units. **This is the authoritative source for all get/set/execute indices.**

**Identify module type from project.omp:**
```bash
unzip -p runtime/project.omp system.xml | python3 -c "
import sys, re
data = sys.stdin.read()
start = data.find('<nameOnCLU>ROL5074</nameOnCLU>')
print(data[start:start+500])
"
```
Look for `<type>`, `<hwType>`, `<fwType>` near the nameOnCLU block.

**Match to interface file** — naming convention: `module_2_0_<MODULE_TYPE>_fv<fwVer>_<fwApiVer>.xml`

Examples:

| Object type in project | Interface file pattern                            |
|------------------------|---------------------------------------------------|
| `ROLLER_SHUTTER`       | `module_2_0_ROLLER_SHUTTER_DIN_3_fv*`            |
| `DIMMER`               | `module_2_0_DIMMER_MOSFET_DIN_fv*`               |
| `RELAY`                | `module_2_0_RELAY_DIN_4_fv*`                      |
| `LED`                  | `module_2_0_LED_RGBW_DIN_fv*`                    |
| `IO_MODULE`            | `module_2_0_IO_MODULE_DIN_8_fv*`                 |
| `SMART_PANEL`          | `module_SMART_PANEL_FM_4_fv*`                    |

Pick the highest matching firmware version. List all candidates:
```bash
ls docs/device-interfaces/ | grep -i ROLLER_SHUTTER_DIN_3
```

**Extract feature and method index table:**
```bash
grep -E '<(feature|method)[^>]*(index|name)=' docs/device-interfaces/<file>.xml \
  | sed 's/.*index="\([^"]*\)".*name="\([^"]*\)".*/\1 \2/'
```

---

## Step 2b — Device Interface Concepts

Each interface XML defines three sections per object class:

### `<features>` — CLU-side state

Scalar values the CLU tracks for the object. Attributes:

| Attribute      | Meaning                                                        |
|----------------|----------------------------------------------------------------|
| `index="N"`    | Index used in `get(N)` / `set(N, val)` Lua calls              |
| `get="true"`   | Readable: `OBJ:get(N)` returns current value                  |
| `set="true"`   | Directly writable: `OBJ:set(N, val)` writes without a method  |
| `set="false"`  | Read-only via get; only writable through a matching method     |
| `range="A-B"`  | Valid value range                                              |
| `enum="0,1,2"` | Discrete enum; check `<enum>` children for names              |
| `unit=""`      | Value unit (ms, %, bool, W, …)                                 |
| `default="N"`  | Value after module reset                                       |

### `<methods>` — named operations

Callable procedures, split by `call` type:

| `call` attr    | Lua invocation              | Notes                                              |
|----------------|-----------------------------|----------------------------------------------------|
| `call="set"`   | `OBJ:set(index, val)`       | Same Lua call as a `set="true"` feature write; index matches the target feature index |
| `call="execute"` | `OBJ:execute(index, ...)` | Independent index namespace from `set`; may take 0–N params per `<param>` children |

`set` methods and `set="true"` features share the **same `set()` namespace** — e.g. RELAY `set(0, 1)` is both feature[0] direct write and the `SetValue` method. The method form just documents it with a name, default, and range.

`execute` methods are **never** mixed with `set` — the indices are independent. Always check `call=` before assuming.

### `<events>` — outbound CLU triggers

Fired by the CLU when the object state changes. Each has `address="N"`. You attach Lua handlers to events in the OMP project. **Not testable via mcp-clu** — they are outbound notifications, not commands. Useful for knowing what state changes the CLU can observe and react to.

---

## Step 3 — CLU Lua API

`clu_execute` accepts only **single-expression scripts** — no multi-statement Lua, no `local` declarations.

Return values:
- `"nil"` — void return (success)
- `"null"` — Lua error (wrong method name, wrong arg count, object not found)
- numeric string — actual return value

### Chaining multiple calls in one expression

When sequential commands must arrive without inter-call latency (e.g. draw + flush before panel timeout), chain them using `or 1` to convert falsy nil returns into a truthy value that keeps the `and` chain alive:

```lua
((OBJ:execute(A) or 1) and (OBJ:execute(B) or 1)) and OBJ:execute(C)
```

`execute()` returns Lua nil (falsy). `nil or 1` → 1 (truthy) → `and` proceeds to next call. Final call result is the expression's return value.

### Reading features

```lua
OBJ:get(N)        -- read feature at index N
```

Feature available when interface XML has `<feature index="N" get="true">`.

### Writing config / writable features

```lua
OBJ:set(N, val)   -- write feature at index N (requires set="true" in XML)
```

Also used for methods declared `<method call="set" index="N">` in the interface.

### Triggering actions

```lua
OBJ:execute(N)            -- trigger action at index N (no params)
OBJ:execute(N, arg1)      -- trigger with one param
OBJ:execute(N, arg1, arg2)-- trigger with two params
```

Used for methods declared `<method call="execute" index="N">` in the interface.

### Index namespace separation

`set` indices and `execute` indices are **independent namespaces**. Example for RELAY_DIN_4:
- `set(0, 1)` → SetValue (feature write)
- `execute(0)` → Switch (action)

Always check `call="set"` vs `call="execute"` in the interface XML before assuming.

---

## Step 4 — Identify Bus Address

1. Start sniff on `/dev/ttyUSB1`, `filter=true`, no `addr` filter
2. In parallel: issue a command that changes observable state — e.g. `OBJ:execute(N, val)` or `OBJ:set(0, X)` with value different from current
3. The addr whose STATUS_POLL payload changes = module's bus address

Confirm with focused sniff: `addr=N`, `filter=false` to see steady-state TX/RX cycle.

---

## Step 5 — Observe Bus Response to Commands

- `filter=true` — drops frames identical to last-seen for that addr; use to spot reactions to commands
- `filter=false` + `addr=N` — every TX ping + RX response for one module continuously
- **MODULE_CMD (type=0xF0) is never captured in TX**: fires between STATUS_POLL cycles; only the resulting STATUS_POLL response is ever seen
- **filter=true hides repeated identical payloads**: if two consecutive value changes produce the same STATUS_POLL payload, only the first is shown — use `filter=false` when doing systematic channel sweeps

---

## Step 6 — Decode STATUS_POLL Response

Frame: `aa 00 <len> <payload> <xor_crc>`

Payload TLV: `[type(1)] [len(1)] [meta(1)] [data(len)]` — first byte = record count.

Decode each TLV record per module type — see per-module `.md` files in `docs/`.

---

## Step 7 — Capturing STATUS_POLL Data Frames (LED-type modules)

LED-type modules (e.g. LED_RGBW_DIN) respond to STATUS_POLL with ACK (`AA 00 01 AB`) by default. A data frame is only emitted when a MODULE_CMD arrives **during** the STATUS_POLL exchange window (timing collision):

- Run `sniff` + `execute()` in parallel — both start simultaneously
- The MODULE_CMD fires as soon as the CLU receives the TCP request
- If MODULE_CMD lands while CLU is waiting for STATUS_POLL response, module bundles data frame with reply
- If timing misses, only ACK returned; value still changed; no retry needed
- Expect data frames occasionally, not on every attempt
