# Protokół TFBUS

## Przegląd

TFBUS to zastrzeżony protokół magistrali polowej stosowany przez sterowniki Grenton CLU (Central Logic Unit) do komunikacji z peryferyjnymi modułami sprzętowymi przez RS485. Wersja protokołu: **TFBUS 2.0**.

Protokół definiuje:
- Fizyczne ramkowanie RS485 dla bezpośredniej komunikacji CLU–moduł
- Warstwę komend do sterowania modułami (przekaźniki, ściemniacze, rolety, LED, panele)
- Model danych TLV (Type-Length-Value) do dwukierunkowej wymiany statusu i konfiguracji
- Automat stanów wykrywania i przypisywania adresów do automatycznej enumeracji modułów

---

## Architektura

TFBUS działa w jednym kontekście transportowym:

| Warstwa | Transport | Struktura ramki | Cel |
|---------|-----------|----------------|-----|
| RS485 Direct | UART | `{0xAA, addr, type, payload, XOR}` | Wykrywanie, reset, przypisywanie adresów, polling, sterowanie modułami |

Wewnętrzny format kolejki TCP/UDP nie jest widoczny na magistrali. Cała komunikacja RS485 używa standardowego ramkowania opisanego poniżej.

---

## Format ramki RS485

Znaczenie bajtu[2] różni się w zależności od kierunku:

**CLU → moduł (komenda)**:
```
Bajt [0]      = 0xAA           bajt startowy (zawsze)
Bajt [1]      = dest_addr      docelowy adres RS485 (1–48, 0xFF broadcast)
Bajt [2]      = frame_type     ID komendy — patrz tabela typów ramek
Bajt [3..N-1] = payload        0–29 bajtów
Bajt [N]      = XOR_crc        XOR bajtów [0..N-1]
```
Brak jawnego pola długości. Odbiorca używa tabeli typ→długość dla znanych typów ramek; dla nieznanych typów skanuje CRC. Wyjątek: MODULE_CMD (0xF0) zawiera jawny bajt `plen` na pozycji [3] kodujący długość ładunku (plen wlicza siebie).

**Moduł → CLU odpowiedź** (dest_addr = 0x00):
```
Bajt [0]      = 0xAA           bajt startowy
Bajt [1]      = 0x00           adres CLU
Bajt [2]      = payload_len    liczba następujących bajtów ładunku
Bajt [3..N-1] = payload        rekordy TLV
Bajt [N]      = XOR_crc        XOR bajtów [0..N-1]
```
Jawne pole długości na bajcie[2] — skanowanie CRC nie jest potrzebne.

**Przestrzeń adresowa**: moduły używają adresów 1–48; `0xFF` = broadcast; `0x00` = własny adres RS485 CLU.

**Suma kontrolna**: XOR wszystkich bajtów łącznie z bajtem startowym. Skrót dla ramek bez ładunku: `XOR = 0xAA ^ dest_addr ^ type`.

**Standardowy ACK**: `AA 00 01 AB` — wysyłany przez moduły w odpowiedzi na większość komend (SEEK, ADDR_ASSIGN, MODULE_CMD).

---

## Typy ramek

Typy ramek dzielą się na trzy grupy:

- **Uniwersalne (< 0x10)**: działają z dowolnym modułem — wykrywanie, reset, przypisywanie adresów, polling
- **Specyficzne dla klasy (0x10–0x2F)**: bajt typu równa się ID klasy obiektu CLU; ten sam bajt typu niesie różne ładunki do różnych klas modułów
- **Opakowania komend / specjalne (0x30+)**: ustrukturyzowane ramki komend, provisionning, zapytanie o wersję

| Typ | Nazwa            | Rozmiar | Cel     | Ładunek |
|-----|------------------|---------|---------|---------|
| `0x02` | ADDR_ASSIGN      | 9 | 0xFF | `serial_number(u32 LE), channel(u8)` |
| `0x04` | STATUS_POLL      | 4 | unicast | brak |
| `0x07` | RESET            | 4 | dowolny | brak |
| `0x09` | ADDR_CONFIRM     | 5 | unicast | `{0x02}` |
| `0x0A` | ???              | 4 | dowolny | brak |
| `0x0B` | FORCE_GET_STATUS | 4 | 0xFF | brak |
| `0x10`–`0x28` | CLASS_UPDATE     | zmienny | unicast | specyficzny dla klasy; patrz sekcja Klasy |
| `0x2A` | SEEK             | 4 | 0xFF | brak |
| `0xF9` | VERSION_QUERY    | 4 | unicast | brak |
| `0x30` | DISPLAY_BLOCK    | 26 | unicast | `chan(1) sub(1) data[20]` |
| `0x31` | TFBUS_CMD        | 26 | unicast | `cmd(1) data[21]` |
| `0xF0` | MODULE_CMD       | zmienny | unicast | `plen(1) count(1) podrekordy...` |
| `0xFB` | PROVISION        | 25 | 0xFF | `type(1) serial(4) key(16)` |
| `0xFD` | ???              | 7 | 0xFF | `{r4, r5, r6}` |
| `0xFE` | ???              | 7 | 0xFF | `{r4, r5, r6}` |

