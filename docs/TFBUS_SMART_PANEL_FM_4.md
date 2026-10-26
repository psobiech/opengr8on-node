# TFBUS — SMART_PANEL_FM_4 Module

**hwType=3, fwType=3, fwApiVer=4** — 4-button panel with OLED display, gesture, proximity, temperature, and light sensors.

Objects: `PANEL` (class=29) ×1, `PANEL_BUTTON` (class=30) ×16, `PANELSENSTEMP` (class=20) ×1, `PANELSENSLIGHT` (class=21) ×1, `PANEL_PAGE` (class=19) ×4

SN prefix: `0x0f05`. Does not respond to VERSION_QUERY.

---

## LED_CMD Frame (type 0x18)

Sent by CLU to control per-button LEDs.

```
AA  dest  0x18  btn_mask  0x00  cmd_byte  XOR_crc     (7 bytes total)
```

- `btn_mask`: `1 << button_idx` (bit N = button N, 0-indexed)
- second payload byte: always `0x00`
- `cmd_byte`: LED action

| cmd_byte | Command | Effect |
|----------|---------|--------|
| `0x00` | ShowOK | Green LED flash |
| `0x01` | ShowError | Red LED flash |
| `0x02` | LedSwitchOn | LED on (steady) |
| `0x04` | LedSwitchOff | LED off — **not** `0x03` |
| `0x10` | RedLedSwitchOn | Red LED on (steady) |

Frame length: 7 bytes. Parser detects by CRC-scanning lengths 7–15.

Wire examples (dest=`<addr>`, button 1 = bit 0 = mask 0x01, button 4 = bit 3 = mask 0x08):
```
ShowOK          aa <addr> 18 01 00 00 <crc>   (btn1, mask=0x01)
ShowError       aa <addr> 18 08 00 01 <crc>   (btn4, mask=0x08)
LedSwitchOn     aa <addr> 18 08 00 02 <crc>
LedSwitchOff    aa <addr> 18 08 00 04 <crc>
RedLedSwitchOn  aa <addr> 18 08 00 10 <crc>
```

---

## STATUS_POLL Response

Unlike LED-type modules, SMART_PANEL_FM_4 **always returns a data frame** — never bare ACK (`AA 00 01 AB`). The minimum response is a 1-record TLV frame.

Frame format:
```
AA 00 <plen> <count> [TLV records...] <CRC>
```

Sub-record layout: `[type(1)] [len(1)] [meta(1)] [data(len)]`

### TLV Records Observed

| type | len | meta | Description |
|------|-----|------|-------------|
| 0x06 | 1   | 0x01 | Baseline status byte — always present; data=0x00 when idle |
| 0x02 | 2   | 0x10 | Temperature — LE int16, units 0.01 °C (panel surface, ~1–2 °C above ambient due to self-heating) |
| 0x07 | 2   | 0x10 | Light sensor — LE int16 raw ADC (CLU maps to 0–100 %) |
| 0x08 | 2   | 0x10 | Button event — edge, one cycle only; VAL = btn_idx×7 + event_id |

### Baseline Frame (1 record, always present)

```
aa 00 06 01  06 01 01 00  ab
│  │  │  │   │  │  │  │
│  │  │  │   │  │  │  └── data = 0x00 (idle)
│  │  │  │   │  │  └───── meta = 0x01
│  │  │  │   │  └──────── len = 1
│  │  │  │   └─────────── type = 0x06 (baseline status)
│  │  │  └─────────────── count = 1 record
│  │  └────────────────── plen = 6
│  └───────────────────── addr = 0x00 (module → CLU)
└──────────────────────── 0xAA start
```

### Extended Frame (2 records, periodic ~every 1.25 s)

Temperature reading (`type=0x02`):
```
aa 00 0b 02  06 01 01 00  02 02 10 24 09  98
                          │  │  │  └─┘
                          │  │  │   └── LE int16 = 0x0924 = 2340 → 23.40 °C raw
                          │  │  └────── meta = 0x10
                          │  └──────── len = 2
                          └─────────── type = 0x02 (temperature)
```

Light reading (`type=0x07`), follows temperature by ~113 ms:
```
aa 00 0b 02  06 01 01 00  07 02 10 dc 00  6c
                          │  │  │  └─┘
                          │  │  │   └── LE int16 = 0x00DC = 220 raw ADC
                          │  │  └────── meta = 0x10
                          │  └──────── len = 2
                          └─────────── type = 0x07 (light)
```

### Sensor Periodicity

