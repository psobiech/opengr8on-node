# TFBUS — ROLLER_SHUTTER_DIN_4 Module

**hwType=53, fwType=2**

Objects: `ROLLER_SHUTTER` ×4, `DIN` ×8, `PowerSupplyVoltage` ×1

---

## Init Sequence

Same pattern as ROLLER_SH_DIN_3 (hwType=42), ×4 roller channels (ch=1–4). DIN inputs (ch=0–7) also initialized.

Per roller channel (inst=1–4):
1. `CHANNEL_INIT [0x16, inst, 0]`
2. `FEATURE_PARAM ×4`  (compact_idx 0–3 → MaxTime, MechanicalOffset, BlindsUpMaxTime, BlindsDownMaxTime; unit=10ms)
3. `MODULE_PARAM [0, inst-1, 1, 0]`
4. `ROLLER_CHAN_REG [0, inst]`

Per DIN input (ch=0–7):
5. `CHANNEL_INIT [0x00, ch, 0]`
6. `MODULE_PARAM [0, ch, 0, 0]`

Batched F0 frames (fwType=2, hwType=53>9).

Each sub-record layout: `type(1) len(1) meta(1) data[len]`. The F0 frame plen = count_byte + all_sub_record_bytes + 1.

---

## STATUS_POLL Response

Four roller channels + 8 digital inputs. TLV response:

```
count=06
  01 01 00 [state]                  combined motion state (0=stop, 1=up, 2=down)
  16 03 00 [inst1] [pos%] [flags]   roller ch1: type=0x16, len=3; inst=1-based channel, pos 0–100%
  16 03 00 [inst2] [pos%] [flags]   roller ch2: parse_rx_roller_position matches chan_idx==byte[1]-1
  16 03 00 [inst3] [pos%] [flags]   roller ch3
  16 03 00 [inst4] [pos%] [flags]   roller ch4
  00 01 [meta] [inp8]               8-bit digital input bitmask; byte[2]=value bitmask
```

The flags byte encodes motion state via bits[7:5] (from `parse_rx_roller_complex`):
- bits[7:5]=0: simple stop; 3 bytes from [0xb]
- bits[7:5]=1 or 2: direction + 4-byte packed state at [0xb], position at [1]
- bits[7:5]=3: 10-byte position data
- bits[7:5]=5: 4-byte roller width at [1]
- `0x00` — stopped at target (bits[7:5]=0)
- `0x5a` — position uncertain / uninitialized

The SET_POSITION command uses `send_roller_position_cmd`: sub-type 0x16, 4 bytes: `[direction_byte, position_percent, 0x00, 0x00]`. Direction derived from channel instance (chan_idx 0x14→0, 0x15→1, 0x16→2).

Standard ACK `AA 00 01 AB` returned when no state change.

---

## Wire Examples

F0 (MODULE_CMD) frame: `AA dest 0xF0 plen count [type len meta data...]... XOR_crc`

```
roller1 STOP:   aa <addr> f0  06 01 09 01 01 30  <crc>         DEACTIVATE type=0x09 len=1 meta=0x01 data=0x30
setpos ch2 50%: aa <addr> f0  08 01 16 03 00 00 02 32  <crc>   SET_POSITION type=0x16 len=3 meta=0x00 [dir=0x00 pos%=0x32(50%) 0x00]
moveup ch1:     aa <addr> f0  06 01 08 01 01 01  <crc>         ACTIVATE type=0x08 len=1 meta=0x01 data=0x01
movedown ch1:   aa <addr> f0  06 01 08 01 01 02  <crc>         ACTIVATE type=0x08 len=1 meta=0x01 data=0x02
```

---

## CLU Lua API

Source of truth: `docs/device-interfaces/module_2_0_ROLLER_SHUTTER_DIN_4_fv03_02.xml`

### ROLLER_SHUTTER (class=24, ×4)

**Features:**

