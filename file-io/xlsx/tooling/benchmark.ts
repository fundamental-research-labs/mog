/**
 * XLSX Parser WASM Benchmark
 *
 * Measures the performance of the WASM-based XLSX parser and compares
 * it against the JSZip + fast-xml-parser based importer.
 *
 * Usage:
 *   npx tsx --expose-gc xlsx/tooling/benchmark.ts
 *
 * Metrics:
 *   - Parse latency (mean, min, max, p95)
 *   - Memory usage (peak, retained)
 *   - Throughput (cells/second)
 *   - Comparison with fast-xml-parser
 */

import { XMLParser } from 'fast-xml-parser';
import JSZip from 'jszip';
import { readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

// Types for WASM module (bridge-generated parse_xlsx_full)
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

interface BenchmarkResult {
  file: string;
  fileSize: number;
  cellCount: number;
  sheetCount: number;
  iterations: number;
  latency: {
    mean: number;
    min: number;
    max: number;
    p95: number;
    stdDev: number;
  };
  memory: {
    peakHeapUsed: number;
    retainedHeapUsed: number;
  };
  throughput: {
    cellsPerSecond: number;
    bytesPerSecond: number;
  };
}

// Helper to format bytes
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// Helper to format numbers with commas
function formatNumber(num: number): string {
  return num.toLocaleString('en-US');
}

// Calculate statistics from an array of numbers
function calculateStats(values: number[]): {
  mean: number;
  min: number;
  max: number;
  p95: number;
  stdDev: number;
} {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;

  return {
    mean,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    stdDev: Math.sqrt(variance),
  };
}

// Force garbage collection if available
function forceGC(): void {
  if (typeof global.gc === 'function') {
    global.gc();
  }
}

// Get current memory usage
function getMemoryUsage(): { heapUsed: number; external: number } {
  const mem = process.memoryUsage();
  return {
    heapUsed: mem.heapUsed,
    external: mem.external,
  };
}

// Load WASM module for Node.js
async function loadWasmModule(): Promise<WasmModule> {
  const wasmPath = join(process.cwd(), 'compute/wasm/npm/compute_core_wasm_bg.wasm');

  // Read the WASM binary
  const wasmBytes = readFileSync(wasmPath);

  // Import the JS wrapper
  const jsModulePath = join(process.cwd(), 'compute/wasm/npm/compute_core_wasm.js');

  // We need to use dynamic import with file URL
  const { pathToFileURL } = await import('node:url');
  const jsModuleUrl = pathToFileURL(jsModulePath).href;

  const wasmJsModule = await import(jsModuleUrl);

  // Initialize with the WASM bytes (panic hook is auto-set via #[wasm_bindgen(start)])
  await wasmJsModule.default(wasmBytes);

  return wasmJsModule as unknown as WasmModule;
}

// Run benchmark for a single file
async function benchmarkFile(
  wasm: WasmModule,
  filePath: string,
  iterations: number = 10,
  warmupIterations: number = 3,
): Promise<BenchmarkResult> {
  const fileStats = statSync(filePath);
  const fileSize = fileStats.size;
  const fileName = basename(filePath);

  console.log(`\nBenchmarking: ${fileName} (${formatBytes(fileSize)})`);
  console.log('='.repeat(60));

  // Read file into memory
  const xlsxBytes = readFileSync(filePath);
  const xlsxData = new Uint8Array(xlsxBytes);

  // Warmup runs
  console.log(`Running ${warmupIterations} warmup iterations...`);
  let cellCount = 0;
  let sheetCount = 0;

  for (let i = 0; i < warmupIterations; i++) {
    const result = wasm.parse_xlsx_full(xlsxData);
    cellCount = result.stats.total_cells;
    sheetCount = result.stats.total_sheets;
  }

  console.log(`  Cells: ${formatNumber(cellCount)}, Sheets: ${sheetCount}`);

  // Force GC before measurements
  forceGC();
  const baselineMemory = getMemoryUsage();

  // Benchmark runs
  console.log(`Running ${iterations} benchmark iterations...`);
  const timings: number[] = [];
  let peakHeapUsed = baselineMemory.heapUsed;

  for (let i = 0; i < iterations; i++) {
    // Force GC before each iteration for more accurate measurements
    forceGC();

    const startTime = performance.now();
    wasm.parse_xlsx_full(xlsxData);
    const endTime = performance.now();

    const parseTimeMs = endTime - startTime;
    timings.push(parseTimeMs);

    // Track peak memory
    const currentMemory = getMemoryUsage();
    peakHeapUsed = Math.max(peakHeapUsed, currentMemory.heapUsed);

    // Progress indicator
    if ((i + 1) % Math.ceil(iterations / 10) === 0) {
      process.stdout.write('.');
    }
  }
  console.log(' done');

  // Final GC and measure retained memory
  forceGC();
  const finalMemory = getMemoryUsage();

  // Calculate statistics
  const stats = calculateStats(timings);

  const result: BenchmarkResult = {
    file: fileName,
    fileSize,
    cellCount,
    sheetCount,
    iterations,
    latency: {
      mean: stats.mean,
      min: stats.min,
      max: stats.max,
      p95: stats.p95,
      stdDev: stats.stdDev,
    },
    memory: {
      peakHeapUsed: peakHeapUsed - baselineMemory.heapUsed,
      retainedHeapUsed: finalMemory.heapUsed - baselineMemory.heapUsed,
    },
    throughput: {
      cellsPerSecond: cellCount / (stats.mean / 1000),
      bytesPerSecond: fileSize / (stats.mean / 1000),
    },
  };

  return result;
}

// Print benchmark results
function printResults(results: BenchmarkResult[]): void {
  console.log('\n');
  console.log('='.repeat(80));
  console.log('BENCHMARK RESULTS');
  console.log('='.repeat(80));

  for (const r of results) {
    console.log(`\n${r.file}`);
    console.log('-'.repeat(60));

    console.log('\nFile Info:');
    console.log(`  Size:       ${formatBytes(r.fileSize)}`);
    console.log(`  Cells:      ${formatNumber(r.cellCount)}`);
    console.log(`  Sheets:     ${r.sheetCount}`);
    console.log(`  Iterations: ${r.iterations}`);

    console.log('\nLatency (ms):');
    console.log(`  Mean:   ${r.latency.mean.toFixed(3)}`);
    console.log(`  Min:    ${r.latency.min.toFixed(3)}`);
    console.log(`  Max:    ${r.latency.max.toFixed(3)}`);
    console.log(`  P95:    ${r.latency.p95.toFixed(3)}`);
    console.log(`  StdDev: ${r.latency.stdDev.toFixed(3)}`);

    console.log('\nMemory:');
    console.log(`  Peak Heap:     ${formatBytes(r.memory.peakHeapUsed)}`);
    console.log(`  Retained Heap: ${formatBytes(r.memory.retainedHeapUsed)}`);

    console.log('\nThroughput:');
    console.log(`  Cells/sec:  ${formatNumber(Math.round(r.throughput.cellsPerSecond))}`);
    console.log(`  Bytes/sec:  ${formatBytes(r.throughput.bytesPerSecond)}/s`);
  }

  // Summary table
  console.log('\n');
  console.log('='.repeat(80));
  console.log('SUMMARY TABLE');
  console.log('='.repeat(80));
  console.log(
    '\n' +
      'File'.padEnd(25) +
      'Size'.padStart(12) +
      'Cells'.padStart(12) +
      'Mean (ms)'.padStart(12) +
      'P95 (ms)'.padStart(12) +
      'Cells/sec'.padStart(15),
  );
  console.log('-'.repeat(88));

  for (const r of results) {
    console.log(
      r.file.slice(0, 24).padEnd(25) +
        formatBytes(r.fileSize).padStart(12) +
        formatNumber(r.cellCount).padStart(12) +
        r.latency.mean.toFixed(2).padStart(12) +
        r.latency.p95.toFixed(2).padStart(12) +
        formatNumber(Math.round(r.throughput.cellsPerSecond)).padStart(15),
    );
  }
}

// ==========================================
// JSZip + fast-xml-parser baseline benchmark
// ==========================================

// XML parser for fast-xml-parser comparison
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseAttributeValue: true,
  trimValues: true,
});