Temperature (type=0x02) self-samples on a ~1.25 s schedule regardless of CLU commands. Between cycles the module sends only the 1-record baseline frame.

Light sensor (type=0x07) behavior is firmware-variant dependent. On some units, a light frame follows each temperature frame (~113 ms apart). On others, type=0x07 is never emitted in STATUS_POLL even when the CLU-reported light value changes — the CLU may obtain the light reading via a MODULE_CMD channel not observable in STATUS_POLL cycles. Capture type=0x07 opportunistically; absence does not indicate sensor failure.

### Button Press Frame (type=0x08, edge, one cycle only)

```
aa 00 0b 02  06 01 01 00  08 02 10 1c 00  a3
                          │  │  │  └─┘
                          │  │  │   └── VAL=0x1C=28, 0x00 (always zero)
                          │  │  └────── meta = 0x10
                          │  └──────── len = 2
                          └─────────── type = 0x08 (button identity event)
```

**Encoding**: `VAL = btn_idx × 7 + event_id`
- `btn_idx = VAL / 7` (integer divide) → which button, 0-indexed
- `event_id = VAL % 7` → event type

| event_id | Name |
|----------|------|
| 0 | OnChange |
| 1 | OnSwitchOn |
| 2 | OnSwitchOff |
| 3 | OnShortPress |
| 4 | OnLongPress |
| 5 | OnHold |
| 6 | OnClick |

**btn_idx = button object index (0-based), NOT physical slot position.** Physical slot → btn_idx depends on the active page's `Object_N_Id` assignment. On a page with default/inactive configuration assigning buttons 1–4 to slots 1–4, the row-major mapping holds:

| Physical slot | btn_idx (page default) |
|--------------|----------------------|
| top-left | 0 |
| top-right | 1 |
| bottom-left | 2 |
| bottom-right | 3 |

On a page that assigns e.g. button 5 to slot 1, pressing physical top-left produces btn_idx=4. Verify by reading active page's `Object_N_Id` if unexpected btn_idx values appear.

One physical press queues multiple events (OnSwitchOn → OnShortPress → OnClick → OnChange), drained one per poll cycle (~780 ms each), draining over 3–5 cycles.

**Decoded examples (page with buttons 1–4 assigned to slots 1–4):**

| VAL (hex) | btn_idx | event_id | Event |
|-----------|---------|----------|-------|
| 0x01 (1) | 0 | 1 | top-left, OnSwitchOn |
| 0x08 (8) | 1 | 1 | top-right, OnSwitchOn |
| 0x0F (15) | 2 | 1 | bottom-left, OnSwitchOn |
| 0x16 (22) | 3 | 1 | bottom-right, OnSwitchOn |

---

### Observed Wire Values

| TLV type | data (hex) | LE int16 | CLU value | Notes |
|----------|-----------|----------|-----------|-------|
| 0x02 | `2409` | 2340 | 21.70 °C | Panel surface; ~1.7 °C above ambient |
| 0x02 | `1009` | 2320 | ~21.5 °C | |
| 0x02 | `1a09` | 2330 | ~21.6 °C | |
| 0x07 | `dc00` | 220 | 1.50 % | Light sensor; raw-to-% conversion non-linear |
| 0x07 | `da00` | 218 | — | Natural light sensor variation |
| 0x07 | `d700` | 215 | — | |
| 0x07 | `d800` | 216 | — | |
| 0x08 | `0f00` | VAL=15 | bottom-left OnSwitchOn | btn_idx=2 (Button 3 assigned to slot 3) |
| 0x08 | `1100` | VAL=17 | bottom-left OnShortPress | btn_idx=2, event_id=3 |
| 0x08 | `1200` | VAL=18 | bottom-left OnLongPress | btn_idx=2, event_id=4 |
| 0x08 | `1500` | VAL=21 | bottom-right OnChange | btn_idx=3 (Button 4 assigned to slot 4) |
| 0x08 | `2000` | VAL=32 | page-2 top-left OnLongPress | btn_idx=4 (Button 5 assigned to page 2 slot 1) |

Multiple record types can appear in one frame. Example — light + button event together:
```
aa 00 10 03  06 01 01 00  07 02 10 d7 00  08 02 10 12 00  75
             baseline     light=215       button VAL=18(OnLongPress)
```

---

## CLU Interface

### PANEL_BUTTON (class=30, ×16)

#### Feature Indices (get/set)