**Uwaga dot. typu 0x18**: pełni podwójną rolę — sterowanie LED dla modułów SMART_PANEL_FM_4 oraz powiadomienie klasy WAKE_UP dla modułów Z-Wave. Adres docelowy determinuje interpretację.

---

## Ramki specyficzne dla klasy (0x10–0x28)

### Model konceptualny

CLU utrzymuje wewnętrzny model obiektowy, w którym **obiekty** (abstrakcje programowe w środowisku Lua CLU) są mapowane na **moduły** (fizyczne urządzenia RS485). Gdy stan obiektu ulega zmianie, CLU wysyła ramkę class-update na adres RS485 modułu hostującego ten obiekt.

Bajt typu `0x10`–`0x28` = ID klasy obiektu (dziesiętny ID klasy interpretowany jako bajt hex). Moduł docelowy interpretuje ramkę zgodnie z obsługą tej klasy w swoim oprogramowaniu.

**Dwie ścieżki dispatchera** zależnie od generacji oprogramowania modułu:
- **Nowa ścieżka TLV** (nowsze typy firmware): buduje ramkę TLV z wieloma rekordami i kolejkuje do RS485
- **Stara ścieżka bezpośrednia** (starsze typy firmware): buduje ładunek inline i wysyła bezpośrednio

Obie ścieżki emitują ten sam bajt typu na magistrali.

### Mapowanie ID klasy

| ID klasy | Nazwa XML | Ładunek stara ścieżka | TLV rec_type nowa ścieżka |
|---|---|---|---|
| `0x10` (16) | Scheduler | 2B: `[1<<channel, value_lo]` | — |
| `0x11` (17) | GENERIC_ZW_NODE | 1B: `[1<<channel]` lub `[value]` | rec_type=0x08, len=1 |
| `0x12` (18) | Thermostat | 1B: `[1<<channel]` lub `[value]` | rec_type=0x09, len=1 |
| `0x13` (19) | PANEL_PAGE | 5B: `[1<<channel, v0, v1, v2, v3]` (pełne 32-bit) | rec_type=0x0A, len=5 |
| `0x14` (20) | PANELSENSTEMP | 3B: `[1<<channel, v_lo, v_hi]` (16-bit, 0.01°C) | rec_type=0x0C, len=3 |
| `0x15` (21) | PANELSENSLIGHT | 3B: `[1<<channel, v_lo, v_hi]` | rec_type=0x06, len=3 |
| `0x16` (22) | HUMIDITY_SENSOR | 4B: `[chan, lo, mid, hi]` | rec_type=0x00, len=4 |
| `0x17` (23) | ONEW_SENSOR | 3B: `[mask_lo, mask_hi, v_lo]` | rec_type=0x01, len=3 |
| `0x18` (24) | WAKE_UP | 3B: `[mask_lo, mask_hi, v_lo]` | rec_type=0x02, len=3 |
| `0x19` (25) | ZWAVE_BINARY_SENSOR | **brak ramki** | — |
| `0x1A` (26) | BATTERY | 4B: `[v2, v3, v1, v0]` (przestawiona kolejność bajtów) | — |
| `0x1B` (27) | DALI_MASTER | 3B: `[v0, v1, v2]` (dolne 24 bity) | 4× rekordy TLV: każdy `[chan_idx(0-3), byte_of_value]` |
| `0x1C` (28) | *(nieprzypisane w XML)* | 2B: `[v0, v1]` (dolne 16 bitów) | rec_type=0x06, len=5 |
| `0x1D` (29) | PANEL | 3B: `[v0, v1, v2]` (dolne 24 bity) | 1 rekord TLV: `[v_lo, v_hi8, 0]` |
| `0x1E` (30) | PANEL_BUTTON | **pusty ładunek** | — |
| `0x1F` (31) | Push | 20B ze wskaźnika na bufor | — |
| `0x20` (32) | DALI_GEAR | **pusty ładunek** | — |
| `0x21` (33) | RS232_CONTROLLER | **pusty ładunek** | — |
| `0x22` (34) | PRESSURE_SENSOR | **pusty ładunek** | — |
| `0x23` (35) | DALI_GEAR_DT8 | 22B ze wskaźnika na bufor | — |
| `0x24` (36) | AIR_VOC_SENSOR | **pusty ładunek** | — |
| `0x25` (37) | SOUND_SENSOR | 4B: `[v3, v2, v1, v0]` (big-endian 32-bit) | — |
| `0x26` (38) | IR_CONTROLLER | 3B: `[obj_class_byte, v_lo, v_hi]` | — |
| `0x27` (39) | SunriseSunsetCalendar | 3B: `[obj_class_byte, v_lo, v_hi]` | — |
| `0x28` (40) | PresenceSensor | 1B: `[v_lo]` | — |

