/**
 * Memory Test Suite Index
 *
 * This module provides programmatic access to all memory tests.
 *
 * Usage:
 *   npx tsx --expose-gc xlsx/tooling/tests/memory/index.ts [test-name]
 *
 * Available tests:
 *   wasm   - WASM memory profiling
 *   heap   - JavaScript heap profiling
 *   leak   - Memory leak detection
 *   budget - Memory budget enforcement (CI)
 *   all    - Run all tests
 *
 * @module xlsx/tooling/tests/memory
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Test file paths
const TEST_FILES = {
  wasm: 'memory-wasm.test.ts',
  heap: 'memory-heap.test.ts',
  leak: 'leak-detection.test.ts',
  budget: 'memory-budget.test.ts',
} as const;

type TestName = keyof typeof TEST_FILES | 'all';

/**
 * Run a specific memory test
 */
async function runTest(testName: Exclude<TestName, 'all'>): Promise<void> {
  const testFile = TEST_FILES[testName];
  const testPath = join(import.meta.dirname, testFile);

  if (!existsSync(testPath)) {
    throw new Error(`Test file not found: ${testPath}`);
  }

  console.log(`\nRunning ${testName} test...\n`);

  // Dynamic import to run the test
  await import(`./${testFile}`);
}

/**
 * Run all memory tests
 */
async function runAllTests(): Promise<void> {
  const testNames: Array<Exclude<TestName, 'all'>> = ['wasm', 'heap', 'leak', 'budget'];

  for (const testName of testNames) {
    try {
      await runTest(testName);
    } catch (error) {
      console.error(`\nTest '${testName}' failed:`, error);
      // Continue to next test
    }
  }
}

/**
 * Print usage information
 */
function printUsage(): void {
  console.log(`
Memory Test Suite

Usage:
  npx tsx --expose-gc xlsx/tooling/tests/memory/index.ts [test-name]

Available tests:
  wasm   - WASM memory profiling (tracks WASM linear memory growth)
  heap   - JavaScript heap profiling (allocation hot spots, GC pressure)
  leak   - Memory leak detection (sequential parsing, reference accumulation)
  budget - Memory budget enforcement (CI-friendly, <80MB for 500K cells)
  all    - Run all tests sequentially

Examples:
  npx tsx --expose-gc xlsx/tooling/tests/memory/index.ts budget
  npx tsx --expose-gc xlsx/tooling/tests/memory/index.ts all

Note: The --expose-gc flag is required for accurate memory measurements.
`);
}

// Main entry point
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const rawArg = args[0]?.toLowerCase() || 'help';

  // Check for help
  if (rawArg === 'help' || rawArg === '--help' || rawArg === '-h') {
    printUsage();
    return;
  }

  const testName = rawArg as TestName | 'help';

  // Check for --expose-gc
  if (typeof global.gc !== 'function') {
    console.warn('\nWarning: --expose-gc flag not detected.');
    console.warn('Memory measurements will be less accurate.');
    console.warn('Run with: npx tsx --expose-gc xlsx/tooling/tests/memory/index.ts\n');
  }

  // Run tests
  if (testName === 'all') {
    await runAllTests();
  } else if (testName in TEST_FILES) {
    await runTest(testName as Exclude<TestName, 'all'>);
  } else {
    console.error(`Unknown test: ${testName}`);
    printUsage();
    process.exit(1);
  }
}

// Run
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

// Export for programmatic use
export { runAllTests, runTest, TEST_FILES };