| Index | Feature | r/w | Default | Notes |
|-------|---------|-----|---------|-------|
| 0 | Value | r/o | — | 0 or 1 (button state) |
| 1 | Mode | r/w | 0 | 0=Monostable, 1=Bistable, 2=Locked |
| 2 | HoldDelay | r/w | 1000 ms | 100–5000 ms |
| 3 | HoldInterval | r/w | 100 ms | 100–2000 ms |
| 4 | Label | r/w | "" | string (max 15 chars) |
| 5 | IconA | r/w | "" | BMP filename; prefix `~` for negative |
| 6 | IconB | r/w | "" | BMP filename for bistable ON state |

#### Methods (execute)

| Index | Name | set= | Args |
|-------|------|------|------|
| 0 | ShowOK | 0 | — |
| 0 | ShowError | 1 | — |
| 1 | LedSwitchOn | 2 | — |
| 2 | RedLedSwitchOn | 16 | — |
| 2 | LedSwitchOff | 4 | — |
| 3 | SetLabel | — | text |
| 4 | SetIconA | — | filename |
| 5 | SetIconB | — | filename |

set/index methods: SetMode(set=1), SetHoldDelay(set=2), SetHoldInterval(set=3)

#### Events

| Address | Name |
|---------|------|
| 0 | OnChange |
| 1 | OnSwitchOn |
| 2 | OnSwitchOff |
| 3 | OnShortPress |
| 4 | OnLongPress |
| 5 | OnHold |
| 6 | OnClick |

---

### PANEL (class=29, ×1)

#### Feature Indices (get/set)

| Index | Feature | r/w | Default | Notes |
|-------|---------|-----|---------|-------|
| 4 | GestureIconUp | r/w | — | |
| 5 | GestureIconDown | r/w | — | |
| 6 | GestureIconLeft | r/w | — | |
| 7 | GestureIconRight | r/w | — | |
| 10 | ProximitySens | r/w | 5 | 2–100, lower=more sensitive |
| 11 | ProximityTimeout | r/w | 5000 ms | 1000–60000 ms |
| 12 | ProximityValue | r/o | — | raw dimensionless ADC |
| 13 | BuzzerValue | r/w | 1 | 0=Off, 1=On |
| 15 | GestureMode | r/w | 3 | 0=Off, 1=Vertical, 2=Horizontal, 3=Both |
| 16 | GestureSens | r/w | 2 | 1=Low, 2=Mid, 3=High |
| 17 | PageNr | r/w | 1 | current page (1–4) |
| 18 | PageDisplayMode | r/w | 0 | 0=ShowImmediately, 1=ShowIconOrName, 2=ShowGesture |
| 19 | ButtonsLEDMode | r/w | 1 | 0=Off, 1=On, 2=OnForActive |
| 20 | PageControlMode | r/w | 1 | 0=Command, 1=Gesture/Command |
| 21 | GestureDisplayMode | r/w | 1 | 0=Off, 1=On |

#### Methods (execute)

| Index | Name | Args |
|-------|------|------|
| 0 | SwitchOnDisplay | — |
| 1 | ShowButtons | — |
| 2 | ClearScreen | — |
| 3 | PrintText | x(0–127), y(0–63), txt, fontSize(1/2/3) |
| 4 | DrawLine | x, y, xe, ye, color(0=black/1=white) |
| 5 | DrawPoint | x, y, color |
| 6 | DrawIcon | x, y, filename |
| 7 | DisplayContent | — |
| 20 | PrintFloat | x, y, number, precision(0–2), fontSize |
| 21 | SetBeep | freq(Hz 30–5700), duration(ms), volume(0–16), 0 |
| 22 | SetPageNr | nr(1–4) |
| 27 | SetNextPage | — |
| 28 | SetPrevPage | — |
| 29 | Draw | — |

set methods: SetGestureMode(15), SetGestureSens(16), SetPageDisplayMode(18), SetButtonsLEDMode(19), SetPageControlMode(20), SetGestureDisplayMode(21), SetProximitySens(10), SetProximityTimeout(11), SetBuzzerValue(13)

#### Events

| Address | Name |
|---------|------|
| 0 | OnGestureUp |
| 1 | OnGestureDown |
| 2 | OnGestureLeft |
| 3 | OnGestureRight |
| 4 | OnProximityDetect |
| 5 | OnPageChange |

---

### PANELSENSTEMP (class=20, ×1)

| Index | Feature | r/w | Default | Unit |
|-------|---------|-----|---------|------|
| 0 | Value | r/o | — | °C (0.0–45.0) |
| 1 | Threshold | r/w | 0.1 | °C hysteresis |
| 2 | Sensitivity | r/w | 1000 ms | averaging period |
| 3 | MinValue | r/w | 0 | °C |
| 4 | MaxValue | r/w | 45 | °C |