**Klasy z pustym ładunkiem** (0x1E, 0x20–0x22, 0x24): ramka 4-bajtowa `AA dest type CRC` jest nadal wysyłana do fizycznego modułu. Pełni rolę impulsu synchronizacyjnego lub wyzwalacza aktualizacji.

**Klasy ze wskaźnikiem** (0x1F Push, 0x23 DALI_GEAR_DT8): argument wartości jest wskaźnikiem na bufor danych przygotowany przez wywołującego, nie skalarem.

---

### Przykłady

## Ramka LED_CMD (typ 0x18) — Sterowanie LED SMART_PANEL_FM_4

```
AA  dest  0x18  btn_mask  0x00  cmd_byte  XOR_crc     (7 bajtów łącznie)
```

- `btn_mask`: bit N = przycisk N (indeksowany od 0); wartość = `1 << button_idx`
- drugi bajt ładunku: zawsze `0x00`
- `cmd_byte`: akcja LED

| cmd_byte | Komenda | Efekt |
|----------|---------|-------|
| `0x00` | ShowOK | Zielone mignięcie LED |
| `0x01` | ShowError | Czerwone mignięcie LED |
| `0x02` | LedSwitchOn | LED włączony (stały) |
| `0x04` | LedSwitchOff | LED wyłączony — **nie** `0x03` |
| `0x10` | RedLedSwitchOn | Czerwony LED włączony (stały) |

Przykłady (dest=0x14, przycisk 4 = bit 3 = maska 0x08):
```
ShowOK        aa 14 18 01 00 00 a7   (btn1, mask=0x01)
ShowError     aa 14 18 08 00 01 af   (btn4, mask=0x08)
LedSwitchOn   aa 14 18 08 00 02 ac
LedSwitchOff  aa 14 18 08 00 04 aa
RedLedSwitchOn aa 14 18 08 00 10 be
```

Długość ramki: 7 bajtów. Parser wykrywa przez skanowanie CRC dla długości 7–15.

---

## Ramka TFBUS_CMD (typ 0x31)

Wszystkie ramki TFBUS_CMD mają dokładnie 26 bajtów na magistrali. CLU zawsze wysyła pełny 22-bajtowy ładunek (cmd + 21 bajtów danych, uzupełnionych zerami).

**Format RS485:**
```
AA  dest  0x31  cmd  [dane — do 21 bajtów, uzupełnione zerami do 21]  XOR_crc
```

Parser wykrywa długość ramki przez skanowanie CRC dla długości 5–32.

### Komendy

| cmd | Nazwa | Układ danych |
|-----|-------|--------------|
| `0x00` | CHECK_ALIVE | brak |
| `0x01` | RESP_CHECK_ALIVE | `arg(u32)` |
| `0x03` | RESET | `reset_type(u32)` |
| `0x04` | FORCE_GET_STATUS | brak |
| `0x05` | SEEK_BCAST | `hw_type(u8) fw_type(u8) name[15] null` |
| `0x06` | RGBW_SET | `W(u8) R(u8) G(u8) B(u8) channel_idx(u8)` |
| `0x08` | SEEK_RESPONSE | `hw_type(u8) fw_type(u8) name[15] null` |
| `0x0A` | PRINT_TEXT | `x(u8) y(u8) font(u8) text[16] null 2×0x00` |
| `0x0B` | SET_FEATURE | `feature_id(u8)` |
| `0x0E` | EXEC_METHOD | `method_id(u8)` |
| `0x0F` | BUZZER_BEEP | `freq(u16LE) dur(u16LE) vol(u16LE) reserved(u8) + 14×0x00` |
| `0x12` | ITEM_SENSITIVITY | zmienny; `sensitivity_class(u8)` w buf[0], dane wywołującego w buf[1..] |
| `0x19` | DRAW | 21 bajtów zerowych — zatwierdza bufor wyświetlacza |
| `0x1B` | RGBW_SET_ALT | `a(u8) b(u8) c(u8) d(u8) e(u8)` |

**Zakresy parametrów BUZZER_BEEP**: freq 30–5700 Hz, czas trwania 1–2000 ms, głośność 0–16 (u16 LE), reserved=0.

**PRINT_TEXT**: pole tekstu ma dokładnie 16 bajtów. Po PRINT_TEXT zawsze należy wysłać DRAW (0x19) aby zatwierdzić wyświetlacz.

**Format kolejki wewnętrznej vs. magistrala**:

