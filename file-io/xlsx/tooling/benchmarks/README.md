# XLSX Parser Benchmark Suite

Comprehensive benchmark suite for measuring XLSX parser performance.

## Quick Start

```bash
# Generate test files and run all benchmarks
pnpm bench:all

# Or run individual benchmarks
pnpm bench:large      # Large file benchmarks (100K-5M cells)
pnpm bench:features   # Feature-specific benchmarks
pnpm bench:real       # Real-world file benchmarks
pnpm bench:compare    # Generate comparison reports
```

## Benchmark Scripts

### 1. Large File Benchmarks (`large-files.ts`)

Tests parser performance with files of increasing size:

- 100K cells (1000 x 100)
- 500K cells (2500 x 200)
- 1M cells (5000 x 200)
- 5M cells (10000 x 500)

```bash
# Run with default settings
pnpm bench:large

# Generate test files (required on first run)
pnpm bench:large:generate

# Options
npx tsx --expose-gc xlsx-parser/benchmarks/large-files.ts --wasm-only
npx tsx --expose-gc xlsx-parser/benchmarks/large-files.ts --js-only
npx tsx --expose-gc xlsx-parser/benchmarks/large-files.ts --sizes=100k,1m
npx tsx --expose-gc xlsx-parser/benchmarks/large-files.ts --iterations=20
```

### 2. Feature-Specific Benchmarks (`feature-benchmarks.ts`)

Tests impact of different Excel features:

- **Styles**: Files with 100-2000 unique styles
- **Formulas**: Files with formula-heavy cells
- **Rich Text**: Files with formatted text runs
- **Merges**: Files with merged cell regions
- **Mixed**: Realistic combination of features
- **Baseline**: Numbers-only baseline for comparison

```bash
# Run with default settings
pnpm bench:features

# Generate test files
pnpm bench:features:generate

# Options
npx tsx --expose-gc xlsx-parser/benchmarks/feature-benchmarks.ts --features=styles,formulas
npx tsx --expose-gc xlsx-parser/benchmarks/feature-benchmarks.ts --wasm-only
```

### 3. Real-World Benchmarks (`real-world.ts`)

Tests with realistic file patterns:

- **Fixtures**: Existing test files from `performance/fixtures/`
- **Financial**: Complex formulas, number formats
- **Data Export**: Simple structure, many rows
- **Reports**: Mixed content, formatting

```bash
# Run with default settings
pnpm bench:real

# Generate synthetic files
pnpm bench:real:generate

# Options
npx tsx --expose-gc xlsx-parser/benchmarks/real-world.ts --no-fixtures
npx tsx --expose-gc xlsx-parser/benchmarks/real-world.ts --categories=financial,data-export
```

### 4. Comparison Dashboard (`compare.ts`)

Generates comparison reports and detects regressions:

```bash
# Compare latest results
pnpm bench:compare

# Compare specific files
npx tsx xlsx-parser/benchmarks/compare.ts --input=results/large-files-latest.json

# Detect regressions vs baseline
npx tsx xlsx-parser/benchmarks/compare.ts --baseline=results/baseline.json --threshold=5

# Output formats
npx tsx xlsx-parser/benchmarks/compare.ts --format=json,md,console
```

## Output

Results are saved to `xlsx-parser/benchmarks/results/`:

- `*-latest.json` - Most recent results for each benchmark type
- `*-<timestamp>.json` - Historical results with timestamp
- `*-<timestamp>.md` - Human-readable Markdown reports
- `comparison-latest.json` - Latest comparison report
- `comparison-latest.md` - Latest comparison in Markdown

## Metrics

Each benchmark measures:

### Latency

- **Mean**: Average parse time
- **Min/Max**: Range of parse times
- **P50/P95/P99**: Percentile latencies
- **StdDev**: Consistency of measurements

### Memory

- **Peak Heap**: Maximum heap usage during parse
- **Baseline**: Heap usage before parse
- **Delta**: Memory allocated during parse

### Throughput

- **Cells/sec**: Cell processing rate
- **MB/sec**: File processing rate

## CLI Options

All benchmark scripts support these common options:

| Option           | Description                                  |
| ---------------- | -------------------------------------------- |
| `--wasm-only`    | Only run WASM parser benchmarks              |
| `--js-only`      | Only run JavaScript parser benchmarks        |
| `--generate`     | Generate test files (required on first run)  |
| `--iterations=N` | Number of benchmark iterations (default: 10) |

## Memory Measurement

For accurate memory measurements, run with `--expose-gc`:

```bash
npx tsx --expose-gc xlsx-parser/benchmarks/large-files.ts
```

Without this flag, memory measurements may be less accurate but benchmarks will still run.

## Generated Files

Test files are generated in `xlsx-parser/benchmarks/generated/`:

- `*.xlsx` - Large file test files
- `features/*.xlsx` - Feature-specific test files
- `real-world/*.xlsx` - Synthetic real-world files

These files are not tracked in git and are generated on first run.

## CI/CD Integration

The benchmark suite can be used in CI/CD pipelines:

```bash
# Run benchmarks and save baseline
pnpm bench:all

# Compare against baseline (exit code 1 if regressions detected)
npx tsx xlsx-parser/benchmarks/compare.ts \
  --baseline=results/baseline.json \
  --threshold=10
```

The `compare.ts` script exits with code 1 if regressions exceed the threshold.

## Development

### Adding New Benchmarks

1. Create new file in `xlsx-parser/benchmarks/`
2. Import utilities from `./utils.ts`
3. Follow the pattern in existing benchmark files
4. Add npm script to `package.json`

### Utilities

The `utils.ts` module provides:

- `generateXlsxFile()` - Create synthetic XLSX files
- `generateFeatureXlsxFile()` - Create files with specific features
- `calculateStats()` - Compute latency statistics
- `formatBytes()`, `formatNumber()` - Output formatting
- `saveResults()`, `loadResults()` - Result persistence
- `printResultsTable()`, `printComparisonTable()` - Console output
- `generateMarkdownReport()` - Markdown generation