| Index | Name | R/W | Type | Range / Default | Unit | Description |
|-------|------|-----|------|-----------------|------|-------------|
| 16 | MechanicalOffset | RW | num | 0-1000, def=0 | ms | The time of compensation for start of the drive |
| 9 | MaxTime | RW | num | 0-600000, def=30000 | ms | The time in milliseconds it takes to fully open / close the blind |
| 14 | BlindsUpMaxTime | RW | num | 0-600000, def=0 | ms | The time in milliseconds it takes to fully open the blind |
| 15 | BlindsDownMaxTime | RW | num | 0-600000, def=0 | ms | The time in milliseconds it takes to fully close the blind |
| 0 | State | R | num | 0=Stop 1=Up 2=Down 3=Blocked 4=Calibration | - | Output state: 0 - no movement, 1 - moving upwards, 2 - moving downwards, 3 - blocked, 4 -… |
| 3 | Up | R | num | 0=Off 1=On |  | State of UP relay (moving upwards) |
| 4 | Down | R | num | 0=Off 1=On |  | State of DOWN relay (moving downwards) |
| 7 | Position | R | num | def=0 | % | Percentage value of the shutter opening: 0% - fully closed, 100% - fully open |
| 8 | LamelPosition | R | num | def=0 | ° | Roller shutter lamel position 90 - fully closed, 0 - fully open |
| 10 | LamelMoveTimeout | RW | num | 0-60000, def=0 | ms | The maximum working time of the shutter's slats, if the shutter does not have slats, shou… |
| 11 | DistributedLogicGroup | RW | num | 0-10000, def=0 |  | Distributed Logic group - broadcast group for distributed logic |
| 13 | ReversePosition | RW | num | 0=No 1=Yes |  | The function for inverting position range (0-100% for 100-0%): 0 - No, 1 - Yes |
| 17 | ReverseDirections | RW | num | 0=Normal 1=Reverse |  | The function of reversing the direction of the roller shutter operation |

**Methods:**