Events: OnChange(0), OnRaiseValue(1), OnLowerValue(2), OnOutOfRange(3)

---

### PANELSENSLIGHT (class=21, ×1)

| Index | Feature | r/w | Default | Unit |
|-------|---------|-----|---------|------|
| 0 | Value | r/o | — | % (0–100) |
| 1 | Threshold | r/w | 0.5 | % hysteresis |
| 2 | Sensitivity | r/w | 500 ms | averaging period |
| 3 | MinValue | r/w | 0 | % |
| 4 | MaxValue | r/w | 100 | % |

Events: OnChange(0), OnRaiseValue(1), OnLowerValue(2), OnOutOfRange(3)

---

### PANEL_PAGE (class=19, ×4)

| Index | Feature | r/w | Notes |
|-------|---------|-----|-------|
| 0 | PageType | r/w | 0=Inactive, 1=Buttons, 2=Thermostats, 3=FreeDraw |
| 1 | PageName | r/w | string (max 15 chars) |
| 3 | Object_1_Id | r/w | thermostat nameOnCLU or button number (1–16) |
| 4 | Object_1_Name | r/w | display name |
| 5–10 | Object_2/3/4_Id/Name | r/w | same pattern for slots 2–4 |

---

## Display Draw Sequence

Correct sequence to update the display from CLU Lua:

1. `execute(0)` — SwitchOnDisplay (display is off after proximity timeout; must wake it first)
2. `execute(2)` — ClearScreen
3. `execute(3, x, y, text, fontSize)` — PrintText (and/or other draw operations)
4. `execute(7)` — **DisplayContent** — flushes buffer to screen

**DisplayContent (`execute(7)`) is the correct flush command**, not Draw (`execute(29)`). Draw does not render to screen on its own.

**All commands must be sent in a single CLU `execute` call** — separate MCP calls introduce enough latency to trigger the draw timeout between drawing and flush. Use the Lua `or 1` chaining trick (since execute returns nil, which is falsy):

```lua
(((PAN:execute(0) or 1) and (PAN:execute(2) or 1)) and (PAN:execute(3, 10, 20, "hello", 2) or 1)) and PAN:execute(7)
```

If draw operations are issued but `DisplayContent` is **not** invoked within the timeout window, the panel displays `! TIMEOUT !` on screen.

The panel displays `! NO CLU !` when it enters distributed logic group mode (no CLU ownership over TFBUS).

See also: [SMARTPANEL_FW_FORMAT.md](SMARTPANEL_FW_FORMAT.md) — firmware update file format and binary analysis.

---

## Multi-CLU Note

Secondary CLU (TCP-notified) receives button event type=0x07 only — all buttons appear identical (no identity). Button identity (event type=0x08) is only available to the primary CLU owning the RS485 bus.

---

## CLU Lua API — Full Reference

Source of truth: `docs/device-interfaces/module_SMART_PANEL_FM_4_fv07_03.xml`

### PANEL_BUTTON (class=30, ×16)

**Features:**

| Index | Name | R/W | Type | Range / Default | Unit | Description |
|-------|------|-----|------|-----------------|------|-------------|
| 1 | Mode | RW | num | 0=Monostable 1=Bistable 2=Locked |  | Returns the selected mode of button action: 0 – monostable, 1 – bistable, 2 – locked |
| 2 | HoldDelay | RW | num | 100-5000, def=1000 | ms | Time in milliseconds after which, when pressing and holding a button, the OnHold event oc… |
| 3 | HoldInterval | RW | num | 100-2000, def=100 | ms | Cyclical interval in milliseconds after which, when pressing and holding a button, the On… |
| 0 | Value | R | num |  | bool | Returns input state as 0 or 1 |
| 4 | Label | RW | str | 0-15, def= | string | The text that describes the button |
| 5 | IconA | RW | str | 0-9, def= | string | The file name of the icon assigned to the button in monostable and bistable mode in the O… |
| 6 | IconB | RW | str | 0-9, def= | string | The file name of the icon assigned to the button in bistable mode in the ON position. The… |

**Methods:**