| Pole | Magistrala RS485 | Wewnętrzna kolejka TCP/UDP |
|------|-----------------|---------------------------|
| Nagłówek | `AA dest 0x31` | `addr 0x31` |
| Pole długości | brak | bajt `payload_len` |
| Bajt odstępu | brak | `0x00` |
| Terminator | XOR CRC | ograniczony długością |

---

## Ramka MODULE_CMD (typ 0xF0)

```
AA  dest  0xF0  plen  count  [podrekordy...]  XOR_crc
```

- `plen`: łączna liczba bajtów ładunku **włącznie** z samym bajtem `plen` (= bajt `count` + bajty podrekordów + 1)
- `count`: liczba podrekordów TLV (1 lub więcej dla komend wsadowych)
- Podrekordy: format TLV — `type(1) len(1) meta(1) data(len bajtów)`

Moduł odpowiada pustym ACK: `AA 00 01 AB`.

Parser wykrywa długość ramki przez skanowanie CRC dla długości 5–15.

**Ramki wielorekordowe**: wiele podrekordów może być wsadowanych w jednej ramce MODULE_CMD (np. 2× CHANNEL_MAP dla kanałów silnika, lub 2× FEATURE_PARAM). `plen` zawsze obejmuje wszystkie podrekordy.

### Typy podrekordów

Ten sam format TLV i kody typów są używane w **obu kierunkach** — odpowiedzi STATUS_POLL (moduł → CLU) oraz ramki MODULE_CMD (CLU → moduł).

| typ | Nazwa | len | meta | dane |
|-----|-------|-----|------|------|
| `0x00` | SENSOR_SENSITIVITY | 4 | 0x00 | `[sensor_id(1), threshold×10(1), sensitivity/100ms(1), 0(1)]`; sensor_id: 0x07=PANELSENSTEMP, 0x08=PANELSENSLIGHT |
| `0x01` | SET_OUTPUT | 3 | 0x00 | `[chan_mask(1), val_lo(1), val_hi(1)]`; przekaźnik: chan_mask=`1<<ch`, val=0=wyłącz; TOUCH_PANEL: chan_mask=`1<<btn`, val[0]=0=inicj. LED wyłącz |
| `0x02` | BUTTON_HOLDDELAY | 3 | 0x01 | `[0x00, delay_lo, delay_hi]`; LE u16 w ms |
| `0x03` | SET_MODE | 1 | 0x01 | `[mode]`; 0=Monostabilny, 1=Bistabilny, 2=Zablokowany |
| `0x04` | CHANNEL_INIT | 3 | 0x00 | `[chan_type(1), chan_idx(1), 0(1)]`; chan_type: 0x00=wejście DIN, 0x16=kanał silnika ROLLER |
| `0x05` | SET_CHANNEL_VALUE | 2 | 0x10 | `[chan_idx(1), value(1)]`; jasność LED_RGBW 0–255; wszystkie 4 kanały RGBW wysyłane jako jedna paczka count=4 |
| `0x06` | SET_RAMP_TIME | 5 | 0x00 | `[0, time_lo, time_hi, 0x00, 0x00]`; LE u16 ms; wysyłać przed SET_CHANNEL_VALUE lub DIMMER_SET_VALUE |
| `0x08` | ACTIVATE | 1 | 0x01 | `[level]`; włącz; level = wartość skonfigurowana w CLU |
| `0x09` | DEACTIVATE | 1 | 0x01 | `[val]`; wyłącz / zatrzymaj; val = stała skonfigurowana w CLU (nie bieżący stan modułu) |
| `0x0b` | CHANNEL_MAP | 2 | 0x00 | `[chan_id(1), obj_type(1)]`; obj_type: 0x00=DIN/silnik, 0x02=przekaźnik/DOUT; roleta: 2 przekaźniki na logiczny kanał (góra=2n-1, dół=2n), wysyłane jako paczka 2-rekordowa |
| `0x0c` | DIMMER_SET_VALUE | 3 | 0x00 | `[0, val_lo, val_hi]`; LE u16, skala 0–1000 (÷1000 = 0.0–1.0, rozdzielczość 0.1%); poprzedzone SET_RAMP_TIME |
| `0x0f` | MODULE_PARAM | 4 | 0x00 | `[0, chan_idx(1), io_dir(1), 0]`; io_dir: 0=wejście, 1=wyjście; wysyłane raz na kanał przy init |
| `0x16` | SET_POSITION | 3 | 0x00 | `[flags(1), channel(1), target%(1)]`; docelowa pozycja rolety 0–100%; **kolejność bajtów różni się od STATUS_POLL RX** |
| `0x17` | FEATURE_PARAM | 4 | 0x00 | `[compact_idx(1), channel(1), val_lo(1), val_hi(1)]`; LE u16; jednostka czasu rolety = 10ms |
| `0x1c` | ROLLER_CHAN_REG | 2 | 0x00 | `[0x00, channel_1based(1)]`; wysyłane na kanał rolety po CHANNEL_INIT + FEATURE_PARAMs |

