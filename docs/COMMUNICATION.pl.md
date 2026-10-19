# Przegląd komunikacji systemu Grenton

W systemie Grenton uczestniczą trzy typy urządzeń:

- **CLU** — centralna jednostka logiczna; wykonuje skrypty Lua, posiada jedną magistralę RS485 TFBUS, komunikuje się przez UDP
- **GATE** — uproszczony wariant CLU; wykonuje skrypty Lua, komunikuje się przez UDP, brak magistrali RS485; zamiast niej łączy się z zewnętrznymi systemami (Modbus, HTTP, Z-Wave itp.)
- **OM / Narzędzie** — Object Manager lub narzędzie deweloperskie; zarządza CLU i GATE przez UDP

Dwie niezależne płaszczyzny komunikacji:

- **UDP** — protokół tekstowy (port 1234, AES-128-CBC); używany przez OM, CLU i GATE do wymiany poleceń i stanu przez sieć
- **TFBUS** — zastrzeżony binarny protokół RS485; używany wyłącznie przez CLU do sterowania i odpytywania bezpośrednio podłączonych modułów sprzętowych

```
  ┌──────────────────────────────────────────────────────────────────────────────┐
  │                                SIEĆ IP                                       │
  │                                                                              │
  │  ┌──────────────┐  UDP 1234  ┌──────────┐  UDP 1234  ┌──────────┐           │
  │  │ OM / Narzędzie◄──────────►│  CLU  A  │◄──────────►│  CLU  B  │           │
  │  └──────────────┘  AES/CBC   └──────┬───┘  AES/CBC   └──────┬───┘           │
  │        │                            │                         │              │
  │        │           UDP 1234         │                         │              │
  │        └────────────────────►┌──────┴────┐   UDP 1234  ┌─────┴──────┐      │
  │                               │   GATE    │◄────────────►│   GATE     │      │
  │                               │ (Modbus)  │  AES/CBC    │  (HTTP)    │      │
  │                               └──────┬────┘             └────────────┘      │
  └─────────────────────────────────┬────┼──────────────────────────────────────┘
                                    │    │ Modbus RTU (RS485)
                         RS485      │    └──────────────────────────┐
             ┌───────────┴────────┐ │                   ┌──────────┴──────────┐
             │ Moduły TFBUS (A)   │ │                   │ Urządzenia Modbus   │
             │ przekaźnik ściemn. │ │                   │  zewnętrzne (RS485) │
             └────────────────────┘ │ RS485             └─────────────────────┘
                         ┌──────────┴────────┐
                         │ Moduły TFBUS (B)   │
                         │  roleta  panel ... │
                         └────────────────────┘
```

Każdy CLU posiada dokładnie jedną magistralę RS485. GATE nie ma magistrali RS485. Zarówno CLU jak i GATE używają tego samego protokołu UDP (port 1234, AES/CBC) i tego samego modelu wykonania Lua — GATE to CLU bez TFBUS. Moduły nie są współdzielone między CLU. Zdarzenia z modułów podłączonych do CLU A docierają do CLU B i GATE przez UDP, nie przez TFBUS.

---

## Protokół poleceń UDP

Cały ruch UDP korzysta z **portu 1234/UDP**. Każdy pakiet jest szyfrowany AES-128-CBC. Tekst jawny to ciąg ASCII oddzielany dwukropkami: `prefiks_komendy:pole1:pole2:...`

Dwa style komend:
- **Zarządzanie** (`req_discovery_clu`, `req_set_key`, `req_reset`, …) — jednorazowe pary żądanie/odpowiedź
- **Wykonanie Lua** (`req`/`resp`) — wykonuje dowolne wyrażenie Lua w środowisku CLU lub GATE; używane do sterowania, wywołań między urządzeniami i subskrypcji push

GATE używa tego samego protokołu UDP co CLU. Sekwencja inicjalizacji (discovery, set key, TFTP, reset) jest identyczna dla obu typów urządzeń.

### Sekwencja inicjalizacji OM → CLU/GATE

```
 OM                                          CLU lub GATE
  │── broadcast req_discovery_clu ───────────────►│  znajdź urządzenia w sieci
  │◄── resp_discovery_clu  SN  IV  MAC ───────────│
  │── broadcast req_set_clu_ip  SN  nowy_ip ─────►│  przypisz statyczny IP
  │◄── resp_set_clu_ip  SN  nowy_ip ──────────────│
  │── unicast req_set_key  nowy_klucz ───────────►│  provisionuj klucz AES projektu
  │◄── resp:OK ───────────────────────────────────│
  │── req_start_ftp ─────────────────────────────►│  włącz TFTP (port 69)
  │◄── resp:OK ───────────────────────────────────│
  │═══ TFTP GET: config, pliki LUA ═══════════════│
  │═══ TFTP PUT: nowe pliki LUA ══════════════════│
  │── req_reset:<host_ip> ────────────────────────►│  zastosuj nowe skrypty
  │◄── resp_reset:<device_ip> ────────────────────│
  │── req:...:checkAlive() (poll) ────────────────►│  czekaj na restart
  │◄── resp:...:<sn_hex lub true> ────────────────│  CLU→sn_hex, GATE→true
```

