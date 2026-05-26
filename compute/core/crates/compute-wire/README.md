# compute-wire

Binary wire format definitions and serializers for the Rust-to-TypeScript viewport and mutation protocols.

## Overview

`compute-wire` is the **single source of truth** for the binary transfer protocols between the Rust compute engine and the TypeScript renderer. Instead of serializing cell data as JSON (which requires parsing thousands of objects per frame), this crate packs viewport snapshots and mutation deltas into flat `Vec<u8>` blobs that TypeScript reads directly via `DataView` with zero parsing overhead.

The crate provides:

- **Flag bit definitions** -- value type, has\_formula, is\_spill\_member, etc.
- **Wire layout constants** -- header sizes, strides, byte offsets, sentinels
- **Render types** -- `ViewportRenderCell`, `ViewportRenderData`, merge/dimension structs
- **Binary serializers** -- `serialize_viewport_binary()` and `serialize_mutation_result()`
- **FormatPalette** -- append-only format deduplication (intern `CellFormat` to `u16` index)
- **TypeScript codegen** -- `generate-ts` binary emits matching TS constants

All multi-byte values are **little-endian**.

---

## Viewport Binary Protocol

Produced by `serialize_viewport_binary()`. Sent as a `Uint8Array` to the TypeScript renderer on every viewport scroll or recalc.

### Overall Layout

```
 0                                                    total_size
 |                                                         |
 v                                                         v
 [Header 36B][CellRecords N*32B][StringPool][Merges M*16B][RowDims R*12B][ColDims C*12B][FormatPaletteJSON][DataBars D*24B][Icons I*8B][RowPositions R*8B][ColPositions C*8B]
```

### Header (36 bytes)

| Offset | Size | Type | Field               | Description                                      |
|--------|------|------|---------------------|--------------------------------------------------|
| 0      | 4    | u32  | `start_row`         | Top-left row of viewport (zero-based)            |
| 4      | 4    | u32  | `start_col`         | Top-left column of viewport (zero-based)         |
| 8      | 4    | u32  | `cell_count`        | Total cells = `viewport_rows * viewport_cols`    |
| 12     | 4    | u32  | `format_palette_len`| Byte length of the JSON palette at end of buffer |
| 16     | 4    | u32  | `string_pool_bytes` | Byte length of the UTF-8 string pool             |
| 20     | 2    | u16  | `viewport_rows`     | Number of rows in the viewport grid              |
| 22     | 2    | u16  | `viewport_cols`     | Number of columns in the viewport grid           |
| 24     | 2    | u16  | `merge_count`       | Number of merge records                          |
| 26     | 2    | u16  | `row_dim_count`     | Number of row dimension records                  |
| 28     | 2    | u16  | `col_dim_count`     | Number of column dimension records               |
| 30     | 1    | u8   | `flags`             | Bit 0: `is_delta`; bits 4-7: version (currently 0) |
| 31     | 1    | u8   | `generation`        | Monotonic counter for stale-buffer detection     |
| 32     | 2    | u16  | `data_bar_count`    | Number of data bar CF entries                    |
| 34     | 2    | u16  | `icon_count`        | Number of icon CF entries                        |

### Cell Record (32 bytes, naturally aligned)

Cells are stored in **dense row-major order** -- position is implicit from `(index / viewport_cols, index % viewport_cols) + (start_row, start_col)`. There are exactly `cell_count` records.

