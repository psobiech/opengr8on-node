# TFBUS — RELAY_WIFI_FM_2 Module

**hwType=35, fwType=2**

Objects: `DOUT` ×2, `DIN` ×2

---

## Init Sequence

Same pattern as RELAY_DIN_4 (hwType=21), per relay channel (ch=0,1):

1. `DEACTIVATE [1<<ch]`
2. `CHANNEL_MAP [ch, 0x02]`
3. `MODULE_PARAM [0, ch, 1, 0]`

Inputs (DIN ch=0,1) additionally get:
4. `CHANNEL_INIT [0x00, ch, 0]`
5. `MODULE_PARAM [0, ch, 0, 0]`  (io_dir=0 = input)

Batched F0 frames (fwType=2, hwType=35>9).

Each sub-record layout: `type(1) len(1) meta(1) data[len]`. The F0 frame plen = count_byte + all_sub_record_bytes + 1.

---

## STATUS_POLL Response

Two relay outputs + two digital inputs. TLV response:

```
count=03
  01 02 10 [s0 s1]    relay output states (LE u16); bit N=1 → relay N active
                       parsed by parse_rx_input_bitmask: byte[1]=enable_mask, byte[2]=value_mask
  01 01 00 [state]    combined output state byte (0=all off)
  00 01 [meta] [inp]  digital input bitmask; parse_rx_input_bitmask: byte[2]=value bitmask (bit 0=DIN0, bit 1=DIN1)
```

Standard ACK `AA 00 01 AB` returned when no state change.

---

## Wire Examples

F0 (MODULE_CMD) frame: `AA dest 0xF0 plen count [type len meta data...]... XOR_crc`

```
relay1 ON:   aa <addr> f0  06 01 08 01 01 01  <crc>    ACTIVATE   type=0x08 len=1 meta=0x01 data=0x01
relay1 OFF:  aa <addr> f0  06 01 09 01 01 01  <crc>    DEACTIVATE type=0x09 len=1 meta=0x01 data=0x01
relay2 ON:   aa <addr> f0  06 01 08 01 01 02  <crc>    ACTIVATE   type=0x08 len=1 meta=0x01 data=0x02
relay2 OFF:  aa <addr> f0  06 01 09 01 01 02  <crc>    DEACTIVATE type=0x09 len=1 meta=0x01 data=0x02
```

---

## CLU Lua API

Source of truth: `docs/device-interfaces/module_RELAY_WIFI_FM_2_fv01_02.xml`

### DOUT (class=4, ×2)

**Features:**

| Index | Name | R/W | Type | Range / Default | Unit | Description |
|-------|------|-----|------|-----------------|------|-------------|
| 0 | Value | RW | num | 0=Off 1=On | bool | Returns 1 for output set at On and 0 for output set at Off state |
| 15 | DeclaredLoad | RW | num | 0-1000, def=0 | [W] | Declared Power Consumption. It is copied to the Load property when the output is On |
| 8 | Load | R | num |  | [W] | Actual load power consumption |
| 11 | PowerOnTime | R | num |  | [s] | Total time of the output On state since power up or ResetPowerStatistics() call |
| 12 | PowerConsumption | R | num |  | [kWh] | Total power consumption since power up or ResetPowerStatistics() call |

**Methods:**

| Call | Index | Name | Params | Description |
|------|-------|------|--------|-------------|
| set | 0 | SetValue | Value(bool) | Sets output state to 1 or 0 |
| execute | 0 | Switch |  | Changes the output value to opposite state |
| execute | 1 | SwitchOn | Time(ms) | Sets output value to 1. The first parameter is the time of change: 0 - switches output to… |
| execute | 2 | SwitchOff | Time(ms) | Sets output value to 0. The first parameter is the time of change: 0 - switches output to… |
| execute | 3 | ResetPowerStatistics |  | Resets power measurement statistics |

**Events:**

| Address | Name | Description |
|---------|------|-------------|
| 0 | OnValueChange | Occurs when a change in the state takes place (regardless of the value) |
| 1 | OnSwitchOn | Occurs when On(1) is set at output |
| 2 | OnSwitchOff | Occurs when Off(0) is set at output |

### DIN (class=3, ×2)

**Features:**

| Index | Name | R/W | Type | Range / Default | Unit | Description |
|-------|------|-----|------|-----------------|------|-------------|
| 1 | Inertion | RW | num | 20-500, def=60 | ms | Specifies the entry time constant. The value step is 20ms |
| 2 | HoldDelay | RW | num | 100-5000, def=500 | ms | Time in milliseconds after which, when pressing and holding a button, the OnHold event oc… |
| 3 | HoldInterval | RW | num | 100-2000, def=200 | ms | Cyclical interval in milliseconds after which, when pressing and holding a button, the On… |
| 0 | Value | R | num | 0-1 | bool | Returns input state as 0 or 1 |
| 4 | Coupling | R | num | 0-120 | % | Returns the percentage of coupling between wires: 0% - no coupling when input physically … |

**Methods:**

| Call | Index | Name | Params | Description |
|------|-------|------|--------|-------------|
| set | 1 | SetInertion | Inertion(ms) | Sets the input inertia time |
| set | 2 | SetHoldDelay | HoldDelay(ms) | Sets HoldDelay value |
| set | 3 | SetHoldInterval | HoldInterval(ms) | Sets HoldInterval value |

**Events:**

| Address | Name | Description |
|---------|------|-------------|
| 0 | OnValueChange | Occurs when a change in the input state takes place (regardless of the value) |
| 1 | OnSwitchOn | Occurs when the high state is set at input |
| 2 | OnSwitchOff | Occurs when the low state is set at input |
| 3 | OnShortPress | Occurs after pressing the button for 500 - 2000ms |
| 4 | OnLongPress | Occurs after pressing the button for at least 2000ms |
| 5 | OnHold | Occurs for the first time after HoldDelay time and then cyclically every HoldInterval val… |
| 6 | OnClick | Occurs after pressing the button for less than 500 ms |

