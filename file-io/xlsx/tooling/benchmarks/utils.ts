/**
 * Shared utilities for XLSX Parser Benchmarks
 *
 * This module provides common utilities for:
 * - File generation (creating test XLSX files)
 * - Memory measurement
 * - Statistics calculation
 * - Result formatting and output
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// =============================================================================
// Types
// =============================================================================

export interface BenchmarkResult {
  name: string;
  file: string;
  fileSize: number;
  cellCount: number;
  sheetCount: number;
  iterations: number;
  latency: LatencyStats;
  memory: MemoryStats;
  throughput: ThroughputStats;
  timestamp: string;
  parserType: 'wasm' | 'javascript';
  metadata?: Record<string, unknown>;
}

export interface LatencyStats {
  mean: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
  stdDev: number;
}

export interface MemoryStats {
  peakHeapUsed: number;
  baselineHeapUsed: number;
  delta: number;
}

export interface ThroughputStats {
  cellsPerSecond: number;
  bytesPerSecond: number;
  mbPerSecond: number;
}

export interface ComparisonResult {
  file: string;
  wasm: BenchmarkResult;
  javascript: BenchmarkResult;
  speedup: number;
  memoryRatio: number;
}

export interface FileSpec {
  name: string;
  rows: number;
  cols: number;
  description: string;
}

// =============================================================================
// Constants
// =============================================================================

export const RESULTS_DIR = join(process.cwd(), 'xlsx/tooling/benchmarks/results');
export const FIXTURES_DIR = join(process.cwd(), 'performance/fixtures');
export const GENERATED_DIR = join(process.cwd(), 'xlsx/tooling/benchmarks/generated');

// =============================================================================
// Memory Utilities
// =============================================================================

/**
 * Force garbage collection if available.
 */
export function forceGC(): void {
  if (typeof global.gc === 'function') {
    global.gc();
  }
}

/**
 * Get current memory usage.
 */
export function getMemoryUsage(): {
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
} {
  const mem = process.memoryUsage();
  return {
    heapUsed: mem.heapUsed,
    heapTotal: mem.heapTotal,
    external: mem.external,
    rss: mem.rss,
  };
}

/**
 * Measure peak memory during an async operation.
 */
export async function measureMemory<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; memory: MemoryStats }> {
  forceGC();
  const baseline = getMemoryUsage().heapUsed;

  let peakHeapUsed = baseline;
  const intervalId = setInterval(() => {
    const current = getMemoryUsage().heapUsed;
    if (current > peakHeapUsed) {
      peakHeapUsed = current;
    }
  }, 10);

  try {
    const result = await fn();

    // Final check
    const final = getMemoryUsage().heapUsed;
    if (final > peakHeapUsed) {
      peakHeapUsed = final;
    }

    return {
      result,
      memory: {
        peakHeapUsed,
        baselineHeapUsed: baseline,
        delta: peakHeapUsed - baseline,
      },
    };
  } finally {
    clearInterval(intervalId);
  }
}

// =============================================================================
// Statistics Utilities
// =============================================================================

/**
 * Calculate comprehensive statistics from timing data.
 */
