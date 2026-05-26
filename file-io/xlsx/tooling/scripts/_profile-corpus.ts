#!/usr/bin/env npx tsx
/**
 * Profile ALL xlsx files in the corpus using the profiled WASM parser.
 * Usage: cd os && npx tsx xlsx/tooling/scripts/_profile-corpus.ts <corpus-path>
 *
 * Or set MOG_XLSX_CORPUS_DIR.
 * Produces a detailed timing report with per-phase breakdowns and aggregate stats.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(import.meta.url);
const wasmJsModule = require('../../../../compute/wasm/npm/compute_core_wasm.js');

const corpusArg = process.argv[2] || process.env.MOG_XLSX_CORPUS_DIR;
if (!corpusArg) {
  console.error('Usage: _profile-corpus.ts <corpus-path> or set MOG_XLSX_CORPUS_DIR');
  process.exit(1);
}

const corpusDir = resolve(corpusArg);

interface FileTimings {
  dir: string;
  sizeBytes: number;
  sizeMB: number;
  cellCount: number;
  sheetCount: number;
  sharedStringCount: number;
  zipIndexUs: number;
  sharedStringsUs: number;
  ssZipUs: number;
  ssParseRefsUs: number;
  ssMaterializeUs: number;
  ssXmlBytes: number;
  ssCountTotal: number;
  ssCountPlain: number;
  ssCountEntities: number;
  ssCountRichText: number;
  stylesUs: number;
  metadataUs: number;
  worksheetParseUs: number;
  serdeSerializeUs: number;
  totalUs: number;
  error?: string;
}

// Find all corpus directories containing latest.xlsx
const entries = readdirSync(corpusDir).filter((e) => {
  if (e === 'crashtest-report.json') return false;
  try {
    const s = statSync(join(corpusDir, e));
    return s.isDirectory();
  } catch {
    return false;
  }
});

console.log(`Found ${entries.length} corpus files in ${corpusDir}`);
console.log('Starting WASM profiled parsing...\n');

const results: FileTimings[] = [];
let processed = 0;
const startAll = performance.now();

for (const dir of entries) {
  const xlsxPath = join(corpusDir, dir, 'latest.xlsx');
  processed++;

  try {
    const data = readFileSync(xlsxPath);
    const sizeBytes = data.length;
    const sizeMB = sizeBytes / 1024 / 1024;

    const profiled = wasmJsModule.parse_xlsx_full_profiled(new Uint8Array(data));
    const t = profiled.timings;
    const r = profiled.result;

    const entry: FileTimings = {
      dir,
      sizeBytes,
      sizeMB,
      cellCount: r.stats.totalCells,
      sheetCount: r.sheets.length,
      sharedStringCount: r.sharedStrings.length,
      zipIndexUs: t.zip_index_us,
      sharedStringsUs: t.shared_strings_us,
      ssZipUs: t.ss_zip_us,
      ssParseRefsUs: t.ss_parse_refs_us,
      ssMaterializeUs: t.ss_materialize_us,
      ssXmlBytes: t.ss_xml_bytes,
      ssCountTotal: t.ss_count_total,
      ssCountPlain: t.ss_count_plain,
      ssCountEntities: t.ss_count_entities,
      ssCountRichText: t.ss_count_rich_text,
      stylesUs: t.styles_us,
      metadataUs: t.metadata_us,
      worksheetParseUs: t.worksheet_parse_us,
      serdeSerializeUs: t.serde_serialize_us,
      totalUs: t.total_us,
    };

    results.push(entry);

    const totalMs = (t.total_us / 1000).toFixed(0);
    const cellsPerSec =
      t.total_us > 0 ? ((r.stats.totalCells / t.total_us) * 1_000_000).toFixed(0) : '0';
    process.stdout.write(
      `  [${processed}/${entries.length}] ${dir.slice(0, 12)}... ${sizeMB.toFixed(1)}MB  ${r.stats.totalCells} cells  ${totalMs}ms  (${cellsPerSec} cells/s)\n`,
    );
  } catch (err: any) {
    results.push({
      dir,
      sizeBytes: 0,
      sizeMB: 0,
      cellCount: 0,
      sheetCount: 0,
      sharedStringCount: 0,
      zipIndexUs: 0,
      sharedStringsUs: 0,
      ssZipUs: 0,
      ssParseRefsUs: 0,
      ssMaterializeUs: 0,
      ssXmlBytes: 0,
      ssCountTotal: 0,
      ssCountPlain: 0,
      ssCountEntities: 0,
      ssCountRichText: 0,
      stylesUs: 0,
      metadataUs: 0,
      worksheetParseUs: 0,
      serdeSerializeUs: 0,
      totalUs: 0,
      error: err.message?.slice(0, 200),
    });
    process.stdout.write(
      `  [${processed}/${entries.length}] ${dir.slice(0, 12)}... ERROR: ${err.message?.slice(0, 80)}\n`,
    );
  }
}

const wallClockMs = performance.now() - startAll;

// === Analysis ===
const ok = results.filter((r) => !r.error);
const errors = results.filter((r) => r.error);

// Sort by total parse time descending
const byTime = [...ok].sort((a, b) => b.totalUs - a.totalUs);

// Aggregate stats
const totalCells = ok.reduce((s, r) => s + r.cellCount, 0);
const totalBytes = ok.reduce((s, r) => s + r.sizeBytes, 0);
const totalParseUs = ok.reduce((s, r) => s + r.totalUs, 0);
const totalZipUs = ok.reduce((s, r) => s + r.zipIndexUs, 0);
const totalSSUs = ok.reduce((s, r) => s + r.sharedStringsUs, 0);
const totalStylesUs = ok.reduce((s, r) => s + r.stylesUs, 0);
const totalMetaUs = ok.reduce((s, r) => s + r.metadataUs, 0);
const totalWSUs = ok.reduce((s, r) => s + r.worksheetParseUs, 0);
const totalSerdeUs = ok.reduce((s, r) => s + r.serdeSerializeUs, 0);

const ms = (us: number) => (us / 1000).toFixed(1) + 'ms';
const sec = (us: number) => (us / 1_000_000).toFixed(2) + 's';
const pct = (part: number, whole: number) =>
  whole > 0 ? ((part / whole) * 100).toFixed(1) + '%' : '-';
const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1) + 'MB';

console.log('\n' + '═'.repeat(80));
console.log('  CORPUS PROFILING REPORT — WASM parse_xlsx_full_profiled()');
console.log('═'.repeat(80));

console.log(`\n  Files: ${ok.length} parsed, ${errors.length} errors`);
console.log(`  Total cells: ${totalCells.toLocaleString()}`);
console.log(`  Total file size: ${mb(totalBytes)}`);
console.log(`  Wall clock: ${(wallClockMs / 1000).toFixed(1)}s`);
console.log(`  Sum of parse times: ${sec(totalParseUs)}`);
console.log(
  `  Aggregate throughput: ${((totalCells / totalParseUs) * 1_000_000).toFixed(0)} cells/s`,
);
console.log(
  `  Aggregate throughput: ${(((totalBytes / totalParseUs) * 1_000_000) / 1024 / 1024).toFixed(1)} MB/s`,
);

console.log('\n┌──────────────────────────────────────────────────────────┐');
console.log('│  PHASE BREAKDOWN (aggregate across all files)           │');
console.log('├──────────────────────────────────────────────────────────┤');
console.log(
  `│  ZIP index:         ${sec(totalZipUs).padStart(8)}   ${pct(totalZipUs, totalParseUs).padStart(6)}  │`,
);
console.log(
  `│  Shared strings:    ${sec(totalSSUs).padStart(8)}   ${pct(totalSSUs, totalParseUs).padStart(6)}  │`,
);
console.log(
  `│  Styles:            ${sec(totalStylesUs).padStart(8)}   ${pct(totalStylesUs, totalParseUs).padStart(6)}  │`,
);
console.log(
  `│  Metadata:          ${sec(totalMetaUs).padStart(8)}   ${pct(totalMetaUs, totalParseUs).padStart(6)}  │`,
);
console.log(
  `│  Worksheets:        ${sec(totalWSUs).padStart(8)}   ${pct(totalWSUs, totalParseUs).padStart(6)}  │`,
);
console.log(
  `│  Serde serialize:   ${sec(totalSerdeUs).padStart(8)}   ${pct(totalSerdeUs, totalParseUs).padStart(6)}  │`,
);
console.log('└──────────────────────────────────────────────────────────┘');

console.log('\n── TOP 15 SLOWEST FILES ──');
console.log(
  '  ' +
    'Dir'.padEnd(14) +
    'Size'.padStart(8) +
    'Cells'.padStart(10) +
    'Total'.padStart(10) +
    'ZIP'.padStart(8) +
    'SS'.padStart(8) +
    'Styles'.padStart(8) +
    'WS'.padStart(8) +
    'Serde'.padStart(8) +
    'cells/s'.padStart(12),
);
for (const r of byTime.slice(0, 15)) {
  const cellsPerSec = r.totalUs > 0 ? ((r.cellCount / r.totalUs) * 1_000_000).toFixed(0) : '-';
  console.log(
    '  ' +
      (r.dir.slice(0, 12) + '..').padEnd(14) +
      mb(r.sizeBytes).padStart(8) +
      r.cellCount.toLocaleString().padStart(10) +
      ms(r.totalUs).padStart(10) +
      ms(r.zipIndexUs).padStart(8) +
      ms(r.sharedStringsUs).padStart(8) +
      ms(r.stylesUs).padStart(8) +
      ms(r.worksheetParseUs).padStart(8) +
      ms(r.serdeSerializeUs).padStart(8) +
      cellsPerSec.padStart(12),
  );
}

console.log('\n── TOP 15 FASTEST FILES ──');
const byTimeFastest = [...ok].sort((a, b) => a.totalUs - b.totalUs);
console.log(
  '  ' +
    'Dir'.padEnd(14) +
    'Size'.padStart(8) +
    'Cells'.padStart(10) +
    'Total'.padStart(10) +
    'cells/s'.padStart(12),
);
for (const r of byTimeFastest.slice(0, 15)) {
  const cellsPerSec = r.totalUs > 0 ? ((r.cellCount / r.totalUs) * 1_000_000).toFixed(0) : '-';
  console.log(
    '  ' +
      (r.dir.slice(0, 12) + '..').padEnd(14) +
      mb(r.sizeBytes).padStart(8) +
      r.cellCount.toLocaleString().padStart(10) +
      ms(r.totalUs).padStart(10) +
      cellsPerSec.padStart(12),
  );
}

// Throughput distribution
const throughputs = ok
  .filter((r) => r.totalUs > 0)
  .map((r) => (r.cellCount / r.totalUs) * 1_000_000)
  .sort((a, b) => a - b);
if (throughputs.length > 0) {
  const p = (idx: number) => throughputs[Math.min(Math.floor(idx), throughputs.length - 1)]!;
  console.log('\n── THROUGHPUT DISTRIBUTION (cells/s) ──');
  console.log(`  Min:    ${p(0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  console.log(
    `  P10:    ${p(throughputs.length * 0.1).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
  );
  console.log(
    `  P25:    ${p(throughputs.length * 0.25).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
  );
  console.log(
    `  Median: ${p(throughputs.length * 0.5).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
  );
  console.log(
    `  P75:    ${p(throughputs.length * 0.75).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
  );
  console.log(
    `  P90:    ${p(throughputs.length * 0.9).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
  );
  console.log(
    `  Max:    ${p(throughputs.length - 1).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
  );
}

// Parse time distribution
const parseTimes = ok.map((r) => r.totalUs / 1000).sort((a, b) => a - b);
if (parseTimes.length > 0) {
  const p = (idx: number) => parseTimes[Math.min(Math.floor(idx), parseTimes.length - 1)]!;
  console.log('\n── PARSE TIME DISTRIBUTION (ms) ──');
  console.log(`  Min:    ${p(0).toFixed(1)}ms`);
  console.log(`  P10:    ${p(parseTimes.length * 0.1).toFixed(1)}ms`);
  console.log(`  P25:    ${p(parseTimes.length * 0.25).toFixed(1)}ms`);
  console.log(`  Median: ${p(parseTimes.length * 0.5).toFixed(1)}ms`);
  console.log(`  P75:    ${p(parseTimes.length * 0.75).toFixed(1)}ms`);
  console.log(`  P90:    ${p(parseTimes.length * 0.9).toFixed(1)}ms`);
  console.log(`  Max:    ${p(parseTimes.length - 1).toFixed(1)}ms`);
}

// Files where shared strings dominate
const ssHeavy = ok
  .filter((r) => r.totalUs > 0 && r.sharedStringsUs / r.totalUs > 0.3)
  .sort((a, b) => b.sharedStringsUs - a.sharedStringsUs);
if (ssHeavy.length > 0) {
  console.log(`\n── SHARED STRINGS BOTTLENECK (>${'30%'} of total) — ${ssHeavy.length} files ──`);
  console.log(
    '  ' +
      'Dir'.padEnd(14) +
      'SS Time'.padStart(10) +
      'SS %'.padStart(8) +
      'Total'.padStart(10) +
      'SS Count'.padStart(10) +
      'Rich'.padStart(8) +
      'XML MB'.padStart(8),
  );
  for (const r of ssHeavy.slice(0, 10)) {
    console.log(
      '  ' +
        (r.dir.slice(0, 12) + '..').padEnd(14) +
        ms(r.sharedStringsUs).padStart(10) +
        pct(r.sharedStringsUs, r.totalUs).padStart(8) +
        ms(r.totalUs).padStart(10) +
        r.ssCountTotal.toLocaleString().padStart(10) +
        r.ssCountRichText.toLocaleString().padStart(8) +
        (r.ssXmlBytes / 1024 / 1024).toFixed(2).padStart(8),
    );
  }
}

// Files where serde dominates
const serdeHeavy = ok
  .filter((r) => r.totalUs > 0 && r.serdeSerializeUs / r.totalUs > 0.3)
  .sort((a, b) => b.serdeSerializeUs - a.serdeSerializeUs);
if (serdeHeavy.length > 0) {
  console.log(`\n── SERDE BOTTLENECK (>${'30%'} of total) — ${serdeHeavy.length} files ──`);
  console.log(
    '  ' +
      'Dir'.padEnd(14) +
      'Serde'.padStart(10) +
      'Serde %'.padStart(9) +
      'Total'.padStart(10) +
      'Cells'.padStart(10),
  );
  for (const r of serdeHeavy.slice(0, 10)) {
    console.log(
      '  ' +
        (r.dir.slice(0, 12) + '..').padEnd(14) +
        ms(r.serdeSerializeUs).padStart(10) +
        pct(r.serdeSerializeUs, r.totalUs).padStart(9) +
        ms(r.totalUs).padStart(10) +
        r.cellCount.toLocaleString().padStart(10),
    );
  }
}

// Files where worksheet parsing dominates
const wsHeavy = ok
  .filter((r) => r.totalUs > 0 && r.worksheetParseUs / r.totalUs > 0.5)
  .sort((a, b) => b.worksheetParseUs - a.worksheetParseUs);
if (wsHeavy.length > 0) {
  console.log(`\n── WORKSHEET PARSING DOMINANT (>${'50%'} of total) — ${wsHeavy.length} files ──`);
  console.log(
    '  ' +
      'Dir'.padEnd(14) +
      'WS Time'.padStart(10) +
      'WS %'.padStart(8) +
      'Total'.padStart(10) +
      'Cells'.padStart(10) +
      'Sheets'.padStart(8),
  );
  for (const r of wsHeavy.slice(0, 10)) {
    console.log(
      '  ' +
        (r.dir.slice(0, 12) + '..').padEnd(14) +
        ms(r.worksheetParseUs).padStart(10) +
        pct(r.worksheetParseUs, r.totalUs).padStart(8) +
        ms(r.totalUs).padStart(10) +
        r.cellCount.toLocaleString().padStart(10) +
        String(r.sheetCount).padStart(8),
    );
  }
}

if (errors.length > 0) {
  console.log(`\n── ERRORS (${errors.length} files) ──`);
  for (const r of errors) {
    console.log(`  ${r.dir}: ${r.error}`);
  }
}

// Save JSON report
const reportPath = join(corpusDir, 'profile-report.json');
const report = {
  generated: new Date().toISOString(),
  summary: {
    files: ok.length,
    errors: errors.length,
    totalCells,
    totalBytes,
    totalParseMsSum: totalParseUs / 1000,
    wallClockMs,
    aggregateCellsPerSec: (totalCells / totalParseUs) * 1_000_000,
    aggregateMBPerSec: ((totalBytes / totalParseUs) * 1_000_000) / 1024 / 1024,
    phaseBreakdown: {
      zipIndex: { us: totalZipUs, pct: totalZipUs / totalParseUs },
      sharedStrings: { us: totalSSUs, pct: totalSSUs / totalParseUs },
      styles: { us: totalStylesUs, pct: totalStylesUs / totalParseUs },
      metadata: { us: totalMetaUs, pct: totalMetaUs / totalParseUs },
      worksheets: { us: totalWSUs, pct: totalWSUs / totalParseUs },
      serde: { us: totalSerdeUs, pct: totalSerdeUs / totalParseUs },
    },
  },
  files: byTime.map((r) => ({
    dir: r.dir,
    sizeMB: +r.sizeMB.toFixed(2),
    cells: r.cellCount,
    sheets: r.sheetCount,
    sharedStrings: r.sharedStringCount,
    totalMs: +(r.totalUs / 1000).toFixed(1),
    cellsPerSec: r.totalUs > 0 ? +((r.cellCount / r.totalUs) * 1_000_000).toFixed(0) : 0,
    phases: {
      zipIndexMs: +(r.zipIndexUs / 1000).toFixed(1),
      sharedStringsMs: +(r.sharedStringsUs / 1000).toFixed(1),
      stylesMs: +(r.stylesUs / 1000).toFixed(1),
      metadataMs: +(r.metadataUs / 1000).toFixed(1),
      worksheetsMs: +(r.worksheetParseUs / 1000).toFixed(1),
      serdeMs: +(r.serdeSerializeUs / 1000).toFixed(1),
    },
    sharedStringDetail: {
      total: r.ssCountTotal,
      plain: r.ssCountPlain,
      entities: r.ssCountEntities,
      richText: r.ssCountRichText,
      xmlMB: +(r.ssXmlBytes / 1024 / 1024).toFixed(2),
    },
  })),
  errors: errors.map((r) => ({ dir: r.dir, error: r.error })),
};

writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`\nJSON report saved to: ${reportPath}`);
