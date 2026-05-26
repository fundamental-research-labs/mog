/**
 * JavaScript Heap Profiling Tests
 *
 * Tests JavaScript heap allocation during XLSX parsing using process.memoryUsage().
 * Identifies allocation hot spots and measures GC pressure.
 *
 * Usage:
 *   npx tsx --expose-gc xlsx/tooling/tests/memory/memory-heap.test.ts
 *
 * @module xlsx/tooling/tests/memory/memory-heap
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
 * Memory snapshot at a point in time
 */
interface MemorySnapshot {
  timestamp: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
  rss: number;
}

/**
 * Heap profile result
 */
interface HeapProfile {
  file: string;
  cellCount: number;
  snapshots: {
    baseline: MemorySnapshot;
    afterFileLoad: MemorySnapshot;
    afterParse: MemorySnapshot;
    afterGC: MemorySnapshot;
  };
  allocations: {
    fileLoad: number;
    parse: number;
    retained: number;
  };
  gcPressure: {
    allocationsBeforeGC: number;
    freedByGC: number;
    gcEfficiency: number;
  };
  parseTimeMs: number;
}

/**
 * Heap profile report
 */
interface HeapProfileReport {
  timestamp: string;
  platform: string;
  nodeVersion: string;
  profiles: HeapProfile[];
  summary: {
    totalAllocations: number;
    totalRetained: number;
    averageGCEfficiency: number;
    peakHeapUsed: number;
  };
  hotSpots: {
    phase: string;
    allocation: number;
    percentage: number;
  }[];
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

// Take a memory snapshot
function takeSnapshot(): MemorySnapshot {
  const mem = process.memoryUsage();
  return {
    timestamp: Date.now(),
    heapUsed: mem.heapUsed,
    heapTotal: mem.heapTotal,
    external: mem.external,
    arrayBuffers: mem.arrayBuffers,
    rss: mem.rss,
  };
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
 * Profile JavaScript heap for a single file
 */
async function profileHeap(wasm: WasmModule, filePath: string): Promise<HeapProfile> {
  const fileName = basename(filePath);

  // Force GC and take baseline
  forceGC();
  await new Promise((r) => setTimeout(r, 10)); // Let GC settle
  const baseline = takeSnapshot();

  // Load file into memory
  const fileBytes = readFileSync(filePath);
  const xlsxData = new Uint8Array(fileBytes);
  const afterFileLoad = takeSnapshot();

  // Parse using bridge-generated parse_xlsx_full
  const startTime = performance.now();
  const result = wasm.parse_xlsx_full(xlsxData);
  const parseTimeMs = performance.now() - startTime;
  const afterParse = takeSnapshot();

  const cellCount = result.stats.total_cells;

  // Force GC and measure retained
  forceGC();
  await new Promise((r) => setTimeout(r, 10));
  const afterGC = takeSnapshot();

  // Calculate allocations
  const fileLoadAlloc = afterFileLoad.heapUsed - baseline.heapUsed;
  const parseAlloc = afterParse.heapUsed - afterFileLoad.heapUsed;
  const retained = afterGC.heapUsed - baseline.heapUsed;

  // Calculate GC pressure
  const allocationsBeforeGC = afterParse.heapUsed - baseline.heapUsed;
  const freedByGC = afterParse.heapUsed - afterGC.heapUsed;
  const gcEfficiency = allocationsBeforeGC > 0 ? freedByGC / allocationsBeforeGC : 0;

  return {
    file: fileName,
    cellCount,
    snapshots: {
      baseline,
      afterFileLoad,
      afterParse,
      afterGC,
    },
    allocations: {
      fileLoad: fileLoadAlloc,
      parse: parseAlloc,
      retained,
    },
    gcPressure: {
      allocationsBeforeGC,
      freedByGC,
      gcEfficiency,
    },
    parseTimeMs,
  };
}

/**
 * Test: Profile heap allocation during parsing
 */
async function testHeapAllocationProfile(): Promise<void> {
  console.log('\n=== JavaScript Heap Profiling Test ===\n');

  if (typeof global.gc !== 'function') {
    console.warn('Warning: --expose-gc flag not set. Run with:');
    console.warn('  npx tsx --expose-gc xlsx/tooling/tests/memory/memory-heap.test.ts\n');
  }

  const wasm = await loadWasmModule();
  console.log(`WASM module version: ${wasm.version()}`);

  const fixturesDir = join(process.cwd(), 'performance/fixtures');
  const testFiles = ['smoke-bench.xlsx', 'small-bench.xlsx', 'smoke-test.xlsx', 'small-test.xlsx'];

  const profiles: HeapProfile[] = [];

  for (const file of testFiles) {
    const filePath = join(fixturesDir, file);
    if (!existsSync(filePath)) {
      console.log(`  Skipping ${file} - not found`);
      continue;
    }

    console.log(`\nProfiling heap for: ${file}`);
    console.log('-'.repeat(50));

    try {
      const profile = await profileHeap(wasm, filePath);
      profiles.push(profile);

      console.log(`  Cells parsed:        ${profile.cellCount.toLocaleString()}`);
      console.log(`  Parse time:          ${profile.parseTimeMs.toFixed(2)}ms`);
      console.log('');
      console.log('  Allocation breakdown:');
      console.log(`    File load:         ${formatBytes(profile.allocations.fileLoad)}`);
      console.log(`    Parse overhead:    ${formatBytes(profile.allocations.parse)}`);
      console.log(`    Retained after GC: ${formatBytes(profile.allocations.retained)}`);
      console.log('');
      console.log('  GC pressure:');
      console.log(`    Total allocated:   ${formatBytes(profile.gcPressure.allocationsBeforeGC)}`);
      console.log(`    Freed by GC:       ${formatBytes(profile.gcPressure.freedByGC)}`);
      console.log(`    GC efficiency:     ${(profile.gcPressure.gcEfficiency * 100).toFixed(1)}%`);
    } catch (error) {
      console.error(`  Error: ${error}`);
    }
  }

  // Identify hot spots
  const hotSpots = profiles.flatMap((p) => [
    { phase: `${p.file} - File Load`, allocation: p.allocations.fileLoad },
    { phase: `${p.file} - Parse`, allocation: p.allocations.parse },
  ]);

  const totalAlloc = hotSpots.reduce((sum, h) => sum + Math.max(0, h.allocation), 0);
  const sortedHotSpots = hotSpots
    .map((h) => ({
      ...h,
      percentage: totalAlloc > 0 ? (Math.max(0, h.allocation) / totalAlloc) * 100 : 0,
    }))
    .sort((a, b) => b.allocation - a.allocation)
    .slice(0, 10);

  // Generate report
  const report: HeapProfileReport = {
    timestamp: new Date().toISOString(),
    platform: `${process.platform} ${process.arch}`,
    nodeVersion: process.version,
    profiles,
    summary: {
      totalAllocations: profiles.reduce((sum, p) => sum + p.gcPressure.allocationsBeforeGC, 0),
      totalRetained: profiles.reduce((sum, p) => sum + p.allocations.retained, 0),
      averageGCEfficiency:
        profiles.length > 0
          ? profiles.reduce((sum, p) => sum + p.gcPressure.gcEfficiency, 0) / profiles.length
          : 0,
      peakHeapUsed: Math.max(...profiles.map((p) => p.snapshots.afterParse.heapUsed), 0),
    },
    hotSpots: sortedHotSpots,
  };

  // Save report
  const reportPath = join(process.cwd(), 'xlsx/tooling/tests/memory/heap-profile-report.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nReport saved to: ${reportPath}`);

  // Print hot spots
  console.log('\n=== Allocation Hot Spots ===');
  for (const hotSpot of sortedHotSpots.slice(0, 5)) {
    console.log(
      `  ${hotSpot.phase.padEnd(40)} ${formatBytes(hotSpot.allocation).padStart(12)} (${hotSpot.percentage.toFixed(1)}%)`,
    );
  }

  // Print summary
  console.log('\n=== Summary ===');
  console.log(`  Total allocations:   ${formatBytes(report.summary.totalAllocations)}`);
  console.log(`  Total retained:      ${formatBytes(report.summary.totalRetained)}`);
  console.log(`  Avg GC efficiency:   ${(report.summary.averageGCEfficiency * 100).toFixed(1)}%`);
  console.log(`  Peak heap used:      ${formatBytes(report.summary.peakHeapUsed)}`);
}

/**
 * Test: Measure GC pressure through frequent allocations
 */
async function testGCPressure(): Promise<void> {
  console.log('\n=== GC Pressure Test ===\n');

  const wasm = await loadWasmModule();
  const fixturesDir = join(process.cwd(), 'performance/fixtures');
  const testFile = join(fixturesDir, 'smoke-bench.xlsx');

  if (!existsSync(testFile)) {
    console.log('Test file not found, skipping');
    return;
  }

  const xlsxData = new Uint8Array(readFileSync(testFile));

  // Parse multiple times to measure GC pressure
  const iterations = 10;
  const gcCounts: number[] = [];
  const heapGrowths: number[] = [];

  console.log(`Running ${iterations} parse iterations to measure GC pressure...\n`);

  forceGC();
  const baselineHeap = process.memoryUsage().heapUsed;

  for (let i = 0; i < iterations; i++) {
    const beforeHeap = process.memoryUsage().heapUsed;

    wasm.parse_xlsx_full(xlsxData);

    const afterHeap = process.memoryUsage().heapUsed;
    heapGrowths.push(afterHeap - beforeHeap);

    // Force GC and measure
    forceGC();
    const afterGCHeap = process.memoryUsage().heapUsed;
    const freedByGC = afterHeap - afterGCHeap;
    gcCounts.push(freedByGC);

    console.log(
      `  Iteration ${(i + 1).toString().padStart(2)}: heap growth ${formatBytes(afterHeap - beforeHeap).padStart(12)}, GC freed ${formatBytes(freedByGC).padStart(12)}`,
    );
  }

  // Calculate stats
  const avgHeapGrowth = heapGrowths.reduce((a, b) => a + b, 0) / heapGrowths.length;
  const avgGCFreed = gcCounts.reduce((a, b) => a + b, 0) / gcCounts.length;
  const maxHeapGrowth = Math.max(...heapGrowths);

  const finalHeap = process.memoryUsage().heapUsed;
  const totalRetained = finalHeap - baselineHeap;

  console.log('\n  Results:');
  console.log(`    Average heap growth per iteration: ${formatBytes(avgHeapGrowth)}`);
  console.log(`    Maximum heap growth:              ${formatBytes(maxHeapGrowth)}`);
  console.log(`    Average freed by GC:              ${formatBytes(avgGCFreed)}`);
  console.log(`    Total retained after all:         ${formatBytes(totalRetained)}`);
  console.log(
    `    GC efficiency:                    ${avgHeapGrowth > 0 ? ((avgGCFreed / avgHeapGrowth) * 100).toFixed(1) : 0}%`,
  );
}

/**
 * Test: Track heap growth over time
 */
async function testHeapGrowthOverTime(): Promise<void> {
  console.log('\n=== Heap Growth Over Time Test ===\n');

  const wasm = await loadWasmModule();
  const fixturesDir = join(process.cwd(), 'performance/fixtures');
  const testFile = join(fixturesDir, 'smoke-bench.xlsx');

  if (!existsSync(testFile)) {
    console.log('Test file not found, skipping');
    return;
  }

  const xlsxData = new Uint8Array(readFileSync(testFile));
  const snapshots: { iteration: number; heapUsed: number; heapTotal: number }[] = [];

  // Initial snapshot
  forceGC();
  snapshots.push({ iteration: 0, ...process.memoryUsage() });

  // Parse 20 times without explicit GC
  console.log('Parsing 20 times without explicit GC...\n');

  for (let i = 1; i <= 20; i++) {
    wasm.parse_xlsx_full(xlsxData);

    const mem = process.memoryUsage();
    snapshots.push({ iteration: i, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal });
  }

  // Print growth chart
  const maxHeap = Math.max(...snapshots.map((s) => s.heapUsed));
  const minHeap = Math.min(...snapshots.map((s) => s.heapUsed));
  const range = maxHeap - minHeap;
  const chartWidth = 40;

  console.log('Heap usage over time:');
  console.log('  Iteration  Heap Used     [Chart]');
  console.log('-'.repeat(70));

  for (const snapshot of snapshots) {
    const barLength =
      range > 0 ? Math.round(((snapshot.heapUsed - minHeap) / range) * chartWidth) : 0;
    const bar = '#'.repeat(barLength).padEnd(chartWidth);
    console.log(
      `  ${snapshot.iteration.toString().padStart(3)}        ${formatBytes(snapshot.heapUsed).padStart(10)}  [${bar}]`,
    );
  }

  // Final GC
  forceGC();
  const finalMem = process.memoryUsage();
  console.log(`\n  After final GC: ${formatBytes(finalMem.heapUsed)}`);
  console.log(`  Growth from start: ${formatBytes(finalMem.heapUsed - snapshots[0].heapUsed)}`);
}

// Main test runner
async function main(): Promise<void> {
  console.log('JavaScript Heap Profiling Tests');
  console.log('='.repeat(60));

  try {
    await testHeapAllocationProfile();
    await testGCPressure();
    await testHeapGrowthOverTime();

    console.log('\n=== All Heap Profiling Tests Passed ===\n');
  } catch (error) {
    console.error('\nTest failed:', error);
    process.exit(1);
  }
}

// Run tests
main().catch(console.error);
