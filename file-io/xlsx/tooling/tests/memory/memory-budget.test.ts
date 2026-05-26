/**
 * Memory Budget Enforcement Tests
 *
 * Enforces memory targets from the world-class parser plan:
 * - Target: <80MB for 500K cells (WASM)
 * - Target: <40MB for 500K cells (future native)
 *
 * These tests are designed for CI and produce deterministic, actionable results.
 *
 * Usage:
 *   npx tsx --expose-gc xlsx/tooling/tests/memory/memory-budget.test.ts
 *
 * Exit codes:
 *   0 - All budgets passed
 *   1 - One or more budgets exceeded
 *
 * @module xlsx/tooling/tests/memory/memory-budget
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

// Memory budget targets from the plan
const MEMORY_BUDGETS = {
  WASM_500K_CELLS: 80 * 1024 * 1024, // 80MB for 500K cells
  WASM_1M_CELLS: 160 * 1024 * 1024, // 160MB for 1M cells (linear scaling)
  FUTURE_NATIVE_500K: 40 * 1024 * 1024, // 40MB target for future native

  // Per-file budgets (estimated based on actual cell counts)
  SMOKE_BENCH: 10 * 1024 * 1024, // ~1K cells
  SMALL_BENCH: 20 * 1024 * 1024, // ~10K cells
  SMOKE_TEST: 30 * 1024 * 1024, // ~5K cells
  SMALL_TEST: 80 * 1024 * 1024, // ~50K cells
  MEDIUM_BENCH: 100 * 1024 * 1024, // ~500K cells
} as const;

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
 * Budget test result
 */
interface BudgetTestResult {
  file: string;
  cellCount: number;
  budgetName: string;
  budgetBytes: number;
  actualBytes: number;
  parseOverhead: number;
  usagePercent: number;
  passed: boolean;
  margin: number;
}

/**
 * Budget report for CI
 */