### Indeks parametrów funkcji ROLLER_SHUTTER (podtyp 0x17)

`compact_idx` to sekwencyjny indeks kompaktowy, **nie** indeks funkcji XML.

| compact_idx | Nazwa funkcji | Jednostka | Opis |
|-------------|--------------|-----------|------|
| 0 | MaxTime | 10ms | Pełny czas otwarcia/zamknięcia |
| 1 | MechanicalOffset | 10ms | Kompensacja rozruchu napędu |
| 2 | BlindsUpMaxTime | 10ms | Czas otwierania (0 = użyj MaxTime) |
| 3 | BlindsDownMaxTime | 10ms | Czas zamykania (0 = użyj MaxTime) |

### Sekwencje protokołu dla modułów

**IO_MODULE_DIN_8** — inicjalizacja 2-fazowa:
- Faza 1 (wyjścia przekaźnikowe, ch 0–7 każdy): `DEACTIVATE` + `MODULE_PARAM [0, ch, 1, 0]`
- Faza 2 (wejścia DIN, ch 0–7 każdy): `CHANNEL_INIT [0x00, ch, 0]` + `MODULE_PARAM [0, ch, 0, 0]`
- Runtime: cykliczne `CHANNEL_INIT` + `CHANNEL_MAP` na kanał wejściowy (malejąco)

**RELAY_DIN_4** — na każdy kanał przekaźnika:
`DEACTIVATE` + `CHANNEL_MAP [ch, 0x02]` + `MODULE_PARAM [0, ch, 1, 0]`
- Runtime: cykliczne `CHANNEL_MAP [ch, 0x02]` dla wszystkich kanałów (malejąco)

**ROLLER_SH_DIN_3** — na każdy logiczny kanał rolety (numerowany od 1):
1. `CHANNEL_INIT [0x16, ch, 0]`
2. `FEATURE_PARAM ×4` (compact_idx 0,2,3 = wartości skonfigurowane; idx 1 = 0)
3. `MODULE_PARAM [0, ch-1, 1, 0]`
4. `ROLLER_CHAN_REG [0, ch]`
- Odświeżanie runtime: 2-rekordowy `CHANNEL_MAP` (para przekaźników góra/dół) + 2-rekordowy `FEATURE_PARAM [idx0,ch]+[idx1,ch,0,0]` + pojedynczy FEATURE_PARAM dla idx 2 i 3 + `CHANNEL_INIT` + `ROLLER_CHAN_REG`

**LED_RGBW_DIN** — jednorazowa inicjalizacja:
1. `SET_RAMP_TIME` (typ=0x06; domyślny ramp=0ms dla RGBW)
2. paczka count=4: `SET_CHANNEL_VALUE [0,R] [1,G] [2,B] [3,W]` (typ=0x05, meta=0x10, wartości 0–255)

**DIMMER_MOSFET_DIN** — sekwencja SetValue:
1. `SET_RAMP_TIME` (typ=0x06; domyślne 500ms)
2. `DIMMER_SET_VALUE` (typ=0x0c; LE u16 skala 0–1000)

**TOUCH_PANEL_FM_4** — inicjalizacja:
1. 4× `SET_OUTPUT [1<<btn, 0, 0]` (inicj. LED=wyłącz) + `MODULE_PARAM [0, btn, 0, 0]`
2. Rekordy `SENSOR_SENSITIVITY` (2 na czujnik: PANELSENSTEMP=0x07, PANELSENSLIGHT=0x08)
3. `SET_MODE [mode]`
- Odświeżanie runtime: SET_MODE + częściowy SENSOR_SENSITIVITY + SET_OUTPUT ×4 + BUTTON_HOLDDELAY

### Przykłady na magistrali

```
light ON:    aa 03 f0  06 01 08 01 01 80  d6    ACTIVATE level=128
light OFF:   aa 03 f0  06 01 09 01 01 80  d7    DEACTIVATE val=128
roller STOP: aa 07 f0  06 01 09 01 01 30  63    DEACTIVATE val=48
setpos 41%:  aa 07 f0  08 01 16 03 00 00 03 29  6b  SET_POSITION ch3 → 41%
```

---

## Format ładunku odpowiedzi STATUS_POLL

CLU odpytuje każdy moduł sekwencyjnie komendą `AA dest 0x04 CRC`. Moduły odpowiadają natychmiast z bieżącym stanem.

### Uniwersalny format TLV

Wszystkie ładunki odpowiedzi STATUS_POLL mają strukturę TLV (wyjątki: 13-bajtowa maska bitowa SMART_PANEL i 18-bajtowa odpowiedź multiканałowa CLU):

