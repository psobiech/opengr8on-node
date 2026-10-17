# Protokół UDP — szczegółowa dokumentacja

Cała komunikacja sieciowa CLU używa **portu 1234/UDP**, szyfrowanego AES-128-CBC. Kontekst systemowy: [COMMUNICATION.pl.md](./COMMUNICATION.pl.md).

---

## Transport i ramkowanie

```
 Datagram UDP (maks. 1472 bajty)
 ┌─────────────────────────────────────────────────────────┐
 │  AES-128-CBC( klucz, IV, tekst_jawny )  — z paddingiem  │
 └─────────────────────────────────────────────────────────┘

 Tekst jawny (po odszyfrowaniu, ASCII z dwukropkami)
 ┌──────────────────┬─────────────────────────────────────┐
 │  prefiks komendy │  :pole1:pole2:...                    │
 └──────────────────┴─────────────────────────────────────┘
```

- Separator: `:` (0x3A)
- Niektóre komendy dołączają `\r\n` (CRLF) jako terminator; parsery go ignorują
- Pola binarne (zaszyfrowane dane, IV, klucz) to surowe bajty inline między separatorami `:` — **nie** są kodowane w hex

---

## Szyfrowanie i klucze

| Faza | Szyfruj przy użyciu | Źródło IV |
|------|---------------------|-----------|
| Broadcast odkrywania | Fabryczny GRENTON_KEY | OWN_IV — 16 losowych bajtów generowanych przez wywołującego |
| Odpowiedź na odkrywanie | Fabryczny GRENTON_KEY | OWN_IV z pasującego żądania odkrywania |
| Unicast po `req_set_key` | Klucz per-urządzenie CLU | Wymieniony podczas `req_set_key` |

**Fabryczny GRENTON_KEY** jest identyczny dla wszystkich urządzeń i znany w czasie kompilacji.

**Domyślny klucz per-urządzenie** wyprowadzany z klucza prywatnego urządzenia (naklejka na CLU):

```
wejście:  DEFAULT_IV (16 bajtów, stałe),  privateKey (8 bajtów)
wyjście:  device_key (16 bajtów)

dla i w [0, 8):   device_key[i]  = DEFAULT_IV[i]  XOR privateKey[i]
dla i w [8, 16):  device_key[i]  = DEFAULT_IV[i]  XOR privateKey[15 - i]
```

Po `req_set_key` CLU przełącza się na klucz dostarczony przez wywołującego dla wszystkich kolejnych wiadomości unicast.

---

## Dokumentacja komend

| Prefiks żądania | Prefiks odpowiedzi | Transport | Opis |
|-----------------|-------------------|-----------|------|
| `req_discovery_clu` | `resp_discovery_clu` | broadcast | Odkryj CLU w sieci; wymień klucze |
| `req_set_clu_ip` | `resp_set_clu_ip` | broadcast | Przypisz statyczny IP do CLU po numerze seryjnym |
| `req_set_key` | `resp:OK` | unicast | Provisionuj nowy klucz AES |
| `req_start_ftp` | `resp:OK` | unicast | Włącz serwer TFTP (port 69) |
| `req_tftp_stop` | — | unicast | Wyłącz serwer TFTP |
| `req_reset` | `resp_reset` | unicast | Restartuj CLU |
| `req` | `resp` | unicast/broadcast | Wykonaj wyrażenie Lua w środowisku CLU |
| `req_gen_measurements` | `meas_file_download` | unicast | Zapisz i udostępnij meas.bin przez TFTP |
| `req_check_alive` | `resp_check_alive` | unicast | Niskopoziomowe sprawdzenie aktywności (nie-Lua) |
| `req_refresh_modules` | `resp_refresh_modules` | unicast | Przeładuj listę modułów |
| `req_refresh_config` | `resp_refresh_config` | unicast | Przeładuj konfigurację CLU |
| `req_diagnostic_pack` | `resp_diagnostic_pack` | unicast | Diagnostyka JSON CLU + modułów |
| `req_start_fw_upgrade` | `resp_fw_upgrade_status` | unicast | Rozpocznij aktualizację OTA firmware |

---

## Odkrywanie — `req_discovery_clu` / `resp_discovery_clu`

Wysyłane jako broadcast UDP na `255.255.255.255:1234`. Wszystkie osiągalne CLU odpowiadają.

**Układ tekstu jawnego żądania** (bajty, po kolei):

