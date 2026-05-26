#!/usr/bin/env npx tsx --expose-gc
/**
 * Feature-Specific Benchmarks (5B-2)
 *
 * Benchmarks XLSX parsing performance with different file characteristics:
 * - Styles-heavy (1000+ unique styles)
 * - Formula-heavy (50%+ formula cells)
 * - Rich text files (formatted strings)
 * - Table/chart-heavy files
 * - Merged cells
 * - Mixed content
 *
 * This helps identify performance bottlenecks specific to certain Excel features.
 *
 * Usage:
 *   npx tsx --expose-gc xlsx/tooling/benchmarks/feature-benchmarks.ts
 *   pnpm bench:features
 *
 * Options:
 *   --wasm-only     Only run WASM parser benchmarks
 *   --js-only       Only run JavaScript parser benchmarks
 *   --generate      Generate test files (required on first run)
 *   --features=styles,formulas,richtext,merges,mixed
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
  generateFeatureXlsxFile,
  getMemoryUsage,
  printResultsTable,
  saveMarkdownReport,
  saveResults,
} from './utils';

// =============================================================================
// Feature Configurations
// =============================================================================

interface FeatureSpec extends FileSpec {
  features: {
    styles?: number;
    formulas?: boolean;
    richText?: boolean;
    merges?: number;
  };
  category: string;
}

const FEATURE_SPECS: FeatureSpec[] = [
  // Styles-heavy files
  {
    name: 'styles-100',
    rows: 500,
    cols: 100,
    description: '100 unique styles, 50K cells',
    features: { styles: 100 },
    category: 'styles',
  },
  {
    name: 'styles-500',
    rows: 500,
    cols: 100,
    description: '500 unique styles, 50K cells',
    features: { styles: 500 },
    category: 'styles',
  },
  {
    name: 'styles-1000',
    rows: 500,
    cols: 100,
    description: '1000 unique styles, 50K cells',
    features: { styles: 1000 },
    category: 'styles',
  },
  {
    name: 'styles-2000',
    rows: 500,
    cols: 100,
    description: '2000 unique styles, 50K cells',
    features: { styles: 2000 },
    category: 'styles',
  },

  // Formula-heavy files
  {
    name: 'formulas-small',
    rows: 100,
    cols: 50,
    description: 'Formula-heavy, 5K cells',
    features: { formulas: true, styles: 1 },
    category: 'formulas',
  },
  {
    name: 'formulas-medium',
    rows: 500,
    cols: 100,
    description: 'Formula-heavy, 50K cells',
    features: { formulas: true, styles: 1 },
    category: 'formulas',
  },
  {
    name: 'formulas-large',
    rows: 1000,
    cols: 100,
    description: 'Formula-heavy, 100K cells',
    features: { formulas: true, styles: 1 },
    category: 'formulas',
  },

  // Rich text files
  {
    name: 'richtext-small',
    rows: 100,
    cols: 50,
    description: 'Rich text, 5K cells',
    features: { richText: true, styles: 1 },
    category: 'richtext',
  },
  {
    name: 'richtext-medium',
    rows: 500,
    cols: 100,
    description: 'Rich text, 50K cells',
    features: { richText: true, styles: 1 },
    category: 'richtext',
  },

  // Merged cells
  {
    name: 'merges-100',
    rows: 500,
    cols: 100,
    description: '100 merged ranges, 50K cells',
    features: { merges: 100, styles: 1 },
    category: 'merges',
  },
  {
    name: 'merges-500',
    rows: 500,
    cols: 100,
    description: '500 merged ranges, 50K cells',
    features: { merges: 500, styles: 1 },
    category: 'merges',
  },

  // Mixed content (realistic combination)
  {
    name: 'mixed-small',
    rows: 200,
    cols: 50,
    description: 'Mixed content, 10K cells',
    features: { styles: 50, formulas: true, merges: 20 },
    category: 'mixed',
  },
  {
    name: 'mixed-medium',
    rows: 500,
    cols: 100,
    description: 'Mixed content, 50K cells',
    features: { styles: 200, formulas: true, merges: 50 },
    category: 'mixed',
  },
  {
    name: 'mixed-large',
    rows: 1000,
    cols: 100,
    description: 'Mixed content, 100K cells',
    features: { styles: 500, formulas: true, merges: 100 },
    category: 'mixed',
  },

  // Baseline (no special features)
  {
    name: 'baseline-50k',
    rows: 500,
    cols: 100,
    description: 'Baseline, 50K cells (numbers only)',
    features: { styles: 1 },
    category: 'baseline',
  },
  {
    name: 'baseline-100k',
    rows: 1000,
    cols: 100,
    description: 'Baseline, 100K cells (numbers only)',
    features: { styles: 1 },
    category: 'baseline',
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

  const { JavaScriptXlsxParser } = await import(jsParserPath);
  return new JavaScriptXlsxParser();
}

// =============================================================================
// Benchmark Functions
// =============================================================================

async function benchmarkWasm(
  wasm: WasmModule,
  filePath: string,
  spec: FeatureSpec,
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
      features: spec.features,
    },
  };
}

async function benchmarkJavascript(
  parser: JsParser,
  filePath: string,
  spec: FeatureSpec,
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
      features: spec.features,
    },
  };
}

// =============================================================================
// File Generation
// =============================================================================

async function generateTestFiles(specs: FeatureSpec[]): Promise<void> {
  ensureDir(join(GENERATED_DIR, 'features'));

  console.log('Generating feature test files...');
  console.log('='.repeat(60));

  for (const spec of specs) {
    const filePath = join(GENERATED_DIR, 'features', `${spec.name}.xlsx`);

    if (fileExists(filePath)) {
      console.log(`  [SKIP] ${spec.name}.xlsx already exists`);
      continue;
    }

    console.log(`  [GENERATING] ${spec.name}.xlsx (${spec.description})...`);
    const startTime = performance.now();

    const xlsxData = await generateFeatureXlsxFile(spec, spec.features);
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
  features: string[];
  iterations: number;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);

  return {
    wasmOnly: args.includes('--wasm-only'),
    jsOnly: args.includes('--js-only'),
    generate: args.includes('--generate'),
    features: args
      .find((a) => a.startsWith('--features='))
      ?.split('=')[1]
      ?.split(',') || ['styles', 'formulas', 'richtext', 'merges', 'mixed', 'baseline'],
    iterations: parseInt(
      args.find((a) => a.startsWith('--iterations='))?.split('=')[1] || '10',
      10,
    ),
  };
}

// =============================================================================
// Results Analysis
// =============================================================================

function analyzeResults(results: BenchmarkResult[]): void {
  console.log('\n' + '='.repeat(80));
  console.log('FEATURE ANALYSIS');
  console.log('='.repeat(80));

  // Group by category
  const categories = ['baseline', 'styles', 'formulas', 'richtext', 'merges', 'mixed'];

  for (const category of categories) {
    const categoryResults = results.filter((r) => r.metadata?.category === category);

    if (categoryResults.length === 0) continue;

    const wasmResults = categoryResults.filter((r) => r.parserType === 'wasm');
    const jsResults = categoryResults.filter((r) => r.parserType === 'javascript');

    console.log(`\n[${category.toUpperCase()}]`);

    if (wasmResults.length > 0) {
      console.log('  WASM:');
      for (const r of wasmResults) {
        console.log(
          `    ${r.name}: ${r.latency.mean.toFixed(2)}ms (${formatNumber(Math.round(r.throughput.cellsPerSecond))} cells/s)`,
        );
      }
    }

    if (jsResults.length > 0) {
      console.log('  JavaScript:');
      for (const r of jsResults) {
        console.log(
          `    ${r.name}: ${r.latency.mean.toFixed(2)}ms (${formatNumber(Math.round(r.throughput.cellsPerSecond))} cells/s)`,
        );
      }
    }

    // Speedup comparison
    if (wasmResults.length > 0 && jsResults.length > 0) {
      console.log('  Speedup:');
      for (const wasmResult of wasmResults) {
        const jsResult = jsResults.find((r) => r.name === wasmResult.name);
        if (jsResult) {
          const speedup = jsResult.latency.mean / wasmResult.latency.mean;
          console.log(`    ${wasmResult.name}: ${speedup.toFixed(2)}x`);
        }
      }
    }
  }

  // Analyze feature impact
  const wasmBaseline = results.find((r) => r.parserType === 'wasm' && r.name === 'baseline-50k');
  const jsBaseline = results.find(
    (r) => r.parserType === 'javascript' && r.name === 'baseline-50k',
  );

  if (wasmBaseline || jsBaseline) {
    console.log('\n[FEATURE IMPACT vs BASELINE]');

    const comparisons = [
      { name: 'styles-1000', description: '1000 styles' },
      { name: 'formulas-medium', description: 'Formulas' },
      { name: 'richtext-medium', description: 'Rich text' },
      { name: 'merges-500', description: '500 merges' },
      { name: 'mixed-medium', description: 'Mixed content' },
    ];

    for (const comp of comparisons) {
      if (wasmBaseline) {
        const featureResult = results.find((r) => r.parserType === 'wasm' && r.name === comp.name);
        if (featureResult) {
          const overhead = (featureResult.latency.mean / wasmBaseline.latency.mean - 1) * 100;
          console.log(
            `  WASM ${comp.description}: ${overhead > 0 ? '+' : ''}${overhead.toFixed(1)}% overhead`,
          );
        }
      }

      if (jsBaseline) {
        const featureResult = results.find(
          (r) => r.parserType === 'javascript' && r.name === comp.name,
        );
        if (featureResult) {
          const overhead = (featureResult.latency.mean / jsBaseline.latency.mean - 1) * 100;
          console.log(
            `  JS ${comp.description}: ${overhead > 0 ? '+' : ''}${overhead.toFixed(1)}% overhead`,
          );
        }
      }
    }
  }
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  console.log('XLSX Parser - Feature-Specific Benchmarks');
  console.log('==========================================\n');

  if (typeof global.gc !== 'function') {
    console.warn('Warning: --expose-gc flag not set. Memory measurements may be less accurate.');
    console.warn('Run with: npx tsx --expose-gc xlsx/tooling/benchmarks/feature-benchmarks.ts\n');
  }

  const options = parseArgs();

  // Filter specs based on features option
  const selectedSpecs = FEATURE_SPECS.filter((spec) => options.features.includes(spec.category));

  if (selectedSpecs.length === 0) {
    console.error(
      'No valid features specified. Use: styles, formulas, richtext, merges, mixed, baseline',
    );
    process.exit(1);
  }

  // Generate files if requested or if they don't exist
  const needsGeneration = selectedSpecs.some(
    (spec) => !fileExists(join(GENERATED_DIR, 'features', `${spec.name}.xlsx`)),
  );

  if (options.generate || needsGeneration) {
    await generateTestFiles(selectedSpecs);
  }

  // Verify all files exist
  for (const spec of selectedSpecs) {
    const filePath = join(GENERATED_DIR, 'features', `${spec.name}.xlsx`);
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
        const filePath = join(GENERATED_DIR, 'features', `${spec.name}.xlsx`);
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

      for (const spec of selectedSpecs) {
        const filePath = join(GENERATED_DIR, 'features', `${spec.name}.xlsx`);
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
    analyzeResults(allResults);

    // Save results
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    saveResults(allResults, `feature-benchmarks-${timestamp}.json`);
    saveMarkdownReport(allResults, `feature-benchmarks-${timestamp}.md`);

    // Also save latest results
    saveResults(allResults, 'feature-benchmarks-latest.json');
  }

  console.log('\nBenchmark complete!');
}

// Run
main().catch((error) => {
  console.error('Benchmark failed:', error);
  process.exit(1);
});
