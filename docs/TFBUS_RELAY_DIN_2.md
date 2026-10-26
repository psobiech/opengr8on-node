# TFBUS — RELAY_DIN_2 Module

**hwType=22, fwType=2**

Objects: `DOUT` ×2, `PowerSupplyVoltage` ×1

---

## Init Sequence

Same pattern as RELAY_DIN_4 (hwType=21), per relay channel (ch=0,1):

1. `DEACTIVATE [1<<ch]`
2. `CHANNEL_MAP [ch, 0x02]`
3. `MODULE_PARAM [0, ch, 1, 0]`

All three are MODULE_CMD (0xF0) sub-records sent as batched F0 frame (fwType=2, hwType>9).

Each sub-record layout: `type(1) len(1) meta(1) data[len]`. The F0 frame plen = count_byte + all_sub_record_bytes + 1.

---

## STATUS_POLL Response

Two relay channels + voltage sensor. TLV response:

```
count=03
  01 02 10 [s0 s1]    relay output states (LE u16); bit N=1 → relay N active
                       parsed by parse_rx_input_bitmask: byte[1]=enable_mask, byte[2]=value_mask
  01 01 00 [state]    combined output state byte (0=all off)
  02 02 10 [lo hi]    power supply voltage LE u16 ÷ 100 = V
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

Source of truth: `docs/device-interfaces/module_2_0_RELAY_DIN_2_fv02_02.xml`

### DOUT (class=4, ×2)

**Features:**

| Index | Name | R/W | Type | Range / Default | Unit | Description |
|-------|------|-----|------|-----------------|------|-------------|
| 0 | Value | RW | num | 0=Off 1=On | bool | Returns 1 for output set at On and 0 for output set at Off state |
| 3 | VoltageType | RW | num | 0=AC 1=DC 2=Signal |  | Load voltage type: 0 - AC, 1 - DC |
| 4 | VoltageValue | RW | num | 0-230, def=230 | V | Load voltage value |
| 5 | Power | R | num | 0-3000, def=0 | W | Returns power in watts |
| 7 | Overload | RW | num | 0-3000, def=3000 | W | The power value beyond which the OnOverload event is generated |
| 6 | DistributedLogicGroup | RW | num | 0-10000, def=0 |  | Distributed Logic group - broadcast group for distributed logic |
| 1 | StatisticState | RW | num | 0=Off 1=Continuous 3=Real | number | Enables measurement reporting to the statistics module: Off - turned off, Continuous - lo… |
| 2 | Load | RW | num | 0-60000, def=0 | W | The measured value multiplier. For StatisticState: Continuous - load measurement value in… |

**Methods:**

| Call | Index | Name | Params | Description |
|------|-------|------|--------|-------------|
| set | 0 | SetValue | Value(bool) | Sets output state to 1 or 0 |
| execute | 0 | Switch | Time(ms) | Changes the output value from 0 to 1 or from 1 to 0. The first parameter is the time of c… |
| execute | 1 | SwitchOn | Time(ms) | Sets output value to 1 |
| execute | 2 | SwitchOff | Time(ms) | Sets output value to 0 |
| set | 7 | SetOverload | Overload(W) | Sets the power value beyond which the OnOverload event is generated |

**Events:**

| Address | Name | Description |
|---------|------|-------------|
| 0 | OnValueChange | Occurs when a change in the state takes place (regardless of the value) |
| 1 | OnSwitchOn | Occurs when On(1) is set at output |
| 2 | OnSwitchOff | Occurs when Off(0) is set at output |
| 3 | OnOverload | The event is raised when the power consumed by the receiver exceeds the Overload value |

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

