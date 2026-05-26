#!/usr/bin/env npx tsx --expose-gc
/**
 * Real-World File Benchmarks (5B-3)
 *
 * Benchmarks XLSX parsing performance with real-world file patterns:
 * - Financial models (complex formulas, number formats)
 * - Data exports (simple structure, many cells)
 * - Reports (mixed content, formatting)
 * - Existing test fixtures from performance/fixtures/
 *
 * This benchmark uses actual test files when available and generates
 * representative synthetic files for categories that don't have fixtures.
 *
 * Usage:
 *   npx tsx --expose-gc xlsx/tooling/benchmarks/real-world.ts
 *   pnpm bench:real
 *
 * Options:
 *   --wasm-only     Only run WASM parser benchmarks
 *   --js-only       Only run JavaScript parser benchmarks
 *   --generate      Generate synthetic test files
 *   --iterations=N  Number of iterations (default: 10)
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  BenchmarkConfig,
  BenchmarkResult,
  FIXTURES_DIR,
  FileSpec,
  GENERATED_DIR,
  calculateStats,
  ensureDir,
  fileExists,
  forceGC,
  formatBytes,
  formatDuration,
  formatNumber,
  generateFeatureXlsxFile,
  getFileSize,
  getMemoryUsage,
  printResultsTable,
  saveMarkdownReport,
  saveResults,
} from './utils';

// =============================================================================
// Real-World File Categories
// =============================================================================

interface RealWorldSpec {
  name: string;
  description: string;
  category: 'financial' | 'data-export' | 'report' | 'fixture';
  filePath?: string; // If undefined, will be generated
  generate?: {
    rows: number;
    cols: number;
    features: {
      styles?: number;
      formulas?: boolean;
      richText?: boolean;
      merges?: number;
    };
  };
}

// Files to test from performance/fixtures/
const FIXTURE_FILES = [
  'smoke-bench.xlsx',
  'small-bench.xlsx',
  'medium-bench.xlsx',
  'large-bench.xlsx',
  'extreme-bench.xlsx',
  'smoke-test.xlsx',
  'small-test.xlsx',
];

// Synthetic real-world file specs
const SYNTHETIC_SPECS: RealWorldSpec[] = [
  // Financial models - complex formulas, many number formats
  {
    name: 'financial-small',
    description: 'Financial model, 10K cells',
    category: 'financial',
    generate: {
      rows: 200,
      cols: 50,
      features: { styles: 50, formulas: true, merges: 10 },
    },
  },
  {
    name: 'financial-medium',
    description: 'Financial model, 50K cells',
    category: 'financial',
    generate: {
      rows: 500,
      cols: 100,
      features: { styles: 100, formulas: true, merges: 30 },
    },
  },
  {
    name: 'financial-large',
    description: 'Financial model, 100K cells',
    category: 'financial',
    generate: {
      rows: 1000,
      cols: 100,
      features: { styles: 200, formulas: true, merges: 50 },
    },
  },

  // Data exports - simple structure, many rows
  {
    name: 'data-export-small',
    description: 'Data export, 50K cells',
    category: 'data-export',
    generate: {
      rows: 5000,
      cols: 10,
      features: { styles: 5 },
    },
  },
  {
    name: 'data-export-medium',
    description: 'Data export, 200K cells',
    category: 'data-export',
    generate: {
      rows: 10000,
      cols: 20,
      features: { styles: 5 },
    },
  },
  {
    name: 'data-export-large',
    description: 'Data export, 500K cells',
    category: 'data-export',
    generate: {
      rows: 25000,
      cols: 20,
      features: { styles: 5 },
    },
  },

  // Reports - mixed content, formatting
  {
    name: 'report-small',
    description: 'Report, 5K cells',
    category: 'report',
    generate: {
      rows: 100,
      cols: 50,
      features: { styles: 30, richText: true, merges: 20 },
    },
  },
  {
    name: 'report-medium',
    description: 'Report, 25K cells',
    category: 'report',
    generate: {
      rows: 250,
      cols: 100,
      features: { styles: 100, richText: true, merges: 50 },
    },
  },
  {
    name: 'report-large',
    description: 'Report, 50K cells',
    category: 'report',
    generate: {
      rows: 500,
      cols: 100,
      features: { styles: 200, richText: true, merges: 100 },
    },
  },
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

  const { JavaScriptXlsxParser } = await import(jsParserPath);
  return new JavaScriptXlsxParser();
}

// =============================================================================
// Benchmark Functions
// =============================================================================

async function benchmarkWasm(
  wasm: WasmModule,
  filePath: string,
  spec: RealWorldSpec,
  config: BenchmarkConfig,
): Promise<BenchmarkResult> {
  const fileBytes = readFileSync(filePath);
  const xlsxData = new Uint8Array(fileBytes);
  const fileSize = fileBytes.length;

  config.onProgress?.(`\nBenchmarking WASM: ${spec.name} (${formatBytes(fileSize)})`);
  config.onProgress?.(`  Category: ${spec.category} - ${spec.description}`);
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
    name: spec.name,
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
    metadata: {
      category: spec.category,
      description: spec.description,
    },
  };
}

async function benchmarkJavascript(
  parser: JsParser,
  filePath: string,
  spec: RealWorldSpec,
  config: BenchmarkConfig,
): Promise<BenchmarkResult> {
  const fileBytes = readFileSync(filePath);
  const fileSize = fileBytes.length;

  config.onProgress?.(`\nBenchmarking JavaScript: ${spec.name} (${formatBytes(fileSize)})`);
  config.onProgress?.(`  Category: ${spec.category} - ${spec.description}`);
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
    name: spec.name,
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
    metadata: {
      category: spec.category,
      description: spec.description,
    },
  };
}

// =============================================================================
// File Discovery and Generation
// =============================================================================

function discoverFixtureFiles(): RealWorldSpec[] {
  const specs: RealWorldSpec[] = [];

  if (!existsSync(FIXTURES_DIR)) {
    console.warn(`Fixtures directory not found: ${FIXTURES_DIR}`);
    return specs;
  }

  const files = readdirSync(FIXTURES_DIR);

  for (const file of FIXTURE_FILES) {
    const filePath = join(FIXTURES_DIR, file);
    if (files.includes(file) && existsSync(filePath)) {
      const fileSize = getFileSize(filePath);
      specs.push({
        name: file.replace('.xlsx', ''),
        description: `Fixture ${formatBytes(fileSize)}`,
        category: 'fixture',
        filePath,
      });
    }
  }

  return specs;
}

async function generateSyntheticFiles(specs: RealWorldSpec[]): Promise<void> {
  ensureDir(join(GENERATED_DIR, 'real-world'));

  console.log('Generating synthetic real-world files...');
  console.log('='.repeat(60));

  for (const spec of specs) {
    if (!spec.generate) continue;

    const filePath = join(GENERATED_DIR, 'real-world', `${spec.name}.xlsx`);

    if (fileExists(filePath)) {
      console.log(`  [SKIP] ${spec.name}.xlsx already exists`);
      continue;
    }

    console.log(`  [GENERATING] ${spec.name}.xlsx (${spec.description})...`);
    const startTime = performance.now();

    const fileSpec: FileSpec = {
      name: spec.name,
      rows: spec.generate.rows,
      cols: spec.generate.cols,
      description: spec.description,
    };

    const xlsxData = await generateFeatureXlsxFile(fileSpec, spec.generate.features);
    writeFileSync(filePath, xlsxData);

    const endTime = performance.now();
    const fileSize = xlsxData.length;
    console.log(`    Created ${formatBytes(fileSize)} in ${formatDuration(endTime - startTime)}`);
  }

  console.log('File generation complete.\n');
}

// =============================================================================
// Results Analysis
// =============================================================================

function analyzeRealWorldResults(results: BenchmarkResult[]): void {
  console.log('\n' + '='.repeat(80));
  console.log('REAL-WORLD ANALYSIS');
  console.log('='.repeat(80));

  // Group by category
  const categories = ['fixture', 'financial', 'data-export', 'report'];

  for (const category of categories) {
    const categoryResults = results.filter((r) => r.metadata?.category === category);

    if (categoryResults.length === 0) continue;

    const wasmResults = categoryResults.filter((r) => r.parserType === 'wasm');
    const jsResults = categoryResults.filter((r) => r.parserType === 'javascript');

    console.log(`\n[${category.toUpperCase()}]`);

    // Calculate category averages
    if (wasmResults.length > 0) {
      const avgThroughput =
        wasmResults.reduce((acc, r) => acc + r.throughput.cellsPerSecond, 0) / wasmResults.length;
      console.log(`  WASM avg throughput: ${formatNumber(Math.round(avgThroughput))} cells/s`);
    }

    if (jsResults.length > 0) {
      const avgThroughput =
        jsResults.reduce((acc, r) => acc + r.throughput.cellsPerSecond, 0) / jsResults.length;
      console.log(`  JS avg throughput: ${formatNumber(Math.round(avgThroughput))} cells/s`);
    }

    // Category speedup
    if (wasmResults.length > 0 && jsResults.length > 0) {
      const wasmAvg = wasmResults.reduce((acc, r) => acc + r.latency.mean, 0) / wasmResults.length;
      const jsAvg = jsResults.reduce((acc, r) => acc + r.latency.mean, 0) / jsResults.length;
      const avgSpeedup = jsAvg / wasmAvg;
      console.log(`  Average WASM speedup: ${avgSpeedup.toFixed(2)}x`);
    }

    // Individual file stats
    console.log('  Files:');
    for (const wasmResult of wasmResults) {
      const jsResult = jsResults.find((r) => r.name === wasmResult.name);
      if (jsResult) {
        const speedup = jsResult.latency.mean / wasmResult.latency.mean;
        console.log(
          `    ${wasmResult.name}: WASM ${wasmResult.latency.mean.toFixed(2)}ms vs JS ${jsResult.latency.mean.toFixed(2)}ms (${speedup.toFixed(2)}x)`,
        );
      } else {
        console.log(
          `    ${wasmResult.name}: WASM ${wasmResult.latency.mean.toFixed(2)}ms (${formatNumber(wasmResult.cellCount)} cells)`,
        );
      }
    }

    // JS-only results
    for (const jsResult of jsResults) {
      const wasmResult = wasmResults.find((r) => r.name === jsResult.name);
      if (!wasmResult) {
        console.log(
          `    ${jsResult.name}: JS ${jsResult.latency.mean.toFixed(2)}ms (${formatNumber(jsResult.cellCount)} cells)`,
        );
      }
    }
  }

  // Performance by file size
  console.log('\n[PERFORMANCE BY FILE SIZE]');

  const wasmResults = results
    .filter((r) => r.parserType === 'wasm')
    .sort((a, b) => a.fileSize - b.fileSize);

  if (wasmResults.length > 0) {
    console.log('  WASM:');
    for (const r of wasmResults) {
      console.log(
        `    ${formatBytes(r.fileSize).padEnd(12)} -> ${r.latency.mean.toFixed(2).padStart(10)}ms (${formatNumber(Math.round(r.throughput.cellsPerSecond)).padStart(12)} cells/s)`,
      );
    }
  }

  const jsResults = results
    .filter((r) => r.parserType === 'javascript')
    .sort((a, b) => a.fileSize - b.fileSize);

  if (jsResults.length > 0) {
    console.log('  JavaScript:');
    for (const r of jsResults) {
      console.log(
        `    ${formatBytes(r.fileSize).padEnd(12)} -> ${r.latency.mean.toFixed(2).padStart(10)}ms (${formatNumber(Math.round(r.throughput.cellsPerSecond)).padStart(12)} cells/s)`,
      );
    }
  }
}

// =============================================================================
// CLI Argument Parsing
// =============================================================================

interface CliOptions {
  wasmOnly: boolean;
  jsOnly: boolean;
  generate: boolean;
  fixtures: boolean;
  categories: string[];
  iterations: number;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);

  return {
    wasmOnly: args.includes('--wasm-only'),
    jsOnly: args.includes('--js-only'),
    generate: args.includes('--generate'),
    fixtures: !args.includes('--no-fixtures'),
    categories: args
      .find((a) => a.startsWith('--categories='))
      ?.split('=')[1]
      ?.split(',') || ['fixture', 'financial', 'data-export', 'report'],
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
  console.log('XLSX Parser - Real-World File Benchmarks');
  console.log('========================================\n');

  if (typeof global.gc !== 'function') {
    console.warn('Warning: --expose-gc flag not set. Memory measurements may be less accurate.');
    console.warn('Run with: npx tsx --expose-gc xlsx/tooling/benchmarks/real-world.ts\n');
  }

  const options = parseArgs();

  // Build list of specs to benchmark
  const allSpecs: RealWorldSpec[] = [];

  // Add fixture files if requested
  if (options.fixtures && options.categories.includes('fixture')) {
    const fixtureSpecs = discoverFixtureFiles();
    console.log(`Found ${fixtureSpecs.length} fixture files`);
    allSpecs.push(...fixtureSpecs);
  }

  // Add synthetic specs for requested categories
  const syntheticCategories = options.categories.filter((c) => c !== 'fixture');
  const selectedSynthetic = SYNTHETIC_SPECS.filter((spec) =>
    syntheticCategories.includes(spec.category),
  );

  // Generate files if needed
  if (selectedSynthetic.length > 0) {
    const needsGeneration = selectedSynthetic.some(
      (spec) => !fileExists(join(GENERATED_DIR, 'real-world', `${spec.name}.xlsx`)),
    );

    if (options.generate || needsGeneration) {
      await generateSyntheticFiles(selectedSynthetic);
    }

    // Add synthetic specs with file paths
    for (const spec of selectedSynthetic) {
      const filePath = join(GENERATED_DIR, 'real-world', `${spec.name}.xlsx`);
      if (fileExists(filePath)) {
        allSpecs.push({ ...spec, filePath });
      }
    }
  }

  if (allSpecs.length === 0) {
    console.error('No files to benchmark.');
    console.error('Use --generate to create synthetic files or ensure fixture files exist.');
    process.exit(1);
  }

  console.log(`\nBenchmarking ${allSpecs.length} files...\n`);

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

      for (const spec of allSpecs) {
        const filePath = spec.filePath!;
        try {
          const result = await benchmarkWasm(wasm, filePath, spec, config);
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

      for (const spec of allSpecs) {
        const filePath = spec.filePath!;
        try {
          const result = await benchmarkJavascript(jsParser, filePath, spec, config);
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
    analyzeRealWorldResults(allResults);

    // Save results
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    saveResults(allResults, `real-world-${timestamp}.json`);
    saveMarkdownReport(allResults, `real-world-${timestamp}.md`);

    // Also save latest results
    saveResults(allResults, 'real-world-latest.json');
  }

  console.log('\nBenchmark complete!');
}

// Run
main().catch((error) => {
  console.error('Benchmark failed:', error);
  process.exit(1);
});
