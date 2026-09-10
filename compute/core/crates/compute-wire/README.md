# compute-wire

Render types and binary serialization for explicit viewport snapshots. The
engine's mutation APIs return `MutationResult` directly; this crate handles
viewport data requested by rendering and screenshot consumers.

The crate provides cell flags, byte-layout constants, viewport render types,
format-palette interning and serialization, and conditional-format render data.
All multi-byte values are little-endian.

## Viewport format

`serialize_viewport_binary` writes these sections in order:

| Section | Size |
|---|---:|
| Header | 36 bytes |
| Cell records, in row-major order | 32 bytes per cell |
| UTF-8 string pool | Variable |
| Merges | 16 bytes per merge |
| Row and column dimensions | 12 bytes per dimension |
| Binary format palette | Variable |
| Conditional-format data bars | 24 bytes per entry |
| Conditional-format icons | 8 bytes per entry |
| Row and column pixel positions | 8 bytes per position |

The header contains the viewport origin and dimensions, section counts and
lengths, generation, and flags. Bits 4–7 of the flags byte hold `WIRE_VERSION`,
currently 2. A cell record contains its number value, string offsets and lengths,
flags, format-palette index, and conditional-format color overrides.

The exact offsets and strides are defined in [constants.rs](src/constants.rs).
The serializer and its header documentation are in
[viewport/mod.rs](src/viewport/mod.rs).

## Format palette

`FormatPalette` interns `CellFormat` values into `u16` indexes. Its append-only
entries let viewport deltas transmit only formats added since the previous
snapshot. The palette uses the binary encoding in
[palette_binary](src/palette_binary/mod.rs), including a starting index and
its own string pool.

## Verification

Unit and integration tests cover viewport serialization, palette roundtrips,
conditional formatting, strings, and malformed buffers.
The `test-utils` feature exposes the viewport deserializer for downstream tests.

```sh
cargo test -p compute-wire --locked
cargo bench -p compute-wire --bench wire_bench --locked
```