```
 [0..31]   encrypted(32)   = AES-128-CBC(GRENTON_KEY, OWN_IV, randomBytes(30))
 [32]      0x3A            ':'
 [33..48]  OWN_IV(16)      wygenerowany przez wywołującego 16-bajtowy IV
 [49]      0x3A            ':'
 [50..]    "req_discovery_clu"
 [..]      0x3A            ':'
 [..]      host_ip         ASCII z kropkami (np. "10.0.0.1")
```

Zewnętrzna koperta AES używa `GRENTON_KEY` + `OWN_IV`.

**Układ tekstu jawnego odpowiedzi**:

```
 [0..31]   encrypted(32)   = AES-128-CBC(device_key, OWN_IV, hash(randomBytes))
 [32]      0x3A            ':'
 [33..48]  CLU_IV(16)      bieżący IV tego CLU (losowany przy każdym resecie)
 [49]      0x3A            ':'
 [50..]    "resp_discovery_clu"
 [..]      0x3A            ':'
 [..]      sn_hex(8)       numer seryjny CLU jako 8 wielkich liter hex (np. "0D123456")
 [..]      0x3A            ':'
 [..]      mac(12)         adres MAC bez separatorów (np. "80AABBCCDDEE")
```

Odpowiedź szyfrowana przy użyciu `GRENTON_KEY` + `OWN_IV` (IV z żądania).

**Hash odkrywania** — weryfikuje, że CLU zna klucz urządzenia:

```
result[0] = (randomBytes[0] XOR randomBytes[29]) & 0xFF
dla i w [1, 30):
    a = result[i-1] % 13
    b = randomBytes[i] % 19
    result[i] = ((a + 1) * (b + 1)) & 0xFF
```

Wywołujący ponownie oblicza `hash(randomBytes)` używając klucza prywatnego urządzenia i porównuje z `encrypted` w odpowiedzi. Zgodność → `CipherType.PROJECT` (CLU ma klucz projektu); niezgodność lub brak klucza prywatnego → `CipherType.NONE`.

---

## Ustawianie IP — `req_set_clu_ip` / `resp_set_clu_ip`

Przypisuje statyczny adres IP. Wysyłane jako broadcast; CLU dopasowuje po numerze seryjnym.

```
req_set_clu_ip:<sn_hex8>:<nowy_ip>:<gateway_ip>
np. req_set_clu_ip:0D123456:192.168.1.50:192.168.1.1

resp_set_clu_ip:<sn_hex8>:<nowy_ip>
np. resp_set_clu_ip:0D123456:192.168.1.50
```

Szyfrowane przy użyciu `GRENTON_KEY` + `OWN_IV` (ten sam IV co żądanie odkrywania).

---

## Ustawianie klucza — `req_set_key` / `resp:OK`

Provisionuje nowy klucz AES. Od tego momentu wywołujący musi używać nowego klucza.

**Układ tekstu jawnego żądania** (bajty):

```
 [0..31]   encrypted(32)   = AES-128-CBC(nowy_klucz, nowy_iv, randomBytes(30))
 [32]      0x3A            ':'
 [33..48]  nowy_iv(16)     16-bajtowy IV dla nowego klucza
 [49]      0x3A            ':'
 [50..]    "req_set_key"
 [..]      0x3A            ':'
 [..]      nowy_klucz(16)  surowe 16 bajtów klucza AES
```

Szyfrowane **bieżącym** kluczem CLU. Łączny tekst jawny: 32 + 1 + 16 + 1 + 11 + 1 + 16 = 78 bajtów.

**Tekst jawny odpowiedzi**: `resp:OK`

---

## Sterowanie TFTP — `req_start_ftp` / `req_tftp_stop`

Włącza lub wyłącza serwer TFTP (port 69). OM wysyła `req_start_ftp` przed każdym transferem pliku.

**Żądanie**: `req_start_ftp` (bez pól) → **Odpowiedź**: `resp:OK`

**Zatrzymanie**: `req_tftp_stop` (brak dokumentowanej odpowiedzi)

---

## Reset — `req_reset` / `resp_reset`

Restartuje CLU; stosuje nowo wgrane skrypty Lua.

```
req_reset:<host_ip>          np. req_reset:10.0.0.5
resp_reset:<clu_ip>          np. resp_reset:192.168.1.50
```

CLU restartuje się po wysłaniu odpowiedzi. Odpytuj `checkAlive()` dopóki CLU nie wróci do trybu online.

---

## Wykonanie Lua — `req` / `resp`

Dowolne wyrażenie Lua w środowisku CLU można wywołać. Obsługiwane jako korutyna Lua.