interface FastXmlBenchmarkResult {
  file: string;
  fileSize: number;
  cellCount: number;
  latency: {
    mean: number;
    min: number;
    max: number;
    p95: number;
    stdDev: number;
  };
  throughput: {
    cellsPerSecond: number;
    bytesPerSecond: number;
  };
}

// Count cells in a worksheet using fast-xml-parser
function countCellsInWorksheetXml(worksheetXml: string): number {
  const worksheet = xmlParser.parse(worksheetXml);
  let count = 0;

  const rows = worksheet?.worksheet?.sheetData?.row;
  if (!rows) return 0;

  const rowArray = Array.isArray(rows) ? rows : [rows];
  for (const row of rowArray) {
    if (!row) continue;
    const cells = row.c;
    if (!cells) continue;
    const cellArray = Array.isArray(cells) ? cells : [cells];
    count += cellArray.filter((c: unknown) => c !== null && c !== undefined).length;
  }

  return count;
}

// Benchmark JSZip + fast-xml-parser
async function benchmarkFastXmlParser(
  filePath: string,
  iterations: number = 10,
  warmupIterations: number = 3,
): Promise<FastXmlBenchmarkResult> {
  const fileStats = statSync(filePath);
  const fileSize = fileStats.size;
  const fileName = basename(filePath);

  console.log(`\nBenchmarking fast-xml-parser: ${fileName} (${formatBytes(fileSize)})`);
  console.log('='.repeat(60));

  // Read file into memory
  const xlsxBytes = readFileSync(filePath);

  // Warmup runs
  console.log(`Running ${warmupIterations} warmup iterations...`);
  let totalCells = 0;

  for (let i = 0; i < warmupIterations; i++) {
    const zip = await JSZip.loadAsync(xlsxBytes);
    let cells = 0;

    // Parse each worksheet
    const sheetFiles = Object.keys(zip.files).filter(
      (f) => f.startsWith('xl/worksheets/sheet') && f.endsWith('.xml'),
    );

    for (const sheetFile of sheetFiles) {
      const xml = await zip.file(sheetFile)?.async('string');
      if (xml) {
        cells += countCellsInWorksheetXml(xml);
      }
    }

    totalCells = cells;
  }

  console.log(`  Cells: ${formatNumber(totalCells)}`);

  // Benchmark runs
  console.log(`Running ${iterations} benchmark iterations...`);
  const timings: number[] = [];

  for (let i = 0; i < iterations; i++) {
    forceGC();

    const startTime = performance.now();

    // Full parse: JSZip + fast-xml-parser
    const zip = await JSZip.loadAsync(xlsxBytes);

    // Parse worksheets
    const sheetFiles = Object.keys(zip.files).filter(
      (f) => f.startsWith('xl/worksheets/sheet') && f.endsWith('.xml'),
    );

    for (const sheetFile of sheetFiles) {
      const xml = await zip.file(sheetFile)?.async('string');
      if (xml) {
        // Parse the XML (we don't process it further to measure pure parsing)
        xmlParser.parse(xml);
      }
    }

    const endTime = performance.now();
    timings.push(endTime - startTime);

    // Progress indicator
    if ((i + 1) % Math.ceil(iterations / 10) === 0) {
      process.stdout.write('.');
    }
  }
  console.log(' done');

  // Calculate statistics
  const stats = calculateStats(timings);

  return {
    file: fileName,
    fileSize,
    cellCount: totalCells,
    latency: stats,
    throughput: {
      cellsPerSecond: totalCells / (stats.mean / 1000),
      bytesPerSecond: fileSize / (stats.mean / 1000),
    },
  };
}