```
payload[0]        = count          liczba podrekordów
payload[1..]      = podrekordy     powtórzone count razy

Każdy podrekord:
  type (1 bajt)   identyfikator cechy/właściwości
  len  (1 bajt)   długość danych w bajtach
  meta (1 bajt)   kwalifikator kontekstu
  data (len bajtów)

Łączny rozmiar podrekordu = 3 + len bajtów.
```

Ten sam format TLV jest używany w **obu kierunkach** — odpowiedzi STATUS_POLL (moduł → CLU) i ramki MODULE_CMD (CLU → moduł) — z tymi samymi kodami typów.

### Bajt meta

| meta | Interpretacja |
|------|---------------|
| `0x00` | Brak kwalifikatora / kanał 0 |
| `0x01` | Główny / pierwsza instancja |
| `0x10` | Czujnik / drugorzędny |

### Typy podrekordów

| typ | Nazwa | typowy len | Dane |
|-----|-------|-----------|------|
| `0x00` | Maska wejść | 1 | bit N = cyfrowe wejście N aktywne |
| `0x01` | Stan/wyjście | 1–2 | `0x00`=bezczynny, `0x01`=aktywny; lub wielobajtowy poziom wyjścia |
| `0x02` | Temperatura | 2 | LE uint16, jednostka 0.01°C |
| `0x05` | Licznik pollingu | 3 | `[counter_lo, 0x00, 0x00]` — inkrementowany każdy cykl, zerowany przy resecie CLU |
| `0x06` | Stan cyfrowy | 1 | `0x00`=bezczynny, `0x02`=aktywny |
| `0x07` | Poziom światła / dotyku | 2 | LE uint16, jednostka 0.01% |
| `0x08` | Zdarzenie przycisku | 1–2 | `VAL = btn_idx × 7 + event_id`; końcowe 0x00 |
| `0x16` | Pozycja rolety (RX) | 3 | `instance(u8) pos%(u8) flags(u8)` — instancja numerowana od 1, 0=zatrzymana |

### Potwierdzone wzorce ładunku według typu modułu

Notacja: `count  type len meta [dane]  type len meta [dane]  …`

| Bajty | Wzorzec | Typ modułu |
|-------|---------|------------|
| 0 | — | Brak danych / własny adres CLU |
| 5 | `01  06 01 01 [state]` | Cyfrowy (przekaźnik/DIN), 1 kanał |
| 6 | `01  02 02 10 [LO HI]` | Sam czujnik temperatury |
| 10 | `02  06 01 01 [state]  02 02 10 [LO HI]` | Panel dotykowy: stan + temperatura |
| 10 | `02  06 01 01 [state]  07 02 10 [LO HI]` | Panel dotykowy: zdarzenie dotyku (PANELSENSLIGHT) |
| 10 | `02  06 01 01 [state]  08 02 10 [VAL 00]` | Panel dotykowy: zdarzenie tożsamości przycisku |
| 10 | `02  01 02 10 [s0 s1]  01 01 00 [state]` | Stan wyjść wielokanałowych (przekaźnik/DOUT) |
| 10 | `02  01 02 10 [v0 v1]  00 01 01 [on]` | DIMMER_MOSFET_DIN — poziom ściemniania LE u16 (0–1000) + wł./wył. |
| 13 | *(specjalny — nie TLV; patrz niżej)* | Maska bitowa SMART_PANEL_FM_4 |
| 14 | `03  00 01 01 [inp]  01 01 01 [st]  02 02 10 [LO HI]` | IO_MODULE_DIN_8 |
| 18 | *(specjalny — nie TLV; patrz niżej)* | Wewnętrzny multiканał CLU |
| 23 | `04  01 01 [meta] [st]  16 03 00 [i p f]  16 03 00 …  16 03 00 …` | ROLLER_SH_DIN_3 — 1 stan + 3 kanały rolety |

### Kodowanie tożsamości przycisku (podrekord typ=0x08)

**Kodowanie**: `VAL = btn_idx × 7 + event_id`
- `btn_idx = VAL / 7` (dzielenie całkowite) → który przycisk (indeksowany od 0)
- `event_id = VAL % 7` → typ zdarzenia

| event_id | Nazwa | Opis |
|----------|-------|------|
| 0 | OnChange | stan zmieniony |
| 1 | OnSwitchOn | przycisk wciśnięty |
| 2 | OnSwitchOff | przycisk zwolniony |
| 3 | OnShortPress | krótkie naciśnięcie potwierdzone |
| 4 | OnLongPress | długie naciśnięcie |
| 5 | OnHold | przytrzymanie (powtarzające się) |
| 6 | OnClick | kliknięcie potwierdzone |

Jedno fizyczne naciśnięcie przycisku kolejkuje wiele zdarzeń (OnSwitchOn → OnShortPress → OnClick → OnChange), raportowanych jedno na cykl pollingu (~780ms każde), spływających przez 3–5 cykli.