export function calculateStats(values: number[]): LatencyStats {
  if (values.length === 0) {
    return { mean: 0, min: 0, max: 0, p50: 0, p95: 0, p99: 0, stdDev: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((a, b) => a + b, 0);
  const mean = sum / values.length;

  const variance = values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance);

  return {
    mean,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    stdDev,
  };
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

// =============================================================================
// Formatting Utilities
// =============================================================================

/**
 * Format bytes as human-readable string.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Format numbers with commas.
 */
export function formatNumber(num: number): string {
  return num.toLocaleString('en-US');
}

/**
 * Format milliseconds as human-readable duration.
 */
export function formatDuration(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(2)} us`;
  if (ms < 1000) return `${ms.toFixed(2)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

// =============================================================================
// File Utilities
// =============================================================================

/**
 * Ensure a directory exists.
 */
export function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Read file stats safely.
 */
export function getFileSize(filePath: string): number {
  try {
    return statSync(filePath).size;
  } catch {
    return 0;
  }
}

/**
 * Check if a file exists.
 */
export function fileExists(filePath: string): boolean {
  return existsSync(filePath);
}

// =============================================================================
// Result Output Utilities
// =============================================================================

/**
 * Save benchmark results to JSON file.
 */
export function saveResults(results: BenchmarkResult[], filename: string): void {
  ensureDir(RESULTS_DIR);
  const filePath = join(RESULTS_DIR, filename);
  writeFileSync(filePath, JSON.stringify(results, null, 2));
  console.log(`Results saved to: ${filePath}`);
}

/**
 * Load previous benchmark results.
 */
export function loadResults(filename: string): BenchmarkResult[] | null {
  const filePath = join(RESULTS_DIR, filename);
  if (!fileExists(filePath)) {
    return null;
  }
  const content = readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Print benchmark results as a table.
 */
export function printResultsTable(results: BenchmarkResult[]): void {
  console.log('\n' + '='.repeat(100));
  console.log('BENCHMARK RESULTS');
  console.log('='.repeat(100));

  console.log(
    '\n' +
      'File'.padEnd(30) +
      'Size'.padStart(12) +
      'Cells'.padStart(12) +
      'Mean (ms)'.padStart(12) +
      'P95 (ms)'.padStart(12) +
      'Cells/sec'.padStart(15) +
      'Parser'.padStart(10),
  );
  console.log('-'.repeat(103));

  for (const r of results) {
    console.log(
      r.name.slice(0, 29).padEnd(30) +
        formatBytes(r.fileSize).padStart(12) +
        formatNumber(r.cellCount).padStart(12) +
        r.latency.mean.toFixed(2).padStart(12) +
        r.latency.p95.toFixed(2).padStart(12) +
        formatNumber(Math.round(r.throughput.cellsPerSecond)).padStart(15) +
        r.parserType.padStart(10),
    );
  }
}

/**
 * Print comparison results.
 */
export function printComparisonTable(comparisons: ComparisonResult[]): void {
  console.log('\n' + '='.repeat(110));
  console.log('COMPARISON: WASM vs JavaScript');
  console.log('='.repeat(110));

  console.log(
    '\n' +
      'File'.padEnd(25) +
      'WASM (ms)'.padStart(12) +
      'JS (ms)'.padStart(12) +
      'Speedup'.padStart(10) +
      'WASM cells/s'.padStart(15) +
      'JS cells/s'.padStart(15) +
      'Memory Ratio'.padStart(14),
  );
  console.log('-'.repeat(103));

  for (const c of comparisons) {
    const speedupStr =
      c.speedup >= 1 ? `${c.speedup.toFixed(2)}x` : `${(1 / c.speedup).toFixed(2)}x slower`;

    console.log(
      c.file.slice(0, 24).padEnd(25) +
        c.wasm.latency.mean.toFixed(2).padStart(12) +
        c.javascript.latency.mean.toFixed(2).padStart(12) +
        speedupStr.padStart(10) +
        formatNumber(Math.round(c.wasm.throughput.cellsPerSecond)).padStart(15) +
        formatNumber(Math.round(c.javascript.throughput.cellsPerSecond)).padStart(15) +
        `${c.memoryRatio.toFixed(2)}x`.padStart(14),
    );
  }
}

/**
 * Generate markdown report.
 */
export function generateMarkdownReport(
  results: BenchmarkResult[],
  comparisons?: ComparisonResult[],
): string {
  const lines: string[] = [];

  lines.push('# XLSX Parser Benchmark Results');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');

  // Summary table
  lines.push('## Summary');
  lines.push('');
  lines.push('| File | Size | Cells | Mean (ms) | P95 (ms) | Cells/sec | Parser |');
  lines.push('|------|------|-------|-----------|----------|-----------|--------|');

  for (const r of results) {
    lines.push(
      `| ${r.name} | ${formatBytes(r.fileSize)} | ${formatNumber(r.cellCount)} | ${r.latency.mean.toFixed(2)} | ${r.latency.p95.toFixed(2)} | ${formatNumber(Math.round(r.throughput.cellsPerSecond))} | ${r.parserType} |`,
    );
  }

  // Comparison table
  if (comparisons && comparisons.length > 0) {
    lines.push('');
    lines.push('## WASM vs JavaScript Comparison');
    lines.push('');
    lines.push('| File | WASM (ms) | JS (ms) | Speedup | WASM cells/s | JS cells/s |');
    lines.push('|------|-----------|---------|---------|--------------|------------|');

    for (const c of comparisons) {
      const speedupStr =
        c.speedup >= 1 ? `${c.speedup.toFixed(2)}x` : `${(1 / c.speedup).toFixed(2)}x slower`;
      lines.push(
        `| ${c.file} | ${c.wasm.latency.mean.toFixed(2)} | ${c.javascript.latency.mean.toFixed(2)} | ${speedupStr} | ${formatNumber(Math.round(c.wasm.throughput.cellsPerSecond))} | ${formatNumber(Math.round(c.javascript.throughput.cellsPerSecond))} |`,
      );
    }
  }

  // Detailed results
  lines.push('');
  lines.push('## Detailed Results');
  lines.push('');

  for (const r of results) {
    lines.push(`### ${r.name}`);
    lines.push('');
    lines.push(`- **File**: ${r.file}`);
    lines.push(`- **Size**: ${formatBytes(r.fileSize)}`);
    lines.push(`- **Cells**: ${formatNumber(r.cellCount)}`);
    lines.push(`- **Sheets**: ${r.sheetCount}`);
    lines.push(`- **Parser**: ${r.parserType}`);
    lines.push('');
    lines.push('**Latency (ms)**:');
    lines.push(`- Mean: ${r.latency.mean.toFixed(3)}`);
    lines.push(`- Min: ${r.latency.min.toFixed(3)}`);
    lines.push(`- Max: ${r.latency.max.toFixed(3)}`);
    lines.push(`- P50: ${r.latency.p50.toFixed(3)}`);
    lines.push(`- P95: ${r.latency.p95.toFixed(3)}`);
    lines.push(`- P99: ${r.latency.p99.toFixed(3)}`);
    lines.push(`- StdDev: ${r.latency.stdDev.toFixed(3)}`);
    lines.push('');
    lines.push('**Throughput**:');
    lines.push(`- Cells/sec: ${formatNumber(Math.round(r.throughput.cellsPerSecond))}`);
    lines.push(`- MB/sec: ${r.throughput.mbPerSecond.toFixed(2)}`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Save markdown report.
 */
export function saveMarkdownReport(
  results: BenchmarkResult[],
  filename: string,
  comparisons?: ComparisonResult[],
): void {
  ensureDir(RESULTS_DIR);
  const report = generateMarkdownReport(results, comparisons);
  const filePath = join(RESULTS_DIR, filename);
  writeFileSync(filePath, report);
  console.log(`Markdown report saved to: ${filePath}`);
}

// =============================================================================
// XLSX File Generation
// =============================================================================

/**
 * Generate a simple XLSX file programmatically.
 *
 * This creates a valid XLSX file with minimal structure for benchmarking.
 * Uses ZIP and XML templates to create files of various sizes.
 */
export async function generateXlsxFile(spec: FileSpec): Promise<Uint8Array> {
  // Dynamic import of JSZip
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();

  const { rows, cols } = spec;
  const cellCount = rows * cols;

  // [Content_Types].xml
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
  );

  // _rels/.rels
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
  );

  // xl/_rels/workbook.xml.rels
  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
  );

  // xl/workbook.xml
  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Sheet1" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`,
  );

  // xl/styles.xml (minimal styles)
  zip.file(
    'xl/styles.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
</styleSheet>`,
  );

  // xl/sharedStrings.xml (empty for numbers-only benchmark)
  zip.file(
    'xl/sharedStrings.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="0" uniqueCount="0">
</sst>`,
  );

  // xl/worksheets/sheet1.xml - generate cell data
  const sheetXml = generateSheetXml(rows, cols);
  zip.file('xl/worksheets/sheet1.xml', sheetXml);

  // Generate zip buffer
  const buffer = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return buffer;
}

/**
 * Generate sheet XML with cells.
 */
function generateSheetXml(rows: number, cols: number): string {
  const lines: string[] = [];

  lines.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  lines.push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">');
  lines.push('<sheetData>');

  for (let r = 1; r <= rows; r++) {
    lines.push(`<row r="${r}">`);
    for (let c = 1; c <= cols; c++) {
      const cellRef = colToLetter(c) + r;
      const value = r * 1000 + c; // Unique numeric value
      lines.push(`<c r="${cellRef}"><v>${value}</v></c>`);
    }
    lines.push('</row>');
  }

  lines.push('</sheetData>');
  lines.push('</worksheet>');

  return lines.join('');
}

/**
 * Convert column number to Excel letter (1=A, 26=Z, 27=AA).
 */
function colToLetter(col: number): string {
  let result = '';
  let n = col;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

/**
 * Generate XLSX file with specific features for feature benchmarks.
 */
export async function generateFeatureXlsxFile(
  spec: FileSpec,
  features: {
    styles?: number;
    formulas?: boolean;
    richText?: boolean;
    merges?: number;
  },
): Promise<Uint8Array> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();

  const { rows, cols } = spec;
  const { styles = 1, formulas = false, richText = false, merges = 0 } = features;

  // [Content_Types].xml
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
  );

  // _rels/.rels
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
  );

  // xl/_rels/workbook.xml.rels
  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
  );

  // xl/workbook.xml
  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Sheet1" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`,
  );

  // Generate styles.xml with multiple styles
  const stylesXml = generateStylesXml(styles);
  zip.file('xl/styles.xml', stylesXml);

  // Generate shared strings for rich text or regular strings
  const sharedStringsXml = richText
    ? generateRichTextSharedStrings(Math.min(rows * cols, 10000))
    : generateSharedStrings(Math.min(rows * cols, 10000));
  zip.file('xl/sharedStrings.xml', sharedStringsXml);

  // Generate sheet with formulas or values
  const sheetXml = generateFeatureSheetXml(rows, cols, { formulas, merges, styles });
  zip.file('xl/worksheets/sheet1.xml', sheetXml);

  const buffer = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return buffer;
}

