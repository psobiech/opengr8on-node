# TFBUS — RS232_CONTROLLER_DIN Module

**hwType=43, fwType=2**

Objects: `RS232_CONTROLLER` ×1, `PowerSupplyVoltage` ×1

---

## Init Sequence

TODO: requires bus capture

---

## STATUS_POLL Response

TODO: requires bus capture

---

## Wire Examples

TODO: requires bus capture

---

## CLU Lua API

Source of truth: `docs/device-interfaces/module_2_0_RS232_CONTROLLER_DIN_fv01_02.xml`

### RS232_CONTROLLER (class=33, ×1)

**Features:**

| Index | Name | R/W | Type | Range / Default | Unit | Description |
|-------|------|-----|------|-----------------|------|-------------|
| 0 | RepresentationType | RW | num | 0=HEX 1=ASCII |  | Data representation type |
| 1 | BaudRate | RW | num | 1200=1200 2400=2400 4800=4800 9600=9600 19200=19200 38400=38400 57600=57600 115200=115200 | bps | Transmission Speed |
| 2 | WordLenght | RW | num | 8=8 9=9 |  | Length of word |
| 3 | StopBits | RW | num | 0=1 1=1.5 2=2 |  | Stop bits: 0 - 1 stop bit 1 - 1.5 stop bits 2 - 2 stop bits |
| 4 | Parity | RW | num | 0=None 1=Odd 2=Even |  | Parity bit: 0 - None 1 - Odd 2 - Even |
| 5 | TxBuffer | R | str | def= |  | Transceiver buffer. Cleared automatically after calling SendTxBuffer |
| 6 | RxBuffer | R | str | def= |  | Receiver buffer. Incoming data is added to the buffer. After analyzing the data, clear th… |
| 7 | ResponseSize | RW | num | def=1 |  | The size of the expected response determined by the minimum number of bytes in the receiv… |
| 8 | ResponseTimeout | RW | num | 100-1000, def=100 | ms | Time of response |

**Methods:**

| Call | Index | Name | Params | Description |
|------|-------|------|--------|-------------|
| set | 0 | SetRepresentationType | Type | Sets data representation type |
| set | 1 | SetBaudRate | BaudRate(bps) | Sets transmission speed |
| set | 2 | SetWordLenght | WordLength | Sets length of word |
| set | 3 | SetStopBits | StopBits | Sets stop bits number |
| set | 4 | SetParity | Parity | Sets parity control type |
| execute | 3 | AddToTxBuffer | Tx | Add data to transceiver buffer |
| set | 7 | SetResponseSize | Size | Sets size of response |
| set | 8 | SetResponseTimeout | Time(ms) | Sets time of response |
| execute | 0 | ClearRxBuffer | Size | Clears receiver buffer |
| execute | 1 | ClearTxBuffer | Size | Clears transceiver buffer |
| execute | 2 | SendTxBuffer | EndLineCharacter | Sends transceiver buffer |

**Events:**

| Address | Name | Description |
|---------|------|-------------|
| 0 | OnReceive | Occurs when controller receives data. If the size of the received data is smaller than Re… |
| 1 | OnTransmit | Occurs when controller is sending data |
| 2 | OnResponseTimeout | Occurs when the response time has been exceeded |
| 4 | OnOverflow | Occurs when the receiver buffer is overflown |
| 5 | OnTransmitError | Occurs during transmission error |

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