| Call | Index | Name | Params | Description |
|------|-------|------|--------|-------------|
| set | 16 | SetMechanicalOffset | Offset(0-1000 ms) | Sets the time of compensation for start of the drive |
| set | 14 | SetBlindsUpMaxTime | Timeout(0-600000 ms) | Sets the shutter opening time |
| set | 15 | SetBlindsDownMaxTime | Timeout(0-600000 ms) | Sets the shutter closing time |
| execute | 10 | SetPosition | Position(0-100 %), Lamel(0-90 °) | Shutter opening percentage setting: 0% - fully open, 100% - fully closed |
| execute | 9 | SetLamelPosition | Position(0-90 °) | Sets the position of the slats |
| execute | 8 | Calibration | Direction(-) | Calibrates the shutter position |
| set | 10 | SetLamelMoveTimeout | Timeout(0-60000 ms) | Sets the cycle time of the slats |
| execute | 0 | MoveUp | Time(ms) | Roller shutter UP or STOP if moving. Parameter Time: num - move up time (or until roller … |
| execute | 1 | MoveDown | Time(ms) | Roller shutter DOWN or STOP if moving. Parameter Time: num - move down time (or until rol… |
| execute | 2 | Start | Time(ms) | Roller shutter up if the preceding motion was down or roller shutter down if the precedin… |
| execute | 3 | Stop |  | STOP if moving |
| execute | 4 | Hold |  | Hold with direction change |
| execute | 5 | HoldUp |  | Hold always up |
| execute | 6 | HoldDown |  | Hold always down |
| execute | 13 | SetRollerBlocked | State(0-1 ms) | Enables / disables the ability to control the roller shutter |
| execute | 14 | LamelStart |  | Changes the position of the slats by 45° |

**Events:**

| Address | Name | Description |
|---------|------|-------------|
| 0 | OnStateChange | Occurs when changing the State properties |
| 1 | OnUp | Occurs when changing the Stop state to the Up state |
| 2 | OnDown | Occurs when changing the Stop state to the Down state |
| 3 | OnStart | Occurs when the shutter is activated |
| 4 | OnStop | Occurs when the shutter is stopped |
| 6 | OnLamelClosed | Occurs when the slats are closed (value 90°) |
| 7 | OnLamelOpen | Occurs when the slats are opened (value 0°) |
| 8 | OnPositionChange | Occurs when the roller shutter position has changed |
| 9 | OnLamelPositionChange | Occurs when the position of the slats has changed |

### DIN (class=3, ×8)

**Features:**

| Index | Name | R/W | Type | Range / Default | Unit | Description |
|-------|------|-----|------|-----------------|------|-------------|
| 1 | Inertion | RW | num | 0-500, def=0 | ms | Specifies the time constant of the input |
| 2 | HoldDelay | RW | num | 100-5000, def=500 | ms | Time in milliseconds after which, when pressing and holding a button, the OnHold event oc… |
| 3 | HoldInterval | RW | num | 100-2000, def=100 | ms | Cyclical interval in milliseconds after which, when pressing and holding a button, the On… |
| 0 | Value | R | num | 0-1 | bool | Returns input state as 0 or 1 |
| 6 | DistributedLogicGroup | RW | num | 0-10000, def=0 |  | Distributed Logic group - broadcast group for distributed logic |
| 4 | StatisticState | RW | num | 0=Off 1=Continuous 2=Pulse | number | Enables measurement reporting to the statistics module: Off - turned off, Continuous - lo… |
| 5 | Load | RW | num | 0-60000, def=0 | W | The measured value multiplier. For StatisticState: Continuous - load measurement value in… |

**Methods:**

| Call | Index | Name | Params | Description |
|------|-------|------|--------|-------------|
| set | 1 | SetInertion | Inertion(ms) | Minimum interval in milliseconds which has to pass between presses of a button so that it… |
| set | 2 | SetHoldDelay | HoldDelay(ms) | Sets HoldDelay value |
| set | 3 | SetHoldInterval | HoldInterval(ms) | Sets HoldInterval value |

**Events:**

| Address | Name | Description |
|---------|------|-------------|
| 0 | OnValueChange | Occurs when a change in the input state takes place (regardless of the value) |
| 1 | OnSwitchOn | Occurs when the high state is set at input |
| 2 | OnSwitchOff | Occurs when the low state is set at input |
| 3 | OnShortPress | Occurs after pressing the button for 500 ms - 2000 ms |
| 4 | OnLongPress | Occurs after pressing the button for at least 2000 ms |
| 5 | OnHold | Occurs for the first time after HoldDelay time and then cyclically every HoldInterval val… |
| 6 | OnClick | Occurs after pressing the button for less than 500 ms |

### PowerSupplyVoltage (class=12, ×1)

**Features:**

| Index | Name | R/W | Type | Range / Default | Unit | Description |
|-------|------|-----|------|-----------------|------|-------------|
| 0 | Value | R | num | 0-24, def=0 | V | Current power supply voltage value |
| 1 | Value% | R | num | 0-1000000, def=0 | % | Current percentage input value of the maximum value (MaxValue characteristic) |
| 3 | Sensitivity | RW | num | 0-10, def=0.5 | V | Minimum change of input state when the OnValueChange, OnValueLower or OnValueRise event i… |
| 5 | MinValue | RW | num | def=21 | V | Minimum value of the Value characteristic after exceeding which the OnOutOfRange event is… |
| 6 | MaxValue | RW | num | def=24 | V | Maximum value of the Value characteristic after exceeding which the OnOutOfRange event is… |

**Methods:**

| Call | Index | Name | Params | Description |
|------|-------|------|--------|-------------|
| set | 3 | SetSensitivity | Sensitivity(0-10 V) | Sets input sensitivity value |
| set | 5 | SetMinValue | MinValue | Sets MinValue |
| set | 6 | SetMaxValue | MaxValue | Sets MaxValue |

**Events:**

| Address | Name | Description |
|---------|------|-------------|
| 0 | OnValueChange | Event resulting from changing input state |
| 1 | OnValueLower | Event occurs when a value lower than the value from the last reading appears at input |
| 2 | OnValueRise | Event occurs when a value higher than the value from the last reading appears at input |
| 3 | OnOutOfRange | Event resulting from exceeding the permissible range (MinValue - MaxValue) |
| 6 | OnInRange | Event occurs when value returns to MinValue - MaxValue range |

