# XLSX Parser Test Corpus

This directory contains test files for validating the xlsx-parser's error recovery
and resilience against malformed input files.

## Directory Structure

```
test-corpus/
├── README.md              # This file
├── basic/                 # Valid simple files for baseline testing
├── malformed/             # Intentionally broken files
│   ├── xml/               # Malformed XML (unclosed tags, invalid entities)
│   ├── zip/               # Corrupted ZIP structure
│   ├── cells/             # Invalid cell references, values
│   ├── styles/            # Invalid style indices, formats
│   ├── relationships/     # Missing or broken .rels files
│   ├── truncated/         # Files cut off at various points
│   └── mixed/             # Multiple error types combined
├── edge-cases/            # Unusual but valid files
├── generated/             # Generated test files (from TypeScript scripts)
│   ├── features/          # ECMA-376 feature coverage tests
│   ├── realistic/         # Real-world scenario simulations
│   └── edge-cases/        # Edge case test files
└── validation-report.json # Corpus validation results
```

## Purpose of Each Directory

### `basic/`

Valid, minimal XLSX files used as baseline references. These files should always
parse successfully and are used to verify the parser works correctly before
testing error recovery.

**Expected behavior**: All files parse successfully with no errors.

### `malformed/xml/`

Files containing XML syntax errors:

- Unclosed tags (e.g., `<c>` without `</c>`)
- Invalid XML entities (e.g., `&invalid;`)
- Malformed UTF-8 sequences
- Missing XML declaration
- Invalid attribute syntax

**Expected behavior**: Parser should collect errors and continue parsing
recoverable portions. In Lenient mode, should not panic.

### `malformed/zip/`

Files with corrupted ZIP archive structure:

- Invalid ZIP signature
- Corrupted central directory
- Bad compression method
- CRC checksum mismatches
- Invalid local file headers

**Expected behavior**: Parser should return a meaningful error indicating
the archive is corrupted, not panic or hang.

### `malformed/cells/`

Files with invalid cell data:

- Invalid cell references (e.g., `ZZZZZ99999999`)
- Out-of-range row/column indices
- Invalid cell type markers
- Malformed cell values
- Invalid shared string indices

**Expected behavior**: Parser should skip invalid cells and continue
parsing valid cells. Should collect errors for reporting.

### `malformed/styles/`

Files with invalid style information:

- Invalid style indices in cells
- Malformed number formats
- Invalid font/fill/border references
- Circular style references

**Expected behavior**: Parser should use default styles for cells with
invalid style references and continue parsing.

### `malformed/relationships/`

Files with missing or broken relationship files:

- Missing `_rels/.rels`
- Missing `xl/_rels/workbook.xml.rels`
- Invalid relationship targets
- Circular relationship references

**Expected behavior**: Parser should attempt to locate files by
convention when relationships are missing.

### `malformed/truncated/`

Files cut off at various points during parsing:

- Mid-XML element
- Mid-ZIP entry
- After header but before data
- In the middle of a row or cell

**Expected behavior**: Parser should return partial results for
successfully parsed data and indicate truncation.

### `malformed/mixed/`

Files combining multiple types of errors to test compound error recovery:

- Invalid XML + invalid cells
- Truncated + corrupted ZIP
- Missing relationships + invalid styles

**Expected behavior**: Parser should handle multiple errors gracefully
and recover as much data as possible.

### `edge-cases/`

Unusual but technically valid files:

- Empty worksheets
- Very large cell references (XFD1048576)
- Unicode sheet names
- Very long strings
- Many sheets
- Sparse data (few cells, large range)

**Expected behavior**: All files should parse successfully, though
some may require special handling.

## How to Add New Test Files

### Manual Creation

1. Create a valid XLSX file using Excel, LibreOffice, or the test fixture helpers
2. Modify the file using a hex editor or ZIP tool to introduce specific errors
3. Document the error type in the filename (e.g., `unclosed_cell_tag.xlsx`)
4. Add a comment in this README describing the specific error

### Automated Generation

#### Rust Generator (Malformed Files)

Use the Rust corpus generator to create malformed test files:

```bash
# Generate all malformed test corpus files
cargo run --bin generate_test_corpus --features corpus-gen

# The generator creates files in each category with documented errors
```

#### TypeScript Generators (Feature Coverage)

Use the TypeScript generators for comprehensive feature coverage:

```bash
# Generate all test files (features, realistic, edge-cases)
pnpm corpus:generate

# Generate specific categories
pnpm corpus:generate:features     # ECMA-376 feature coverage tests
pnpm corpus:generate:realistic    # Real-world scenario simulations
pnpm corpus:generate:edge-cases   # Edge case test files

# Validate the entire corpus
pnpm corpus:validate

# Generate and validate in one command
pnpm corpus:all
```

### Generated Test File Categories

#### `generated/features/`

Tests for ECMA-376 feature coverage:

- `basic-data-types.xlsx` - Numbers, strings, booleans, errors, inline strings
- `formulas.xlsx` - Math, aggregation, logical, text, lookup, nested formulas
- `font-styles.xlsx` - Bold, italic, underline, sizes, colors, font families
- `fill-styles.xlsx` - Solid fills with various colors
- `border-styles.xlsx` - Thin, medium, thick, dashed, colored borders
- `number-formats.xlsx` - Currency, percentage, date, time, scientific notation
- `alignment-styles.xlsx` - Horizontal, vertical, wrap text, rotation
- `merged-cells.xlsx` - Horizontal, vertical, block merges
- `frozen-panes.xlsx` - Frozen rows, columns, and both
- `multiple-sheets.xlsx` - Workbook with multiple sheets
- `large-dataset.xlsx` - 1000+ rows of data
- `combined-styles.xlsx` - Multiple formatting features combined

#### `generated/realistic/`

Real-world scenario simulations:

- `financial-budget.xlsx` - Annual budget with income/expense tracking, subtotals
- `sales-report.xlsx` - 500 sales records with auto-filter
- `project-tracker.xlsx` - Task tracker with status colors and progress
- `inventory-system.xlsx` - Product inventory with low-stock highlighting
- `employee-directory.xlsx` - Employee list with formatting and filtering

#### `generated/edge-cases/`

Edge case test files:

- `max-cell-reference.xlsx` - Cell at XFD1048576 (Excel max)
- `unicode-content.xlsx` - Unicode strings in various scripts
- `long-strings.xlsx` - Strings up to 32K characters
- `sparse-data.xlsx` - Few cells in large range
- `many-sheets.xlsx` - Workbook with 100 sheets
- `deep-formulas.xlsx` - Deeply nested formulas
- `special-characters.xlsx` - XML special chars, whitespace, control chars
- `numeric-edge-cases.xlsx` - MAX_VALUE, MIN_VALUE, precision limits
- `empty-variations.xlsx` - Empty cells, sheets, and references
- `merge-edge-cases.xlsx` - Wide merges, tall merges, adjacent merges
- `duplicate-data.xlsx` - Repeated strings and patterns

## Running Tests Against the Corpus

### Run All Corpus Tests

```bash
cargo test --test corpus_tests
```

### Run Specific Categories

```bash
# Test only malformed XML recovery
cargo test --test corpus_tests test_malformed_xml

# Test only truncated file handling
cargo test --test corpus_tests test_truncated

# Test basic valid files
cargo test --test corpus_tests test_basic
```

### Verbose Output

```bash
cargo test --test corpus_tests -- --nocapture
```

## Test File Naming Conventions

- Use descriptive names indicating the type of error
- Include the location/aspect affected in the name
- Use `.xlsx` extension even if the file is corrupted

Examples:

- `unclosed_cell_tag.xlsx` - XML with unclosed `<c>` tag
- `invalid_cell_ref_zzz.xlsx` - Cell with reference "ZZZ99999999"
- `truncated_mid_row.xlsx` - File truncated in the middle of a row element
- `missing_workbook_rels.xlsx` - Missing xl/\_rels/workbook.xml.rels
- `bad_zip_signature.xlsx` - ZIP file with corrupted signature bytes

## Error Recovery Expectations

### Strict Mode

- Returns errors immediately on first malformed content
- Used for validation scenarios where data integrity is critical

### Lenient Mode (Default)

- Collects errors and continues parsing
- Skips malformed elements while preserving valid data
- Returns partial results with error list
- Should never panic on any input

### Recovery Statistics

Tests verify recovery by checking:

1. Parse does not panic
2. Errors are collected and reported
3. Valid data before errors is preserved
4. Error messages are descriptive and actionable

## Contributing

When adding new test files:

1. Document the specific error being tested
2. Ensure the error is reproducible
3. Add corresponding assertions in `corpus_tests.rs`
4. Update this README with any new categories or conventions