### Wywołania między urządzeniami

CLU i GATE wywołują się nawzajem używając tego samego transportu `req:`/`resp:` — unicast na IP docelowego urządzenia. Obiekt Lua `RemoteCLU` przekazuje wywołania `execute()` tą ścieżką.

Zdarzenia modułów z magistrali CLU B docierają do CLU A i GATE wyłącznie jako powiadomienia UDP — tylko CLU B jest na magistrali RS485. CLU A i GATE otrzymują tylko uproszczone powiadomienie (bez indeksu przycisku ani typu zdarzenia); pełna tożsamość przycisku dostępna tylko dla CLU posiadającego magistralę RS485.

### Subskrypcje push

CLU wysyła zmiany wartości funkcji przez `SYSTEM:clientRegister("ip", port, id, {{NazwaObj, idx_funkcji}, ...})`. Przy każdej zmianie CLU wysyła niezamówione `resp:0.0.0.0:00000000:clientReport:<id>:{wartości...}` na zarejestrowany adres. Domyślny port: 4344.

Pełne układy pakietów, wyprowadzanie kluczy, hash odkrywania i formaty bajtów per komenda: [UDP.md](./UDP.md) · [UDP.pl.md](./UDP.pl.md).

---

## Interfejsy urządzeń

Każde CLU, GATE i moduł sprzętowy posiada towarzyszący **plik XML interfejsu urządzenia**, który deklaruje pełny kontrakt API dla danej wersji firmware. OM dołącza bibliotekę tych plików i używa ich w dwóch celach: do budowania wizualnego edytora projektu oraz do generowania skryptów Lua przesyłanych na urządzenia.

**Co definiuje plik interfejsu**:

| Element | Opis |
|---------|------|
| `feature` | Indeksowana wartość stanu do odczytu/zapisu — nazwa, numeryczny `index`, typ, jednostka, wartości enum, flagi get/set |
| `method` | Indeksowana akcja do wywołania — nazwa, numeryczny `index`, parametry, typ zwracany; `call=set` ustawia wartość cechy, `call=execute` wyzwala akcję |
| `event` | Nazwane zdarzenie z numerycznym `address` (= indeks zdarzenia) — wywoływane przez środowisko uruchomieniowe przy zmianie stanu urządzenia |

**Nazewnictwo plików i klucz wyszukiwania**:
- Interfejsy modułów: `module_<nazwa>_fv<fwType>_<fwApiVer>.xml` — wyszukiwane po `hwType : fwType : fwApiVer` (z SEEK_RESPONSE + VERSION_QUERY)
- Interfejsy CLU/GATE: `clu_<nazwa>_ft<fwType>_fv<fwApiVer>_ht<hwType>_hv<hwVer>.xml` — wyszukiwane po `hwType : hwVer : fwType : fwApiVer`

**Przepływ integracji**:
1. Odkrywanie urządzenia zwraca `hwType`, `hwVer`, `fwType`, `fwApiVer` — OM wyszukuje pasujący plik interfejsu
2. OM prezentuje nazwane cechy, metody i zdarzenia w wizualnym edytorze okablowania
3. Przy wdrożeniu OM generuje `OM.LUA` używając **numerycznych indeksów** z interfejsu — `NazwaObiektu:get(idx)`, `NazwaObiektu:set(idx, val)`, `NazwaObiektu:execute(method_id, args...)`
4. CLU/GATE ładuje `OM.LUA` przy starcie; środowisko Lua mapuje te indeksy na rzeczywistą funkcjonalność urządzenia przez TFBUS lub zewnętrzny protokół GATE

Deweloperzy komunikujący się bezpośrednio z urządzeniem przez komendy UDP `req:` muszą używać tych samych numerycznych indeksów zdefiniowanych w pliku interfejsu.

---

## Środowisko Lua

