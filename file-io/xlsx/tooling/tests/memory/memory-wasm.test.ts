/**
 * WASM Memory Profiling Tests
 *
 * Tests WASM linear memory growth during parsing and creates memory profiles.
 *
 * Usage:
 *   npx tsx --expose-gc xlsx/tooling/tests/memory/memory-wasm.test.ts
 *
 * @module xlsx/tooling/tests/memory/memory-wasm
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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

/**
 * Memory profile result for a single parse operation
 */
interface WasmMemoryProfile {
  file: string;
  fileSize: number;
  cellCount: number;
  sheetCount: number;
  memoryUsage: {
    totalUsed: number;
    bytesPerCell: number;
  };
  peakMemory: number;
  parseTimeMs: number;
  timestamp: string;
}

/**
 * Aggregated memory profile report
 */
interface WasmMemoryReport {
  version: string;
  timestamp: string;
  platform: string;
  profiles: WasmMemoryProfile[];
  summary: {
    totalFilesProcessed: number;
    totalCellsParsed: number;
    averageBytesPerCell: number;
    peakMemoryUsed: number;
    averageParseTimeMs: number;
  };
}

// Helper to format bytes
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// Force garbage collection
function forceGC(): void {
  if (typeof global.gc === 'function') {
    global.gc();
    global.gc(); // Run twice for thorough cleanup
  }
}

// Load WASM module
async function loadWasmModule(): Promise<WasmModule> {
  const wasmPath = join(process.cwd(), 'compute/wasm/npm/compute_core_wasm_bg.wasm');
  const wasmBytes = readFileSync(wasmPath);

  const jsModulePath = join(process.cwd(), 'compute/wasm/npm/compute_core_wasm.js');
  const { pathToFileURL } = await import('node:url');
  const jsModuleUrl = pathToFileURL(jsModulePath).href;

  const wasmJsModule = await import(jsModuleUrl);
  await wasmJsModule.default(wasmBytes);

  return wasmJsModule as unknown as WasmModule;
}

/**
 * Profile WASM memory usage for a single file
 */
async function profileWasmMemory(wasm: WasmModule, filePath: string): Promise<WasmMemoryProfile> {
  const fileSize = readFileSync(filePath).length;
  const fileName = basename(filePath);
  const xlsxData = new Uint8Array(readFileSync(filePath));

  forceGC();
  const beforeParse = process.memoryUsage();

  // Parse file using bridge-generated parse_xlsx_full
  const startTime = performance.now();
  const result = wasm.parse_xlsx_full(xlsxData);
  const endTime = performance.now();

  const cellCount = result.stats.total_cells;
  const sheetCount = result.stats.total_sheets;

  const afterParse = process.memoryUsage();
  const totalUsed = afterParse.heapUsed - beforeParse.heapUsed;

  const profile: WasmMemoryProfile = {
    file: fileName,
    fileSize,
    cellCount,
    sheetCount,
    memoryUsage: {
      totalUsed,
      bytesPerCell: cellCount > 0 ? totalUsed / cellCount : 0,
    },
    peakMemory: afterParse.heapUsed,
    parseTimeMs: endTime - startTime,
    timestamp: new Date().toISOString(),
  };

  return profile;
}

/**
 * Test: Profile WASM memory for different file sizes
 */
