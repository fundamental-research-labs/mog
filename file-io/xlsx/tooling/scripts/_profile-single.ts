#!/usr/bin/env npx tsx
/**
 * Profile a single XLSX file using the profiled WASM parser.
 * Usage: tsx scripts/_profile-single.ts <path-to-xlsx>
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const wasmJsModule = require('../../../../compute/wasm/npm/compute_core_wasm.js');

const xlsxPath = process.argv[2];
if (!xlsxPath) {
  console.error('Usage: tsx scripts/_profile-single.ts <path-to-xlsx>');
  process.exit(1);
}

const xlsxData = readFileSync(xlsxPath);
console.log('File size:', (xlsxData.length / 1024 / 1024).toFixed(2), 'MB');

const profiled = wasmJsModule.parse_xlsx_full_profiled(new Uint8Array(xlsxData));
const timings = profiled.timings;

const ms = (us: number) => (us / 1000).toFixed(1) + 'ms';
const pct = (part: number, whole: number) =>
  whole > 0 ? ((part / whole) * 100).toFixed(1) + '%' : '-';

console.log();
console.log('=== Phase Timing Breakdown ===');
console.log('ZIP index:        ' + ms(timings.zip_index_us));
console.log(
  'Shared strings:   ' +
    ms(timings.shared_strings_us) +
    '  (' +
    pct(timings.shared_strings_us, timings.total_us) +
    ' of total)',
);
console.log(
  '  ├─ ZIP decomp:  ' +
    ms(timings.ss_zip_us) +
    '  (xml: ' +
    (timings.ss_xml_bytes / 1024 / 1024).toFixed(2) +
    ' MB)',
);
console.log('  ├─ Parse refs:  ' + ms(timings.ss_parse_refs_us));
console.log('  └─ Materialize: ' + ms(timings.ss_materialize_us));
console.log('Styles:           ' + ms(timings.styles_us));
console.log('Metadata:         ' + ms(timings.metadata_us));
console.log('Worksheets:       ' + ms(timings.worksheet_parse_us));
console.log('Serde serialize:  ' + ms(timings.serde_serialize_us));
console.log('─────────────────────────────');
console.log('Total:            ' + ms(timings.total_us));

console.log();
console.log('=== String Categories ===');
const total = timings.ss_count_total;
console.log(
  'Plain (zero-copy): ' + timings.ss_count_plain + '  (' + pct(timings.ss_count_plain, total) + ')',
);
console.log(
  'Entities-only:     ' +
    timings.ss_count_entities +
    '  (' +
    pct(timings.ss_count_entities, total) +
    ')',
);
console.log(
  'Rich text:         ' +
    timings.ss_count_rich_text +
    '  (' +
    pct(timings.ss_count_rich_text, total) +
    ')',
);
console.log('Total:             ' + total);

const result = profiled.result;
console.log();
console.log('=== Content Summary ===');
console.log('Sheets:', result.sheets.length);
console.log('Total cells:', result.stats.totalCells);
console.log('Shared strings:', result.sharedStrings.length);
console.log('Defined names:', result.definedNames.length);

console.log();
console.log('=== Per-Sheet Breakdown ===');
for (const s of result.sheets) {
  const formulas = s.cells.filter((c: any) => c.formula).length;
  console.log(
    '  ' +
      s.name.padEnd(30) +
      ' cells=' +
      String(s.cells.length).padStart(8) +
      '  formulas=' +
      String(formulas).padStart(6) +
      '  merges=' +
      s.merges.length +
      '  cf=' +
      s.conditionalFormats.length +
      '  dv=' +
      s.dataValidations.length,
  );
}