**Numeracja przycisków**: kolejność wierszami — lewy górny → prawy górny → lewy dolny → prawy dolny = indeksy 0→1→2→3.

### Ładunek IO_MODULE_DIN_8 (14 bajtów)

```
03
  00 01 [meta] [inp_byte]      8 wejść cyfrowych — bit N = wejście N aktywne
  01 01 [meta] [state]         stan wyjścia (0=bezczynny)
  02 02 [meta] [LO] [HI]       temperatura LE uint16 ÷ 100 = °C
```

Przykład: `03 00 01 01 00 01 01 01 00 02 02 10 6c 09`
→ wejścia=0x00 (wszystkie wyłączone), stan=bezczynny, temp=0x096C=2412→**24.12°C**

### Ładunek ROLLER_SH_DIN_3 (23 bajty)

```
04
  01 01 [meta] [state]
  16 03 [meta] [inst] [pos%] [flags]   kanał rolety 0
  16 03 [meta] [inst] [pos%] [flags]   kanał rolety 1
  16 03 [meta] [inst] [pos%] [flags]   kanał rolety 2
```

Pola typ 0x16: `instance(u8)` = indeks kanału numerowany od 1, `pos%(u8)` = 0–100%, `flags(u8)` = flagi ruchu/błędu (0=zatrzymana).

### Ładunek maski bitowej SMART_PANEL_FM_4 (13 bajtów, nie-TLV)

```
bajty[0–1]   LE u16  maska przycisków: bit N = instancja N aktywna
bajty[2–3]   LE u16  maska zbocza: niezerowa przy naciśnięciu, 0 przy zwolnieniu
bajty[4–5]   LE u16  PANELSENSLIGHT (natężenie światła ×100)
bajty[6–7]   LE u16  nieznane
bajty[8–11]          zera
bajt[12]             flaga 0x02
```

### Kodowanie temperatury

Wszystkie wartości temperatury: LE uint16, jednostka = 0.01°C.

```
6a 09  →  0x096A = 2410  →  24.10°C
5e 09  →  0x095E = 2398  →  23.98°C
```

### Zachowanie magistrali wielu CLU

Moduł jest fizycznie podłączony do magistrali RS485 jednego CLU. Pozostałe CLU dowiadują się o zdarzeniach przez **powiadomienie TCP między CLU**, nie przez RS485.

| Magistrala | Widoczne zdarzenia | Tożsamość przycisku |
|------------|-------------------|---------------------|
| Główny CLU (właściciel modułu) | typ=0x07 (dotyk) a następnie typ=0x08 (zdarzenia przycisków, wiele na naciśnięcie) | Pełna: btn_idx + event_id w VAL |
| Wtórny CLU (powiadamiany TCP) | tylko typ=0x07 | Brak — wszystkie przyciski wyglądają identycznie |

---

## Wykrywanie / Przypisywanie adresów

CLU zna numery seryjne wszystkich modułów ze swojej konfiguracji. Wykrywanie przypisuje dynamiczne adresy RS485 do znanych modułów przez dopasowanie numeru seryjnego.

### Sekwencja

```
1. AA FF 07 52                         RESET broadcast (reset wszystkich modułów)
2. AA FF 2A 7F                         SEEK broadcast (moduły wchodzą w tryb akceptacji adresu)
   ← AA 00 01 AB                       wszystkie moduły ACK
3. dla każdego modułu:
   AA FF 02 SN[4 LE] CH CRC           ADDR_ASSIGN broadcast: SN + przypisany kanał
   ← AA 00 01 AB                       pasujący moduł ACK; pozostałe ignorują
4. AA dest 04 CRC                      STATUS_POLL wznawiane na nowych adresach
5. AA dest F9 CRC                      VERSION_QUERY unicast do każdego modułu
   ← AA 00 len hwType hwVer fwApiVer CRC  moduł odpowiada informacją wersji 3–4 bajty
```

Tylko moduł, którego numer seryjny pasuje do ładunku ADDR_ASSIGN, przyjmuje adres. Moduły SMART_PANEL_FM_4 (prefiks SN `0x0f05`) nie odpowiadają na VERSION_QUERY.

### Format odpowiedzi VERSION_QUERY

3–4 bajty: `[hwType, hwVer, fwApiVer]` lub `[hwType, 0x00, 0x00, 0x01]`.

`hwType` identyfikuje rodzinę sprzętową (patrz tabela typów modułów). `hwVer` to bajt rewizji sprzętu. `fwApiVer` to wersja API firmware, używana razem z `fwType` (z SEEK_RESPONSE cmd 0x08) do wyboru definicji interfejsu modułu.

### Automat stanów

