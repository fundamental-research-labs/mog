#!/usr/bin/env npx tsx --expose-gc
/**
 * Large File Benchmarks (5B-1)
 *
 * Benchmarks XLSX parsing performance with large files:
 * - 100K cells
 * - 500K cells
 * - 1M cells
 * - 5M cells
 *
 * Measures:
 * - Parse time (mean, min, max, p95, p99)
 * - Memory usage (peak, baseline, delta)
 * - Throughput (cells/sec, MB/sec)
 *
 * Usage:
 *   npx tsx --expose-gc xlsx/tooling/benchmarks/large-files.ts
 *   pnpm bench:large
 *
 * Options:
 *   --wasm-only     Only run WASM parser benchmarks
 *   --js-only       Only run JavaScript parser benchmarks
 *   --generate      Generate test files (required on first run)
 *   --sizes=100k,500k,1m,5m  Specify which sizes to test
 *   --iterations=N  Number of iterations (default: 10)
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  BenchmarkConfig,
  BenchmarkResult,
  FileSpec,
  GENERATED_DIR,
  calculateStats,
  ensureDir,
  fileExists,
  forceGC,
  formatBytes,
  formatDuration,
  formatNumber,
  generateXlsxFile,
  getMemoryUsage,
  printResultsTable,
  saveMarkdownReport,
  saveResults,
} from './utils';

// =============================================================================
// Configuration
// =============================================================================

const FILE_SPECS: FileSpec[] = [
  { name: '100k-cells', rows: 1000, cols: 100, description: '100K cells (1000x100)' },
  { name: '500k-cells', rows: 2500, cols: 200, description: '500K cells (2500x200)' },
  { name: '1m-cells', rows: 5000, cols: 200, description: '1M cells (5000x200)' },
  { name: '5m-cells', rows: 10000, cols: 500, description: '5M cells (10000x500)' },
];

// =============================================================================
// WASM Parser Types and Loading
// =============================================================================

interface FullParseResult {
  readonly stats: {
    readonly total_cells: number;
    readonly total_sheets: number;
    readonly parse_time_us: number;
  };
  readonly sheets: unknown[];
}

interface WasmModule {
  parse_xlsx_full(xlsxData: Uint8Array): FullParseResult;
  version(): string;
}

async function loadWasmModule(): Promise<WasmModule> {
  const wasmPath = join(process.cwd(), 'compute/wasm/npm/compute_core_wasm_bg.wasm');
  const jsModulePath = join(process.cwd(), 'compute/wasm/npm/compute_core_wasm.js');

  if (!existsSync(wasmPath) || !existsSync(jsModulePath)) {
    throw new Error('WASM module not built. Run: cd compute/wasm && bash build.sh');
  }

  const wasmBytes = readFileSync(wasmPath);
  const jsModuleUrl = pathToFileURL(jsModulePath).href;
  const wasmJsModule = await import(jsModuleUrl);

  // Panic hook is auto-set via #[wasm_bindgen(start)] in @mog-sdk/wasm
  await wasmJsModule.default(wasmBytes);

  return wasmJsModule as unknown as WasmModule;
}

// =============================================================================
// JavaScript Parser Loading
// =============================================================================

interface JsParseResult {
  success: boolean;
  workbook: {
    sheets: { cells: Map<string, unknown> }[];
    stats?: { totalCells: number; totalSheets: number };
  } | null;
  metrics: {
    cellCount: number;
    sheetCount: number;
    totalMs: number;
  };
}

interface JsParser {
  initialize(): Promise<void>;
  parse(data: ArrayBuffer): Promise<JsParseResult>;
  dispose(): void;
}

async function loadJsParser(): Promise<JsParser> {
  const jsParserPath = join(process.cwd(), 'file-io/src/xlsx/js-parser.ts');

  if (!existsSync(jsParserPath)) {
    throw new Error('JavaScript parser not found at: ' + jsParserPath);
  }

  // Dynamic import of the JS parser
  const { JavaScriptXlsxParser } = await import(jsParserPath);
  return new JavaScriptXlsxParser();
}

// =============================================================================
// Benchmark Functions
// =============================================================================

async function benchmarkWasm(
  wasm: WasmModule,
  filePath: string,
  fileName: string,
  config: BenchmarkConfig,
): Promise<BenchmarkResult> {
  const fileBytes = readFileSync(filePath);
  const xlsxData = new Uint8Array(fileBytes);
  const fileSize = fileBytes.length;

  config.onProgress?.(`\nBenchmarking WASM: ${fileName} (${formatBytes(fileSize)})`);
  config.onProgress?.('='.repeat(60));

  // Warmup
  config.onProgress?.(`Running ${config.warmupIterations} warmup iterations...`);
  let cellCount = 0;
  let sheetCount = 0;

  for (let i = 0; i < config.warmupIterations; i++) {
    const result = wasm.parse_xlsx_full(xlsxData);
    cellCount = result.stats.total_cells;
    sheetCount = result.stats.total_sheets;
  }

  config.onProgress?.(`  Cells: ${formatNumber(cellCount)}, Sheets: ${sheetCount}`);

  // Benchmark runs
  config.onProgress?.(`Running ${config.iterations} benchmark iterations...`);
  const timings: number[] = [];

  forceGC();
  const baselineMemory = getMemoryUsage().heapUsed;
  let peakMemory = baselineMemory;

  for (let i = 0; i < config.iterations; i++) {
    forceGC();

    const startTime = performance.now();
    wasm.parse_xlsx_full(xlsxData);
    const endTime = performance.now();

    timings.push(endTime - startTime);

    const currentMemory = getMemoryUsage().heapUsed;
    if (currentMemory > peakMemory) {
      peakMemory = currentMemory;
    }

    if ((i + 1) % Math.ceil(config.iterations / 10) === 0) {
      process.stdout.write('.');
    }
  }
  config.onProgress?.(' done');

  const stats = calculateStats(timings);

  return {
    name: fileName,
    file: filePath,
    fileSize,
    cellCount,
    sheetCount,
    iterations: config.iterations,
    latency: stats,
    memory: {
      peakHeapUsed: peakMemory,
      baselineHeapUsed: baselineMemory,
      delta: peakMemory - baselineMemory,
    },
    throughput: {
      cellsPerSecond: cellCount / (stats.mean / 1000),
      bytesPerSecond: fileSize / (stats.mean / 1000),
      mbPerSecond: fileSize / (1024 * 1024) / (stats.mean / 1000),
    },
    timestamp: new Date().toISOString(),
    parserType: 'wasm',
  };
}

async function benchmarkJavascript(
  parser: JsParser,
  filePath: string,
  fileName: string,
  config: BenchmarkConfig,
): Promise<BenchmarkResult> {
  const fileBytes = readFileSync(filePath);
  const fileSize = fileBytes.length;

  config.onProgress?.(`\nBenchmarking JavaScript: ${fileName} (${formatBytes(fileSize)})`);
  config.onProgress?.('='.repeat(60));

  // Warmup
  config.onProgress?.(`Running ${config.warmupIterations} warmup iterations...`);
  let cellCount = 0;
  let sheetCount = 0;

  for (let i = 0; i < config.warmupIterations; i++) {
    const result = await parser.parse(
      fileBytes.buffer.slice(fileBytes.byteOffset, fileBytes.byteOffset + fileBytes.byteLength),
    );
    if (!result.success) {
      throw new Error('JavaScript parse failed during warmup');
    }
    cellCount = result.metrics.cellCount;
    sheetCount = result.metrics.sheetCount;
  }

  config.onProgress?.(`  Cells: ${formatNumber(cellCount)}, Sheets: ${sheetCount}`);

  // Benchmark runs
  config.onProgress?.(`Running ${config.iterations} benchmark iterations...`);
  const timings: number[] = [];

  forceGC();
  const baselineMemory = getMemoryUsage().heapUsed;
  let peakMemory = baselineMemory;

  for (let i = 0; i < config.iterations; i++) {
    forceGC();

    const startTime = performance.now();
    const result = await parser.parse(
      fileBytes.buffer.slice(fileBytes.byteOffset, fileBytes.byteOffset + fileBytes.byteLength),
    );
    const endTime = performance.now();

    if (!result.success) {
      throw new Error(`JavaScript parse failed on iteration ${i}`);
    }

    timings.push(endTime - startTime);

    const currentMemory = getMemoryUsage().heapUsed;
    if (currentMemory > peakMemory) {
      peakMemory = currentMemory;
    }

    if ((i + 1) % Math.ceil(config.iterations / 10) === 0) {
      process.stdout.write('.');
    }
  }
  config.onProgress?.(' done');

  const stats = calculateStats(timings);

  return {
    name: fileName,
    file: filePath,
    fileSize,
    cellCount,
    sheetCount,
    iterations: config.iterations,
    latency: stats,
    memory: {
      peakHeapUsed: peakMemory,
      baselineHeapUsed: baselineMemory,
      delta: peakMemory - baselineMemory,
    },
    throughput: {
      cellsPerSecond: cellCount / (stats.mean / 1000),
      bytesPerSecond: fileSize / (stats.mean / 1000),
      mbPerSecond: fileSize / (1024 * 1024) / (stats.mean / 1000),
    },
    timestamp: new Date().toISOString(),
    parserType: 'javascript',
  };
}

// =============================================================================
// File Generation
// =============================================================================

async function generateTestFiles(specs: FileSpec[]): Promise<void> {
  ensureDir(GENERATED_DIR);

  console.log('Generating test files...');
  console.log('='.repeat(60));

  for (const spec of specs) {
    const filePath = join(GENERATED_DIR, `${spec.name}.xlsx`);

    if (fileExists(filePath)) {
      console.log(`  [SKIP] ${spec.name}.xlsx already exists`);
      continue;
    }

    console.log(`  [GENERATING] ${spec.name}.xlsx (${spec.description})...`);
    const startTime = performance.now();

    const xlsxData = await generateXlsxFile(spec);
    writeFileSync(filePath, xlsxData);

    const endTime = performance.now();
    const fileSize = xlsxData.length;
    console.log(`    Created ${formatBytes(fileSize)} in ${formatDuration(endTime - startTime)}`);
  }

  console.log('File generation complete.\n');
}

// =============================================================================
// CLI Argument Parsing
// =============================================================================

interface CliOptions {
  wasmOnly: boolean;
  jsOnly: boolean;
  generate: boolean;
  sizes: string[];
  iterations: number;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);

  return {
    wasmOnly: args.includes('--wasm-only'),
    jsOnly: args.includes('--js-only'),
    generate: args.includes('--generate'),
    sizes: args
      .find((a) => a.startsWith('--sizes='))
      ?.split('=')[1]
      ?.split(',') || ['100k', '500k', '1m', '5m'],
    iterations: parseInt(
      args.find((a) => a.startsWith('--iterations='))?.split('=')[1] || '10',
      10,
    ),
  };
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  console.log('XLSX Parser - Large File Benchmarks');
  console.log('====================================\n');

  // Check for --expose-gc
  if (typeof global.gc !== 'function') {
    console.warn('Warning: --expose-gc flag not set. Memory measurements may be less accurate.');
    console.warn('Run with: npx tsx --expose-gc xlsx/tooling/benchmarks/large-files.ts\n');
  }

  const options = parseArgs();

  // Filter specs based on sizes option
  const sizeMap: Record<string, string> = {
    '100k': '100k-cells',
    '500k': '500k-cells',
    '1m': '1m-cells',
    '5m': '5m-cells',
  };

  const selectedSpecs = FILE_SPECS.filter((spec) =>
    options.sizes.some((size) => spec.name === sizeMap[size.toLowerCase()]),
  );

  if (selectedSpecs.length === 0) {
    console.error('No valid sizes specified. Use: 100k, 500k, 1m, 5m');
    process.exit(1);
  }

  // Generate files if requested or if they don't exist
  const needsGeneration = selectedSpecs.some(
    (spec) => !fileExists(join(GENERATED_DIR, `${spec.name}.xlsx`)),
  );

  if (options.generate || needsGeneration) {
    await generateTestFiles(selectedSpecs);
  }

  // Verify all files exist
  for (const spec of selectedSpecs) {
    const filePath = join(GENERATED_DIR, `${spec.name}.xlsx`);
    if (!fileExists(filePath)) {
      console.error(`Test file not found: ${filePath}`);
      console.error('Run with --generate to create test files.');
      process.exit(1);
    }
  }

  const config: BenchmarkConfig = {
    iterations: options.iterations,
    warmupIterations: Math.max(2, Math.floor(options.iterations / 5)),
    onProgress: console.log,
  };

  const allResults: BenchmarkResult[] = [];

  // WASM benchmarks
  if (!options.jsOnly) {
    console.log('\n' + '='.repeat(80));
    console.log('WASM PARSER BENCHMARKS');
    console.log('='.repeat(80));

    try {
      console.log('Loading WASM module...');
      const wasm = await loadWasmModule();
      console.log(`WASM module loaded. Version: ${wasm.version()}`);

      for (const spec of selectedSpecs) {
        const filePath = join(GENERATED_DIR, `${spec.name}.xlsx`);
        try {
          const result = await benchmarkWasm(wasm, filePath, spec.name, config);
          allResults.push(result);
        } catch (error) {
          console.error(`Error benchmarking ${spec.name}:`, error);
        }
      }
    } catch (error) {
      console.error('Failed to load WASM module:', error);
      if (!options.wasmOnly) {
        console.log('Continuing with JavaScript parser only...');
      }
    }
  }

  // JavaScript benchmarks
  if (!options.wasmOnly) {
    console.log('\n' + '='.repeat(80));
    console.log('JAVASCRIPT PARSER BENCHMARKS');
    console.log('='.repeat(80));

    try {
      console.log('Loading JavaScript parser...');
      const jsParser = await loadJsParser();
      await jsParser.initialize();
      console.log('JavaScript parser loaded.');

      for (const spec of selectedSpecs) {
        const filePath = join(GENERATED_DIR, `${spec.name}.xlsx`);
        try {
          const result = await benchmarkJavascript(jsParser, filePath, spec.name, config);
          allResults.push(result);
        } catch (error) {
          console.error(`Error benchmarking ${spec.name}:`, error);
        }
      }

      jsParser.dispose();
    } catch (error) {
      console.error('Failed to load JavaScript parser:', error);
    }
  }

  // Print and save results
  if (allResults.length > 0) {
    printResultsTable(allResults);

    // Save results
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    saveResults(allResults, `large-files-${timestamp}.json`);
    saveMarkdownReport(allResults, `large-files-${timestamp}.md`);

    // Also save latest results
    saveResults(allResults, 'large-files-latest.json');

    // Print summary statistics
    console.log('\n' + '='.repeat(80));
    console.log('SUMMARY');
    console.log('='.repeat(80));

    const wasmResults = allResults.filter((r) => r.parserType === 'wasm');
    const jsResults = allResults.filter((r) => r.parserType === 'javascript');

    if (wasmResults.length > 0) {
      const avgCellsPerSec =
        wasmResults.reduce((acc, r) => acc + r.throughput.cellsPerSecond, 0) / wasmResults.length;
      console.log(`\nWASM Parser:`);
      console.log(`  Average throughput: ${formatNumber(Math.round(avgCellsPerSec))} cells/sec`);
    }

    if (jsResults.length > 0) {
      const avgCellsPerSec =
        jsResults.reduce((acc, r) => acc + r.throughput.cellsPerSecond, 0) / jsResults.length;
      console.log(`\nJavaScript Parser:`);
      console.log(`  Average throughput: ${formatNumber(Math.round(avgCellsPerSec))} cells/sec`);
    }

    if (wasmResults.length > 0 && jsResults.length > 0) {
      console.log('\nComparison:');
      for (const spec of selectedSpecs) {
        const wasmResult = wasmResults.find((r) => r.name === spec.name);
        const jsResult = jsResults.find((r) => r.name === spec.name);
        if (wasmResult && jsResult) {
          const speedup = jsResult.latency.mean / wasmResult.latency.mean;
          console.log(
            `  ${spec.name}: WASM is ${speedup.toFixed(2)}x ${speedup >= 1 ? 'faster' : 'slower'}`,
          );
        }
      }
    }
  }

  console.log('\nBenchmark complete!');
}

// Run
main().catch((error) => {
  console.error('Benchmark failed:', error);
  process.exit(1);
});
