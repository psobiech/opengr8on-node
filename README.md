# opengr8on-node

> **Uwaga / Note:** Dokumentacja i opisy protokołów zawarte w tym repozytorium mogą zawierać błędy, nieścisłości lub domysły. Nie gwarantujemy ich dokładności ani kompletności.
>
> Documentation and protocol descriptions in this repository may contain errors, inaccuracies, or guesswork. No guarantee of accuracy or completeness is provided.

Implementacja protokołu systemu Grenton w Node.js — biblioteka kliencka, wirtualny CLU (vCLU) oraz narzędzia diagnostyczne do magistrali TFBUS.

### O projekcie

[Grenton](https://grenton.com) to system automatyki budynkowej oparty na urządzeniach CLU i GATE komunikujących się przez UDP/IP (protokół UDP, port 1234, szyfrowanie AES-128-CBC). Do fizycznych modułów (przekaźniki, ściemniacze, rolety, panele) CLU podłącza się przez magistralę RS485 (protokół TFBUS).

Ten projekt zawiera:
- **Bibliotekę kliencką UDP** — odkrywanie CLU/GATE, wysyłanie komend, wykonywanie wyrażeń Lua
- **Wirtualny CLU (vCLU)** — implementacja serwera CLU w Node.js;
- **Narzędzia TFBUS** — monitor magistrali RS485 i interaktywny REPL do diagnostyki i sterowania modułami z linii polecen
- **Parser interfejsów urządzeń** — parsowanie plików XML opisujących API modułów i urządzeń CLU/GATE

### Dokumentacja protokołu

| Dokument | Opis |
|----------|------|
| [docs/COMMUNICATION.pl.md](docs/COMMUNICATION.pl.md) | Przegląd systemu: CLU, GATE, UDP, TFBUS, Lua, interfejsy urządzeń |
| [docs/UDP.pl.md](docs/UDP.pl.md) | Protokół UDP: układy pakietów, wyprowadzanie kluczy, hash odkrywania, formaty per komenda |
| [docs/TFBUS.pl.md](docs/TFBUS.pl.md) | Protokół TFBUS 2.0: format ramki, typy TLV, sekwencje inicjalizacji modułów |

Wersje angielskie: [COMMUNICATION.md](docs/COMMUNICATION.md) · [UDP.md](docs/UDP.md) · [TFBUS.md](docs/TFBUS.md)

### Wymagania sprzętowe

Do komunikacji z magistrala TFBUS potrzebny jest np. konwerter USB↔RS485 z **izolacją galwaniczną**.

Przykładowe urządzenie: [KAMOD USB-RS485-ISO](https://kamami.pl/konwertery-rs485/1187349-kamod-usb-rs485-iso-konwerter-usb-rs485-z-izolacja-galwaniczna-5906623433391.html).

Dowolny izolowany konwerter USB-RS485 powinien działać (np. na chipie CH340, CP2102, FT232). Port pojawi się jako `/dev/ttyUSBn` (Linux) lub `COMn` (Windows).

### Instalacja

```bash
npm ci
```

### Narzędzie `tfbus-monitor`

Nasłuchuje lub aktywnie skanuje magistralę TFBUS. Domyślnie działa w **trybie pasywnym** — tylko nasłuch, bez transmisji.

```
tfbus-monitor --port /dev/ttyUSB0 [--baud 115200]
              [--dir ./docs/device-interfaces] [--lang pl]
              [--range 1-30]      zakres adresów do skanowania (tryb aktywny)
              [--seek]            wyślij ramkę SEEK przed skanowaniem
              [--reset]           wyślij RESET przed skanowaniem
              [--interval 500]    interwał STATUS_POLL w ms (tryb aktywny)
              [--active]          tryb aktywny: skanuj i odpytuj moduły
              [--omp ./projekt.omp]   wczytaj projekt Grenton (.omp) dla nazw obiektów
              [--clu S/N]   filtruj moduły z konkretnego CLU (numer seryjny)
```

**Tryb pasywny** (domyślny): podłącz się do magistrali i obserwuj ruch — bez żadnej ingerencji w komunikację CLU↔moduł.

**Tryb aktywny** (`--active`): skaner samodzielnie odpytuje moduły STATUS_POLL i VERSION_QUERY w podanym zakresie adresów. Używać tylko gdy CLU jest odłączone lub w celach serwisowych.

Przykład:
```bash
# Nasłuch pasywny z nazwami z projektu
npx tfbus-monitor --port /dev/ttyUSB0 --omp ./runtime/project.omp --lang pl

# Aktywne skanowanie adresów 1–10
npx tfbus-monitor --port /dev/ttyUSB0 --active --range 1-10 --seek
```

### Narzędzie `tfbus-repl`

Interaktywna powłoka do bezpośredniego sterowania modułami TFBUS. Po uruchomieniu wczytuje transkrypt modułów (z pliku .omp lub katalogu interfejsów) i umożliwia sterowanie po nazwie.

```
tfbus-repl --port /dev/ttyUSB0 [--baud 115200]
           [--omp ./projekt.omp] [--clu 221010198]
           [--dir ./docs/device-interfaces] [--lang pl]
           [--my-addr 0xFE]    zwrotny adres TFBUS
```

**Komendy REPL:**

```
list                              — lista wszystkich znanych modułów
info <nazwa|addr>                 — szczegóły modułu + cechy/metody z transkryptu
get <nazwa|addr> [Cecha]          — STATUS_POLL: wszystkie wartości lub jedna cecha
status <nazwa|addr>               — wyślij STATUS_POLL i zdekoduj odpowiedź
version <nazwa|addr>              — wyślij VERSION_QUERY
set <nazwa|addr> <Cecha> <wart>   — ustaw cechę po nazwie z transkryptu
execute <nazwa|addr> <Metoda> [p…]— wywołaj metodę po nazwie z transkryptu
listen [nazwa|addr] [sek=5]       — pasywny nasłuch modułu przez N sekund
busload [sek=10]                  — zmierz obciążenie magistrali RS485 w %
on <nazwa|addr>                   — skrót: ACTIVATE
off <nazwa|addr>                  — skrót: DEACTIVATE
help                              — ta pomoc
exit / quit                       — wyjście
```

Przykład sesji:
```
$ npx tfbus-repl --port /dev/ttyUSB0 --omp ./runtime/project.omp
Opening /dev/ttyUSB0 @ 115200 baud…
tfbus> list
  addr=3  DOUT_Oswietlenie  hwType=1 fwType=3 fwApiVer=1
  addr=7  ROLLER_Roleta1    hwType=7 fwType=2 fwApiVer=2
tfbus> get DOUT_Oswietlenie Value
  Value: 0b00000001
tfbus> on DOUT_Oswietlenie
  execute Switch(0) → addr=3 [DOUT_Oswietlenie]
tfbus> set ROLLER_Roleta1 Position 50
  set Position=50 → addr=7 [ROLLER_Roleta1]
```

### Projekt siostrzany

[opengr8on](https://github.com/psobiech/opengr8on) — implementacja vCLU w Javie, bardziej dojrzała i przetestowana. Jeśli szukasz stabilnej implementacji wirtualnego CLU, zacznij od tamtego projektu.

### Wirtualny CLU (`vclu`)

Implementacja wirtualnego CLU. Port z Javy [psobiech/opengr8on](https://github.com/psobiech/opengr8on) — **port to wczesna wersja, w dużej mierze nieprzetestowana**.

```bash
vclu [interfejs_lub_ip]
```

Katalog roboczy (`runtime/`) musi zawierać:
```
runtime/keys.json             — klucze AES (generowane automatycznie)
runtime/root/a/CONFIG.JSON    — konfiguracja urządzenia (generowana automatycznie)
runtime/root/a/MAIN.LUA       — główny skrypt Lua
runtime/root/a/EMERGNCY.LUA   — skrypt awaryjny
runtime/project.omp           — plik projektu Grenton (opcjonalny)
```

### Licencje

Dokumentacja (katalog `docs/`) jest objęta licencją [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).

Noty katalogowe (datasheets) stanowią własność ich odpowiednich właścicieli.

Pozostały kod źródłowy jest objęty licencją [AGPLv3](LICENSE.txt).

### Zastrzeżenie prawne

Projekt nie jest popierany przez, bezpośrednio powiązany z, utrzymywany, autoryzowany ani sponsorowany przez Grenton Sp. z o.o.

Użycie jakichkolwiek nazw handlowych lub znaków towarowych służy wyłącznie celom identyfikacyjnym i referencyjnym i nie implikuje żadnego związku z właścicielem znaku towarowego ani jego marką produktową.

Wszelkie nazwy produktów, logotypy, marki i inne znaki towarowe lub obrazy wymienione na tej stronie stanowią własność ich odpowiednich właścicieli.

Korzystanie z tego oprogramowania może naruszać warunki gwarancji urządzeń Grenton. Użytkownik ponosi wyłączną odpowiedzialność za ocenę zgodności z warunkami gwarancji producenta przed użyciem tego oprogramowania z urządzeniami objętymi gwarancją.

Oprogramowanie jest dostarczane w stanie „takim, jaki jest" (as-is), bez jakichkolwiek gwarancji, wyraźnych ani dorozumianych, w tym między innymi bez gwarancji przydatności handlowej, przydatności do określonego celu ani nienaruszania praw osób trzecich. O ile wyraźnie nie zaznaczono inaczej, osoba która powiązała utwór z niniejszą adnotacją nie udziela żadnych gwarancji dotyczących tego utworu i zrzeka się odpowiedzialności za wszelkie sposoby jego użycia, w najszerszym zakresie dopuszczalnym przez obowiązujące prawo.


---

Node.js implementation of the Grenton smart-home protocol — UDP client library, virtual CLU (vCLU), and RS485 TFBUS diagnostic tools.

### About

[Grenton](https://grenton.com) is a building automation system built around CLU and GATE devices communicating over UDP/IP (UDP protocol, port 1234, AES-128-CBC). CLUs connect to physical hardware modules (relays, dimmers, roller shutters, panels) over an RS485 bus using the TFBUS protocol.

This project provides:
- **UDP client library** — CLU/GATE discovery, command dispatch, Lua expression execution
- **Virtual CLU (vCLU)** — Node.js CLU server implementation;
- **TFBUS tools** — RS485 bus monitor and interactive REPL for diagnostics and direct module control from the command line
- **Device interface parser** — parses the XML files that describe the API of each CLU/GATE/module firmware version

### Protocol documentation

| Document | Content |
|----------|---------|
| [docs/COMMUNICATION.md](docs/COMMUNICATION.md) | System overview: CLU, GATE, UDP, TFBUS, Lua runtime, device interfaces |
| [docs/UDP.md](docs/UDP.md) | UDP protocol: packet layouts, key derivation, discovery hash, per-command byte formats |
| [docs/TFBUS.md](docs/TFBUS.md) | TFBUS 2.0 wire protocol: frame formats, TLV types, module init sequences |

Polish translations: [COMMUNICATION.pl.md](docs/COMMUNICATION.pl.md) · [UDP.pl.md](docs/UDP.pl.md) · [TFBUS.pl.md](docs/TFBUS.pl.md)

### Hardware requirements

Accessing the TFBUS RS485 bus requires a USB↔RS485 converter with **galvanic isolation**.

Example: [KAMOD USB-RS485-ISO](https://kamami.pl/konwertery-rs485/1187349-kamod-usb-rs485-iso-konwerter-usb-rs485-z-izolacja-galwaniczna-5906623433391.html).

Any isolated USB-RS485 adapter works (CH340, CP2102, FT232-based, etc.). The port appears as `/dev/ttyUSBn` on Linux or `COMn` on Windows.

### Install

```bash
npm ci
```

### `tfbus-monitor`

Listens to or actively scans the TFBUS RS485 bus. Default mode is **passive** — listen only, no transmissions.

```
tfbus-monitor --port /dev/ttyUSB0 [--baud 115200]
              [--dir ./docs/device-interfaces] [--lang pl]
              [--range 1-30]      address range to scan (active mode)
              [--seek]            send SEEK frame before scanning
              [--reset]           send RESET frame before scanning
              [--interval 500]    STATUS_POLL interval in ms (active mode)
              [--active]          active mode: scan and poll modules
              [--omp ./project.omp]  load Grenton project file for object names
              [--clu 221010198]   filter modules from a specific CLU (serial number)
```

**Passive mode** (default): attach to the bus and observe traffic — no interference with ongoing CLU↔module communication.

**Active mode** (`--active`): the tool polls modules itself with STATUS_POLL and VERSION_QUERY over the given address range. Use only when the CLU is disconnected or for service purposes.

Examples:
```bash
# Passive listen with project object names
npx tfbus-monitor --port /dev/ttyUSB0 --omp ./runtime/project.omp --lang en

# Active scan of addresses 1–10
npx tfbus-monitor --port /dev/ttyUSB0 --active --range 1-10 --seek
```

### `tfbus-repl`

Interactive shell for direct TFBUS module control. On startup it loads the module transcript (from an `.omp` file or the interfaces directory) and allows addressing modules by name.

```
tfbus-repl --port /dev/ttyUSB0 [--baud 115200]
           [--omp ./project.omp] [--clu 221010198]
           [--dir ./docs/device-interfaces] [--lang pl]
           [--my-addr 0xFE]    TFBUS return address
```

**REPL commands:**

```
list                              — list all known modules
info <name|addr>                  — module details + transcript features/methods
get <name|addr> [Feature]         — STATUS_POLL: all values, or one named feature
status <name|addr>                — send STATUS_POLL and decode response
version <name|addr>               — send VERSION_QUERY
set <name|addr> <Feature> <value> — set a feature by transcript name
execute <name|addr> <Method> [p…] — execute a method by transcript name
listen [name|addr] [seconds=5]    — passively watch module(s) for N seconds
busload [seconds=10]              — measure RS485 bus utilisation %
on <name|addr>                    — shortcut: ACTIVATE
off <name|addr>                   — shortcut: DEACTIVATE
help                              — this help
exit / quit                       — exit
```

Example session:
```
$ npx tfbus-repl --port /dev/ttyUSB0 --omp ./runtime/project.omp
Opening /dev/ttyUSB0 @ 115200 baud…
tfbus> list
  addr=3  DOUT_Light   hwType=1 fwType=3 fwApiVer=1
  addr=7  ROLLER_Blind hwType=7 fwType=2 fwApiVer=2
tfbus> get DOUT_Light Value
  Value: 0b00000001
tfbus> on DOUT_Light
  execute Switch(0) → addr=3 [DOUT_Light]
tfbus> set ROLLER_Blind Position 50
  set Position=50 → addr=7 [ROLLER_Blind]
```

### Sister project

[opengr8on](https://github.com/psobiech/opengr8on) — Java implementation of vCLU, more mature and better tested. If you need a stable virtual CLU, start there.

### Virtual CLU (`vclu`)

Virtual CLU implementation. Port from Java [psobiech/opengr8on](https://github.com/psobiech/opengr8on) — **port is an early work in progress, largely untested**.

```bash
vclu [interface_or_ip]
```

Working directory (`runtime/`) layout:
```
runtime/keys.json             — AES keys (auto-generated on first run)
runtime/root/a/CONFIG.JSON    — device config (auto-generated on first run)
runtime/root/a/MAIN.LUA       — main Lua script
runtime/root/a/EMERGNCY.LUA   — emergency fallback script
runtime/project.omp           — Grenton project file (optional)
```

### Licenses

Documentation (`docs/` directory) is licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).

Datasheets are owned by their respective owners.

All other code is licensed under [AGPLv3](LICENSE.txt).

### Disclaimer

This project is not endorsed by, directly affiliated with, maintained, authorized, or sponsored by Grenton Sp. z o.o.

The use of any trade name or trademark is for identification and reference purposes only and does not imply any association with the trademark holder of their product brand.

Any product names, logos, brands, and other trademarks or images featured or referred to within this page are the property of their respective trademark holders.

Use of this software may void the warranty of your Grenton devices. It is solely your responsibility to evaluate whether using this software with warranted hardware complies with the manufacturer's warranty terms.

This software is provided "as-is", without warranty of any kind, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose, and non-infringement. Unless expressly stated otherwise, the person who associated a work with this deed makes no warranties about the work, and disclaims liability for all uses of the work, to the fullest extent permitted by applicable law.