// Print comparison results
function printComparisonResults(
  wasmResults: BenchmarkResult[],
  fastXmlResults: FastXmlBenchmarkResult[],
): void {
  console.log('\n');
  console.log('='.repeat(90));
  console.log('COMPARISON: WASM vs fast-xml-parser');
  console.log('='.repeat(90));

  console.log(
    '\n' +
      'File'.padEnd(25) +
      'WASM (ms)'.padStart(12) +
      'FXP (ms)'.padStart(12) +
      'Speedup'.padStart(10) +
      'WASM cells/s'.padStart(15) +
      'FXP cells/s'.padStart(15),
  );
  console.log('-'.repeat(89));

  for (let i = 0; i < wasmResults.length; i++) {
    const wasm = wasmResults[i];
    const fxp = fastXmlResults[i];

    if (!wasm || !fxp) continue;

    const speedup = fxp.latency.mean / wasm.latency.mean;
    const speedupStr =
      speedup >= 1 ? `${speedup.toFixed(2)}x` : `${(1 / speedup).toFixed(2)}x slower`;

    console.log(
      wasm.file.slice(0, 24).padEnd(25) +
        wasm.latency.mean.toFixed(2).padStart(12) +
        fxp.latency.mean.toFixed(2).padStart(12) +
        speedupStr.padStart(10) +
        formatNumber(Math.round(wasm.throughput.cellsPerSecond)).padStart(15) +
        formatNumber(Math.round(fxp.throughput.cellsPerSecond)).padStart(15),
    );
  }
}

