/**
 * Memory Leak Detection Tests
 *
 * Tests for memory leaks by parsing multiple files sequentially and verifying
 * memory returns to baseline after garbage collection.
 *
 * Usage:
 *   npx tsx --expose-gc xlsx/tooling/tests/memory/leak-detection.test.ts
 *
 * @module xlsx/tooling/tests/memory/leak-detection
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
 * Leak test result
 */
interface LeakTestResult {
  testName: string;
  iterations: number;
  baselineMemory: number;
  peakMemory: number;
  finalMemory: number;
  memoryGrowth: number;
  memoryGrowthPercent: number;
  passed: boolean;
  threshold: number;
  details: string;
}

/**
 * Leak detection report
 */
interface LeakDetectionReport {
  timestamp: string;
  platform: string;
  wasmVersion: string;
  results: LeakTestResult[];
  summary: {
    totalTests: number;
    passed: number;
    failed: number;
    maxMemoryGrowth: number;
  };
}

// Helper to format bytes
function formatBytes(bytes: number): string {
  if (bytes < 0) return `-${formatBytes(-bytes)}`;
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

// Wait for memory to stabilize
async function stabilizeMemory(): Promise<number> {
  forceGC();
  await new Promise((r) => setTimeout(r, 50));
  forceGC();
  await new Promise((r) => setTimeout(r, 50));
  return process.memoryUsage().heapUsed;
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
 * Test: Parse 100 small files sequentially
 * Memory should return to near-baseline after each batch
 */
async function testManySmallFilesSequential(wasm: WasmModule): Promise<LeakTestResult> {
  const testName = 'Many Small Files Sequential (100 iterations)';
  console.log(`\n=== ${testName} ===\n`);

  const fixturesDir = join(process.cwd(), 'performance/fixtures');
  const testFile = join(fixturesDir, 'smoke-bench.xlsx');

  if (!existsSync(testFile)) {
    return {
      testName,
      iterations: 0,
      baselineMemory: 0,
      peakMemory: 0,
      finalMemory: 0,
      memoryGrowth: 0,
      memoryGrowthPercent: 0,
      passed: false,
      threshold: 0,
      details: 'Test file not found',
    };
  }

  const xlsxData = new Uint8Array(readFileSync(testFile));
  const iterations = 100;
  const threshold = 5 * 1024 * 1024; // Allow 5MB growth tolerance

  // Establish baseline
  const baselineMemory = await stabilizeMemory();
  let peakMemory = baselineMemory;

  console.log(`  Baseline memory: ${formatBytes(baselineMemory)}`);
  console.log(`  Running ${iterations} iterations...`);

  // Parse many times
  for (let i = 0; i < iterations; i++) {
    wasm.parse_xlsx_full(xlsxData);

    // Track peak
    const currentMemory = process.memoryUsage().heapUsed;
    peakMemory = Math.max(peakMemory, currentMemory);

    // Progress every 20 iterations
    if ((i + 1) % 20 === 0) {
      forceGC();
      const afterGC = process.memoryUsage().heapUsed;
      console.log(
        `    Iteration ${i + 1}: current ${formatBytes(afterGC)}, growth ${formatBytes(afterGC - baselineMemory)}`,
      );
    }
  }

  // Final measurement
  const finalMemory = await stabilizeMemory();
  const memoryGrowth = finalMemory - baselineMemory;
  const memoryGrowthPercent = (memoryGrowth / baselineMemory) * 100;
  const passed = memoryGrowth < threshold;

  console.log(`\n  Results:`);
  console.log(`    Peak memory:    ${formatBytes(peakMemory)}`);
  console.log(`    Final memory:   ${formatBytes(finalMemory)}`);
  console.log(
    `    Memory growth:  ${formatBytes(memoryGrowth)} (${memoryGrowthPercent.toFixed(2)}%)`,
  );
  console.log(`    Threshold:      ${formatBytes(threshold)}`);
  console.log(`    Status:         ${passed ? 'PASSED' : 'FAILED'}`);

  return {
    testName,
    iterations,
    baselineMemory,
    peakMemory,
    finalMemory,
    memoryGrowth,
    memoryGrowthPercent,
    passed,
    threshold,
    details: passed
      ? 'No significant leak detected'
      : `Memory growth ${formatBytes(memoryGrowth)} exceeds threshold ${formatBytes(threshold)}`,
  };
}

/**
 * Test: Parse 10 large files sequentially
 */
async function testLargeFilesSequential(wasm: WasmModule): Promise<LeakTestResult> {
  const testName = 'Large Files Sequential (10 iterations)';
  console.log(`\n=== ${testName} ===\n`);

  const fixturesDir = join(process.cwd(), 'performance/fixtures');
  const testFile = join(fixturesDir, 'small-test.xlsx');

  if (!existsSync(testFile)) {
    return {
      testName,
      iterations: 0,
      baselineMemory: 0,
      peakMemory: 0,
      finalMemory: 0,
      memoryGrowth: 0,
      memoryGrowthPercent: 0,
      passed: false,
      threshold: 0,
      details: 'Test file not found',
    };
  }

  const xlsxData = new Uint8Array(readFileSync(testFile));
  const iterations = 10;
  const threshold = 10 * 1024 * 1024; // Allow 10MB growth tolerance for larger files

  // Establish baseline
  const baselineMemory = await stabilizeMemory();
  let peakMemory = baselineMemory;

  console.log(`  Baseline memory: ${formatBytes(baselineMemory)}`);
  console.log(`  Running ${iterations} iterations...`);

  // Parse many times
  for (let i = 0; i < iterations; i++) {
    wasm.parse_xlsx_full(xlsxData);

    // Track peak
    const currentMemory = process.memoryUsage().heapUsed;
    peakMemory = Math.max(peakMemory, currentMemory);

    forceGC();
    const afterGC = process.memoryUsage().heapUsed;
    console.log(
      `    Iteration ${i + 1}: current ${formatBytes(afterGC)}, growth ${formatBytes(afterGC - baselineMemory)}`,
    );
  }

  // Final measurement
  const finalMemory = await stabilizeMemory();
  const memoryGrowth = finalMemory - baselineMemory;
  const memoryGrowthPercent = (memoryGrowth / baselineMemory) * 100;
  const passed = memoryGrowth < threshold;

  console.log(`\n  Results:`);
  console.log(`    Peak memory:    ${formatBytes(peakMemory)}`);
  console.log(`    Final memory:   ${formatBytes(finalMemory)}`);
  console.log(
    `    Memory growth:  ${formatBytes(memoryGrowth)} (${memoryGrowthPercent.toFixed(2)}%)`,
  );
  console.log(`    Threshold:      ${formatBytes(threshold)}`);
  console.log(`    Status:         ${passed ? 'PASSED' : 'FAILED'}`);

  return {
    testName,
    iterations,
    baselineMemory,
    peakMemory,
    finalMemory,
    memoryGrowth,
    memoryGrowthPercent,
    passed,
    threshold,
    details: passed
      ? 'No significant leak detected'
      : `Memory growth ${formatBytes(memoryGrowth)} exceeds threshold ${formatBytes(threshold)}`,
  };
}

/**
 * Test: Create and dispose parser instances repeatedly
 * This tests for leaks in the parser lifecycle
 */
async function testParserInstanceLifecycle(): Promise<LeakTestResult> {
  const testName = 'Parser Instance Lifecycle (50 create/dispose cycles)';
  console.log(`\n=== ${testName} ===\n`);

  const fixturesDir = join(process.cwd(), 'performance/fixtures');
  const testFile = join(fixturesDir, 'smoke-bench.xlsx');

  if (!existsSync(testFile)) {
    return {
      testName,
      iterations: 0,
      baselineMemory: 0,
      peakMemory: 0,
      finalMemory: 0,
      memoryGrowth: 0,
      memoryGrowthPercent: 0,
      passed: false,
      threshold: 0,
      details: 'Test file not found',
    };
  }

  const iterations = 50;
  const threshold = 10 * 1024 * 1024; // Allow 10MB growth

  // Establish baseline after initial WASM load
  const baselineMemory = await stabilizeMemory();
  let peakMemory = baselineMemory;

  console.log(`  Baseline memory: ${formatBytes(baselineMemory)}`);
  console.log(`  Running ${iterations} create/dispose cycles...`);

  const xlsxData = new Uint8Array(readFileSync(testFile));

  for (let i = 0; i < iterations; i++) {
    // Load a fresh WASM module each time (simulating parser instance creation)
    const wasmPath = join(process.cwd(), 'compute/wasm/npm/compute_core_wasm_bg.wasm');
    const wasmBytes = readFileSync(wasmPath);

    const jsModulePath = join(process.cwd(), 'compute/wasm/npm/compute_core_wasm.js');
    const { pathToFileURL } = await import('node:url');
    const jsModuleUrl = pathToFileURL(jsModulePath).href;

    const wasmJsModule = await import(jsModuleUrl + `?instance=${i}`);
    await wasmJsModule.default(wasmBytes);

    const wasm = wasmJsModule as unknown as WasmModule;
    wasm.parse_xlsx_full(xlsxData);

    // Track peak
    const currentMemory = process.memoryUsage().heapUsed;
    peakMemory = Math.max(peakMemory, currentMemory);

    // Progress every 10 iterations
    if ((i + 1) % 10 === 0) {
      forceGC();
      const afterGC = process.memoryUsage().heapUsed;
      console.log(
        `    Cycle ${i + 1}: current ${formatBytes(afterGC)}, growth ${formatBytes(afterGC - baselineMemory)}`,
      );
    }
  }

  // Final measurement
  const finalMemory = await stabilizeMemory();
  const memoryGrowth = finalMemory - baselineMemory;
  const memoryGrowthPercent = (memoryGrowth / baselineMemory) * 100;
  const passed = memoryGrowth < threshold;

  console.log(`\n  Results:`);
  console.log(`    Peak memory:    ${formatBytes(peakMemory)}`);
  console.log(`    Final memory:   ${formatBytes(finalMemory)}`);
  console.log(
    `    Memory growth:  ${formatBytes(memoryGrowth)} (${memoryGrowthPercent.toFixed(2)}%)`,
  );
  console.log(`    Threshold:      ${formatBytes(threshold)}`);
  console.log(`    Status:         ${passed ? 'PASSED' : 'FAILED'}`);

  return {
    testName,
    iterations,
    baselineMemory,
    peakMemory,
    finalMemory,
    memoryGrowth,
    memoryGrowthPercent,
    passed,
    threshold,
    details: passed
      ? 'No significant leak detected'
      : `Memory growth ${formatBytes(memoryGrowth)} exceeds threshold ${formatBytes(threshold)}`,
  };
}

/**
 * Test: Verify no accumulated references
 * Parse same file multiple times with fresh results and verify cleanup
 */
async function testNoAccumulatedReferences(wasm: WasmModule): Promise<LeakTestResult> {
  const testName = 'No Accumulated References';
  console.log(`\n=== ${testName} ===\n`);

  const fixturesDir = join(process.cwd(), 'performance/fixtures');
  const testFile = join(fixturesDir, 'smoke-bench.xlsx');

  if (!existsSync(testFile)) {
    return {
      testName,
      iterations: 0,
      baselineMemory: 0,
      peakMemory: 0,
      finalMemory: 0,
      memoryGrowth: 0,
      memoryGrowthPercent: 0,
      passed: false,
      threshold: 0,
      details: 'Test file not found',
    };
  }

  const xlsxData = new Uint8Array(readFileSync(testFile));
  const iterations = 30;
  const threshold = 2 * 1024 * 1024; // Strict 2MB threshold for reference accumulation

  // Establish baseline
  const baselineMemory = await stabilizeMemory();
  let peakMemory = baselineMemory;

  console.log(`  Baseline memory: ${formatBytes(baselineMemory)}`);
  console.log(`  Running ${iterations} iterations...`);

  // Store results to check for accumulation pattern
  const memoryAfterGC: number[] = [];

  for (let i = 0; i < iterations; i++) {
    wasm.parse_xlsx_full(xlsxData);

    peakMemory = Math.max(peakMemory, process.memoryUsage().heapUsed);

    // Force GC and record
    forceGC();
    memoryAfterGC.push(process.memoryUsage().heapUsed);
  }

  // Check for accumulation pattern (steadily increasing memory)
  const firstThird = memoryAfterGC.slice(0, 10);
  const lastThird = memoryAfterGC.slice(-10);

  const avgFirst = firstThird.reduce((a, b) => a + b, 0) / firstThird.length;
  const avgLast = lastThird.reduce((a, b) => a + b, 0) / lastThird.length;
  const trend = avgLast - avgFirst;

  console.log(
    `  Memory trend: first avg ${formatBytes(avgFirst)}, last avg ${formatBytes(avgLast)}`,
  );
  console.log(`  Trend (last - first avg): ${formatBytes(trend)}`);

  // Final measurement
  const finalMemory = await stabilizeMemory();
  const memoryGrowth = finalMemory - baselineMemory;
  const memoryGrowthPercent = (memoryGrowth / baselineMemory) * 100;

  // Pass if no significant trend and growth under threshold
  const hasAccumulation = trend > threshold;
  const passed = !hasAccumulation && memoryGrowth < threshold;

  console.log(`\n  Results:`);
  console.log(`    Peak memory:       ${formatBytes(peakMemory)}`);
  console.log(`    Final memory:      ${formatBytes(finalMemory)}`);
  console.log(
    `    Memory growth:     ${formatBytes(memoryGrowth)} (${memoryGrowthPercent.toFixed(2)}%)`,
  );
  console.log(`    Accumulation trend: ${formatBytes(trend)}`);
  console.log(`    Has accumulation:  ${hasAccumulation ? 'YES (BAD)' : 'NO (GOOD)'}`);
  console.log(`    Status:            ${passed ? 'PASSED' : 'FAILED'}`);

  return {
    testName,
    iterations,
    baselineMemory,
    peakMemory,
    finalMemory,
    memoryGrowth,
    memoryGrowthPercent,
    passed,
    threshold,
    details: passed
      ? 'No reference accumulation detected'
      : hasAccumulation
        ? `Reference accumulation detected: trend ${formatBytes(trend)}`
        : `Memory growth ${formatBytes(memoryGrowth)} exceeds threshold`,
  };
}

/**
 * Test: Mixed file sizes
 */
async function testMixedFileSizes(wasm: WasmModule): Promise<LeakTestResult> {
  const testName = 'Mixed File Sizes (20 iterations)';
  console.log(`\n=== ${testName} ===\n`);

  const fixturesDir = join(process.cwd(), 'performance/fixtures');
  const testFiles = ['smoke-bench.xlsx', 'small-bench.xlsx', 'smoke-test.xlsx'];

  // Check which files exist
  const existingFiles = testFiles.map((f) => join(fixturesDir, f)).filter((f) => existsSync(f));

  if (existingFiles.length === 0) {
    return {
      testName,
      iterations: 0,
      baselineMemory: 0,
      peakMemory: 0,
      finalMemory: 0,
      memoryGrowth: 0,
      memoryGrowthPercent: 0,
      passed: false,
      threshold: 0,
      details: 'No test files found',
    };
  }

  const iterations = 20;
  const threshold = 8 * 1024 * 1024; // 8MB threshold for mixed sizes

  // Establish baseline
  const baselineMemory = await stabilizeMemory();
  let peakMemory = baselineMemory;

  console.log(`  Baseline memory: ${formatBytes(baselineMemory)}`);
  console.log(`  Using files: ${existingFiles.map((f) => basename(f)).join(', ')}`);
  console.log(`  Running ${iterations} iterations...`);

  for (let i = 0; i < iterations; i++) {
    // Cycle through files
    const filePath = existingFiles[i % existingFiles.length];
    const xlsxData = new Uint8Array(readFileSync(filePath));

    wasm.parse_xlsx_full(xlsxData);

    peakMemory = Math.max(peakMemory, process.memoryUsage().heapUsed);

    if ((i + 1) % 5 === 0) {
      forceGC();
      const afterGC = process.memoryUsage().heapUsed;
      console.log(
        `    Iteration ${i + 1}: file=${basename(filePath)}, memory=${formatBytes(afterGC)}`,
      );
    }
  }

  // Final measurement
  const finalMemory = await stabilizeMemory();
  const memoryGrowth = finalMemory - baselineMemory;
  const memoryGrowthPercent = (memoryGrowth / baselineMemory) * 100;
  const passed = memoryGrowth < threshold;

  console.log(`\n  Results:`);
  console.log(`    Peak memory:    ${formatBytes(peakMemory)}`);
  console.log(`    Final memory:   ${formatBytes(finalMemory)}`);
  console.log(
    `    Memory growth:  ${formatBytes(memoryGrowth)} (${memoryGrowthPercent.toFixed(2)}%)`,
  );
  console.log(`    Threshold:      ${formatBytes(threshold)}`);
  console.log(`    Status:         ${passed ? 'PASSED' : 'FAILED'}`);

  return {
    testName,
    iterations,
    baselineMemory,
    peakMemory,
    finalMemory,
    memoryGrowth,
    memoryGrowthPercent,
    passed,
    threshold,
    details: passed
      ? 'No significant leak detected'
      : `Memory growth ${formatBytes(memoryGrowth)} exceeds threshold ${formatBytes(threshold)}`,
  };
}

// Main test runner
async function main(): Promise<void> {
  console.log('Memory Leak Detection Tests');
  console.log('='.repeat(60));

  if (typeof global.gc !== 'function') {
    console.warn('\nWarning: --expose-gc flag not set. Run with:');
    console.warn('  npx tsx --expose-gc xlsx/tooling/tests/memory/leak-detection.test.ts\n');
  }

  const wasm = await loadWasmModule();
  console.log(`WASM module version: ${wasm.version()}`);

  const results: LeakTestResult[] = [];

  try {
    // Run all leak detection tests
    results.push(await testManySmallFilesSequential(wasm));
    results.push(await testLargeFilesSequential(wasm));
    results.push(await testParserInstanceLifecycle());
    results.push(await testNoAccumulatedReferences(wasm));
    results.push(await testMixedFileSizes(wasm));

    // Generate report
    const report: LeakDetectionReport = {
      timestamp: new Date().toISOString(),
      platform: `${process.platform} ${process.arch} Node ${process.version}`,
      wasmVersion: wasm.version(),
      results,
      summary: {
        totalTests: results.length,
        passed: results.filter((r) => r.passed).length,
        failed: results.filter((r) => !r.passed).length,
        maxMemoryGrowth: Math.max(...results.map((r) => r.memoryGrowth), 0),
      },
    };

    // Save report
    const reportPath = join(process.cwd(), 'xlsx/tooling/tests/memory/leak-detection-report.json');
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\nReport saved to: ${reportPath}`);

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('LEAK DETECTION SUMMARY');
    console.log('='.repeat(60));

    for (const result of results) {
      const icon = result.passed ? '[OK]' : '[!!]';
      console.log(`  ${icon} ${result.testName}`);
      console.log(
        `      Growth: ${formatBytes(result.memoryGrowth)} / ${formatBytes(result.threshold)} threshold`,
      );
    }

    console.log('\n  Summary:');
    console.log(`    Total:  ${report.summary.totalTests}`);
    console.log(`    Passed: ${report.summary.passed}`);
    console.log(`    Failed: ${report.summary.failed}`);
    console.log(`    Max growth: ${formatBytes(report.summary.maxMemoryGrowth)}`);

    if (report.summary.failed > 0) {
      console.log('\n=== LEAK DETECTION TESTS FAILED ===\n');
      process.exit(1);
    } else {
      console.log('\n=== All Leak Detection Tests Passed ===\n');
    }
  } catch (error) {
    console.error('\nTest failed:', error);
    process.exit(1);
  }
}

// Run tests
main().catch(console.error);
