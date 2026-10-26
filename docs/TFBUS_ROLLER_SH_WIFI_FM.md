# TFBUS — ROLLER_SH_WIFI_FM Module

**hwType=41, fwType=2**

Objects: `ROLLER_SHUTTER` ×1, `DIN` ×2

---

## Init Sequence

Same pattern as ROLLER_SH_DIN_3 (hwType=42), single roller channel (ch=1). DIN inputs ch=0,1 also initialized.

Roller channel:
1. `CHANNEL_INIT [0x16, 1, 0]`
2. `FEATURE_PARAM ×4`  (compact_idx 0–3 → MaxTime, MechanicalOffset, BlindsUpMaxTime, BlindsDownMaxTime; unit=10ms)
3. `MODULE_PARAM [0, 0, 1, 0]`
4. `ROLLER_CHAN_REG [0, 1]`

DIN inputs (ch=0,1):
5. `CHANNEL_INIT [0x00, ch, 0]`
6. `MODULE_PARAM [0, ch, 0, 0]`

Batched F0 frames (fwType=2, hwType=41>9).

Each sub-record layout: `type(1) len(1) meta(1) data[len]`. The F0 frame plen = count_byte + all_sub_record_bytes + 1.

---

## STATUS_POLL Response

Single roller channel + two digital inputs. TLV response:

```
count=03
  01 01 00 [state]                motion state (0=stop, 1=up, 2=down)
  16 03 00 [inst] [pos%] [flags]  roller position: type=0x16, len=3; inst=1 (1-based);
                                   parse_rx_roller_position matches chan_idx==byte[1]-1
                                   flags bits[7:5]: 0=stopped, 1/2=moving+direction, 3=10B pos data, 5=width
  00 01 [meta] [inp]              digital input bitmask; byte[2]=value bitmask (bit 0=DIN0, bit 1=DIN1)
```

Known flag values:
- `0x00` — stopped at target (bits[7:5]=0)
- `0x5a` — position uncertain / uninitialized

The SET_POSITION command uses `send_roller_position_cmd`: sub-type 0x16, 4 bytes: `[direction_byte, position_percent, 0x00, 0x00]`.

Standard ACK `AA 00 01 AB` returned when no state change.

---

## Wire Examples

F0 (MODULE_CMD) frame: `AA dest 0xF0 plen count [type len meta data...]... XOR_crc`

```
roller STOP:    aa <addr> f0  06 01 09 01 01 30  <crc>           DEACTIVATE type=0x09 len=1 meta=0x01 data=0x30
setpos 50%:     aa <addr> f0  08 01 16 03 00 00 01 32  <crc>     SET_POSITION type=0x16 len=3 meta=0x00 [dir=0x00 pos%=0x32(50%) 0x00]
moveup:         aa <addr> f0  06 01 08 01 01 01  <crc>           ACTIVATE type=0x08 len=1 meta=0x01 data=0x01
movedown:       aa <addr> f0  06 01 08 01 01 02  <crc>           ACTIVATE type=0x08 len=1 meta=0x01 data=0x02
```

---

## CLU Lua API

Source of truth: `docs/device-interfaces/module_ROLLER_SH_WIFI_FM_fv01_02.xml`

### ROLLER_SHUTTER (class=24, ×1)

**Features:**

| Index | Name | R/W | Type | Range / Default | Unit | Description |
|-------|------|-----|------|-----------------|------|-------------|
| 0 | State | R | num | 0=Stop 1=Up 2=Down | - | Output state: 0 - no movement, 1 - moving upwards, 2 - moving downwards |
| 1 | MaxTime | RW | num | def=30000 | ms | Default Time parameter value. 0 if not specified |
| 3 | Up | R | num | 0=Off 1=On |  | State of UP relay (moving upwards) |
| 4 | Down | R | num | 0=Off 1=On |  | State of DOWN relay (moving downwards) |

**Methods:**

| Call | Index | Name | Params | Description |
|------|-------|------|--------|-------------|
| execute | 0 | MoveUp | Time(ms) | Roller shutter up or STOP if moving. Parameter Time: number - output is active for specif… |
| execute | 1 | MoveDown | Time(ms) | Roller shutter down or STOP if moving. Parameter Time: number - output is active for spec… |
| execute | 2 | Start | Time(ms) | Roller shutter up if the preceding motion was down or roller shutter down if the precedin… |
| execute | 3 | Stop |  | STOP if moving |
| execute | 4 | Hold |  | Blind movement hold |
| execute | 5 | HoldUp |  | Hold always up |
| execute | 6 | HoldDown |  | Hold always down |

**Events:**

| Address | Name | Description |
|---------|------|-------------|
| 0 | OnStateChange | Result from a change in the state of any of the outputs |
| 1 | OnUp | Occurs when changing the Stop state to the Up state |
| 2 | OnDown | Occurs when changing the Stop state to the Down state |
| 3 | OnStart | Occurs when the blind has been turned on |
| 4 | OnStop | Occurs when the blind has stopped |

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

