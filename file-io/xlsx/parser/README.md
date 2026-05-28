# @mog/xlsx-parser

High-performance XLSX parser using Rust + WebAssembly with SIMD optimization.

## Performance Target

Parse 500K cells in under 50ms using SIMD-optimized parsing.

## Features

- **SIMD-Accelerated Scanning**: Uses WASM SIMD instructions for byte scanning
- **Zero-Copy String Access**: Shared strings parsed without unnecessary allocations
- **Streaming Architecture**: Pre-allocated buffers for efficient memory usage
- **Pure Rust**: No external dependencies except wasm-bindgen

## XLSX Calculation Chain Policy

Mog never exports `xl/calcChain.xml`. The calculation chain is an Excel engine
cache, not authoritative workbook state. Import counts an existing calcChain
only for diagnostics; it is not represented in `ParseOutput`, Yrs state, or
package sidecars. Export emits formula cached results from modeled cell values
and preserves modeled workbook calculation settings; omitting calcChain does not
force `fullCalcOnLoad`, `calcCompleted`, or `forceFullCalc` changes.

## Architecture

```
xlsx-parser/
  src/
    lib.rs              # WASM entry point and main parse_xlsx function
    scanner.rs          # SIMD-optimized XML byte scanning
    strings.rs          # Shared strings table parser
    lazy.rs             # Lazy parsing for deferred XML processing
    arena.rs            # Arena allocator for efficient memory management
    workbook.rs         # Workbook-level parsing
    styles.rs           # Style definitions parser

    # Shared types between read/write operations
    common/
      mod.rs            # Module exports
      axis.rs           # Row/column axis types
      cond_format.rs    # Conditional formatting shared types
      range.rs          # Cell range utilities

    # Cell parsing submodule
    cell_parser/
      mod.rs            # Module exports
      types.rs          # Cell type definitions
      parsing.rs        # Core cell parsing logic
      helpers.rs        # Parsing helper functions
      recovery.rs       # Error recovery strategies
      adapters.rs       # Format adapters
      tests.rs          # Unit tests

    # Parsing modules (reading XLSX)
    charts/             # Chart parsing (axes, series, types)
    cond_format/        # Conditional formatting parser
    drawings/           # Drawing objects (shapes, images, anchors)
    print/              # Print settings (page setup, headers/footers)
    tables/             # Table definitions (filters, sorting, styles)
    themes/             # Theme parsing (colors, fonts, effects)
    zip/                # ZIP archive handling (decompression, entries)

    # Additional parsing
    comments.rs         # Cell comments
    hyperlinks.rs       # Hyperlink definitions
    names.rs            # Named ranges
    validation.rs       # Data validation rules
    pivot.rs            # Pivot table parsing
    rich_text.rs        # Rich text formatting
    sparklines.rs       # Sparkline charts
    protection.rs       # Sheet/workbook protection
    external.rs         # External references
    vba.rs              # VBA macro handling

    # Writing modules (creating XLSX)
    write/
      mod.rs            # Module exports and writer coordination
      workbook.rs       # Workbook XML writer
      sheet.rs          # Worksheet XML writer
      shared_strings.rs # Shared strings table writer
      relationships.rs  # Relationships writer
      content_types.rs  # Content types writer
      xml_writer.rs     # Low-level XML writing utilities
      zip_writer.rs     # ZIP archive creation

      # Submodule writers
      charts/           # Chart XML writer
      cond_format/      # Conditional formatting writer
      drawings/         # Drawing objects writer
      pivot/            # Pivot table writer (cache, table)
      print/            # Print settings writer
      styles/           # Styles XML writer

      # Additional writers
      comments_writer.rs
      tables_writer.rs
      themes_writer.rs
      validation_writer.rs
      sparklines_writer.rs
      protection_writer.rs

    # TypeScript bindings
    types.ts            # TypeScript type definitions
    index.ts            # TypeScript entry point
    wasm-parser.ts      # WASM module wrapper

  Cargo.toml            # Rust dependencies and WASM configuration
  package.json          # NPM package configuration
```

### Module Organization

The crate follows a **read/write symmetry** pattern:
- **Parsing modules** (`charts/`, `drawings/`, etc.) handle reading XLSX files
- **Write modules** (`write/charts/`, `write/drawings/`, etc.) handle creating XLSX files
- **Common module** (`common/`) contains shared types used by both read and write operations, ensuring type consistency for round-trip parsing

## Building

### Prerequisites

- [Rust](https://rustup.rs/) (1.70+)
- [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/)

### Build Commands

```bash
# Build for web (default)
pnpm build

# Build for development (faster, with debug info)
pnpm build:dev

# Build for bundler (webpack, vite, etc.)
pnpm build:bundler

# Build for Node.js
pnpm build:nodejs
```

## Usage

```typescript
import init, {
  parse_xlsx,
  recommended_cell_buffer_size,
  recommended_string_buffer_size
} from '@mog/xlsx-parser';

// Initialize WASM module
await init();

// Load XLSX file
const xlsxData = new Uint8Array(await file.arrayBuffer());

// Allocate output buffers
const cellBufferSize = recommended_cell_buffer_size(xlsxData.length);
const stringBufferSize = recommended_string_buffer_size(xlsxData.length);

const cellBuffer = new Uint8Array(cellBufferSize);
const stringBuffer = new Uint8Array(stringBufferSize);

// Parse the file
const result = parse_xlsx(xlsxData, cellBuffer, stringBuffer);

if (result.is_ok()) {
  console.log(`Parsed ${result.cell_count} cells in ${result.parse_time_us}us`);
}
```

## Type Definitions

TypeScript types are available in `src/types.ts`:

```typescript
import type { CellUpdate, ParsedWorkbook, ParseOptions } from '@mog/xlsx-parser/types';
```

## Testing

```bash
# Run Rust unit tests
pnpm test

# Run WASM tests in browser
pnpm test:wasm
```

## Round-Trip Testing

The `xlsx-roundtrip` CLI tool verifies that XLSX files can be parsed and re-serialized with 100% fidelity.

### Building the CLI Tool

```bash
# Build for native (not WASM)
cargo build --features cli --bin xlsx-roundtrip --target aarch64-apple-darwin --release
```

### Usage

```bash
# Single file test
./target-native/aarch64-apple-darwin/release/xlsx-roundtrip file.xlsx

# Verbose mode (show details on differences)
./target-native/aarch64-apple-darwin/release/xlsx-roundtrip file.xlsx -v

# Benchmark mode (multiple iterations)
./target-native/aarch64-apple-darwin/release/xlsx-roundtrip file.xlsx -b -n 20

# Save round-tripped output
./target-native/aarch64-apple-darwin/release/xlsx-roundtrip file.xlsx -o output.xlsx

# Ignore attribute order differences
./target-native/aarch64-apple-darwin/release/xlsx-roundtrip file.xlsx --ignore-order
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
# Format code
pnpm fmt

# Lint with clippy
pnpm lint

# Check formatting
pnpm fmt:check
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

MIT
