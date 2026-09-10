# xlsx-parser

High-performance XLSX parser in Rust.

## Features

- Streaming ZIP/XML parse into typed workbook structures
- Shared strings, styles, formulas, and sheet data
- Round-trip write path used by the compute engine

## XLSX Calculation Chain Policy

Mog never exports `xl/calcChain.xml`. The calculation chain is an Excel engine
cache, not authoritative workbook state. Import counts an existing calcChain
only for diagnostics; it is not represented in `ParseOutput`, native workbook state, or
package sidecars. Export emits formula cached results from modeled cell values
and preserves modeled workbook calculation settings; omitting calcChain does not
force `fullCalcOnLoad`, `calcCompleted`, or `forceFullCalc` changes.
An imported `calcPr.calcId` is retained only when `CalcIdProvenance` is explicitly
`ImportedCurrent`, still matches the imported value, and has both workbook and
formula-graph generation values populated. The ordinary parse→export path does
not populate those values and therefore emits the canonical `calcId="0"`; this prevents
a stale calculation-engine identifier from being presented as current and is
independent of whether cached formula values are themselves correct.

## Workbook Metadata and Unsupported XML Policy

Typed workbook state (`fileVersion`, `workbookPr`, `bookViews`, `fileSharing`,
`webPublishing`, and `calcPr`) is parsed into the workbook model and regenerated
from that current state. Direct workbook children without a typed owner are
captured by `WorkbookXmlFidelity`: relationship-free inert payloads may be
replayed from their imported bytes under the writer's canonical workbook child
order, while payloads with package relationships are omitted unless an owner
can remap and validate those relationships.

Direct `mc:AlternateContent` is fail-closed because selecting a branch without
an owner can change workbook semantics. This intentionally drops common
`x15ac:absPath` entries, which describe the source machine's save location.
Unknown direct children such as `xr:revisionPtr` are also omitted because they
carry coauthoring or session state that cannot be proven current after Mog
imports or edits. Root `mc:Ignorable` tokens remain attached to declared
extension namespaces; root `mc:ProcessContent` and `mc:MustUnderstand` are
captured for diagnostics but omitted because this writer cannot prove that all
listed extension markup is interpreted and current. All such omissions are
recorded in import diagnostics. A future typed owner may preserve these values
only after validating their current scope; generic raw replay is not a safe
round-trip contract.

## Architecture

Modules are organized as:

- **`domain/`** — OOXML feature parsers (cells, charts, styles, tables, …)
- **`pipeline/`** — parse orchestration (full, lazy, streaming)
- **`infra/`** — XML, ZIP, namespace, and error infrastructure
- **`output/`** — result types and serialization helpers
- **`write/`** — round-trip write path used by the compute engine
- **`zip/`** — ZIP archive reading

Native callers use `parse_xlsx_to_output()` / `parse_xlsx_full_native()`. There
is no WASM or TypeScript entry point in this crate.

## Building

```bash
cargo test -p xlsx-parser
```

## Round-Trip Testing

The `xlsx-roundtrip` CLI tool verifies that XLSX files can be parsed and re-serialized with 100% fidelity.

### Building the CLI Tool

```bash
cargo build -p xlsx-parser --features cli --bin xlsx-roundtrip --release
```

### Usage

```bash
# Single file test
cargo run -p xlsx-parser --features cli --bin xlsx-roundtrip -- file.xlsx

# Verbose mode (show details on differences)
cargo run -p xlsx-parser --features cli --bin xlsx-roundtrip -- file.xlsx -v

# Benchmark mode (multiple iterations)
cargo run -p xlsx-parser --features cli --bin xlsx-roundtrip -- file.xlsx -b -n 20

# Save round-tripped output
cargo run -p xlsx-parser --features cli --bin xlsx-roundtrip -- file.xlsx -o output.xlsx

# Ignore attribute order differences
cargo run -p xlsx-parser --features cli --bin xlsx-roundtrip -- file.xlsx --ignore-order
```

### Convenience Script

A wrapper script is provided for easier testing:

```bash
# Test a single file
./scripts/roundtrip.sh file.xlsx

# Test all xlsx files in a directory
./scripts/roundtrip.sh /path/to/directory/

# Test all fixture files
./scripts/roundtrip.sh --all

# Benchmark mode
./scripts/roundtrip.sh file.xlsx -b
```

### Output Example

```
📄 Input: test.xlsx (6811 bytes)

⏱️  Timing:
  Parse:     13.333µs
  Serialize: 333.834µs
  Compare:   124.125µs
  Total:     483.875µs
  Throughput: 13.42 MB/s

📊 Comparison:
  ✅ Round-trip successful! 10/10 files matched exactly.
```

### Exit Codes

- `0` - Round-trip successful, all files match
- `1` - Differences detected or error occurred

This makes it suitable for CI/CD pipelines to catch regressions.

## Development

```bash
cargo fmt -p xlsx-parser
cargo clippy -p xlsx-parser
```

## Binary Protocol

### Cell Output Buffer

Each cell is stored as a 20-byte record:

| Offset | Size | Field        | Description                                                   |
| ------ | ---- | ------------ | ------------------------------------------------------------- |
| 0      | 4    | row          | Row index (0-based), u32 LE                                   |
| 4      | 4    | col          | Column index (0-based), u32 LE                                |
| 8      | 1    | cell_type    | Type: 0=empty, 1=number, 2=string, 3=bool, 4=error, 5=formula |
| 9      | 2    | style_idx    | Style index, u16 LE                                           |
| 11     | 1    | value_type   | 0=none, 1=inline, 2=shared_string, 3=formula                  |
| 12     | 4    | value_offset | Offset into string buffer, u32 LE                             |
| 16     | 4    | value_len    | Value length in bytes, u32 LE                                 |

### String Output Buffer

Shared strings are stored sequentially:

| Offset | Size | Field    | Description                    |
| ------ | ---- | -------- | ------------------------------ |
| 0      | 4    | count    | Number of strings, u32 LE      |
| 4      | 2    | len_0    | Length of first string, u16 LE |
| 6      | n    | string_0 | First string bytes (UTF-8)     |
| ...    | ...  | ...      | Subsequent strings follow      |

## License

Apache-2.0
