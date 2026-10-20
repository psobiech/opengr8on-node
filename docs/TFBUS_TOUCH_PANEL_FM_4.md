# TFBUS — TOUCH_PANEL_FM_4 Module

**hwType=28, fwType=2** (also hwType=9, fwType=9) — 4-button capacitive touch panel with temp/light sensors and buzzer

Objects: `BUTTON` (class=7) ×4, `PANELSENSTEMP`, `PANELSENSLIGHT`, `PANEL` (buzzer), `PowerSupply`

---

## Init Sequence

1. 4× `SET_OUTPUT [1<<btn, 0, 0]` (LED init=off) + `MODULE_PARAM [0, btn, 0, 0]`
2. `SENSOR_SENSITIVITY` records (2 per sensor: PANELSENSTEMP=0x07, PANELSENSLIGHT=0x08)
3. `SET_MODE [mode]`

Runtime refresh: `SET_MODE` + partial `SENSOR_SENSITIVITY` + `SET_OUTPUT ×4` + `BUTTON_HOLDDELAY`.

### SENSOR_SENSITIVITY (sub-record type=0x00)

data: `[sensor_id(1), threshold×10(1), sensitivity/100ms(1), 0(1)]`

| sensor_id | Sensor |
|-----------|--------|
| `0x07` | PANELSENSTEMP |
| `0x08` | PANELSENSLIGHT |

### SET_MODE values

| mode | Name |
|------|------|
| 0 | Monostable |
| 1 | Bistable |
| 2 | Locked |

---

## STATUS_POLL Response

| Bytes | Pattern | Condition |
|-------|---------|-----------|
| 10 | `02  06 01 01 [state]  02 02 10 [LO HI]` | idle: state + temp |
| 10 | `02  06 01 01 [state]  07 02 10 [LO HI]` | touch event (PANELSENSLIGHT) |
| 10 | `02  06 01 01 [state]  08 02 10 [VAL 00]` | button identity event |

Button identity encoding: `VAL = btn_idx × 7 + event_id` — see TFBUS.md § Button Identity Encoding.