async function testWasmMemoryProfile(): Promise<void> {
  console.log('\n=== WASM Memory Profiling Test ===\n');

  if (typeof global.gc !== 'function') {
    console.warn('Warning: --expose-gc flag not set. Run with:');
    console.warn('  npx tsx --expose-gc xlsx/tooling/tests/memory/memory-wasm.test.ts\n');
  }

  const wasm = await loadWasmModule();
  console.log(`WASM module version: ${wasm.version()}`);

  const fixturesDir = join(process.cwd(), 'performance/fixtures');
  const testFiles = ['smoke-bench.xlsx', 'small-bench.xlsx', 'smoke-test.xlsx', 'small-test.xlsx'];

  const profiles: WasmMemoryProfile[] = [];

  for (const file of testFiles) {
    const filePath = join(fixturesDir, file);
    if (!existsSync(filePath)) {
      console.log(`  Skipping ${file} - not found`);
      continue;
    }

    console.log(`\nProfiling: ${file}`);
    console.log('-'.repeat(50));

    try {
      forceGC();
      const profile = await profileWasmMemory(wasm, filePath);
      profiles.push(profile);

      console.log(`  File size:        ${formatBytes(profile.fileSize)}`);
      console.log(`  Cells:            ${profile.cellCount.toLocaleString()}`);
      console.log(`  Sheets:           ${profile.sheetCount}`);
      console.log(`  Memory used:      ${formatBytes(profile.memoryUsage.totalUsed)}`);
      console.log(`  Bytes per cell:   ${profile.memoryUsage.bytesPerCell.toFixed(2)}`);
      console.log(`  Peak memory:      ${formatBytes(profile.peakMemory)}`);
      console.log(`  Parse time:       ${profile.parseTimeMs.toFixed(2)}ms`);
    } catch (error) {
      console.error(`  Error: ${error}`);
    }
  }

  // Generate report
  const report: WasmMemoryReport = {
    version: wasm.version(),
    timestamp: new Date().toISOString(),
    platform: `${process.platform} ${process.arch} Node ${process.version}`,
    profiles,
    summary: {
      totalFilesProcessed: profiles.length,
      totalCellsParsed: profiles.reduce((sum, p) => sum + p.cellCount, 0),
      averageBytesPerCell:
        profiles.length > 0
          ? profiles.reduce((sum, p) => sum + p.memoryUsage.bytesPerCell, 0) / profiles.length
          : 0,
      peakMemoryUsed: Math.max(...profiles.map((p) => p.peakMemory), 0),
      averageParseTimeMs:
        profiles.length > 0
          ? profiles.reduce((sum, p) => sum + p.parseTimeMs, 0) / profiles.length
          : 0,
    },
  };

  // Save report
  const reportPath = join(process.cwd(), 'xlsx/tooling/tests/memory/wasm-memory-report.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nReport saved to: ${reportPath}`);

  // Print summary
  console.log('\n=== Summary ===');
  console.log(`  Files processed:      ${report.summary.totalFilesProcessed}`);
  console.log(`  Total cells parsed:   ${report.summary.totalCellsParsed.toLocaleString()}`);
  console.log(`  Avg bytes per cell:   ${report.summary.averageBytesPerCell.toFixed(2)}`);
  console.log(`  Peak memory:          ${formatBytes(report.summary.peakMemoryUsed)}`);
  console.log(`  Avg parse time:       ${report.summary.averageParseTimeMs.toFixed(2)}ms`);
}

/**
 * Test: Track memory growth during parsing
 */
async function testMemoryGrowthDuringParse(): Promise<void> {
  console.log('\n=== Memory Growth During Parse Test ===\n');

  const wasm = await loadWasmModule();
  const fixturesDir = join(process.cwd(), 'performance/fixtures');
  const testFile = join(fixturesDir, 'small-test.xlsx');

  if (!existsSync(testFile)) {
    console.log('Test file not found, skipping');
    return;
  }

  const xlsxData = new Uint8Array(readFileSync(testFile));

  // Test memory growth across multiple parses
  const iterations = [1, 2, 3, 4];

  console.log('Testing memory growth with repeated parses:\n');

  for (const iter of iterations) {
    forceGC();
    const beforeMem = process.memoryUsage();

    const result = wasm.parse_xlsx_full(xlsxData);
    const afterParseMem = process.memoryUsage();

    const parseGrowth = afterParseMem.heapUsed - beforeMem.heapUsed;

    console.log(`  Iteration ${iter}:`);
    console.log(`    Parse overhead:    +${formatBytes(parseGrowth)}`);
    console.log(`    Cells parsed:      ${result.stats.total_cells.toLocaleString()}`);
    console.log('');
  }
}

/**
 * Test: Profile memory per feature (styles, cells, formulas)
 */
async function testFeatureMemoryBreakdown(): Promise<void> {
  console.log('\n=== Feature Memory Breakdown Test ===\n');

  const wasm = await loadWasmModule();
  const fixturesDir = join(process.cwd(), 'performance/fixtures');

  const testFile = join(fixturesDir, 'small-bench.xlsx');
  if (!existsSync(testFile)) {
    console.log('Test file not found, skipping');
    return;
  }

  const xlsxData = new Uint8Array(readFileSync(testFile));

  forceGC();
  const beforeMem = process.memoryUsage();

  const result = wasm.parse_xlsx_full(xlsxData);
  const afterMem = process.memoryUsage();

  const cellCount = result.stats.total_cells;
  const totalUsed = afterMem.heapUsed - beforeMem.heapUsed;

  console.log('Memory breakdown:');
  console.log(`  Total cells:     ${cellCount}`);
  console.log(`  Total memory:    ${formatBytes(totalUsed)}`);
  console.log(`  Bytes per cell:  ${cellCount > 0 ? (totalUsed / cellCount).toFixed(2) : 'N/A'}`);
}

// Main test runner
async function main(): Promise<void> {
  console.log('WASM Memory Profiling Tests');
  console.log('='.repeat(60));

  try {
    await testWasmMemoryProfile();
    await testMemoryGrowthDuringParse();
    await testFeatureMemoryBreakdown();

    console.log('\n=== All WASM Memory Tests Passed ===\n');
  } catch (error) {
    console.error('\nTest failed:', error);
    process.exit(1);
  }
}

// Run tests
main().catch(console.error);