```
req:<host_ip>:<session_id_hex8>:<wyrażenie_lua>\r\n
resp:<clu_ip>:<session_id_hex8>:<wartość_zwracana>

np. req:10.0.0.5:00003649:checkAlive()
    resp:192.168.1.50:00003649:0D123456
```

- `session_id_hex8`: losowe u32 jako 8 cyfr hex z zerami z lewej (np. `00003649`)
- OM używa 6 znaków; CLU uzupełnia do 8 w odpowiedziach — oba formaty działają
- `wartość_zwracana`: wynik `tostring()` Lua wartości zwracanej, lub `nil` / `true` / `false` / `emergency`

**Warianty `checkAlive()`**:

| Wartość | Znaczenie |
|---------|-----------|
| `<sn_hex>` | CLU — zwraca własny numer seryjny jako hex |
| `true` | Urządzenie GATE |
| `false` | CLU niegotowe |
| `emergency` | CLU lub GATE w trybie awaryjnym (main.lua uległ awarii) |

W ten sposób można wywołać dowolną funkcję Lua zadeklarowaną w skryptach CLU, w tym wywołania między CLU.

---

## Generowanie pomiarów — `req_gen_measurements` / `meas_file_download`

Zapisuje log pomiarów z RAM do `p:\meas.bin` i uruchamia TFTP dla tego pliku.

```
req_gen_measurements:<host_ip>:<session_id_hex8>:<unknown>\r\n
meas_file_download:<clu_ip>:<session_id_hex8>:<ścieżka>

np. req_gen_measurements:10.0.0.5:0000ABCD:0
    meas_file_download:192.168.1.50:0000ABCD:p:\meas.bin
```

Po odebraniu odpowiedzi wykonaj TFTP GET podanej ścieżki. Format: binarny `MEAS05` — 6-bajtowa sygnatura, liczba rekordów, znormalizowane odczyty min/max poboru mocy per moduł.

---

## API Lua SYSTEM — subskrypcje push

CLU wysyła zmiany wartości funkcji na zarejestrowany adres IP:port przy każdej zmianie subskrybowanej funkcji.

```
 Klient                                          CLU
  │── req:...:SYSTEM:clientRegister("ip",port,    │
  │           id,{{NazwaObiektu,idx_funkcji},...}) ►│
  │◄── resp:...:clientReport:<id>:{v0,v1,...} ────│  natychmiastowy snapshot
  │◄── resp:0.0.0.0:00000000:clientReport:<id>:{..}  przy zmianie (sesja=0)
  │── req:...:SYSTEM:clientDestroy("ip",port,id) ►│
  │◄── resp:...:<id> ─────────────────────────────│
```

- Domyślny port push: `4344`
- `id`: liczba całkowita wybrana przez wywołującego, powtarzana w każdym `clientReport`
- `{{NazwaObiektu,idx_funkcji},...}`: tabela Lua par `{nazwa_obiektu, indeks_funkcji}`
- Push niezamówiony używa `resp:0.0.0.0:00000000:clientReport:...` (sesja=0)

| Wywołanie Lua | Opis |
|---------------|------|
| `SYSTEM:clientRegister("ip",port,id,{{obj,feat},...})` | Subskrypcja; CLU wysyła `clientReport` przy każdej zmianie |
| `SYSTEM:clientDestroy("ip",port,id)` | Anulowanie subskrypcji |
| `SYSTEM:mqttRegister(id,topics)` | Subskrypcja przez kanał chmurowy MQTT/AWS IoT |
| `SYSTEM:mqttDestroy(id,topics)` | Anulowanie subskrypcji MQTT |

---

## Wywołania między CLU

Obiekty Lua CLU wywołują zdalne CLU używając tego samego transportu `req:` — unicast na IP zdalnego CLU.

```
 CLU A                                          CLU B
  │── req:<B_ip>:<sesja_hex8>:<wyrażenie_lua> ───►│
  │◄── resp:<B_ip>:<sesja_hex8>:<wartość_zwracana> │
```

Obiekty `RemoteCLU` serializują `OBJECT:execute(method_id, args...)` jako źródło Lua `NazwaObiektu:execute(...)` i wysyłają jako wywołanie `req:`. Wymaga yieldable kontekstu korutyny Lua.

Zdarzenia modułów z CLU B docierają do CLU A wyłącznie jako powiadomienia UDP — CLU A nie jest na magistrali RS485 i nie parsuje ramek TFBUS. W efekcie CLU A otrzymuje tylko uproszczone powiadomienie o zdarzeniu (bez indeksu przycisku ani typu zdarzenia); pełna tożsamość przycisku dostępna tylko dla CLU B, które jest właścicielem magistrali RS485.