Cała logika CLU i GATE działa w wbudowanym środowisku Lua 5.x. Skrypty przechowywane są na pamięci flash urządzenia (`a:\`) i ładowane przy starcie:

| Plik | Rola |
|------|------|
| `a:\main.lua` | Główny skrypt — deklaruje wszystkie obiekty i handlery zdarzeń; przy awarii krytycznej zmienia nazwę na `bad_m.lua` |
| `a:\OM.LUA` | Skrypt generowany przez OM — obiekty i okablowanie |
| `a:\USER.LUA` | Skrypt użytkownika |
| `a:\emergncy.lua` | Skrypt awaryjny — uruchamiany zamiast main.lua przy jego krytycznej awarii |
| `a:\settings.usr` | Trwałe wartości funkcji (przeżywają restart) |

**Model obiektowy** — każda encja funkcjonalna (przekaźnik, ściemniacz, integracja GATE itp.) to nazwany obiekt Lua:
- **Funkcje (features)** — indeksowane wartości stanu; odczytywalne i zapisywalne przez Lua lub komendę UDP `req:` (`NazwaObiektu:get(idx)` / `NazwaObiektu:set(idx, val)`)
- **Metody** — indeksowane akcje; wywoływane przez Lua lub `req:` (`NazwaObiektu:execute(method_id, args...)`)
- **Zdarzenia** — wyzwalane przez środowisko uruchomieniowe przy zmianie stanu modułu; handlery to funkcje Lua zarejestrowane w skryptach

**Model wykonania** — każde przychodzące wywołanie UDP `req:` jest wykonywane jako korutyna Lua we współdzielonym środowisku. Środowisko Lua jest jednowątkowe; wywołania wymagające oczekiwania (np. cross-CLU `req:`) zawieszają korutynę do czasu otrzymania odpowiedzi. Pętla periodyczna (~512 ms) obsługuje obiekty Timer i odpytywanie.

**Tryb awaryjny** — jeśli `main.lua` ulega awarii krytycznej, urządzenie zmienia jego nazwę na `bad_m.lua`, ładuje `emergncy.lua` i zwraca `emergency` w odpowiedzi na `checkAlive()`.

---

## TFBUS — protokół modułów RS485

Zobacz szczegółową specyfikację: [TFBUS.md](./TFBUS.md) · [TFBUS.pl.md](./TFBUS.pl.md)

TFBUS 2.0 to half-duplex protokół master/slave na RS485. CLU jest zawsze masterem. Moduły odpowiadają tylko gdy są odpytywane lub sterowane.

### Format ramki na magistrali

```
 Każda ramka (oba kierunki):

  Bajt 0    Bajt 1       Bajt 2       Bajty 3..N-1    Bajt N
 ┌──────┬───────────┬────────────┬─────────────────┬────────┐
 │ 0xAA │ dest_addr │ frame_type │    payload      │  XOR   │
 └──────┴───────────┴────────────┴─────────────────┴────────┘
  start   adres RS485  ID komendy   0–29 bajtów      suma kontr.
```

- `dest_addr`: moduły używają `1–48`; `0xFF` = broadcast; `0x00` = CLU (używane w odpowiedziach modułów)
- `XOR`: XOR wszystkich bajtów łącznie z `0xAA`
- Brak jawnego pola długości — odbiorca skanuje w poszukiwaniu poprawnego CRC przy każdej możliwej długości

### Grupy typów ramek

| Zakres | Kategoria | Opis |
|--------|-----------|------|
| `0x00–0x0F` | Uniwersalne | Odkrywanie, przypisywanie adresów, reset, status poll — działają z dowolnym modułem |
| `0x10–0x28` | Specyficzne dla klasy | ID klasy obiektu CLU; ładunek zależy od typu modułu |
| `0x30+` | Ramki komend | MODULE_CMD (`0xF0`), TFBUS_CMD (`0x31`), provisioning, zapytanie o wersję |

### Standardowy ACK

Większość komend (SEEK, ADDR_ASSIGN, MODULE_CMD) jest potwierdzana przez:
```
AA 00 01 AB
```
Adres docelowy `0x00` oznacza "do CLU"; długość 4 bajty.

### Cykl runtime CLU–moduł

```
 CLU                                    Moduł (addr N)
  │                                          │
  │── AA N 04 CRC ───────────────────────────►│  STATUS_POLL (unicast)
  │◄── AA 00 len [ładunek TLV] CRC ───────────│  bieżący stan (rekordy TLV)
  │                                          │
  │── AA N F0 plen count [rekordy TLV] CRC ──►│  MODULE_CMD (sterowanie/config)
  │◄── AA 00 01 AB ───────────────────────────│  ACK
  │                                          │
  │   (powtórz dla każdego modułu w przestrzeni adresowej)
```

CLU odpytuje moduły sekwencyjnie, typowo co ~780 ms na moduł. Między pollami wysyła ramki MODULE_CMD, aby zastosować zmiany stanu żądane przez środowisko Lua.

### Odkrywanie modułów i przypisywanie adresów

Przy starcie lub resecie CLU dynamicznie przypisuje adresy RS485 według numerów seryjnych:

```
 CLU                                    Wszystkie moduły (broadcast)
  │                                          │
  │── AA FF 07 CRC ──────────────────────────►│  RESET broadcast
  │── AA FF 2A CRC ──────────────────────────►│  SEEK broadcast
  │◄── AA 00 01 AB (×N) ──────────────────────│  wszystkie moduły ACK
  │                                          │
  │  dla każdego znanego modułu (SN z konfigu):│
  │── AA FF 02 SN[4 LE] CH CRC ─────────────►│  ADDR_ASSIGN (SN + kanał)
  │◄── AA 00 01 AB ───────────────────────────│  tylko pasujący moduł ACK
  │                                          │
  │── AA <przypisany_addr> 04 CRC ───────────►│  STATUS_POLL rozpoczyna się
  │── AA <przypisany_addr> F9 CRC ───────────►│  VERSION_QUERY
  │◄── AA 00 [type hw fw] CRC ────────────────│  odpowiedź z wersją
  │                                          │
  │  sekwencje init specyficzne dla modułu...│
```

### Format podrekordu TLV (dwukierunkowy)

Zarówno odpowiedzi STATUS_POLL (moduł → CLU) jak i ładunki MODULE_CMD (CLU → moduł) używają tej samej struktury TLV:

```
 Każdy podrekord:
 ┌──────┬─────┬──────┬────────────────┐
 │ type │ len │ meta │  data[len]     │
 │  1B  │ 1B  │  1B  │  zmienna       │
 └──────┴─────┴──────┴────────────────┘
   co    rozmiar  kontekst  bajty ładunku
```

`meta` kwalifikuje rekord: `0x00` = brak kwalifikatora / kanał 0, `0x01` = główny, `0x10` = czujnik.

### Kluczowe typy TLV

| type | Kierunek | Nazwa | Opis |
|------|----------|-------|------|
| `0x01` | RX | Stan/wyjście | Aktywny (`0x01`) lub bezczynny (`0x00`) |
| `0x02` | RX | Temperatura | LE uint16, 0.01°C |
| `0x08` | RX | Zdarzenie przycisku | `val = btn_idx×7 + event_id` |
| `0x16` | RX/TX | Pozycja rolety | `instancja, pos%, flagi` |
| `0x08` | TX | ACTIVATE | Włącz wyjście na skonfigurowanym poziomie |
| `0x09` | TX | DEACTIVATE | Wyłącz wyjście / zatrzymaj silnik |
| `0x0c` | TX | DIMMER_SET_VALUE | LE u16, skala 0–1000 |
| `0x04` | TX | CHANNEL_INIT | Inicjalizuj typ i indeks kanału |

### Ramki class-update (`0x10–0x28`)

Gdy stan obiektu Lua ulega zmianie, CLU wysyła ramkę class-update, której bajt type jest równy ID klasy obiektu. Moduł interpretuje ładunek na podstawie generacji swojego firmware:

- **Nowa ścieżka firmware**: ramka TLV z wieloma rekordami
- **Stara ścieżka firmware**: inline ładunek skalarny

Obie ścieżki emitują ten sam bajt type na magistrali.

---

## Szyfrowanie

Ruch UDP używa AES-128-CBC. Ramki RS485 (TFBUS) są plaintext — brak szyfrowania na przewodzie. Ramka PROVISION (`0xFB`) dystrybuuje per-modułowy materiał klucza przez RS485 jako surowe bajty.

| Płaszczyzna | Algorytm | Uwagi |
|-------------|----------|-------|
| UDP (port 1234) | AES-128-CBC | Opakowuje cały pakiet z tekstem jawnym |
| RS485 / TFBUS | brak | Tylko suma kontrolna XOR |

Wyprowadzanie klucza per-urządzenie używa `DEFAULT_IV` XOR-owanego z kluczem prywatnym urządzenia (niejednorodnie: druga połowa 8 bajtów używa odwróconego indeksu). Pełny algorytm derywacji i stałe fabryczne: [UDP.pl.md](./UDP.pl.md).

---

## Powiązane dokumenty

| Dokument | Zawartość |
|----------|-----------|
| [UDP.md](./UDP.md) | Pełny protokół UDP: układ pakietów, wyprowadzanie kluczy, hash odkrywania, formaty bajtów per komenda |
| [UDP.pl.md](./UDP.pl.md) | Polskie tłumaczenie UDP.md |
| [TFBUS.md](./TFBUS.md) | Pełna specyfikacja protokołu TFBUS 2.0: wszystkie typy ramek, rekordy TLV, sekwencje init modułów, przykłady na magistrali |
| [TFBUS.pl.md](./TFBUS.pl.md) | Polskie tłumaczenie TFBUS.md |