/**
 * Generate styles.xml with multiple unique styles.
 */
function generateStylesXml(styleCount: number): string {
  const lines: string[] = [];

  lines.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  lines.push('<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">');

  // Number formats
  lines.push(`<numFmts count="${Math.min(styleCount, 100)}">`);
  for (let i = 0; i < Math.min(styleCount, 100); i++) {
    lines.push(`<numFmt numFmtId="${164 + i}" formatCode="0.${'0'.repeat(i % 10)}"/>`);
  }
  lines.push('</numFmts>');

  // Fonts with variations
  lines.push(`<fonts count="${Math.min(styleCount, 100)}">`);
  for (let i = 0; i < Math.min(styleCount, 100); i++) {
    const size = 10 + (i % 20);
    const bold = i % 2 === 0 ? '<b/>' : '';
    const italic = i % 3 === 0 ? '<i/>' : '';
    lines.push(`<font>${bold}${italic}<sz val="${size}"/><name val="Arial"/></font>`);
  }
  lines.push('</fonts>');

  // Fills
  lines.push(`<fills count="${Math.min(styleCount, 50) + 2}">`);
  lines.push('<fill><patternFill patternType="none"/></fill>');
  lines.push('<fill><patternFill patternType="gray125"/></fill>');
  for (let i = 0; i < Math.min(styleCount, 50); i++) {
    const r = ((i * 17) % 256).toString(16).padStart(2, '0');
    const g = ((i * 31) % 256).toString(16).padStart(2, '0');
    const b = ((i * 47) % 256).toString(16).padStart(2, '0');
    lines.push(
      `<fill><patternFill patternType="solid"><fgColor rgb="FF${r}${g}${b}"/></patternFill></fill>`,
    );
  }
  lines.push('</fills>');

  // Borders
  lines.push(`<borders count="${Math.min(styleCount, 20) + 1}">`);
  lines.push('<border><left/><right/><top/><bottom/><diagonal/></border>');
  for (let i = 0; i < Math.min(styleCount, 20); i++) {
    const style = ['thin', 'medium', 'thick', 'dashed'][i % 4];
    lines.push(
      `<border><left style="${style}"/><right style="${style}"/><top style="${style}"/><bottom style="${style}"/><diagonal/></border>`,
    );
  }
  lines.push('</borders>');

  // Cell style XFs
  lines.push(
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>',
  );

  // Cell XFs (the actual styles)
  lines.push(`<cellXfs count="${styleCount}">`);
  for (let i = 0; i < styleCount; i++) {
    const numFmtId = 164 + (i % 100);
    const fontId = i % Math.min(styleCount, 100);
    const fillId = 2 + (i % Math.min(styleCount, 50));
    const borderId = 1 + (i % Math.min(styleCount, 20));
    lines.push(
      `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"/>`,
    );
  }
  lines.push('</cellXfs>');

  lines.push('</styleSheet>');
  return lines.join('');
}