| Call | Index | Name | Params | Description |
|------|-------|------|--------|-------------|
| set | 1 | SetMode | Mode | Sets mode of button action (0 - monostable, 1 - bistable, 2 - locked) |
| set | 2 | SetHoldDelay | HoldDelay | Sets HoldDelay value |
| set | 3 | SetHoldInterval | HoldInterval | Sets HoldInterval value |
| execute | 3 | SetLabel | Text(0-15) | Sets Label value |
| execute | 4 | SetIconA | Filename[.bmp](0-9) | Sets IconA BMP Filename |
| execute | 5 | SetIconB | Filename[.bmp](0-9) | Sets IconB BMP Filename |
| execute | 0 | ShowOK |  | Causes the green diode on the button to flash for 2 seconds (frequency 500 ms). The red d… |
| execute | 0 | ShowError |  | Causes the red diode on the button to flash for 2 seconds (frequency 500 ms). The green d… |
| execute | 1 | LedSwitchOn |  | Activates the green diode on the button |
| execute | 2 | RedLedSwitchOn |  | Activates the red diode on the button |
| execute | 2 | LedSwitchOff |  | Deactivates all the diodes on the button |

**Events:**

| Address | Name | Description |
|---------|------|-------------|
| 0 | OnValueChange | Event occurs when a change in the input state takes place (regardless of the value) |
| 1 | OnSwitchOn | Event occurs when the high state is set at input |
| 2 | OnSwitchOff | Event occurs when the low state is set at input |
| 3 | OnShortPress | Event occurs after pressing the button for 500ms - 2000 ms |
| 4 | OnLongPress | Event occurs after pressing the button for longer then 2000 ms |
| 5 | OnHold | Event occurs for the first time after HoldDelay time passes and then cyclically every Hol… |
| 6 | OnClick | Event occurs after pressing the button for less than 500 ms |

### PANEL (class=29, ×1)

**Features:**

