# SMARTPANEL Firmware Update Format

Analysis of `upload/03/03/020c.fw` and siblings (6 variants, 7.0.6.2345).

---

## `.fw` File Structure

```
[0x00–0x23]  36 bytes   GRENTON string header
[0x24–0x43]  32 bytes   Binary metadata header
[0x44–EOF ]  59044 B    ARM Thumb-2 firmware binary (load address 0x00200000)
```

### String Header (36 bytes)

```
GRENTON[<class>-<sub>-<id_lo>-<id_hi>-<major>.<minor>.<patch>.<b_hi><b_lo>   ]
```

Example: `GRENTON[03-03-0c-02-7.0.6.2345   ]`

- `<class>-<sub>` = module family (03-03 for this series)
- `<id_lo>-<id_hi>` = module variant ID, little-endian bytes of a u16 (`0c-02` → 0x020C)
- `<major>.<minor>.<patch>.<build>` = firmware version (`7.0.6.2345`)
- build stored as two hex pairs: 0x17=23, 0x2D=45 → "2345"
- trailing spaces pad field to fixed width; `]` closes at byte 35

### Binary Metadata Header (32 bytes at offset 0x24)

```c
struct grenton_fw_header {
    uint32_t format_ver;    // = 2
    uint16_t hw_class;      // = 3
    uint16_t hw_sub;        // = 3
    uint16_t fw_major;      // = 7
    uint16_t fw_minor;      // = 0
    uint16_t fw_patch;      // = 6
    uint16_t build_hi;      // = 23  (first two decimal digits of build)
    uint16_t build_lo;      // = 45  (last two decimal digits of build)
    uint16_t pad;           // = 0
    uint16_t module_id_lo;  // = 0x0C (low byte of variant ID)
    uint16_t field_0x16;    // = 0x01BC = 444 (purpose unclear)
    uint32_t field_0x18;    // = 0x49004072 (possibly entry checksum)
    uint32_t load_address;  // = 0x00200000 — flash target address
};
```

All fields little-endian.

---

## Six Hardware Variants

All reside in `upload/03/03/`, same firmware version, different compiled binaries:

| Filename | Module ID | Hex |
|----------|-----------|-----|
| `020c.fw` | 0x020C = 524 | id_lo=0x0C |
| `020d.fw` | 0x020D = 525 | id_lo=0x0D |
| `020e.fw` | 0x020E = 526 | id_lo=0x0E |
| `020f.fw` | 0x020F = 527 | id_lo=0x0F |
| `0210.fw` | 0x0210 = 528 | id_lo=0x10 |
| `0211.fw` | 0x0211 = 529 | id_lo=0x11 |

All files: 59,112 bytes total (68-byte GRENTON header + 59,044 bytes payload).  
All have distinct content (different MD5) — genuinely different HW revision builds.

The firmware binary embeds its own upload path as a string (`upload/03/03/020c.fw`),
presumably for OTA identity verification.

---

## Firmware Binary Layout (base 0x00200000)

Load address confirmed by 93 internal pointer references all resolving within
`[0x200000, 0x20E6A4)`.

| Address range | Size | Content |
|---------------|------|---------|
| `0x200000–0x20007B` | 124 B | Minimal vector table: SP=`0x00FCB520`, Reset/NMI=`0x00F71D00` (bootloader, separate partition) |
| `0x20007C–0x20008F` | 20 B | Secondary fields: `0x00417200` (alt entry?), `0xE8` (size?) |
| `0x200090–0x2003FF` | ~880 B | Hardware init code + UI string constants |
| `0x200400–0x203BC3` | ~13 KB | Proportional bitmap font table + glyph data |
| `0x203BC4–0x2087FF` | ~18 KB | Main application (68 functions, Ghidra-detected) |
| `0x208800–0x20E6A3` | ~24 KB | Graphics routines, protocol stack, bootloader state machine |

Font table format (4 bytes per glyph, starting at 0x200470):
```c
struct glyph_entry {
    uint16_t bitmap_offset;  // byte offset into glyph bitmap data
    uint8_t  width_px;       // character pixel width
    uint8_t  top_bearing;    // vertical bearing / baseline offset
};
```
Typical stride: 8 bytes/glyph (8-pixel wide bitmap rows in 1bpp).

---

## CPU / MCU

- ARM Cortex-M **Thumb-2** confirmed (PUSH/POP prologues, BL calls)
- Coprocessor instructions present (CP7 cache maintenance, CP13) → likely **Cortex-M7**
- FMC peripheral writes to `0x48D001xx` → parallel-bus display controller (TFT LCD via FMC)
- Vector table has **no Thumb bit** in reset vector → this binary is an application image;
  bootloader (at `0x00F71D00`) sets VTOR and jumps here

---

## Module Capabilities (firmware-derived)

Strings and code analysis reveal:

### Display / UI
- `Smart Panel` — product name shown at boot
- `Build: <ver>` / `page: <n>` — info overlay
- `PAGE ERROR !` — page fault display
- `free draw` — raw framebuffer mode
- Proportional bitmap font engine (13 KB glyph table)
- BMP file loading (`.bmp` + FAT32 filesystem for assets)
- Color format conversion routines (RGB bit-shift functions)

### Thermostat UI
- `Cool` / `Heat` / `Auto` / `Dsyn` — four HVAC mode labels

### CLU Integration (TFBUS RS485)
- `! NO CLU !` — displayed when TFBUS link absent
- `! TIMEOUT !` — displayed on CLU communication timeout
- `GRENTON` string at `0x2083BE` — used in protocol identification

### Bootloader / OTA
- `IMAGE FOUND` / `BOOTLOADER` / `REQUEST` — bootloader state machine
- `Reset: <reason>` — reset cause displayed
- `Upss! Err: code <n>` — OTA error display
- `Emergency mode` — crash fallback mode
- Self-embedded path string for OTA image verification

---

## OTA Delivery Path

The `.fw` files reside on the **device's SD card** (FAT32 filesystem also used for BMP assets).
At boot the module's bootloader scans the `upload/` tree, selects the correct variant by
matching the embedded path string (`upload/03/03/020c.fw`) against its own hardware
revision, and self-flashes if a newer version is found.

The CLU is **not involved** in this update process — the device is self-updating.
The six variant files coexist on the SD card; the bootloader picks the right one.