// Main benchmark function
async function main(): Promise<void> {
  console.log('XLSX Parser WASM Benchmark');
  console.log('==========================\n');

  // Check for --expose-gc flag
  if (typeof global.gc !== 'function') {
    console.warn('Warning: --expose-gc flag not set. Memory measurements may be less accurate.');
    console.warn('Run with: node --expose-gc benchmark.ts\n');
  }

  // Load WASM module
  console.log('Loading WASM module...');
  const wasm = await loadWasmModule();
  console.log(`WASM module loaded. Version: ${wasm.version()}`);

  // Test fixture files
  const fixturesDir = join(process.cwd(), 'performance/fixtures');
  const testFiles = ['smoke-bench.xlsx', 'small-bench.xlsx', 'smoke-test.xlsx', 'small-test.xlsx'];

  const wasmResults: BenchmarkResult[] = [];
  const fastXmlResults: FastXmlBenchmarkResult[] = [];

  // Run WASM benchmarks
  console.log('\n' + '='.repeat(80));
  console.log('WASM PARSER BENCHMARKS');
  console.log('='.repeat(80));

  for (const file of testFiles) {
    const filePath = join(fixturesDir, file);
    try {
      const result = await benchmarkFile(wasm, filePath, 20, 5);
      wasmResults.push(result);
    } catch (error) {
      console.error(`Error benchmarking ${file}:`, error);
    }
  }

  // Run fast-xml-parser benchmarks for comparison
  console.log('\n' + '='.repeat(80));
  console.log('FAST-XML-PARSER BENCHMARKS (JSZip + fast-xml-parser)');
  console.log('='.repeat(80));

  for (const file of testFiles) {
    const filePath = join(fixturesDir, file);
    try {
      const result = await benchmarkFastXmlParser(filePath, 20, 5);
      fastXmlResults.push(result);
    } catch (error) {
      console.error(`Error benchmarking ${file} with fast-xml-parser:`, error);
    }
  }

  // Print WASM results
  printResults(wasmResults);

  // Print comparison
  printComparisonResults(wasmResults, fastXmlResults);

  console.log('\nBenchmark complete!');
}

// Run
main().catch(console.error);