| Index | Name | R/W | Type | Range / Default | Unit | Description |
|-------|------|-----|------|-----------------|------|-------------|
| 4 | GestureIconUp | RW | str | 0-9, def=up | .bmp | The BMP file name of the icon for gesture Up (without extension) |
| 5 | GestureIconDown | RW | str | 0-9, def=down | .bmp | The BMP file name of the icon for gesture Down (without extension) |
| 6 | GestureIconLeft | RW | str | 0-9, def=left | .bmp | The BMP file name of the icon for gesture Left (without extension) |
| 7 | GestureIconRight | RW | str | 0-9, def=right | .bmp | The BMP file name of the icon for gesture Right (without extension) |
| 10 | ProximitySens | RW | num | 2-100, def=5 |  | Sensitivity of the proximity sensor (less value-more sensitivity) |
| 11 | ProximityTimeout | RW | num | 1000-60000, def=5000 | ms | The time after which the display will be blanked |
| 12 | ProximityValue | R | num | - | - | Proximity sensor value (dimensionless value) |
| 13 | BuzzerValue | RW | num | 0=Off 1=On |  | Sound indication control: 0 - Off 1 - On |
| 15 | GestureMode | RW | num | 0=Off 1=Vertical 2=Horizontal 3=Vert+Horiz |  | Selection of gestures orientation: 0 - Off 1 - Vertical 2 - Horizontal 3 - Vert+Horiz |
| 16 | GestureSens | RW | num | 1=Low 2=Mid 3=High |  | Selection of gestures sensitivity: 1 - Low 2 - Mid 3 - High |
| 17 | PageNr | RW | num | def=1 |  | Number of the current page displayed |
| 18 | PageDisplayMode | RW | num | 0=ShowImmediately 1=ShowIconOrName 2=ShowGesture |  | Notification before changing the page: 0 - ShowImmediately 1 - ShowIconOrName 2 - ShowGes… |
| 19 | ButtonsLEDMode | RW | num | 0=LocationLedOFF 1=LocationLedON 2=LocationLedONforActive |  | Buttons location using very low LED light: 0 - LocationLedOFF 1 - LocationLedON 2 - Locat… |
| 20 | PageControlMode | RW | num | 0=Command 1=Gesture/Command |  | The source that switches the pages: 0 - Command (switching using methods SetNextPage and … |
| 21 | GestureDisplayMode | RW | num | 0=Off 1=On |  | Display information about the currently performed gesture: 0 - Off 1 - On |

**Methods:**

| Call | Index | Name | Params | Description |
|------|-------|------|--------|-------------|
| execute | 0 | SwitchOnDisplay |  | Wakes the display from sleep mode |
| execute | 1 | ShowButtons |  | Changes display mode into 'buttons'. Clears the display and shows the icons (or text) for… |
| execute | 2 | ClearScreen |  | Clears the display in 'freedraw' mode |
| execute | 3 | PrintText | x(0-127), y(0-63), txt(0-15), font size(1-3) | Displays the text in 'freedraw' mode using parameters: x, y, txt, font size, where: - x a… |
| execute | 20 | PrintFloat | x(0-127), y(0-63), number(8), precision(0-2), font size(1-3) | Displays the float number in 'freedraw' mode using parameters: x, y, number, precision, f… |
| execute | 4 | DrawLine | x(0-127), y(0-63), xe(0-127), ye(0-63), color(0-1) | Draws the line in 'freedraw' mode using the parameters: x, y, xe, ye, colour, where: - x … |
| execute | 30 | DrawBox | x(0-127), y(0-63), w(1-127), h(1-63), color(0-1) | Draws the filled rectangle in 'freedraw' mode using the parameters: x, y, w, h, colour, w… |
| execute | 5 | DrawPoint | x(0-127), y(0-63), color(0-1) | Draws the point in 'freedraw' mode using the parameters: x, y, colour, where: - x and y a… |
| execute | 6 | DrawIcon | x(0-127), y(0-63), Filename[.bmp](0-9) | Draws the icon (bmp) in 'freedraw' mode using the parameters: x, y, Filename, where: - x … |
| execute | 7 | DisplayContent |  | Displays the memory graphic buffer content. Changes display mode to 'freedraw' |
| set | 4 | SetGestureIconUp | Filename[.bmp](0-9) | Sets the icon for gesture Up |
| set | 5 | SetGestureIconDown | Filename[.bmp](0-9) | Sets the icon for gesture Down |
| set | 6 | SetGestureIconLeft | Filename[.bmp](0-9) | Sets the icon for gesture Left |
| set | 7 | SetGestureIconRight | Filename[.bmp](0-9) | Sets the icon for gesture Right |
| set | 10 | SetProximitySens | ProximitySens(2-100) | Sets the ProximitySens value |
| set | 11 | SetProximityTimeout | ProximityTimeout(1000-60000) | Sets the time value (in seconds) after which the screen saver will activate |
| set | 13 | SetBuzzerValue | BuzzerValue(0-1) | Sound control (On/Off) |
| set | 15 | SetGestureMode | GestureMode(0-3) | Selection of gestures orientation |
| set | 16 | SetGestureSens | GestureSens(1-3) | Selection of gestures' sensitivity |
| execute | 21 | SetBeep | Frequency(30-5700), Duration(1-2000), Volume(0-16), Reserved(0-0) | Generates sound according to frequency [Hz], duration [ms] and volume |
| execute | 22 | SetPageNr | Nr(1-4) | Sets the number of the page to be displayed |
| set | 18 | SetPageDisplayMode | PageDisplayMode | Sets the mode of display notification before changing the page |
| set | 19 | SetButtonsLEDMode | ButtonsLEDMode | Sets the buttons location mode using very low LED light |
| set | 20 | SetPageControlMode | PageControlMode | Sets the source that switches the pages (commands / gestures) |
| set | 21 | SetGestureDisplayMode | GestureDisplayMode | Sets the mode of display information about the currently performed gesture |
| execute | 27 | SetNextPage |  | Force next page to be displayed |
| execute | 28 | SetPrevPage |  | Force previous page to be displayed |
| execute | 29 | Draw |  | Performs OnDraw event when OLED is active |
| execute | 31 | StartCleaningMode | Duration(10-255 s) | Disabling button functions, gestures, and screen refresh during panel cleaning (blocking … |

**Events:**

| Address | Name | Description |
|---------|------|-------------|
| 0 | OnGestureUp | Event occurs after gesture Up |
| 1 | OnGestureDown | Event occurs after gesture Down |
| 2 | OnGestureLeft | Event occurs after gesture Left |
| 3 | OnGestureRight | Event occurs after gesture Right |
| 4 | OnProximityDetect | Event occurs after detection an object in front of the Smart Panel |
| 5 | OnPageChange | Event occurs after page change |
| 6 | OnDisplayOn | Event occurs after display on |
| 7 | OnDisplayOff | Event occurs after display off |

### PANELSENSTEMP (class=20, ×1)

**Features:**

| Index | Name | R/W | Type | Range / Default | Unit | Description |
|-------|------|-----|------|-----------------|------|-------------|
| 1 | Threshold | RW | num | 0-1, def=0.1 | number | Hysteresis size (accuracy 0.1°C) specifying the sensitivity when the following events are… |
| 2 | Sensitivity | RW | num | 0-5000, def=1000 | ms | Period (in ms) for which the sampled values are averaged |
| 6 | Calibration | RW | num | def=0 | °C | Temperature calibration factor within -10°C to +10°C |
| 3 | MinValue | RW | num | 0-45, def=0 | °C | Minimum value of the Value characteristic after exceeding which the OnOutOfRange event is… |
| 4 | MaxValue | RW | num | 0-45, def=45 | °C | Maximum value of the Value characteristic after exceeding which the OnOutOfRange event is… |
| 9 | StatisticState | RW | num | 0=Off 1=On | number | Enables measurement reporting to the statistics module |
| 0 | Value | R | num | 0-45 | °C | Input value: for temperature sensor from 0.0 to 45.0 (°C) |

**Methods:**

_None._

**Events:**

| Address | Name | Description |
|---------|------|-------------|
| 0 | OnValueChange | Event resulting from changing input state |
| 1 | OnValueRise | Event resulting from exceeding the upper threshold of hysteresis |
| 2 | OnValueLower | Event resulting from exceeding the lower threshold of hysteresis |
| 3 | OnOutOfRange | Event resulting from exceeding the specified range (MinValue - MaxValue) |

### PANELSENSLIGHT (class=21, ×1)

**Features:**

| Index | Name | R/W | Type | Range / Default | Unit | Description |
|-------|------|-----|------|-----------------|------|-------------|
| 1 | Threshold | RW | num | 0-100, def=0.5 | number | Hysteresis size (accuracy 0.1%) specifying the sensitivity when the following events are … |
| 2 | Sensitivity | RW | num | 0-5000, def=500 | ms | Period (in ms) for which the sampled values are averaged |
| 3 | MinValue | RW | num | 0-100, def=0 | % | Minimum value of the Value characteristic after exceeding which the OnOutOfRange event is… |
| 4 | MaxValue | RW | num | 0-100, def=100 | % | Maximum value of the Value characteristic after exceeding which the OnOutOfRange event is… |
| 0 | Value | R | num | 0-100 | % | Input value: for light sensor from 0 to 100 % |

**Methods:**

_None._

**Events:**

| Address | Name | Description |
|---------|------|-------------|
| 0 | OnValueChange | Event resulting from changing input state |
| 1 | OnValueRise | Event resulting from exceeding the upper threshold of hysteresis |
| 2 | OnValueLower | Event resulting from exceeding the lower threshold of hysteresis |
| 3 | OnOutOfRange | Event resulting from exceeding the specified range (MinValue - MaxValue) |

### PANEL_PAGE (class=19, ×4)

**Features:**

| Index | Name | R/W | Type | Range / Default | Unit | Description |
|-------|------|-----|------|-----------------|------|-------------|
| 0 | PageType | RW | num | 0=Inactive 1=Buttons 2=Thermostats 3=FreeDraw |  | The type of page displayed on the Smart Panel: 0 - Inactive 1 - Buttons 2 - Thermostats 3… |
| 1 | PageName | RW | str | 0-15, def= | - | Page Name/Icon Name of page displayed on the Smart Panel. Enabled when the PageDisplayMod… |
| 3 | Object_1_Id | RW | str | 0-23, def= | - | ID of the thermostat object (e.g.\: on the local CLU\: THE1325, on the remote CLU\: CLU22… |
| 4 | Object_1_Name | RW | str | 0-15, def= | - | Name of the thermostat displayed on the Smart Panel page (no name - thermostat inactive).… |
| 15 | Object_1_CustomIcon | RW | str | 0-9, def= |  | Sets the custom icon name of the thermostat managed by the Smart Panel pages. An empty pr… |
| 11 | DistributedLogicGroup_1 | RW | num | 0-10000, def=0 |  | Distributed Logic group - broadcast group for distributed logic |
| 5 | Object_2_Id | RW | str | 0-23, def= | - | ID of the thermostat object (e.g.\: on the local CLU\: THE1325, on the remote CLU\: CLU22… |
| 6 | Object_2_Name | RW | str | 0-15, def= | - | Name of the thermostat displayed on the Smart Panel page (no name - thermostat inactive).… |
| 16 | Object_2_CustomIcon | RW | str | 0-9, def= |  | Sets the custom icon name of the thermostat managed by the Smart Panel pages. An empty pr… |
| 12 | DistributedLogicGroup_2 | RW | num | 0-10000, def=0 |  | Distributed Logic group - broadcast group for distributed logic |
| 7 | Object_3_Id | RW | str | 0-23, def= | - | ID of the thermostat object (e.g.\: on the local CLU\: THE1325, on the remote CLU\: CLU22… |
| 8 | Object_3_Name | RW | str | 0-15, def= | - | Name of the thermostat displayed on the Smart Panel page (no name - thermostat inactive).… |
| 17 | Object_3_CustomIcon | RW | str | 0-9, def= |  | Sets the custom icon name of the thermostat managed by the Smart Panel pages. An empty pr… |
| 13 | DistributedLogicGroup_3 | RW | num | 0-10000, def=0 |  | Distributed Logic group - broadcast group for distributed logic |
| 9 | Object_4_Id | RW | str | 0-23, def= | - | ID of the thermostat object (e.g.\: on the local CLU\: THE1325, on the remote CLU\: CLU22… |
| 10 | Object_4_Name | RW | str | 0-15, def= | - | Name of the thermostat displayed on the Smart Panel page (no name - thermostat inactive).… |
| 18 | Object_4_CustomIcon | RW | str | 0-9, def= |  | Sets the custom icon name of the thermostat managed by the Smart Panel pages. An empty pr… |
| 14 | DistributedLogicGroup_4 | RW | num | 0-10000, def=0 |  | Distributed Logic group - broadcast group for distributed logic |

**Methods:**

| Call | Index | Name | Params | Description |
|------|-------|------|--------|-------------|
| set | 0 | SetPageType | PageType | The type of page displayed on the Smart Panel |
| set | 1 | SetPageName | PageName | Sets the page name/icon name of page displayed on the Smart Panel. Enabled when the PageD… |
| set | 3 | SetObject_1_Id | Object_1_Id(0-23) | Sets the ID of the thermostat object (e.g.: on the local CLU: THE1325, on the remote CLU:… |
| set | 4 | SetObject_1_Name | Object_1_Name(0-15) | Sets the name of the thermostat displayed on the Smart Panel page (no name - thermostat i… |
| set | 15 | SetObject_1_CustomIcon | Object_1_CustomIcon(0-9) | Sets the custom icon name of the thermostat managed by the Smart Panel pages. Calling the… |
| set | 5 | SetObject_2_Id | Object_2_Id(0-23) | Sets the ID of the thermostat object (e.g.: on the local CLU: THE1325, on the remote CLU:… |
| set | 6 | SetObject_2_Name | Object_2_Name(0-15) | Sets the name of the thermostat displayed on the Smart Panel page (no name - thermostat i… |
| set | 16 | SetObject_2_CustomIcon | Object_2_CustomIcon(0-9) | Sets the custom icon name of the thermostat managed by the Smart Panel pages. Calling the… |
| set | 7 | SetObject_3_Id | Object_3_Id(0-23) | Sets the ID of the thermostat object (e.g.: on the local CLU: THE1325, on the remote CLU:… |
| set | 8 | SetObject_3_Name | Object_3_Name(0-15) | Sets the name of the thermostat displayed on the Smart Panel page (no name - thermostat i… |
| set | 17 | SetObject_3_CustomIcon | Object_3_CustomIcon(0-9) | Sets the custom icon name of the thermostat managed by the Smart Panel pages. Calling the… |
| set | 9 | SetObject_4_Id | Object_4_Id(0-23) | Sets the ID of the thermostat object (e.g.: on the local CLU: THE1325, on the remote CLU:… |
| set | 10 | SetObject_4_Name | Object_4_Name(0-15) | Sets the name of the thermostat displayed on the Smart Panel page (no name - thermostat i… |
| set | 18 | SetObject_4_CustomIcon | Object_4_CustomIcon(0-9) | Sets the custom icon name of the thermostat managed by the Smart Panel pages. Calling the… |

**Events:**

| Address | Name | Description |
|---------|------|-------------|
| 0 | OnPageOpen | Event occurs after new page is shown |
| 1 | OnPageClose | Event occurs after actual page is closed |
| 2 | OnDraw | Event occurs after freedraw page wants to be redrawn |
| 4 | OnTherm1ModeButtonClick | Event occurs after top-left 'mode' button click in the thermostat no. 1 |
| 5 | OnTherm2ModeButtonClick | Event occurs after top-left 'mode' button click in the thermostat no. 2 |
| 6 | OnTherm3ModeButtonClick | Event occurs after top-left 'mode' button click in the thermostat no. 3 |
| 7 | OnTherm4ModeButtonClick | Event occurs after top-left 'mode' button click in the thermostat no. 4 |