| Stan | Akcja | Ramki RS485 |
|------|-------|-------------|
| 0 | Inicjalizacja | `AA FF 07 52` (RESET broadcast) |
| 1 | Ponowny RESET (ponowna próba) | `AA FF 07 52` |
| 2 | Przypisywanie adresów | `AA FF 2A 7F` a następnie `AA FF 02 SN[4] CH CRC` na moduł |
| 3 | Identyfikacja modułów | STATUS_POLL + VERSION_QUERY na moduł |
| 4 | Inicjalizacja sprzętu | Sekwencje inicjalizacji specyficzne dla modułu |

---

## Typy modułów

Krotka tożsamości modułu: `hwType:fwType:fwApiVer`. Wiele wartości fwType może współdzielić jeden hwType.

| hwType | fwType | Nazwa modułu | Hostowane obiekty |
|--------|--------|-------------|-------------------|
| 1 | 0/1/2/3 | DOUTModule | DOUT ×1–4 |
| 2 | 0/1 | DIMMModule | DIMMER ×1 |
| 3 | 1/2 | BUTTModule | BUTTON(class=7) ×8, PANELSENSTEMP, PANELSENSLIGHT |
| 3 | 3 | SMART_PANEL_FM_4 | PANEL_BUTTON(class=30) ×16, PANEL(class=29), PANELSENSTEMP, PANELSENSLIGHT, PANEL_PAGE(class=19) ×4 |
| 4 | 0/1 | LEDRGBmodule | LED ×1 |
| 5 | 0 | GSM | GSM ×1 |
| 7 | 0/1/2 | ROLLER_SH | ROLLER ×1 |
| 8 | 0/1 | ANALOGModule | ANALOG (obsługuje też czujniki 1-Wire) |
| 9 | 8 | TOUCH_PANEL_FM_8 | BUTTON(class=7) ×8 |
| 9 | 9 | TOUCH_PANEL_FM_4 | BUTTON(class=7) ×4, PANELSENSTEMP, PANELSENSLIGHT, PANEL(buzzer), PowerSupply |
| 21 | 2 | RELAY_DIN_4 | RELAY ×4 |
| 22 | 2 | RELAY_DIN_2 | RELAY ×2 |
| 23 | 2 | ROLLER_SH_DIN | ROLLER ×1 |
| 24 | 2 | LED_RGBW_DIN | LED_CHANNEL(class=49) ×4 |
| 25 | 2 | ANALOG_DIN | AnalogOUT(class=13) ×4 |
| 26 | 2 | DIMMER_MOSFET_DIN | DIMM(class=5) ×1 |
| 27 | 2 | TOUCH_PANEL_FM_8 | BUTTON ×8 |
| 28 | 2 | TOUCH_PANEL_FM_4 | BUTTON(class=7) ×4 |
| 29 | 2 | LED_RGBW_FM | LED ×1 |
| 30 | 2 | IO_MODULE_DIN_8 | IO ×8 |
| 31 | 2 | RELAY_FM | RELAY ×1 |
| 32 | 2 | ROLLER_SH_FM | ROLLER ×1 |
| 34 | 2 | RELAY_PLUS_WIFI_FM_2 | RELAY ×2 |
| 35 | 2 | RELAY_WIFI_FM_2 | RELAY ×2 |
| 39 | 2 | DALI_MASTER | master DALI |
| 40 | 8/9 | DALI_GEAR_DT8 / DALI_GEAR | urządzenie DALI |
| 41 | 2 | ROLLER_SH_WIFI_FM | ROLLER ×1 |
| 42 | 2 | ROLLER_SH_DIN_3 | ROLLER ×3 |
| 43 | 2 | RS232_CONTROLLER_DIN | RS232 |
| 44 | 2 | DIMMER_MOSFET_FM | DIMMER ×1 |
| 45 | 2 | MULTISENSOR | SENSOR |
| 51 | 2 | DIGITAL_IN_FM | DIN ×1 |
| 52 | 2 | GRENTON_SWITCH_FM | SWITCH ×1 |
| 53 | 2 | ROLLER_SH_DIN_4 | ROLLER ×4 |
| 55 | 2 | DIGITAL_INPUT_MINI_FM | DIN ×1 |

**Uwaga dot. hwType=3**: obejmuje zarówno BUTTModule (fwType=1/2, 8 przycisków, BUTTON class=7) jak i SMART_PANEL_FM_4 (fwType=3, do 16 PANEL_BUTTON, class=30). Rozróżniać przez fwType w krotce tożsamości modułu.

---

## Szyfrowanie

Domyślny klucz fabryczny do komunikacji CLU (AES/CBC):
- Klucz: `<16-bajtowy klucz AES>`
- IV: `<16-bajtowy IV>`

Ramka provisioningu (`0xFB`) zawiera 16 bajtów materiału klucza per-urządzenie w ładunku. Derywacja klucza per-urządzenie: XOR klucza fabrycznego z kluczem prywatnym urządzenia.
