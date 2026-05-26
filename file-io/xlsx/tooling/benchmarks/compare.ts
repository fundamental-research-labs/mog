#!/usr/bin/env npx tsx
/**
 * Comparison Dashboard (5B-4)
 *
 * Generates comparison reports between:
 * - WASM vs JavaScript parser performance
 * - Current vs historical results (regression detection)
 * - Different file types and sizes
 *
 * Outputs:
 * - JSON data for further analysis
 * - Markdown reports for documentation
 * - Console summary
 *
 * Usage:
 *   npx tsx xlsx/tooling/benchmarks/compare.ts
 *   pnpm bench:compare
 *
 * Options:
 *   --input=FILE.json         Specify input results file
 *   --baseline=FILE.json      Specify baseline for regression comparison
 *   --output=DIR              Output directory for reports
 *   --threshold=N             Regression warning threshold (percent, default: 10)
 *   --format=json,md,console  Output formats (default: all)
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BenchmarkResult,
  ComparisonResult,
  ensureDir,
  formatBytes,
  formatNumber,
  printComparisonTable,
  RESULTS_DIR,
} from './utils';

// =============================================================================
// Types
// =============================================================================

interface RegressionResult {
  name: string;
  parserType: 'wasm' | 'javascript';
  baseline: {
    mean: number;
    p95: number;
    throughput: number;
    timestamp: string;
  };
  current: {
    mean: number;
    p95: number;
    throughput: number;
    timestamp: string;
  };
  delta: {
    meanPercent: number;
    p95Percent: number;
    throughputPercent: number;
  };
  status: 'improved' | 'regressed' | 'unchanged';
}

interface ComparisonReport {
  generated: string;
  summary: {
    totalFiles: number;
    wasmFaster: number;
    jsFaster: number;
    avgSpeedup: number;
    maxSpeedup: number;
    minSpeedup: number;
  };
  comparisons: ComparisonResult[];
  byCategory?: Record<
    string,
    {
      avgSpeedup: number;
      files: number;
    }
  >;
  regressions?: RegressionResult[];
}

// =============================================================================
// Comparison Logic
// =============================================================================

function compareResults(results: BenchmarkResult[]): ComparisonResult[] {
  const comparisons: ComparisonResult[] = [];

  // Group by file name
  const fileGroups = new Map<string, { wasm?: BenchmarkResult; javascript?: BenchmarkResult }>();

  for (const result of results) {
    const existing = fileGroups.get(result.name) || {};
    if (result.parserType === 'wasm') {
      existing.wasm = result;
    } else {
      existing.javascript = result;
    }
    fileGroups.set(result.name, existing);
  }

  // Create comparison for each file that has both results
  for (const [file, group] of fileGroups) {
    if (group.wasm && group.javascript) {
      const speedup = group.javascript.latency.mean / group.wasm.latency.mean;
      const memoryRatio = group.wasm.memory.delta / Math.max(group.javascript.memory.delta, 1);

      comparisons.push({
        file,
        wasm: group.wasm,
        javascript: group.javascript,
        speedup,
        memoryRatio,
      });
    }
  }

  return comparisons.sort((a, b) => b.speedup - a.speedup);
}

function detectRegressions(
  current: BenchmarkResult[],
  baseline: BenchmarkResult[],
  threshold: number,
): RegressionResult[] {
  const regressions: RegressionResult[] = [];

  for (const currentResult of current) {
    const baselineResult = baseline.find(
      (b) => b.name === currentResult.name && b.parserType === currentResult.parserType,
    );

    if (!baselineResult) continue;

    const meanDelta =
      ((currentResult.latency.mean - baselineResult.latency.mean) / baselineResult.latency.mean) *
      100;
    const p95Delta =
      ((currentResult.latency.p95 - baselineResult.latency.p95) / baselineResult.latency.p95) * 100;
    const throughputDelta =
      ((currentResult.throughput.cellsPerSecond - baselineResult.throughput.cellsPerSecond) /
        baselineResult.throughput.cellsPerSecond) *
      100;

    let status: 'improved' | 'regressed' | 'unchanged' = 'unchanged';
    if (meanDelta > threshold) {
      status = 'regressed';
    } else if (meanDelta < -threshold) {
      status = 'improved';
    }

    regressions.push({
      name: currentResult.name,
      parserType: currentResult.parserType,
      baseline: {
        mean: baselineResult.latency.mean,
        p95: baselineResult.latency.p95,
        throughput: baselineResult.throughput.cellsPerSecond,
        timestamp: baselineResult.timestamp,
      },
      current: {
        mean: currentResult.latency.mean,
        p95: currentResult.latency.p95,
        throughput: currentResult.throughput.cellsPerSecond,
        timestamp: currentResult.timestamp,
      },
      delta: {
        meanPercent: meanDelta,
        p95Percent: p95Delta,
        throughputPercent: throughputDelta,
      },
      status,
    });
  }

  return regressions;
}

// =============================================================================
// Report Generation
// =============================================================================

function generateComparisonReport(
  results: BenchmarkResult[],
  baseline?: BenchmarkResult[],
  threshold: number = 10,
): ComparisonReport {
  const comparisons = compareResults(results);

  // Calculate summary stats
  const speedups = comparisons.map((c) => c.speedup);
  const summary = {
    totalFiles: comparisons.length,
    wasmFaster: comparisons.filter((c) => c.speedup >= 1).length,
    jsFaster: comparisons.filter((c) => c.speedup < 1).length,
    avgSpeedup: speedups.length > 0 ? speedups.reduce((a, b) => a + b, 0) / speedups.length : 0,
    maxSpeedup: speedups.length > 0 ? Math.max(...speedups) : 0,
    minSpeedup: speedups.length > 0 ? Math.min(...speedups) : 0,
  };

  // Group by category
  const byCategory: Record<string, { avgSpeedup: number; files: number }> = {};
  for (const comp of comparisons) {
    const category = (comp.wasm.metadata?.category as string) || 'unknown';
    if (!byCategory[category]) {
      byCategory[category] = { avgSpeedup: 0, files: 0 };
    }
    byCategory[category].avgSpeedup += comp.speedup;
    byCategory[category].files += 1;
  }
  for (const cat of Object.keys(byCategory)) {
    byCategory[cat].avgSpeedup /= byCategory[cat].files;
  }

  const report: ComparisonReport = {
    generated: new Date().toISOString(),
    summary,
    comparisons,
    byCategory,
  };

  // Add regression analysis if baseline provided
  if (baseline && baseline.length > 0) {
    report.regressions = detectRegressions(results, baseline, threshold);
  }

  return report;
}

function generateMarkdownComparisonReport(report: ComparisonReport): string {
  const lines: string[] = [];

  lines.push('# XLSX Parser Comparison Report');
  lines.push('');
  lines.push(`Generated: ${report.generated}`);
  lines.push('');

  // Summary
  lines.push('## Summary');
  lines.push('');
  lines.push(`- **Total files compared**: ${report.summary.totalFiles}`);
  lines.push(`- **WASM faster**: ${report.summary.wasmFaster} files`);
  lines.push(`- **JavaScript faster**: ${report.summary.jsFaster} files`);
  lines.push(`- **Average speedup**: ${report.summary.avgSpeedup.toFixed(2)}x`);
  lines.push(`- **Max speedup**: ${report.summary.maxSpeedup.toFixed(2)}x`);
  lines.push(`- **Min speedup**: ${report.summary.minSpeedup.toFixed(2)}x`);
  lines.push('');

  // By Category
  if (report.byCategory && Object.keys(report.byCategory).length > 0) {
    lines.push('## Performance by Category');
    lines.push('');
    lines.push('| Category | Files | Avg Speedup |');
    lines.push('|----------|-------|-------------|');
    for (const [category, stats] of Object.entries(report.byCategory)) {
      lines.push(`| ${category} | ${stats.files} | ${stats.avgSpeedup.toFixed(2)}x |`);
    }
    lines.push('');
  }

  // Detailed Comparison
  lines.push('## WASM vs JavaScript Comparison');
  lines.push('');
  lines.push('| File | WASM (ms) | JS (ms) | Speedup | WASM cells/s | JS cells/s | Memory Ratio |');
  lines.push('|------|-----------|---------|---------|--------------|------------|--------------|');

  for (const comp of report.comparisons) {
    const speedupStr =
      comp.speedup >= 1
        ? `${comp.speedup.toFixed(2)}x`
        : `${(1 / comp.speedup).toFixed(2)}x slower`;

    lines.push(
      `| ${comp.file} | ${comp.wasm.latency.mean.toFixed(2)} | ${comp.javascript.latency.mean.toFixed(2)} | ${speedupStr} | ${formatNumber(Math.round(comp.wasm.throughput.cellsPerSecond))} | ${formatNumber(Math.round(comp.javascript.throughput.cellsPerSecond))} | ${comp.memoryRatio.toFixed(2)}x |`,
    );
  }
  lines.push('');

  // Regressions
  if (report.regressions && report.regressions.length > 0) {
    lines.push('## Regression Analysis');
    lines.push('');

    const regressed = report.regressions.filter((r) => r.status === 'regressed');
    const improved = report.regressions.filter((r) => r.status === 'improved');

    if (regressed.length > 0) {
      lines.push('### Regressions Detected');
      lines.push('');
      lines.push('| File | Parser | Baseline | Current | Delta |');
      lines.push('|------|--------|----------|---------|-------|');
      for (const r of regressed) {
        lines.push(
          `| ${r.name} | ${r.parserType} | ${r.baseline.mean.toFixed(2)}ms | ${r.current.mean.toFixed(2)}ms | +${r.delta.meanPercent.toFixed(1)}% |`,
        );
      }
      lines.push('');
    }

    if (improved.length > 0) {
      lines.push('### Improvements');
      lines.push('');
      lines.push('| File | Parser | Baseline | Current | Delta |');
      lines.push('|------|--------|----------|---------|-------|');
      for (const r of improved) {
        lines.push(
          `| ${r.name} | ${r.parserType} | ${r.baseline.mean.toFixed(2)}ms | ${r.current.mean.toFixed(2)}ms | ${r.delta.meanPercent.toFixed(1)}% |`,
        );
      }
      lines.push('');
    }
  }

  // Detailed stats
  lines.push('## Detailed Statistics');
  lines.push('');

  for (const comp of report.comparisons) {
    lines.push(`### ${comp.file}`);
    lines.push('');
    lines.push('**WASM Parser:**');
    lines.push(`- Mean: ${comp.wasm.latency.mean.toFixed(3)}ms`);
    lines.push(`- P95: ${comp.wasm.latency.p95.toFixed(3)}ms`);
    lines.push(`- P99: ${comp.wasm.latency.p99.toFixed(3)}ms`);
    lines.push(`- StdDev: ${comp.wasm.latency.stdDev.toFixed(3)}ms`);
    lines.push(
      `- Throughput: ${formatNumber(Math.round(comp.wasm.throughput.cellsPerSecond))} cells/s`,
    );
    lines.push(`- Memory delta: ${formatBytes(comp.wasm.memory.delta)}`);
    lines.push('');
    lines.push('**JavaScript Parser:**');
    lines.push(`- Mean: ${comp.javascript.latency.mean.toFixed(3)}ms`);
    lines.push(`- P95: ${comp.javascript.latency.p95.toFixed(3)}ms`);
    lines.push(`- P99: ${comp.javascript.latency.p99.toFixed(3)}ms`);
    lines.push(`- StdDev: ${comp.javascript.latency.stdDev.toFixed(3)}ms`);
    lines.push(
      `- Throughput: ${formatNumber(Math.round(comp.javascript.throughput.cellsPerSecond))} cells/s`,
    );
    lines.push(`- Memory delta: ${formatBytes(comp.javascript.memory.delta)}`);
    lines.push('');
  }

  return lines.join('\n');
}

function printConsoleSummary(report: ComparisonReport): void {
  console.log('\n' + '='.repeat(80));
  console.log('COMPARISON SUMMARY');
  console.log('='.repeat(80));

  console.log(`\nTotal files compared: ${report.summary.totalFiles}`);
  console.log(`WASM faster: ${report.summary.wasmFaster} files`);
  console.log(`JavaScript faster: ${report.summary.jsFaster} files`);
  console.log(`Average WASM speedup: ${report.summary.avgSpeedup.toFixed(2)}x`);
  console.log(
    `Range: ${report.summary.minSpeedup.toFixed(2)}x - ${report.summary.maxSpeedup.toFixed(2)}x`,
  );

  // Print by category
  if (report.byCategory && Object.keys(report.byCategory).length > 1) {
    console.log('\nBy Category:');
    for (const [category, stats] of Object.entries(report.byCategory)) {
      console.log(`  ${category}: ${stats.avgSpeedup.toFixed(2)}x avg (${stats.files} files)`);
    }
  }

  // Print comparison table
  if (report.comparisons.length > 0) {
    printComparisonTable(report.comparisons);
  }

  // Print regressions
  if (report.regressions && report.regressions.length > 0) {
    const regressed = report.regressions.filter((r) => r.status === 'regressed');
    const improved = report.regressions.filter((r) => r.status === 'improved');

    if (regressed.length > 0) {
      console.log('\n' + '!'.repeat(80));
      console.log('REGRESSIONS DETECTED');
      console.log('!'.repeat(80));

      for (const r of regressed) {
        console.log(
          `  ${r.name} (${r.parserType}): ${r.baseline.mean.toFixed(2)}ms -> ${r.current.mean.toFixed(2)}ms (+${r.delta.meanPercent.toFixed(1)}%)`,
        );
      }
    }

    if (improved.length > 0) {
      console.log('\n' + '+'.repeat(80));
      console.log('IMPROVEMENTS DETECTED');
      console.log('+'.repeat(80));

      for (const r of improved) {
        console.log(
          `  ${r.name} (${r.parserType}): ${r.baseline.mean.toFixed(2)}ms -> ${r.current.mean.toFixed(2)}ms (${r.delta.meanPercent.toFixed(1)}%)`,
        );
      }
    }
  }
}

// =============================================================================
// File Loading
// =============================================================================

function loadResultsFile(filePath: string): BenchmarkResult[] {
  if (!existsSync(filePath)) {
    throw new Error(`Results file not found: ${filePath}`);
  }

  const content = readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

function findLatestResultsFiles(): string[] {
  ensureDir(RESULTS_DIR);

  const files = readdirSync(RESULTS_DIR)
    .filter((f) => f.endsWith('-latest.json'))
    .map((f) => join(RESULTS_DIR, f));

  return files;
}

function loadAllLatestResults(): BenchmarkResult[] {
  const files = findLatestResultsFiles();
  const allResults: BenchmarkResult[] = [];

  for (const file of files) {
    try {
      const results = loadResultsFile(file);
      allResults.push(...results);
    } catch (error) {
      console.warn(`Warning: Could not load ${file}:`, error);
    }
  }

  return allResults;
}

// =============================================================================
// CLI Argument Parsing
// =============================================================================

interface CliOptions {
  input?: string;
  baseline?: string;
  output: string;
  threshold: number;
  formats: string[];
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);

  return {
    input: args.find((a) => a.startsWith('--input='))?.split('=')[1],
    baseline: args.find((a) => a.startsWith('--baseline='))?.split('=')[1],
    output: args.find((a) => a.startsWith('--output='))?.split('=')[1] || RESULTS_DIR,
    threshold: parseFloat(args.find((a) => a.startsWith('--threshold='))?.split('=')[1] || '10'),
    formats: args
      .find((a) => a.startsWith('--format='))
      ?.split('=')[1]
      ?.split(',') || ['json', 'md', 'console'],
  };
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  console.log('XLSX Parser - Comparison Dashboard');
  console.log('===================================\n');

  const options = parseArgs();
  ensureDir(options.output);

  // Load results
  let results: BenchmarkResult[];

  if (options.input) {
    console.log(`Loading results from: ${options.input}`);
    results = loadResultsFile(options.input);
  } else {
    console.log('Loading latest results from all benchmarks...');
    results = loadAllLatestResults();
  }

  if (results.length === 0) {
    console.error('No benchmark results found.');
    console.error('Run one of the benchmark scripts first:');
    console.error('  pnpm bench:large');
    console.error('  pnpm bench:features');
    console.error('  pnpm bench:real');
    process.exit(1);
  }

  console.log(`Loaded ${results.length} benchmark results`);

  // Load baseline for regression detection
  let baseline: BenchmarkResult[] | undefined;

  if (options.baseline) {
    console.log(`Loading baseline from: ${options.baseline}`);
    baseline = loadResultsFile(options.baseline);
    console.log(`Loaded ${baseline.length} baseline results`);
  }

  // Generate report
  console.log('\nGenerating comparison report...');
  const report = generateComparisonReport(results, baseline, options.threshold);

  // Output formats
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  if (options.formats.includes('json')) {
    const jsonPath = join(options.output, `comparison-${timestamp}.json`);
    writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    console.log(`JSON report saved to: ${jsonPath}`);

    // Also save latest
    const latestJsonPath = join(options.output, 'comparison-latest.json');
    writeFileSync(latestJsonPath, JSON.stringify(report, null, 2));
  }

  if (options.formats.includes('md')) {
    const mdReport = generateMarkdownComparisonReport(report);
    const mdPath = join(options.output, `comparison-${timestamp}.md`);
    writeFileSync(mdPath, mdReport);
    console.log(`Markdown report saved to: ${mdPath}`);

    // Also save latest
    const latestMdPath = join(options.output, 'comparison-latest.md');
    writeFileSync(latestMdPath, mdReport);
  }

  if (options.formats.includes('console')) {
    printConsoleSummary(report);
  }

  // Exit with error if regressions detected
  if (report.regressions) {
    const regressed = report.regressions.filter((r) => r.status === 'regressed');
    if (regressed.length > 0) {
      console.log(
        `\n${regressed.length} regression(s) detected (threshold: ${options.threshold}%)`,
      );
      process.exit(1);
    }
  }

  console.log('\nComparison complete!');
}

// Run
main().catch((error) => {
  console.error('Comparison failed:', error);
  process.exit(1);
});