| Offset | Size | Type | Field                 | Description                                          |
|--------|------|------|-----------------------|------------------------------------------------------|
| 0      | 8    | f64  | `number_value`        | Numeric value for Number/Boolean cells; NaN otherwise |
| 8      | 4    | u32  | `display_off`         | Byte offset into string pool (`0xFFFFFFFF` = none)   |
| 12     | 4    | u32  | `error_off`           | Byte offset into string pool (`0xFFFFFFFF` = none)   |
| 16     | 2    | u16  | `flags`               | Bitfield (see [Flag Bits](#flag-bits) below)         |
| 18     | 2    | u16  | `format_idx`          | Index into the format palette                        |
| 20     | 2    | u16  | `display_len`         | Byte length of display string in pool                |
| 22     | 2    | u16  | `error_len`           | Byte length of error string in pool                  |
| 24     | 4    | u32  | `bg_color_override`   | CF background color (RGBA, 0 = none)                 |
| 28     | 4    | u32  | `font_color_override` | CF font color (RGBA, 0 = none)                       |

### String Pool

Raw UTF-8 bytes, immediately after the cell records. Strings are packed contiguously with no delimiters. Each cell's `display_off`/`display_len` and `error_off`/`error_len` reference byte ranges within this pool. Offsets are relative to the start of the pool (not the buffer).

**Pool starts at**: `HEADER_SIZE + cell_count * CELL_STRIDE` (byte 36 + N*32).

### Merge Records (16 bytes each)

Located after the string pool. Count is `merge_count` from the header.

| Offset | Size | Type | Field       | Description                      |
|--------|------|------|-------------|----------------------------------|
| 0      | 4    | u32  | `start_row` | Top-left row of merged region    |
| 4      | 4    | u32  | `start_col` | Top-left column of merged region |
| 8      | 4    | u32  | `end_row`   | Bottom-right row (inclusive)     |
| 12     | 4    | u32  | `end_col`   | Bottom-right column (inclusive)  |

### Row Dimension Records (12 bytes each)

Located after merge records. Count is `row_dim_count`.

| Offset | Size | Type | Field    | Description                       |
|--------|------|------|----------|-----------------------------------|
| 0      | 4    | u32  | `row`    | Zero-based row index              |
| 4      | 4    | f32  | `height` | Row height in points              |
| 8      | 4    | u32  | `flags`  | Bit 0: `hidden`                   |

### Column Dimension Records (12 bytes each)

Located after row dimension records. Count is `col_dim_count`.

| Offset | Size | Type | Field   | Description                        |
|--------|------|------|---------|--------------------------------------|
| 0      | 4    | u32  | `col`   | Zero-based column index            |
| 4      | 4    | f32  | `width` | Column width in points             |
| 8      | 4    | u32  | `flags` | Bit 0: `hidden`                    |

### Format Palette (JSON tail)

The last `format_palette_len` bytes of the buffer contain a JSON object:

```json
{
  "start_index": 0,
  "formats": [ { "bold": true, ... }, ... ]
}
```

- **Full response** (`is_delta = 0`): `start_index` is 0 and `formats` contains all entries.
- **Delta response** (`is_delta = 1`): `start_index` is N and `formats` contains only entries added since index N. The consumer appends them to its local palette.

### Section Offsets (computed)

```
header_end      = 36
cells_end       = 36 + cell_count * 32
pool_end        = cells_end + string_pool_bytes
merges_end      = pool_end + merge_count * 16
row_dims_end    = merges_end + row_dim_count * 12
col_dims_end    = row_dims_end + col_dim_count * 12
palette_end     = col_dims_end + format_palette_len
data_bars_end   = palette_end + data_bar_count * 24
icons_end       = data_bars_end + icon_count * 8
row_pos_end     = icons_end + row_dim_count * 8
col_pos_end     = row_pos_end + col_dim_count * 8   (== buffer.length)
```

---

## Mutation Binary Protocol

Produced by `serialize_mutation_result()`. Sent after a recalc to patch individual cells in the existing viewport buffer without retransmitting the full grid.

### Overall Layout

```
 [Header 16B][SheetID UTF-8][CellPatches N*40B][StringPool][SpillSection?][PaletteSection?]
```

### Header (16 bytes)

| Offset | Size | Type | Field          | Description                             |
|--------|------|------|----------------|-----------------------------------------|
| 0      | 4    | u32  | `patch_count`  | Number of cell patches                  |
| 4      | 4    | u32  | `string_bytes` | Total bytes in string pool              |
| 8      | 2    | u16  | `sheet_id_len` | Length of sheet ID UTF-8 string         |
| 10     | 1    | u8   | `flags`        | Bit 0: `has_projection_changes`; bit 1: `has_errors`; bit 2: `has_palette` |
| 11     | 1    | u8   | `generation`   | Mutation generation counter             |
| 12     | 4    | u32  | `reserved`     | Reserved for future use (always 0)      |

### Sheet ID (variable length)

Immediately after the header. UTF-8 encoded sheet identifier, `sheet_id_len` bytes long. No null terminator.

### Cell Patches (40 bytes each)

Each patch is a position prefix (8 bytes) followed by the same 32-byte cell record used in the viewport protocol. This allows TypeScript to splice patches directly into the viewport buffer.

| Offset | Size | Type | Field                 | Description                                          |
|--------|------|------|-----------------------|------------------------------------------------------|
| 0      | 4    | u32  | `row`                 | Zero-based row index                                 |
| 4      | 4    | u32  | `col`                 | Zero-based column index                              |
| 8      | 8    | f64  | `number_value`        | Numeric value for Number/Boolean cells; NaN otherwise |
| 16     | 4    | u32  | `display_off`         | Byte offset into string pool (`0xFFFFFFFF` = none)   |
| 20     | 4    | u32  | `error_off`           | Byte offset into string pool (`0xFFFFFFFF` = none)   |
| 24     | 2    | u16  | `flags`               | Bitfield (see [Flag Bits](#flag-bits))               |
| 26     | 2    | u16  | `format_idx`          | Index into the format palette                        |
| 28     | 2    | u16  | `display_len`         | Byte length of display string in pool                |
| 30     | 2    | u16  | `error_len`           | Byte length of error string in pool                  |
| 32     | 4    | u32  | `bg_color_override`   | CF background color (RGBA, 0 = none)                 |
| 36     | 4    | u32  | `font_color_override` | CF font color (RGBA, 0 = none)                       |

### String Pool

Same structure as the viewport string pool. Starts at `HEADER_SIZE + sheet_id_len + patch_count * PATCH_STRIDE`.

### Spill Section (optional)

Present only when header `flags` bit 0 (`has_spill_changes`) is set. Located immediately after the string pool.

| Offset | Size   | Type | Field          | Description                             |
|--------|--------|------|----------------|-----------------------------------------|
| 0      | 4      | u32  | `spill_count`  | Number of spill cell patches            |
| 4      | N * 40 | --   | spill patches  | Same 40-byte format as cell patches     |

Spill cell patches always have the `IS_SPILL_MEMBER` flag (bit 8) set. Their string offsets reference the same string pool as the regular patches.

---

## Flag Bits

The `flags` field is a `u16` bitfield shared by both protocols.

| Bit(s) | Mask     | Constant               | Description                        |
|--------|----------|------------------------|------------------------------------|
| 0-2    | `0x0007` | `VALUE_TYPE_MASK`      | Value type (see below)             |
| 3      | `0x0008` | `HAS_FORMULA`          | Cell contains a formula            |
| 4      | `0x0010` | `HAS_COMMENT`          | Cell has a comment/note            |
| 5      | `0x0020` | `HAS_SPARKLINE`        | Cell contains a sparkline          |
| 6      | `0x0040` | `HAS_HYPERLINK`        | Cell contains a hyperlink          |
| 7      | `0x0080` | `IS_CHECKBOX`          | Cell is rendered as a checkbox     |
| 8      | `0x0100` | `IS_SPILL_MEMBER`      | Cell is a spill array member       |
| 9      | `0x0200` | `HAS_VALIDATION_ERROR` | Cell has a data validation error   |
| 10     | `0x0400` | `HAS_CF_EXTRAS`        | Cell has CF extras (data bar/icon) in trailing sections |
| 11-15  |          |                        | Reserved                           |

### Value Types (bits 0-2)

| Value | Constant           | Meaning              |
|-------|--------------------|----------------------|
| 0     | `VALUE_TYPE_NULL`   | Empty / blank cell   |
| 1     | `VALUE_TYPE_NUMBER` | Numeric value        |
| 2     | `VALUE_TYPE_TEXT`   | String value         |
| 3     | `VALUE_TYPE_BOOL`   | Boolean (TRUE/FALSE) |
| 4     | `VALUE_TYPE_ERROR`  | Error (#DIV/0!, etc) |
| 5-7   |                    | Reserved             |

---

## Constants

All constants are defined in `src/constants.rs`.

| Constant               | Value        | Description                                          |
|------------------------|--------------|------------------------------------------------------|
| `VIEWPORT_HEADER_SIZE` | 36           | Viewport header size (bytes)                         |
| `CELL_STRIDE`          | 32           | Cell record size (bytes)                             |
| `MERGE_STRIDE`         | 16           | Merge record size (bytes)                            |
| `DIM_STRIDE`           | 12           | Row/column dimension record size (bytes)             |
| `NO_STRING`            | `0xFFFFFFFF` | Sentinel: no string in a `u32` offset field          |
| `MUTATION_HEADER_SIZE` | 16           | Mutation header size (bytes)                         |
| `PATCH_STRIDE`         | 40           | Mutation cell patch size (8 position + 32 cell record) |
| `DATA_BAR_ENTRY_STRIDE`| 24           | Data bar CF entry size (bytes)                       |
| `ICON_ENTRY_STRIDE`    | 8            | Icon CF entry size (bytes)                           |
| `POSITION_ENTRY_SIZE`  | 8            | Row/column position entry size (f64, bytes)          |

### Cell Record Byte Offsets

Offsets within each 32-byte cell record (used by both viewport and mutation protocols).

| Constant                  | Value | Field                 |
|---------------------------|-------|-----------------------|
| `OFF_NUMBER_VALUE`        | 0     | `number_value`        |
| `OFF_DISPLAY_OFF`         | 8     | `display_off`         |
| `OFF_ERROR_OFF`           | 12    | `error_off`           |
| `OFF_FLAGS`               | 16    | `flags`               |
| `OFF_FORMAT_IDX`          | 18    | `format_idx`          |
| `OFF_DISPLAY_LEN`         | 20    | `display_len`         |
| `OFF_ERROR_LEN`           | 22    | `error_len`           |
| `OFF_BG_COLOR_OVERRIDE`   | 24    | `bg_color_override`   |
| `OFF_FONT_COLOR_OVERRIDE` | 28    | `font_color_override` |

---

## Code Generation

TypeScript constants are generated from Rust to ensure both sides stay in sync. To regenerate:

```bash
cargo run -p compute-wire --bin generate-ts > kernel/src/bridges/wire/constants.gen.ts
```

The generated file includes all layout constants, byte offsets, flag definitions, and a `ValueType` enum. **Do not edit the generated file manually** -- always regenerate from Rust.

Source: `src/bin/generate_ts.rs`

---

## Format Palette

The `FormatPalette` struct (in `src/palette.rs`) is an append-only interning table that deduplicates `CellFormat` objects. Instead of sending full format objects per cell, each cell carries a `u16` index. The palette itself is serialized as JSON at the tail of the viewport buffer.

- **Intern**: `palette.intern(format) -> u16` -- returns existing index or appends new entry.
- **Delta support**: `palette.formats_since(idx)` -- returns only entries added since `idx`, enabling incremental palette transfer.

Typically a viewport has 5-20 unique formats versus thousands of cells, so the palette provides significant size reduction.

---

## Usage

From `compute-core` or any crate that depends on `compute-wire`:

```rust
use compute_wire::{
    serialize_viewport_binary, serialize_mutation_result,
    FormatPalette, ViewportRenderData, ViewportRenderCell,
    flags, constants,
};

// Build viewport render data (from engine internals)
let data = ViewportRenderData { /* ... */ };
let blob: Vec<u8> = serialize_viewport_binary(&data, generation, is_delta, palette_start);

// Serialize mutation result after recalc
let result = engine.recalc();
let blob: Vec<u8> = serialize_mutation_result(&result, &sheet_id, generation);
```

On the TypeScript side, the blob is received as a `Uint8Array` and read via `DataView`:

```typescript
import { HEADER_SIZE, CELL_STRIDE, OFF_NUMBER_VALUE, OFF_FLAGS } from './constants.gen';

const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
const cellCount = view.getUint32(8, true); // little-endian

for (let i = 0; i < cellCount; i++) {
  const off = HEADER_SIZE + i * CELL_STRIDE;
  const num = view.getFloat64(off + OFF_NUMBER_VALUE, true);
  const flags = view.getUint16(off + OFF_FLAGS, true);
  // ...
}
```

## Cross-Language Test Fixtures

After changing the wire protocol, regenerate the test fixtures consumed by the TS cross-language roundtrip test:

```bash
cargo run -p compute-wire --bin generate-test-fixtures
```

This writes `.bin` + `.json` fixture pairs to `kernel/src/bridges/wire/__tests__/fixtures/`.
The TS test (`cross-language-roundtrip.test.ts`) will fail loudly if fixtures are missing or stale.