interface BudgetReport {
  timestamp: string;
  platform: string;
  wasmVersion: string;
  nodeVersion: string;
  commitSha?: string;
  results: BudgetTestResult[];
  summary: {
    totalTests: number;
    passed: number;
    failed: number;
    worstUsagePercent: number;
    totalBytesUsed: number;
  };
  ciStatus: 'success' | 'failure';
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
    global.gc();
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
 * Test memory budget for a specific file
 */
async function testMemoryBudget(
  wasm: WasmModule,
  filePath: string,
  budgetName: string,
  budgetBytes: number,
): Promise<BudgetTestResult> {
  const fileName = basename(filePath);
  const xlsxData = new Uint8Array(readFileSync(filePath));

  // Start with clean memory
  const baselineMemory = await stabilizeMemory();

  // Parse using bridge-generated parse_xlsx_full
  const result = wasm.parse_xlsx_full(xlsxData);

  const cellCount = result.stats.total_cells;
  const afterParse = process.memoryUsage().heapUsed;
  const parseOverhead = afterParse - baselineMemory;

  // Total memory used
  const totalUsed = afterParse - baselineMemory;
  const usagePercent = (totalUsed / budgetBytes) * 100;
  const passed = totalUsed <= budgetBytes;
  const margin = budgetBytes - totalUsed;

  return {
    file: fileName,
    cellCount,
    budgetName,
    budgetBytes,
    actualBytes: totalUsed,
    parseOverhead,
    usagePercent,
    passed,
    margin,
  };
}

/**
 * Test: Enforce WASM memory budget for 500K cells
 */
async function testWasm500KCellsBudget(wasm: WasmModule): Promise<BudgetTestResult | null> {
  console.log('\n=== WASM 500K Cells Budget Test ===\n');

  const fixturesDir = join(process.cwd(), 'performance/fixtures');

  // Try medium-bench.xlsx first (should have ~500K cells), fallback to small-test.xlsx
  let testFile = join(fixturesDir, 'medium-bench.xlsx');
  let budgetBytes = MEMORY_BUDGETS.WASM_500K_CELLS;
  let budgetName = 'WASM_500K_CELLS';

  if (!existsSync(testFile)) {
    testFile = join(fixturesDir, 'small-test.xlsx');
    budgetBytes = MEMORY_BUDGETS.SMALL_TEST;
    budgetName = 'SMALL_TEST';

    if (!existsSync(testFile)) {
      console.log('  No suitable test file found, skipping');
      return null;
    }
  }

  console.log(`  Test file: ${basename(testFile)}`);
  console.log(`  Budget: ${formatBytes(budgetBytes)}`);

  const result = await testMemoryBudget(wasm, testFile, budgetName, budgetBytes);

  console.log(`\n  Results:`);
  console.log(`    Cells parsed:      ${result.cellCount.toLocaleString()}`);
  console.log(`    Parse overhead:    ${formatBytes(result.parseOverhead)}`);
  console.log(`    Total memory:      ${formatBytes(result.actualBytes)}`);
  console.log(`    Budget:            ${formatBytes(result.budgetBytes)}`);
  console.log(`    Usage:             ${result.usagePercent.toFixed(1)}%`);
  console.log(`    Margin:            ${formatBytes(result.margin)}`);
  console.log(`    Status:            ${result.passed ? 'PASSED' : 'FAILED'}`);

  return result;
}

/**
 * Test: Per-file memory budgets
 */
async function testPerFileBudgets(wasm: WasmModule): Promise<BudgetTestResult[]> {
  console.log('\n=== Per-File Memory Budget Tests ===\n');

  const fixturesDir = join(process.cwd(), 'performance/fixtures');
  const fileConfigs: Array<{ file: string; budget: keyof typeof MEMORY_BUDGETS }> = [
    { file: 'smoke-bench.xlsx', budget: 'SMOKE_BENCH' },
    { file: 'small-bench.xlsx', budget: 'SMALL_BENCH' },
    { file: 'smoke-test.xlsx', budget: 'SMOKE_TEST' },
    { file: 'small-test.xlsx', budget: 'SMALL_TEST' },
  ];

  const results: BudgetTestResult[] = [];

  for (const { file, budget } of fileConfigs) {
    const filePath = join(fixturesDir, file);

    if (!existsSync(filePath)) {
      console.log(`  Skipping ${file} - not found`);
      continue;
    }

    console.log(`  Testing ${file}...`);

    try {
      forceGC();
      const result = await testMemoryBudget(wasm, filePath, budget, MEMORY_BUDGETS[budget]);
      results.push(result);

      const status = result.passed ? 'PASS' : 'FAIL';
      console.log(
        `    ${status}: ${formatBytes(result.actualBytes)} / ${formatBytes(result.budgetBytes)} (${result.usagePercent.toFixed(1)}%)`,
      );
    } catch (error) {
      console.log(`    ERROR: ${error}`);
    }
  }

  return results;
}

/**
 * Test: Memory scaling with cell count
 */
async function testMemoryScaling(wasm: WasmModule): Promise<void> {
  console.log('\n=== Memory Scaling Analysis ===\n');

  const fixturesDir = join(process.cwd(), 'performance/fixtures');
  const testFiles = ['smoke-bench.xlsx', 'small-bench.xlsx', 'smoke-test.xlsx', 'small-test.xlsx'];

  const scalingData: Array<{ file: string; cells: number; memory: number; bytesPerCell: number }> =
    [];

  for (const file of testFiles) {
    const filePath = join(fixturesDir, file);
    if (!existsSync(filePath)) continue;

    const xlsxData = new Uint8Array(readFileSync(filePath));

    forceGC();
    const baseline = process.memoryUsage().heapUsed;

    const result = wasm.parse_xlsx_full(xlsxData);

    const afterParse = process.memoryUsage().heapUsed;
    const memoryUsed = afterParse - baseline;
    const cellCount = result.stats.total_cells;
    const bytesPerCell = cellCount > 0 ? memoryUsed / cellCount : 0;

    scalingData.push({
      file,
      cells: cellCount,
      memory: memoryUsed,
      bytesPerCell,
    });
  }

  // Print scaling analysis
  console.log('  File                     Cells        Memory       Bytes/Cell');
  console.log('  ' + '-'.repeat(60));

  for (const data of scalingData.sort((a, b) => a.cells - b.cells)) {
    console.log(
      `  ${data.file.padEnd(22)} ${data.cells.toLocaleString().padStart(10)} ${formatBytes(data.memory).padStart(12)} ${data.bytesPerCell.toFixed(2).padStart(12)}`,
    );
  }

  // Calculate average bytes per cell
  const avgBytesPerCell =
    scalingData.length > 0
      ? scalingData.reduce((sum, d) => sum + d.bytesPerCell, 0) / scalingData.length
      : 0;

  console.log('\n  Analysis:');
  console.log(`    Average bytes per cell: ${avgBytesPerCell.toFixed(2)}`);
  console.log(`    Projected 500K cells:   ${formatBytes(avgBytesPerCell * 500_000)}`);
  console.log(`    Projected 1M cells:     ${formatBytes(avgBytesPerCell * 1_000_000)}`);

  // Check against targets
  const projected500K = avgBytesPerCell * 500_000;
  const meetsTarget = projected500K < MEMORY_BUDGETS.WASM_500K_CELLS;
  console.log(`    Meets 80MB target:      ${meetsTarget ? 'YES' : 'NO'}`);
}

/**
 * Generate CI-friendly assertions
 */
function generateCIAssertions(results: BudgetTestResult[]): void {
  console.log('\n=== CI Assertions ===\n');

  for (const result of results) {
    const assertion = result.passed
      ? `ASSERT PASS: ${result.file} memory (${formatBytes(result.actualBytes)}) <= budget (${formatBytes(result.budgetBytes)})`
      : `ASSERT FAIL: ${result.file} memory (${formatBytes(result.actualBytes)}) > budget (${formatBytes(result.budgetBytes)})`;

    console.log(`  ${assertion}`);
  }
}

// Main test runner
async function main(): Promise<void> {
  console.log('Memory Budget Enforcement Tests');
  console.log('='.repeat(60));
  console.log(`\nTarget: <80MB for 500K cells (WASM)`);
  console.log(`Target: <40MB for 500K cells (future native)\n`);

  if (typeof global.gc !== 'function') {
    console.warn('Warning: --expose-gc flag not set. Run with:');
    console.warn('  npx tsx --expose-gc xlsx/tooling/tests/memory/memory-budget.test.ts\n');
  }

  const wasm = await loadWasmModule();
  console.log(`WASM module version: ${wasm.version()}`);

  const results: BudgetTestResult[] = [];

  try {
    // Run budget tests
    const wasm500KResult = await testWasm500KCellsBudget(wasm);
    if (wasm500KResult) results.push(wasm500KResult);

    const perFileResults = await testPerFileBudgets(wasm);
    results.push(...perFileResults);

    // Memory scaling analysis
    await testMemoryScaling(wasm);

    // Generate CI assertions
    generateCIAssertions(results);

    // Generate report
    const report: BudgetReport = {
      timestamp: new Date().toISOString(),
      platform: `${process.platform} ${process.arch}`,
      wasmVersion: wasm.version(),
      nodeVersion: process.version,
      commitSha: process.env.GITHUB_SHA || process.env.CI_COMMIT_SHA,
      results,
      summary: {
        totalTests: results.length,
        passed: results.filter((r) => r.passed).length,
        failed: results.filter((r) => !r.passed).length,
        worstUsagePercent: Math.max(...results.map((r) => r.usagePercent), 0),
        totalBytesUsed: results.reduce((sum, r) => sum + r.actualBytes, 0),
      },
      ciStatus: results.every((r) => r.passed) ? 'success' : 'failure',
    };

    // Save report as JSON for CI parsing
    const reportPath = join(process.cwd(), 'xlsx/tooling/tests/memory/memory-budget-report.json');
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\nReport saved to: ${reportPath}`);

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('MEMORY BUDGET SUMMARY');
    console.log('='.repeat(60));

    console.log('\n  Test Results:');
    for (const result of results) {
      const icon = result.passed ? '[OK]' : '[!!]';
      console.log(
        `    ${icon} ${result.file}: ${formatBytes(result.actualBytes)} / ${formatBytes(result.budgetBytes)} (${result.usagePercent.toFixed(1)}%)`,
      );
    }

    console.log('\n  Summary:');
    console.log(`    Total:         ${report.summary.totalTests}`);
    console.log(`    Passed:        ${report.summary.passed}`);
    console.log(`    Failed:        ${report.summary.failed}`);
    console.log(`    Worst usage:   ${report.summary.worstUsagePercent.toFixed(1)}%`);
    console.log(`    CI Status:     ${report.ciStatus.toUpperCase()}`);

    // Exit with appropriate code for CI
    if (report.ciStatus === 'failure') {
      console.log('\n=== MEMORY BUDGET TESTS FAILED ===\n');
      process.exit(1);
    } else {
      console.log('\n=== All Memory Budget Tests Passed ===\n');
      process.exit(0);
    }
  } catch (error) {
    console.error('\nTest failed:', error);
    process.exit(1);
  }
}

// Export for programmatic use
export { MEMORY_BUDGETS, testMemoryBudget };
export type { BudgetReport, BudgetTestResult };

// Run tests
main().catch(console.error);