/**
 * Generate shared strings.
 */
function generateSharedStrings(count: number): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  lines.push(
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${count}" uniqueCount="${count}">`,
  );

  for (let i = 0; i < count; i++) {
    lines.push(`<si><t>String value ${i} with some text content</t></si>`);
  }

  lines.push('</sst>');
  return lines.join('');
}

/**
 * Generate rich text shared strings.
 */
function generateRichTextSharedStrings(count: number): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  lines.push(
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${count}" uniqueCount="${count}">`,
  );

  for (let i = 0; i < count; i++) {
    lines.push('<si>');
    lines.push(
      '<r><rPr><b/><sz val="11"/><color rgb="FF000000"/><rFont val="Arial"/></rPr><t>Bold </t></r>',
    );
    lines.push(
      '<r><rPr><i/><sz val="11"/><color rgb="FF0000FF"/><rFont val="Arial"/></rPr><t>Italic </t></r>',
    );
    lines.push(`<r><t>Normal ${i}</t></r>`);
    lines.push('</si>');
  }

  lines.push('</sst>');
  return lines.join('');
}

/**
 * Generate sheet XML with features.
 */
function generateFeatureSheetXml(
  rows: number,
  cols: number,
  features: { formulas: boolean; merges: number; styles: number },
): string {
  const lines: string[] = [];
  const { formulas, merges, styles } = features;

  lines.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  lines.push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">');

  // Merge cells
  if (merges > 0) {
    lines.push(`<mergeCells count="${merges}">`);
    for (let i = 0; i < merges && i < rows; i++) {
      const startCol = colToLetter(1);
      const endCol = colToLetter(Math.min(3, cols));
      lines.push(`<mergeCell ref="${startCol}${i + 1}:${endCol}${i + 1}"/>`);
    }
    lines.push('</mergeCells>');
  }

  lines.push('<sheetData>');

  let stringIndex = 0;
  for (let r = 1; r <= rows; r++) {
    lines.push(`<row r="${r}">`);
    for (let c = 1; c <= cols; c++) {
      const cellRef = colToLetter(c) + r;
      const styleIdx = styles > 1 ? (r * cols + c) % styles : 0;

      if (formulas && c > 1) {
        // Formula referencing previous cell
        const prevCell = colToLetter(c - 1) + r;
        lines.push(
          `<c r="${cellRef}" s="${styleIdx}"><f>${prevCell}+1</f><v>${r * 1000 + c}</v></c>`,
        );
      } else if (r % 3 === 0) {
        // String value
        lines.push(`<c r="${cellRef}" t="s" s="${styleIdx}"><v>${stringIndex % 10000}</v></c>`);
        stringIndex++;
      } else {
        // Numeric value
        lines.push(`<c r="${cellRef}" s="${styleIdx}"><v>${r * 1000 + c}</v></c>`);
      }
    }
    lines.push('</row>');
  }

  lines.push('</sheetData>');
  lines.push('</worksheet>');

  return lines.join('');
}

// =============================================================================
// Benchmark Runner Utilities
// =============================================================================

export interface BenchmarkConfig {
  iterations: number;
  warmupIterations: number;
  onProgress?: (message: string) => void;
}

export const DEFAULT_BENCHMARK_CONFIG: BenchmarkConfig = {
  iterations: 10,
  warmupIterations: 3,
  onProgress: console.log,
};
